"use client";

/**
 * PMS-ADMIN-AUTH-001-CP06: the Staff session as this page knows it.
 *
 * The session itself is the API's HttpOnly `.TheBha.Staff` cookie; nothing here
 * stores it, or the identity, anywhere but React state. `GET /me` is the only
 * source of truth: `401` → not signed in; a network, CORS, configuration or
 * server failure → an error (never a signed-out state, and never a mode
 * change); a `200` this page cannot read → an error, with access closed.
 *
 * Every check, refresh, expiry and sign-out takes a new generation number. An
 * answer that belongs to an older generation is dropped, so a slow `me` from
 * before a sign-out, a re-login or a newer refresh can never write over the
 * newer state.
 *
 * CP06-C1: a sign-out waiting for the server is not superseded by anything. A
 * refresh asked for meanwhile reads nothing: after a confirmed sign-out it is
 * moot; after an unconfirmed one it runs then, once, and the sign-out reports
 * back only when it has answered — so the page never resumes changes on
 * memberships it was told to check again.
 *
 * CP06-C2: the sign-out transition lasts until that re-read has answered. A
 * refresh already on the wire when Sign out is clicked is handed over to it
 * (its caller gets the re-read's answer), and a refresh asked for during the
 * re-read joins it instead of starting another. If the re-read finds no
 * session, the session ends; if it cannot check access, access closes as an
 * error with Retry — never left open on the roles it was meant to check.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchStaffSession,
  staffLogout,
  type StaffLogoutOutcome,
  type StaffSession,
} from "@/lib/api/staff";

export type StaffSessionState =
  | { status: "checking" }
  | { status: "authenticated"; session: StaffSession; refreshing: boolean }
  | { status: "unauthenticated"; reason: "none" | "expired" | "signed-out" }
  | { status: "error"; message: string };

/** What a refresh found; the caller decides what to do about anything but `authenticated`. */
export type StaffRefreshResult = "authenticated" | "unauthenticated" | "error" | "superseded";

interface StaffSessionContextValue {
  state: StaffSessionState;
  /** Re-reads `me` once. Updates the session on success; leaves the state alone otherwise. */
  refresh: () => Promise<StaffRefreshResult>;
  /** Checks again from scratch (after an error). */
  retry: () => void;
  /** The server said the session is no longer valid: close everything. */
  expire: () => void;
  /** `POST logout`. Only a confirmed outcome (`204`/`401`) ends the session here. */
  signOut: () => Promise<StaffLogoutOutcome>;
}

const StaffSessionContext = createContext<StaffSessionContextValue | null>(null);

const SIGN_OUT_NOT_CONFIRMED = "Sign-out could not be confirmed. Your session may still be active.";
const ACCESS_NOT_CHECKED = "Sign-out was not confirmed, and your access could not be checked again";

/** CP06-C1: a sign-out waiting for the server, and the refresh asked for while it waited. */
interface PendingSignOut {
  promise: Promise<StaffLogoutOutcome>;
  refreshWanted: boolean;
  refreshResult: StaffRefreshResult | null;
}

/** CP06-C2: one public refresh on the wire, and the sign-out that took it over, if any. */
interface RefreshInFlight {
  handedTo: PendingSignOut | null;
}

/** What one `me` read found (internal): the refresh result, plus why it failed when it did. */
interface MeRead {
  result: StaffRefreshResult;
  message?: string;
}

