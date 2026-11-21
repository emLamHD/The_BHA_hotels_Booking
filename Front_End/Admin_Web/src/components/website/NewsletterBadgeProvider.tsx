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
 * the Blog (BHA-ADMIN-BADGE-001-PR07), Website (PR09) and Promotions (PR10) screens through `useMenuSeen`. It is never optimistic: the number changes when the server answers, and a failed call is
 * retried (a few times) with the SAME watermark and identity. Everything about it is per menu (what is on the wire, what waits, what the server last said), so one menu's call never holds up
 * another's. For a Property-scoped menu (`promotions`) that is per menu AND Property: A's call never holds up or drops B's; an acknowledgement's answer lists every Property, but only the
 * acknowledged one's row is merged into the latest summary, and only if the latest summary still lists that Property (a revoked Property is never brought back, a late answer or retry of it
 * is dropped, and what it had to say waits until a summary lists it again).
 * The sidebar never says "seen", and a watermark never comes from the summary GET.
 *
 * BHA-ADMIN-BADGE-001-PR13: the Calendar is acknowledged per OBJECT, not per menu (`seenCalendarEntity`, `POST menu-unseen/calendar/entities/seen`): by a click on its bar or by the "mark seen" button of
 * a removed object. It is its own path: the menu-level route does not exist for the Calendar, nothing here uses a summary's watermark, and nothing is merged into the summary from the answer (its
 * `lastSeenWatermark` is the OBJECT's cursor, not the Property's) — a successful call only schedules the usual GET. One call per Staff, Property and object is on the wire at a time. Nothing is sent
 * for a Property the latest answer does not list (or before there is an answer), and the answer of a call that outlived its life is handed back as `dropped`.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { WEBSITE_SETTINGS_PERMISSION } from "@/lib/api/staff";
import {
  MENU_ACTIVITY_EVENT,
  MENU_ACTIVITY_READY_EVENT,
  fetchMenuUnseenSummary,
  isMenuActivityHint,
  markCalendarEntitySeen,
  markMenuSeen,
  markNewsletterSeen,
  menuActivityLiveTarget,
  type CalendarEntitySeenAnswer,
  type CalendarEntitySeenRequest,
  type MenuUnseenEntry,
  type MenuUnseenSummary,
} from "@/lib/api/menuUnseen";
import { ADMIN_MENU, type AdminMenuKey } from "@/lib/adminMenus";
import { startNewsletterLive, type LiveStatus, type LiveStopReason } from "@/lib/website/newsletterLive";
import { useStaffSession } from "@/components/auth/StaffSession";
import { useNewsletterLive, useNewsletterLiveConnection, type LiveCallbacks } from "./useNewsletterLive";

/** How often the numbers are asked for while the tab is visible, whatever the sockets say. */
export const BADGE_POLL_MS = 30_000;
/** Requests wanted close together are one. */
export const BADGE_COALESCE_MS = 250;
/** The menus whose screen says "seen": the Newsletter, the four global Blog menus, (BHA-ADMIN-BADGE-001-PR09) the seven Website ones and (PR10) the Property-scoped Promotions and (PR11) the global Catalog. */
export type SeenMenu = Extract<
  AdminMenuKey,
  | "newsletter" | "blog-posts" | "blog-categories" | "blog-media" | "blog-settings"
  | "website-hero" | "website-menus" | "website-languages" | "website-translations" | "website-currencies" | "website-social" | "newsletter-sender"
  | "promotions" | "catalog"
>;

/** A failed acknowledgement is tried again after these delays (same watermark, same identity), then left to the next successful list. */
export const ACK_RETRY_MS: readonly number[] = [1500, 4000];

/** One acknowledgement of a Calendar object: the server's answer; `failed` (retry may help; nothing changed); `dropped` (nothing sent, or the answer belongs to a life, Property or session that is gone — paint nothing). */
export type CalendarAck = { kind: "ok"; answer: CalendarEntitySeenAnswer } | { kind: "failed" } | { kind: "dropped" };

