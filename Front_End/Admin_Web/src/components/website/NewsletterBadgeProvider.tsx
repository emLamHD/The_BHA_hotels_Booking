"use client";

/**
 * BHA-ADMIN-BADGE-001-PR04 (ADR 0011 §B/§E; began as BHA-NEWSLETTER-BADGE-001): the unseen numbers of every Admin menu for the whole shell, and the live connections that feed them.
 * (The file keeps its name so the Newsletter screen's hooks below stay beside the history that explains them.)
 *
 * Mounted once, in `AdminStaffScope`, inside the shared Staff session, for ANY confirmed Staff identity (a Blog-only or Property-only Staff included): which menus and Properties they
 * may read is decided by the API, which leaves the others out of its answer. In `LocalGate` nothing is mounted: nothing is requested and no socket opens.
 *
 * What a number is: whatever the API says (`GET menu-unseen`). Nothing is counted here: a SignalR hint or a legacy Newsletter signal only schedules that GET. It is asked for when the
 * session is confirmed, after a hint (gathered), after a reconnect, when the tab returns to the foreground or gets focus, and every 30 s while visible; one GET is on the wire at a
 * time and one wanted meanwhile runs once afterwards. A failed GET keeps the last valid answer of the same identity (never zero, never a sign-out; only a 401/403 from the API says
 * that, and goes to the session the way every other one does).
 *
 * The LATEST valid answer is the list of what this Staff may read now: a menu or Property it leaves out is dropped, and nothing re-adds it. For each menu the entry shown is the
 * newer one: by watermark (BigInt, per menu and Property; a lower one is older and never brings an old number back), and at equal watermarks by the order the requests were issued
 * (the Newsletter's legacy cascade delete changes a count without moving a watermark). The state is tagged with the identity it was read for and shown only to that identity, so a new
 * Staff, a sign-out or an unmount shows nothing of the old one from the very next render; a new generation also drops whatever is still on the wire.
 *
 * Two connections, one GET path: the shared activity Hub (any identity) and the legacy Newsletter Hub (only a Staff who holds the website permission), which the Newsletter screen
 * shares through `useNewsletterLiveFeed` for its toast, refresh and catch-up (it never opens a third).
 *
 * "Seen" is said by a menu's own screen after a list answered successfully, with the watermark THAT answer carried, to `POST menu-unseen/{menu}/seen`: the Newsletter screen through `ack`,
 * the four Blog screens (BHA-ADMIN-BADGE-001-PR07) through `useMenuSeen`. It is never optimistic: the number changes when the server answers, and a failed call is retried (a few times)
 * with the SAME watermark and identity. Everything about it is per menu (what is on the wire, what waits, what the server last said), so one menu's call never holds up another's.
 * The sidebar never says "seen", and a watermark never comes from the summary GET.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { WEBSITE_SETTINGS_PERMISSION } from "@/lib/api/staff";
import {
  MENU_ACTIVITY_EVENT,
  MENU_ACTIVITY_READY_EVENT,
  fetchMenuUnseenSummary,
  isMenuActivityHint,
  markMenuSeen,
  markNewsletterSeen,
  menuActivityLiveTarget,
  type MenuUnseenEntry,
  type MenuUnseenSummary,
} from "@/lib/api/menuUnseen";
import type { AdminMenuKey } from "@/lib/adminMenus";
import { startNewsletterLive, type LiveStatus, type LiveStopReason } from "@/lib/website/newsletterLive";
import { useStaffSession } from "@/components/auth/StaffSession";
import { useNewsletterLive, useNewsletterLiveConnection, type LiveCallbacks } from "./useNewsletterLive";

/** How often the numbers are asked for while the tab is visible, whatever the sockets say. */
export const BADGE_POLL_MS = 30_000;
/** Requests wanted close together are one. */
export const BADGE_COALESCE_MS = 250;
/** The menus whose screen says "seen": the Newsletter and the four global Blog menus. */
export type SeenMenu = Extract<AdminMenuKey, "newsletter" | "blog-posts" | "blog-categories" | "blog-media" | "blog-settings">;

/** A failed acknowledgement is tried again after these delays (same watermark, same identity), then left to the next successful list. */
export const ACK_RETRY_MS: readonly number[] = [1500, 4000];

