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

  const refresh = useCallback(async (): Promise<StaffRefreshResult> => {
    const generation = begin();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((previous) => (previous.status === "authenticated" ? { ...previous, refreshing: true } : previous));
    const result = await fetchStaffSession(controller.signal);
    if (generationRef.current !== generation) return "superseded";
    controllerRef.current = null;
    if (result.kind === "authenticated") {
      setState({ status: "authenticated", session: result.session, refreshing: false });
      return "authenticated";
    }
    setState((previous) => (previous.status === "authenticated" ? { ...previous, refreshing: false } : previous));
    return result.kind === "unauthenticated" ? "unauthenticated" : "error";
  }, [begin]);

  const expire = useCallback(() => {
    begin();
    setState({ status: "unauthenticated", reason: "expired" });
  }, [begin]);

  const signOut = useCallback(async (): Promise<StaffLogoutOutcome> => {
    const generation = begin();
    const outcome = await staffLogout();
    if (generationRef.current === generation && outcome.kind !== "unconfirmed") {
      setState({ status: "unauthenticated", reason: "signed-out" });
    }
    return outcome;
  }, [begin]);

  const retry = useCallback(() => {
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