interface SharedLive {
  status: LiveStatus;
  stoppedFor?: LiveStopReason;
  retry: () => void;
  /** The screen listens while it is mounted. Returns the way to stop. Nothing that happened before is replayed. */
  subscribe: (callbacks: LiveCallbacks) => () => void;
  /** The Newsletter's "seen up to this watermark" for this Staff identity. Safe to call again with the same one. */
  ack: (watermark: string, identity: string) => void;
  /** The same for any menu that says it. A Property-scoped menu (`promotions`) names its Property as the fourth argument and nothing is sent without it; a global menu has none. */
  seen: (menu: SeenMenu, watermark: string, identity: string, propertyId?: string) => void;
  /** BHA-ADMIN-BADGE-001-PR13: "this Staff member has seen this Calendar object up to this watermark". Never throws; see `CalendarAck`. */
  seenCalendarEntity: (identity: string, request: CalendarEntitySeenRequest) => Promise<CalendarAck>;
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

/** The Calendar's one-object acknowledgement. Without a provider (LocalGate mounts none) nothing is sent and the answer is `dropped`. */
export const useCalendarSeen = (): SharedLive["seenCalendarEntity"] => useContext(SharedContext)?.seenCalendarEntity ?? NO_CALENDAR_SEEN;
const NO_CALENDAR_SEEN: SharedLive["seenCalendarEntity"] = () => Promise.resolve({ kind: "dropped" });

/** The Newsletter screen's way into the shared connection and the acknowledgement. `null` when no provider is mounted (the screen then runs by itself). */
export const useSharedNewsletterLive = (): SharedLive | null => useContext(SharedContext);

const isPropertyMenu = (menu: SeenMenu): boolean => ADMIN_MENU[menu].scope === "property";
/** One queue and one waiting watermark per menu, and for a Property-scoped menu per Property. */
const ackKey = (menu: SeenMenu, propertyId?: string): string => (propertyId === undefined ? menu : `${menu}|${propertyId}`);

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

/**
 * A Property-scoped entry (BHA-ADMIN-BADGE-001-PR10-C1): the latest successful summary's `byProperty` is the membership (a Property it omits is dropped, one it lists is kept), and each
 * listed row is compared with the cached row of THE SAME Property only: the cached row stays when it is newer (an acknowledgement already moved its cursor), the incoming one wins otherwise.
 * The published aggregate is the API's own `count` when every row came from the answer, and the sum of the rows that are shown when a cached row was kept: never a Property that is gone.
 */
function reconcileProperties(before: Known | undefined, entry: MenuUnseenEntry, seq: number): Known {
  const rows = (entry.byProperty ?? []).map((row) => {
    const cached = before?.entry.byProperty?.find((property) => property.propertyId === row.propertyId);
    if (!before || !cached) return row;
    const last = BigInt(row.lastSeenWatermark), current = BigInt(row.currentWatermark);
    const cachedLast = BigInt(cached.lastSeenWatermark), cachedCurrent = BigInt(cached.currentWatermark);
    const older = last < cachedLast || current < cachedCurrent || (last === cachedLast && current === cachedCurrent && seq < before.seq);
    return older ? cached : row;
  });
  const fromAnswer = rows.every((row, index) => row === entry.byProperty?.[index]);
  const merged: MenuUnseenEntry = { count: fromAnswer ? entry.count : rows.reduce((sum, row) => sum + row.count, 0), byProperty: rows };
  return { entry: merged, marks: marksOf(merged), seq: before ? Math.max(before.seq, seq) : seq };
}

function offer(known: Map<string, Known>, key: string, entry: MenuUnseenEntry, seq: number) {
  if (entry.byProperty) {
    known.set(key, reconcileProperties(known.get(key), entry, seq));
    return;
  }
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
  /**
   * BHA-ADMIN-BADGE-001-PR07-C2: acknowledgements for a Blog menu that the latest summary did not list (a permission just granted or restored, the cached answer not caught up). The newest
   * watermark per menu is kept, from a read that WAS shown, until a successful summary of this same life lists the menu; then it goes out through the normal pipeline. Never from a summary,
   * and emptied with the life (sign-out, expiry, another Staff member).
   */
  const deferred = useRef(new Map<string, { menu: SeenMenu; propertyId?: string; value: bigint }>());
  /** The Properties the latest answer lists, per Property-scoped menu (from the answer itself, whatever `offer` kept): the only thing that says a Property may be acknowledged now. */
  const allowedProperties = useRef(new Map<string, Set<string>>());
  const flushDeferred = useRef<(forIdentity: string) => void>(() => undefined);
  const pauseRevoked = useRef<() => void>(() => undefined);
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
      allowedProperties.current = new Map(Object.entries(summary).flatMap(([key, entry]) => (entry?.byProperty ? [[key, new Set(entry.byProperty.map((property) => property.propertyId))] as const] : [])));
      publish(forIdentity);
      pauseRevoked.current();                                                                // a Property that left the answer stops saying what it had queued
      flushDeferred.current(forIdentity);                                                    // a menu that is listed now can say what it was waiting to say
    },
    [publish],
  );

  /** An acknowledgement's answer updates that menu's entry, but never puts a menu back that the latest answer left out. Before the first answer it is only remembered (it can be newer than a slow GET). */
  const applyAck = useCallback(
    (menu: SeenMenu, entry: MenuUnseenEntry, seq: number, forIdentity: string, gen: number, propertyId?: string) => {
      if (gen !== generation.current || forIdentity !== identityRef.current) return;
      if (allowed.current && !allowed.current.has(menu)) return;
      if (propertyId !== undefined) {
        // The answer lists every Property as of ITS moment; only the acknowledged Property's row is merged, into the latest answer, and only if that answer still lists the Property and the row is
        // not older than what is known for it. Another Property's number, the list of Properties and the aggregate stay the latest answer's own.
        const before = known.current.get(menu);
        const row = entry.byProperty?.find((property) => property.propertyId === propertyId);
        const current = before?.entry.byProperty?.find((property) => property.propertyId === propertyId);
        if (!before || !row || !current || !allowedProperties.current.get(menu)?.has(propertyId)) return;
        if (BigInt(row.lastSeenWatermark) < BigInt(current.lastSeenWatermark) || BigInt(row.currentWatermark) < BigInt(current.currentWatermark)) return;
        const byProperty = (before.entry.byProperty ?? []).map((property) => (property.propertyId === propertyId ? row : property));
        const merged: MenuUnseenEntry = { count: byProperty.reduce((sum, property) => sum + property.count, 0), byProperty };
        known.current.set(menu, { entry: merged, marks: marksOf(merged), seq: before.seq });
        publish(forIdentity);
        return;
      }
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

  // ---- saying "seen": per menu (and Property), one on the wire at a time, the newest waiting watermark behind it
  const acks = useRef(new Map<string, { inFlight: boolean; queued: bigint | null; menu: SeenMenu; propertyId?: string }>());
  const slot = (menu: SeenMenu, propertyId?: string) => {
    const key = ackKey(menu, propertyId);
    let state = acks.current.get(key);
    if (!state) acks.current.set(key, (state = { inFlight: false, queued: null, menu, propertyId }));
    return state;
  };
  /**
   * Whether the latest answer lets this menu (and Property) be acknowledged. Before the first answer a global menu is tried, as before (the Newsletter never consulted it); a Property-scoped
   * menu waits (BHA-ADMIN-BADGE-001-PR10-C1): only a summary of this life can say the Staff may still read that Property, and the waiting watermark is then sent through `seen`.
   */
  const readable = (menu: SeenMenu, propertyId?: string): boolean => {
    if (menu === "newsletter") return true;
    if (!allowed.current) return !isPropertyMenu(menu);
    if (!allowed.current.has(menu)) return false;
    return propertyId === undefined || (allowedProperties.current.get(menu)?.has(propertyId) ?? false);
  };
  /** The newest watermark of a read that WAS shown for a menu/Property the latest answer leaves out, kept until a summary of this life lists it again. */
  const defer = (menu: SeenMenu, propertyId: string | undefined, value: bigint) => {
    const key = ackKey(menu, propertyId);
    const waiting = deferred.current.get(key);
    if (waiting === undefined || value > waiting.value) deferred.current.set(key, { menu, propertyId, value });
  };
  const cursorOf = (menu: SeenMenu, propertyId?: string): bigint | undefined => {
    const marks = known.current.get(menu)?.marks;
    return propertyId === undefined ? marks?.[0]?.last : marks?.find((mark) => mark.id === propertyId)?.last;
  };
  const send = useCallback(async (menu: SeenMenu, watermark: bigint, forIdentity: string, gen: number, propertyId?: string) => {
    const state = slot(menu, propertyId);
    state.inFlight = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        // A retry never goes out for a Property the latest answer no longer lists: what it had to say waits for a summary that lists it again.
        if (attempt > 0 && !readable(menu, propertyId)) {
          defer(menu, propertyId, watermark);
          return;
        }
        issued.current += 1;
        const seq = issued.current;
        const result = await (menu === "newsletter"
          ? markNewsletterSeen(String(watermark))
          : propertyId === undefined ? markMenuSeen(menu, String(watermark)) : markMenuSeen(menu, String(watermark), undefined, propertyId));
        if (gen !== generation.current) return;
        if (result.kind === "ok") {
          applyAck(menu, result.data, seq, forIdentity, gen, propertyId);
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
        const last = cursorOf(menu, propertyId);
        if (next !== null && (last === undefined || next > last)) {
          if (readable(menu, propertyId)) void send(menu, next, forIdentity, gen, propertyId);
          else defer(menu, propertyId, next);
        }
      }
    }
  }, [applyAck, authFailure, requestRefresh]);

  const seen = useCallback(
    (menu: SeenMenu, watermark: string, forIdentity: string, propertyId?: string) => {
      if (!identityRef.current || forIdentity !== identityRef.current) return;     // another (or no) Staff identity: not ours to say
      if (!/^(0|[1-9][0-9]*)$/.test(watermark)) return;
      if (isPropertyMenu(menu) ? !propertyId : propertyId !== undefined) return;   // a Property-scoped menu is acknowledged per Property, a global one never has one
      const value = BigInt(watermark);
      // A menu (or Property) the latest answer leaves out is not readable as far as the API has said: nothing is sent and it is never brought back. The watermark of a read that WAS shown is kept
      // (the newest per menu and Property) for the next successful summary of this life that lists it. (The Newsletter's call is unchanged: it never consulted the answer.)
      if (!readable(menu, propertyId)) {
        defer(menu, propertyId, value);
        return;
      }
      const last = cursorOf(menu, propertyId);
      if (last !== undefined && value <= last) return;                             // nothing new to say
      const state = slot(menu, propertyId);
      if (state.inFlight) {
        state.queued = state.queued === null || value > state.queued ? value : state.queued;
        return;
      }
      void send(menu, value, forIdentity, generation.current, propertyId);
    },
    [send],
  );
  const ack = useCallback((watermark: string, forIdentity: string) => seen("newsletter", watermark, forIdentity), [seen]);

  // ---- saying "seen" for ONE Calendar object: one call per Property and object on the wire; the same or a lower watermark meanwhile gets that call back
  const calendarPending = useRef(new Map<string, { value: bigint; promise: Promise<CalendarAck> }>());
  const seenCalendarEntity = useCallback(
    (forIdentity: string, request: CalendarEntitySeenRequest): Promise<CalendarAck> => {
      const dropped: Promise<CalendarAck> = Promise.resolve({ kind: "dropped" });
      if (!identityRef.current || forIdentity !== identityRef.current) return dropped;
      if (!request.propertyId || !request.entityId || !/^(0|[1-9][0-9]*)$/.test(request.observedWatermark)) return dropped;
      // Only a Property the latest answer lists may be acknowledged; before the first answer nothing is sent, and a revoked Property is never brought back.
      if (!allowed.current?.has("calendar") || !allowedProperties.current.get("calendar")?.has(request.propertyId)) return dropped;
      const value = BigInt(request.observedWatermark);
      const key = `${request.propertyId}|${request.entityKind}|${request.entityId}`;
      const waiting = calendarPending.current.get(key);
      if (waiting && waiting.value >= value) return waiting.promise;
      const gen = generation.current;
      const promise = (async (): Promise<CalendarAck> => {
        try {
          const result = await markCalendarEntitySeen(request);
          if (gen !== generation.current || forIdentity !== identityRef.current) return { kind: "dropped" };
          if (result.kind === "ok") {
            requestRefresh();                                                      // the number comes from the API's next GET, never from this answer
            return { kind: "ok", answer: result.data };
          }
          if (result.kind === "unauthenticated" || result.kind === "denied") {
            authFailure(result.kind, gen);
            return { kind: "dropped" };
          }
          if (result.kind === "refused" && result.status === 404) {
            requestRefresh();                                                      // not readable any more: read the numbers again so it leaves the sidebar
            return { kind: "dropped" };
          }
          return { kind: "failed" };
        } finally {
          if (calendarPending.current.get(key)?.value === value) calendarPending.current.delete(key);
        }
      })();
      calendarPending.current.set(key, { value, promise });
      return promise;
    },
    [authFailure, requestRefresh],
  );
  useEffect(() => {
    flushDeferred.current = (forIdentity) => {
      for (const [key, waiting] of [...deferred.current]) {
        if (!allowed.current?.has(waiting.menu) || !readable(waiting.menu, waiting.propertyId)) continue;   // still not listed: keep waiting
        deferred.current.delete(key);
        seen(waiting.menu, String(waiting.value), forIdentity, waiting.propertyId);          // the same pipeline: dedupe against the cursor, one call per menu and Property in flight, retry, stale guards
      }
    };
    // A Property the latest answer no longer lists keeps nothing queued: what waited moves to `deferred` (an in-flight call and a retry stop on their own, see `send` and `applyAck`).
    pauseRevoked.current = () => {
      for (const state of acks.current.values()) {
        if (state.queued === null || readable(state.menu, state.propertyId)) continue;
        defer(state.menu, state.propertyId, state.queued);
        state.queued = null;
      }
    };
  }, [seen]);

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
    calendarPending.current = new Map();
    deferred.current = new Map();
    allowedProperties.current = new Map();
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
      allowedProperties.current = new Map();
      deferred.current = new Map();                                                          // what waited belonged to this life only
      calendarPending.current = new Map();
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
    () => ({ status: live.status, stoppedFor: live.stoppedFor, retry: live.retry, subscribe, ack, seen, seenCalendarEntity }),
    [live.status, live.stoppedFor, live.retry, subscribe, ack, seen, seenCalendarEntity],
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
