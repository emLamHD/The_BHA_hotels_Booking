"use client";

/**
 * BHA-NEWSLETTER-BADGE-001: the Newsletter's unseen count for the whole Admin shell, and the ONE live connection that feeds it.
 *
 * Mounted once, in the Admin layout, inside the shared Staff session. It exists only for a confirmed session that holds the site-wide website permission; for anyone else nothing is
 * requested and nothing is shown.
 *
 * What the count is: whatever the API says (`GET menu-unseen`). SignalR is only a prompt to ask again (a signal is never counted), so the number is right after a lost socket, an API
 * restart or a missed signal. It is asked for when the session is confirmed, after a signal (gathered), after a reconnect, when the tab comes back to the foreground or gets focus, and
 * every 30 s while the tab is visible; one request is on the wire at a time and a request wanted meanwhile runs once afterwards. A failed request keeps the last number: never
 * zero, never a sign-out (only a 401/403 from the API says that, and goes to the session the way every other 401/403 does).
 *
 * "Seen" is said by the Newsletter screen after a list answered successfully, with the watermark THAT answer carried (`ack`). It is never optimistic: the number changes when the server
 * answers. A watermark is only ever passed back unchanged, with the same Staff identity, and a failed call is retried (a few times) with the SAME watermark, never one taken from a
 * later count. Answers are compared as integers (BigInt) and an answer older than what was already applied (either watermark lower) is dropped, so a slow count that started before an
 * acknowledgement can never bring the old number back. Identity change, sign-out and unmount start a new generation: whatever is still on the wire belongs to nobody.
 *
 * The screen takes part in the same connection (`useNewsletterLiveFeed`): it is told of signals and reconnects while it is mounted, nothing is replayed to it, and it never opens one of its own.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { WEBSITE_SETTINGS_PERMISSION } from "@/lib/api/staff";
import { fetchMenuUnseen, markNewsletterSeen, type MenuUnseenEntry } from "@/lib/api/website";
import type { LiveStatus, LiveStopReason } from "@/lib/website/newsletterLive";
import { useStaffSession } from "@/components/auth/StaffSession";
import { useNewsletterLive, useNewsletterLiveConnection, type LiveCallbacks } from "./useNewsletterLive";

/** How often the count is asked for while the tab is visible, whatever the socket says. */
export const BADGE_POLL_MS = 30_000;
/** Requests wanted close together are one. */
export const BADGE_COALESCE_MS = 250;
/** A failed acknowledgement is tried again after these delays (same watermark, same identity), then left to the next successful list. */
export const ACK_RETRY_MS: readonly number[] = [1500, 4000];

interface BadgeValue {
  /** Unseen verifications; 0 while nothing is known. */
  newsletter: number;
}

interface SharedLive {
  status: LiveStatus;
  stoppedFor?: LiveStopReason;
  retry: () => void;
  /** The screen listens while it is mounted. Returns the way to stop. Nothing that happened before is replayed. */
  subscribe: (callbacks: LiveCallbacks) => () => void;
  /** Says "seen up to this watermark" for this Staff identity. Safe to call again with the same one. */
  ack: (watermark: string, identity: string) => void;
}

const BadgeContext = createContext<BadgeValue>({ newsletter: 0 });
const SharedContext = createContext<SharedLive | null>(null);

/** The Newsletter's unseen count for the sidebar. 0 without a provider or without a known count. */
export const useMenuUnseen = (): BadgeValue => useContext(BadgeContext);

/** The Newsletter screen's way into the shared connection and the acknowledgement. `null` when no provider is mounted (the screen then runs by itself). */
export const useSharedNewsletterLive = (): SharedLive | null => useContext(SharedContext);