export function StaffSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StaffSessionState>({ status: "checking" });
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const begin = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  /** Bumped by `retry`: each value is one full check from scratch. */
  const [checkToken, setCheckToken] = useState(0);

  // The state already says "checking" when this runs: on mount it is the initial
  // state, and `retry` sets it before bumping the token.
  useEffect(() => {
    const generation = begin();
    const controller = new AbortController();
    controllerRef.current = controller;
    fetchStaffSession(controller.signal).then((result) => {
      if (generationRef.current !== generation) return;
      controllerRef.current = null;
      if (result.kind === "authenticated") setState({ status: "authenticated", session: result.session, refreshing: false });
      else if (result.kind === "unauthenticated") setState({ status: "unauthenticated", reason: "none" });
      else setState({ status: "error", message: result.message });
    });
    return () => {
      // Unmounted, or replaced by a newer check: what is still on the wire belongs to nobody.
      generationRef.current += 1;
      controller.abort();
    };
  }, [checkToken, begin]);

  /**
   * CP06-C1/C2: set from Sign out until the transition is over — the logout's
   * answer and, when one is owed, the re-read after it. Cleared only by the
   * sign-out that set it.
   */
  const signOutRef = useRef<PendingSignOut | null>(null);
  /** CP06-C2: the public refresh on the wire, so a sign-out can take it over. */
  const refreshInFlightRef = useRef<RefreshInFlight | null>(null);

  const readMe = useCallback(async (): Promise<MeRead> => {
    const generation = begin();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((previous) => (previous.status === "authenticated" ? { ...previous, refreshing: true } : previous));
    const result = await fetchStaffSession(controller.signal);
    if (generationRef.current !== generation) return { result: "superseded" };
    controllerRef.current = null;
    if (result.kind === "authenticated") {
      setState({ status: "authenticated", session: result.session, refreshing: false });
      return { result: "authenticated" };
    }
    setState((previous) => (previous.status === "authenticated" ? { ...previous, refreshing: false } : previous));
    return result.kind === "unauthenticated" ? { result: "unauthenticated" } : { result: "error", message: result.message };
  }, [begin]);

  /** Waits for a sign-out transition and returns the re-read it ran, or "superseded" when the session ended. */
  const joinSignOut = useCallback(async (pending: PendingSignOut): Promise<StaffRefreshResult> => {
    pending.refreshWanted = true;
    await pending.promise;
    return pending.refreshResult ?? "superseded";
  }, []);

  const refresh = useCallback(async (): Promise<StaffRefreshResult> => {
    const pending = signOutRef.current;
    if (pending !== null) return joinSignOut(pending);
    const inFlight: RefreshInFlight = { handedTo: null };
    refreshInFlightRef.current = inFlight;
    const { result } = await readMe();
    if (refreshInFlightRef.current === inFlight) refreshInFlightRef.current = null;
    // CP06-C2: a sign-out interrupted this check and owes it; its answer is this caller's.
    return inFlight.handedTo ? joinSignOut(inFlight.handedTo) : result;
  }, [readMe, joinSignOut]);

  const expire = useCallback(() => {
    begin();
    setState({ status: "unauthenticated", reason: "expired" });
  }, [begin]);

  const signOut = useCallback((): Promise<StaffLogoutOutcome> => {
    if (signOutRef.current) return signOutRef.current.promise;
    // CP06-C2: a permission check on the wire is taken over before it is cut off, so it is redone if needed.
    const interrupted = refreshInFlightRef.current;
    refreshInFlightRef.current = null;
    // Whatever `me` is still on the wire belongs to the session being signed out.
    const generation = begin();
    const waiting: Omit<PendingSignOut, "promise"> = { refreshWanted: interrupted !== null, refreshResult: null };
    const promise = (async (): Promise<StaffLogoutOutcome> => {
      try {
        let outcome: StaffLogoutOutcome;
        try {
          outcome = await staffLogout();
        } catch {
          outcome = { kind: "unconfirmed", message: SIGN_OUT_NOT_CONFIRMED };
        }
        if (outcome.kind !== "unconfirmed") {
          // Confirmed (`204`, or `401`: already gone) — final, whatever else happened meanwhile.
          begin();
          setState({ status: "unauthenticated", reason: "signed-out" });
        } else if (waiting.refreshWanted && generationRef.current === generation) {
          // Still signed in, and a denial asked for the roles to be checked: check them before reporting back.
          // The internal read, not `refresh` — that would wait on this very transition.
          const read = await readMe();
          waiting.refreshResult = read.result;
          if (read.result === "unauthenticated") {
            begin();
            setState({ status: "unauthenticated", reason: "expired" });
          } else if (read.result === "error") {
            // Access stays closed until Retry: never resume on the roles this check was meant to verify.
            begin();
            setState({ status: "error", message: `${ACCESS_NOT_CHECKED}: ${read.message ?? "the Admin API did not answer."} Retry to check it.` });
          }
        }
        return outcome;
      } finally {
        if (signOutRef.current === waiting) signOutRef.current = null;
      }
    })();
    const pending: PendingSignOut = Object.assign(waiting, { promise });
    signOutRef.current = pending;
    if (interrupted) interrupted.handedTo = pending;
    return promise;
  }, [begin, readMe]);

  const retry = useCallback(() => {
    if (signOutRef.current) return;
    setState({ status: "checking" });
    setCheckToken((token) => token + 1);
  }, []);

  const value = useMemo(() => ({ state, refresh, retry, expire, signOut }), [state, refresh, retry, expire, signOut]);
  return <StaffSessionContext.Provider value={value}>{children}</StaffSessionContext.Provider>;
}

export function useStaffSession(): StaffSessionContextValue {
  const value = useContext(StaffSessionContext);
  if (!value) throw new Error("useStaffSession must be used inside StaffSessionProvider.");
  return value;
}