interface SharedLive {
  status: LiveStatus;
  stoppedFor?: LiveStopReason;
  retry: () => void;
  /** The screen listens while it is mounted. Returns the way to stop. Nothing that happened before is replayed. */
  subscribe: (callbacks: LiveCallbacks) => () => void;
  /** The Newsletter's "seen up to this watermark" for this Staff identity. Safe to call again with the same one. */
  ack: (watermark: string, identity: string) => void;
  /** The same for any menu that says it. */
  seen: (menu: SeenMenu, watermark: string, identity: string) => void;
}

/** One watermark pair: a global menu has one (`id` ""), a Property-scoped menu one per Property. */
interface Mark {
  id: string;
  last: bigint;
  current: bigint;
}
/** What is known of one menu: the API's entry, its watermarks as integers, and the order its request was issued in. */
interface Known {
  entry: MenuUnseenEntry;
  marks: Mark[];
  seq: number;
}

/**
 * What the unseen popover and the history screen need besides the numbers (BHA-ADMIN-BADGE-001-PR05): who the numbers belong to, whether the first answer for them has arrived (an empty
 * answer and "not read yet" both show no menu), the names of the Properties the session lists by id, and the way to report a 401/403 to the shared session.
 */
export interface UnseenScope {
  identity: string;
  ready: boolean;
  propertyNames: Readonly<Record<string, string>>;
  reportAuth: (kind: "unauthenticated" | "denied") => void;
}

const EMPTY: MenuUnseenSummary = Object.freeze({});
const NO_SCOPE: UnseenScope = { identity: "", ready: false, propertyNames: Object.freeze({}), reportAuth: () => undefined };
const MenuContext = createContext<MenuUnseenSummary>(EMPTY);
const ScopeContext = createContext<UnseenScope>(NO_SCOPE);
const SharedContext = createContext<SharedLive | null>(null);

/** The numbers the API gave for the menus this Staff may read. A menu that is not there is not allowed (or not known yet): show nothing for it. `{}` without a provider (LocalGate). */
export const useMenuUnseen = (): MenuUnseenSummary => useContext(MenuContext);

/** Who the numbers are for, and what a list under them needs. Without a provider (LocalGate) there is no identity and nothing is ready. */
export const useUnseenScope = (): UnseenScope => useContext(ScopeContext);

/** A menu's screen says "seen up to this watermark" through this, for the Staff identity that started the read. A no-op without a provider (LocalGate mounts none, so nothing is sent there). */
export const useMenuSeen = (): SharedLive["seen"] => useContext(SharedContext)?.seen ?? NO_SEEN;
const NO_SEEN: SharedLive["seen"] = () => undefined;

/** The Newsletter screen's way into the shared connection and the acknowledgement. `null` when no provider is mounted (the screen then runs by itself). */
export const useSharedNewsletterLive = (): SharedLive | null => useContext(SharedContext);

const marksOf = (entry: MenuUnseenEntry): Mark[] =>
  entry.byProperty
    ? entry.byProperty.map((property) => ({ id: property.propertyId, last: BigInt(property.lastSeenWatermark), current: BigInt(property.currentWatermark) }))
    : [{ id: "", last: BigInt(entry.lastSeenWatermark ?? "0"), current: BigInt(entry.currentWatermark ?? "0") }];

/** Older than what is known: a lower watermark (both only grow on the server), or the same watermarks from an earlier request. */
function isOlder(incoming: Known, before: Known): boolean {
  let same = true;
  for (const mark of incoming.marks) {
    const earlier = before.marks.find((candidate) => candidate.id === mark.id);
    if (!earlier) continue;
    if (mark.last < earlier.last || mark.current < earlier.current) return true;
    if (mark.last > earlier.last || mark.current > earlier.current) same = false;
  }
  return same && incoming.seq < before.seq;
}

function offer(known: Map<string, Known>, key: string, entry: MenuUnseenEntry, seq: number) {
  const incoming: Known = { entry, marks: marksOf(entry), seq };
  const before = known.get(key);
  if (!before || !isOlder(incoming, before)) known.set(key, incoming);
}