export function NewsletterBadgeProvider({ children }: { children: React.ReactNode }) {
  const { state, refresh, expire, failAccessCheck } = useStaffSession();
  const identity = state.status === "authenticated" && (state.session.permissions ?? []).includes(WEBSITE_SETTINGS_PERMISSION) ? state.session.staffAccountId : "";
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [count, setCount] = useState<number | null>(null);
  const applied = useRef<{ last: bigint; current: bigint } | null>(null);
  const generation = useRef(0);
  const sessionRef = useRef({ refresh, expire, failAccessCheck });
  sessionRef.current = { refresh, expire, failAccessCheck };

  // ---- what the API answered: one place, one rule
  const apply = useCallback((entry: MenuUnseenEntry, gen: number) => {
    if (gen !== generation.current) return;
    const next = { last: BigInt(entry.lastSeenWatermark), current: BigInt(entry.currentWatermark) };
    const before = applied.current;
    // An answer with a lower watermark than one already applied is older than it (both only grow on the server): it must not bring an old number back.
    if (before && (next.last < before.last || next.current < before.current)) return;
    applied.current = next;
    setCount(entry.count);
  }, []);

  const authFailure = useCallback((kind: "unauthenticated" | "denied", gen: number) => {
    if (gen !== generation.current) return;
    if (kind === "unauthenticated") {
      sessionRef.current.expire();
      return;
    }
    // A 403: the permission may be gone. Ask the session, and treat the answer as the website gate does for its own 403 (`WebsiteBoundary.onDenied`): no session → it ends; a read that
    // could not answer → access closes as an error with Retry (never left open on a permission that could not be checked, and never a sign-out); a confirmed session → it stands (the
    // screens re-render on whatever `me` says now); a read that a newer one replaced (`superseded`) says nothing. An answer that arrives for an earlier identity or generation is dropped.
    void sessionRef.current.refresh().then((result) => {
      if (gen !== generation.current) return;
      if (result === "unauthenticated") sessionRef.current.expire();
      else if (result === "error") sessionRef.current.failAccessCheck();
    });
  }, []);

  // ---- asking for the count
  const fetching = useRef(false);
  const again = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const runRefresh = useCallback(async () => {
    if (!identityRef.current) return;
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    const gen = generation.current;
    const mine = new AbortController();
    controller.current = mine;
    const result = await fetchMenuUnseen(mine.signal);
    if (gen !== generation.current) return;                                        // a later life owns the flags now
    fetching.current = false;
    if (result.kind === "ok") apply(result.data, gen);
    else if (result.kind === "unauthenticated" || result.kind === "denied") authFailure(result.kind, gen);
    // anything else (network, 5xx, an answer this page cannot read): the last number stays.
    if (again.current) {
      again.current = false;
      void runRefresh();
    }
  }, [apply, authFailure]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRefresh = useCallback(() => {
    if (!identityRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void runRefresh();
    }, BADGE_COALESCE_MS);
  }, [runRefresh]);

  // ---- saying "seen"
  const ackInFlight = useRef(false);
  const queued = useRef<bigint | null>(null);
  const send = useCallback(async (watermark: bigint, gen: number) => {
    ackInFlight.current = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        const result = await markNewsletterSeen(String(watermark));
        if (gen !== generation.current) return;
        if (result.kind === "ok") {
          apply(result.data, gen);
          return;
        }
        if (result.kind === "unauthenticated" || result.kind === "denied") {
          authFailure(result.kind, gen);
          return;
        }
        // Refused (a watermark the server does not accept): nothing to retry with. Network or server failure: the same watermark again, a few times.
        if (result.kind === "refused" || attempt >= ACK_RETRY_MS.length) return;
        await new Promise((resolve) => setTimeout(resolve, ACK_RETRY_MS[attempt]));
        if (gen !== generation.current) return;
      }
    } finally {
      if (gen === generation.current) {
        ackInFlight.current = false;
        const next = queued.current;
        queued.current = null;
        if (next !== null && (applied.current === null || next > applied.current.last)) void send(next, gen);
      }
    }
  }, [apply, authFailure]);

  const ack = useCallback(
    (watermark: string, forIdentity: string) => {
      if (!identityRef.current || forIdentity !== identityRef.current) return;     // another (or no) Staff identity: not ours to say
      if (!/^(0|[1-9][0-9]*)$/.test(watermark)) return;
      const value = BigInt(watermark);
      if (applied.current && value <= applied.current.last) return;                // nothing new to say
      if (ackInFlight.current) {
        queued.current = queued.current === null || value > queued.current ? value : queued.current;
        return;
      }
      void send(value, generation.current);
    },
    [send],
  );

  // ---- one life per Staff identity
  useEffect(() => {
    if (!identity) return undefined;
    generation.current += 1;
    const gen = generation.current;
    applied.current = null;
    setCount(null);
    fetching.current = false;
    again.current = false;
    ackInFlight.current = false;
    queued.current = null;
    void runRefresh();

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") requestRefresh();
    }, BADGE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") requestRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      generation.current = gen + 1;                                                // whatever is on the wire belongs to nobody now
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      controller.current?.abort();
      fetching.current = false;
      applied.current = null;
      setCount(null);
    };
  }, [identity, runRefresh, requestRefresh]);

  // ---- the one live connection
  const listeners = useRef(new Set<LiveCallbacks>());
  const subscribe = useCallback((callbacks: LiveCallbacks) => {
    listeners.current.add(callbacks);
    return () => {
      listeners.current.delete(callbacks);
    };
  }, []);
  const callbacks = useMemo<LiveCallbacks>(
    () => ({
      onReady: () => {
        requestRefresh();
        for (const listener of [...listeners.current]) listener.onReady();
      },
      onNew: (n) => {
        requestRefresh();
        for (const listener of [...listeners.current]) listener.onNew(n);
      },
    }),
    [requestRefresh],
  );
  const auth = useMemo(
    () => ({
      onUnauthenticated: () => authFailure("unauthenticated", generation.current),
      onDenied: () => authFailure("denied", generation.current),
    }),
    [authFailure],
  );
  const live = useNewsletterLiveConnection(identity, callbacks, auth, identity !== "");

  const shared = useMemo<SharedLive>(
    () => ({ status: live.status, stoppedFor: live.stoppedFor, retry: live.retry, subscribe, ack }),
    [live.status, live.stoppedFor, live.retry, subscribe, ack],
  );
  const badge = useMemo<BadgeValue>(() => ({ newsletter: count ?? 0 }), [count]);
  return (
    <BadgeContext.Provider value={badge}>
      <SharedContext.Provider value={shared}>{children}</SharedContext.Provider>
    </BadgeContext.Provider>
  );
}

/**
 * The Newsletter screen's view of the live connection: the shared one when a provider is mounted (it only listens), otherwise its own (the screen rendered without the Admin shell).
 * `ack` is a no-op without a provider (nothing shows a badge then).
 */
export function useNewsletterLiveFeed(identity: string, callbacks: LiveCallbacks) {
  const shared = useSharedNewsletterLive();
  const own = useNewsletterLive(identity, callbacks, shared === null);
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });
  const subscribe = shared?.subscribe;
  useEffect(() => {
    if (!subscribe) return undefined;
    // Routed through the ref: the screen's callbacks change with every render, the subscription does not.
    return subscribe({ onReady: () => callbacksRef.current.onReady(), onNew: (n) => callbacksRef.current.onNew(n) });
  }, [subscribe]);
  const noop = useCallback<(watermark: string, identity: string) => void>(() => undefined, []);
  return shared
    ? { status: shared.status, stoppedFor: shared.stoppedFor, retry: shared.retry, ack: shared.ack }
    : { status: own.status, stoppedFor: own.stoppedFor, retry: own.retry, ack: noop };
}