export function MenuUnseenProvider({ children }: { children: React.ReactNode }) {
  const { state, refresh, expire, failAccessCheck } = useStaffSession();
  const session = state.status === "authenticated" ? state.session : null;
  const identity = session?.staffAccountId ?? "";
  // Only a Staff who holds the website permission has a legacy Newsletter connection (its Hub refuses everyone else).
  const legacyIdentity = session && (session.permissions ?? []).includes(WEBSITE_SETTINGS_PERMISSION) ? identity : "";
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [snapshot, setSnapshot] = useState<{ identity: string; menus: MenuUnseenSummary } | null>(null);
  const known = useRef(new Map<string, Known>());
  /** The menus the latest answer allowed; `null` until the first answer of this life. */
  const allowed = useRef<Set<string> | null>(null);
  const issued = useRef(0);
  const generation = useRef(0);
  const sessionRef = useRef({ refresh, expire, failAccessCheck });
  sessionRef.current = { refresh, expire, failAccessCheck };

  // ---- what the API answered: one place, one rule
  const publish = useCallback((forIdentity: string) => {
    const menus: Record<string, MenuUnseenEntry> = {};
    for (const key of allowed.current ?? []) {
      const entry = known.current.get(key)?.entry;
      if (entry) menus[key] = entry;
    }
    setSnapshot({ identity: forIdentity, menus: menus as MenuUnseenSummary });
  }, []);

  const applySummary = useCallback(
    (summary: MenuUnseenSummary, seq: number, forIdentity: string, gen: number) => {
      if (gen !== generation.current || forIdentity !== identityRef.current) return;
      const keys = new Set(Object.keys(summary));
      for (const key of [...known.current.keys()]) if (!keys.has(key)) known.current.delete(key);     // no longer allowed: gone, and nothing can bring it back
      for (const [key, entry] of Object.entries(summary)) if (entry) offer(known.current, key, entry, seq);
      allowed.current = keys;
      publish(forIdentity);
    },
    [publish],
  );

  /** An acknowledgement's answer updates that menu's entry, but never puts a menu back that the latest answer left out. Before the first answer it is only remembered (it can be newer than a slow GET). */
  const applyAck = useCallback(
    (menu: SeenMenu, entry: MenuUnseenEntry, seq: number, forIdentity: string, gen: number) => {
      if (gen !== generation.current || forIdentity !== identityRef.current) return;
      if (allowed.current && !allowed.current.has(menu)) return;
      offer(known.current, menu, entry, seq);
      if (allowed.current) publish(forIdentity);
    },
    [publish],
  );

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

  // ---- asking for the numbers
  const fetching = useRef(false);
  const again = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRefresh = useCallback(async () => {
    const forIdentity = identityRef.current;
    if (!forIdentity) return;
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    // This GET covers every refresh asked for before it started, so a deadline still waiting would only fetch the same thing again. Anything asked for after this point is not covered.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const gen = generation.current;
    const mine = new AbortController();
    controller.current = mine;
    issued.current += 1;
    const seq = issued.current;
    const result = await fetchMenuUnseenSummary(mine.signal);
    if (gen !== generation.current) return;                                        // a later life owns the flags now
    fetching.current = false;
    if (result.kind === "ok") applySummary(result.data, seq, forIdentity, gen);
    else if (result.kind === "unauthenticated" || result.kind === "denied") authFailure(result.kind, gen);
    // anything else (network, 5xx, an answer this page cannot read): the last valid answer stays.
    if (again.current) {
      again.current = false;
      void runRefresh();
    }
  }, [applySummary, authFailure]);

  const requestRefresh = useCallback(() => {
    if (!identityRef.current) return;
    // The first deadline stands: a stream of hints must not keep moving it (that would starve the refresh), and one GET already covers every request made before it starts.
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void runRefresh();
    }, BADGE_COALESCE_MS);
  }, [runRefresh]);

  // ---- saying "seen": per menu, one on the wire at a time, the newest waiting watermark behind it
  const acks = useRef(new Map<SeenMenu, { inFlight: boolean; queued: bigint | null }>());
  const slot = (menu: SeenMenu) => {
    let state = acks.current.get(menu);
    if (!state) acks.current.set(menu, (state = { inFlight: false, queued: null }));
    return state;
  };
  const send = useCallback(async (menu: SeenMenu, watermark: bigint, forIdentity: string, gen: number) => {
    const state = slot(menu);
    state.inFlight = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        issued.current += 1;
        const seq = issued.current;
        const result = await (menu === "newsletter" ? markNewsletterSeen(String(watermark)) : markMenuSeen(menu, String(watermark)));
        if (gen !== generation.current) return;
        if (result.kind === "ok") {
          applyAck(menu, result.data, seq, forIdentity, gen);
          return;
        }
        if (result.kind === "unauthenticated" || result.kind === "denied") {
          authFailure(result.kind, gen);
          return;
        }
        if (result.kind === "refused") {
          // Nothing different to retry with. A 404 says this Staff member can no longer read the menu: read the numbers again so it leaves the sidebar.
          if (result.status === 404) requestRefresh();
          return;
        }
        // Network or server failure: the same watermark again, a few times.
        if (attempt >= ACK_RETRY_MS.length) return;
        await new Promise((resolve) => setTimeout(resolve, ACK_RETRY_MS[attempt]));
        if (gen !== generation.current) return;
      }
    } finally {
      if (gen === generation.current) {
        state.inFlight = false;
        const next = state.queued;
        state.queued = null;
        const last = known.current.get(menu)?.marks[0]?.last;
        if (next !== null && (last === undefined || next > last)) void send(menu, next, forIdentity, gen);
      }
    }
  }, [applyAck, authFailure, requestRefresh]);

  const seen = useCallback(
    (menu: SeenMenu, watermark: string, forIdentity: string) => {
      if (!identityRef.current || forIdentity !== identityRef.current) return;     // another (or no) Staff identity: not ours to say
      if (!/^(0|[1-9][0-9]*)$/.test(watermark)) return;
      // A Blog menu the latest answer leaves out: this Staff member may not read it, so there is nothing to acknowledge, and nothing brings it back. (The Newsletter's call is unchanged: it never consulted the answer.)
      if (menu !== "newsletter" && allowed.current && !allowed.current.has(menu)) return;
      const value = BigInt(watermark);
      const last = known.current.get(menu)?.marks[0]?.last;
      if (last !== undefined && value <= last) return;                             // nothing new to say
      const state = slot(menu);
      if (state.inFlight) {
        state.queued = state.queued === null || value > state.queued ? value : state.queued;
        return;
      }
      void send(menu, value, forIdentity, generation.current);
    },
    [send],
  );
  const ack = useCallback((watermark: string, forIdentity: string) => seen("newsletter", watermark, forIdentity), [seen]);

  // ---- one life per Staff identity
  useEffect(() => {
    if (!identity) return undefined;
    generation.current += 1;
    const gen = generation.current;
    known.current = new Map();
    allowed.current = null;
    fetching.current = false;
    again.current = false;
    acks.current = new Map();
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
      known.current = new Map();
      allowed.current = null;
      setSnapshot(null);
    };
  }, [identity, runRefresh, requestRefresh]);

  // ---- the shared activity Hub: a hint only schedules the GET; its payload is never read for a number
  useEffect(() => {
    if (!identity) return undefined;
    const gen = generation.current;                                                // this life's: a callback of a connection that outlived it can never act on the next one
    const hub = startNewsletterLive({
      target: menuActivityLiveTarget(),
      events: { signal: MENU_ACTIVITY_EVENT, ready: MENU_ACTIVITY_READY_EVENT, isSignal: isMenuActivityHint },
      handlers: {
        onReady: requestRefresh,
        onSignal: requestRefresh,
        onStatus: () => undefined,
        onUnauthenticated: () => authFailure("unauthenticated", gen),
        onDenied: () => authFailure("denied", gen),
      },
    });
    return () => hub.dispose();
  }, [identity, requestRefresh, authFailure]);

  // ---- the legacy Newsletter connection, shared with the Newsletter screen (toast, refresh, catch-up); its signals too only schedule the GET
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
  const live = useNewsletterLiveConnection(legacyIdentity, callbacks, auth, legacyIdentity !== "");

  const shared = useMemo<SharedLive>(
    () => ({ status: live.status, stoppedFor: live.stoppedFor, retry: live.retry, subscribe, ack, seen }),
    [live.status, live.stoppedFor, live.retry, subscribe, ack, seen],
  );
  // Tagged with the identity it was read for: for any other identity (or none) it is empty from this very render, before any effect has run.
  const menus = snapshot && snapshot.identity === identity ? snapshot.menus : EMPTY;
  const ready = snapshot !== null && snapshot.identity === identity;
  const memberships = session?.memberships;
  const scope = useMemo<UnseenScope>(
    () => ({
      identity,
      ready,
      propertyNames: Object.fromEntries((memberships ?? []).map((membership) => [membership.propertyId, membership.propertyName])),
      reportAuth: (kind) => authFailure(kind, generation.current),
    }),
    [identity, ready, memberships, authFailure],
  );
  return (
    <MenuContext.Provider value={menus}>
      <ScopeContext.Provider value={scope}>
        <SharedContext.Provider value={shared}>{children}</SharedContext.Provider>
      </ScopeContext.Provider>
    </MenuContext.Provider>
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
