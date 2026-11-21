/**
 * BHA-ADMIN-BADGE-001-PR04 (ADR 0011 §B/§E): the typed client of the shared per-Staff unseen routes — `GET /api/admin/v1/menu-unseen`, `POST …/{menu}/seen` — and the address of the
 * activity hint Hub. Same outcomes as every Admin call (`call` in `./website`). A watermark is an opaque decimal STRING, never a JSON number, and is only compared as a BigInt.
 * A menu or Property the Staff may not read is ABSENT from the answer, never 0.
 *
 * BHA-ADMIN-BADGE-001-PR05 (ADR 0011 §B): the two read-only lists behind the unseen popover (`GET …/{menu}/changes`) and the history screen (`GET …/activity`). Neither writes: opening or
 * paging them never says "seen". A menu or Property the Staff may not read answers 404, the same as an unknown one.
 */

import { ADMIN_MENU, isAdminMenuKey, type AdminMenuKey } from "@/lib/adminMenus";
import { call, isWatermark, target } from "./website";

export interface PropertyUnseen {
  propertyId: string;
  count: number;
  lastSeenWatermark: string;
  currentWatermark: string;
}

/** One menu as the API states it: a global menu has both watermarks, a Property-scoped one has `byProperty` and its `count` is the API's own sum of it. */
export interface MenuUnseenEntry {
  count: number;
  lastSeenWatermark?: string;
  currentWatermark?: string;
  byProperty?: PropertyUnseen[];
}

export type MenuUnseenSummary = Partial<Record<AdminMenuKey, MenuUnseenEntry>>;

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function parseGlobal(data: unknown): MenuUnseenEntry | null {
  return isRec(data) && isCount(data.count) && isWatermark(data.lastSeenWatermark) && isWatermark(data.currentWatermark)
    ? { count: data.count, lastSeenWatermark: data.lastSeenWatermark, currentWatermark: data.currentWatermark }
    : null;
}

function parseByProperty(data: unknown): MenuUnseenEntry | null {
  if (!isRec(data) || !isCount(data.count) || !Array.isArray(data.byProperty)) return null;
  const byProperty: PropertyUnseen[] = [];
  for (const item of data.byProperty) {
    if (!isRec(item) || typeof item.propertyId !== "string" || item.propertyId === "" || !isCount(item.count) || !isWatermark(item.lastSeenWatermark) || !isWatermark(item.currentWatermark)) return null;
    byProperty.push({ propertyId: item.propertyId, count: item.count, lastSeenWatermark: item.lastSeenWatermark, currentWatermark: item.currentWatermark });
  }
  return { count: data.count, byProperty };
}

/** An entry of the key's own shape (global, or Property-scoped). A key this build does not know is skipped, so a newer server never breaks an older Admin; a known key it cannot read makes the whole answer unreadable. */
export function parseMenuUnseenSummary(data: unknown): MenuUnseenSummary | null {
  if (!isRec(data) || !isRec(data.menus)) return null;
  const summary: MenuUnseenSummary = {};
  for (const [key, raw] of Object.entries(data.menus)) {
    if (!isAdminMenuKey(key)) continue;
    const entry = ADMIN_MENU[key].scope === "property" ? parseByProperty(raw) : parseGlobal(raw);
    if (!entry) return null;
    summary[key] = entry;
  }
  return summary;
}

const MENU_UNSEEN = "/api/admin/v1/menu-unseen";

/** Counts only: it never changes what has been seen. */
export const fetchMenuUnseenSummary = (signal?: AbortSignal) =>
  call<MenuUnseenSummary>("GET", MENU_UNSEEN, undefined, { write: false, parse: parseMenuUnseenSummary, signal });

/**
 * Says "this Staff member has seen the Newsletter list up to `viewWatermark`" — a watermark a list answered with, passed back unchanged — and answers with the entry after the move.
 * It is metadata, not a write of the screen's (`write: false`: no write slot, and a lost answer is an ordinary network failure): the same call with the same watermark is safe to
 * repeat. A 404 means this Staff member can no longer read the menu.
 */
export const markNewsletterSeen = (viewWatermark: string, signal?: AbortSignal) =>
  call<MenuUnseenEntry>("POST", `${MENU_UNSEEN}/newsletter/seen`, { viewWatermark }, { write: false, parse: parseGlobal, signal });

/**
 * Says "this Staff member has seen a menu's list up to `viewWatermark`" (BHA-ADMIN-BADGE-001-PR07: the four Blog menus use it; the Newsletter keeps `markNewsletterSeen`). Same route shape, same
 * answer (the entry after the move), same metadata semantics: `write: false`, safe to repeat with the same watermark, a 404 means the Staff member can no longer read the menu.
 * The third argument stays the AbortSignal. BHA-ADMIN-BADGE-001-PR10: a Property-scoped menu (`promotions`) passes the Property as the fourth; the body is then `{ propertyId, viewWatermark }`,
 * the acknowledgement moves that Property's cursor only, and the answer is the whole `{ count, byProperty }` entry (every Property the Staff may read, not just this one).
 */
export const markMenuSeen = (menu: AdminMenuKey, viewWatermark: string, signal?: AbortSignal, propertyId?: string) =>
  call<MenuUnseenEntry>("POST", `${MENU_UNSEEN}/${encodeURIComponent(menu)}/seen`, propertyId === undefined ? { viewWatermark } : { propertyId, viewWatermark }, {
    write: false, parse: propertyId === undefined ? parseGlobal : parseByProperty, signal,
  });

/** The two Calendar object kinds (ADR 0011 §D): the identity of a bar is its object, never its segment. */
export type CalendarEntityKind = "reservation-unit" | "room-block";

/** What the Calendar's one-object acknowledgement sends: `observedWatermark` is a decimal string that came with the data the Staff member was looking at (board `activity.watermark` or list `observedWatermark`). */
export interface CalendarEntitySeenRequest {
  propertyId: string;
  entityKind: CalendarEntityKind;
  entityId: string;
  observedWatermark: string;
}

/** The server's answer as of ITS moment: the object's cursor after the move, whether a newer event of another person keeps it unread, the Property's unread count and the counter. */
export interface CalendarEntitySeenAnswer {
  propertyId: string;
  entityKind: string;
  entityId: string;
  lastSeenWatermark: string;
  unread: boolean;
  count: number;
  currentWatermark: string;
}

export function parseCalendarEntitySeen(data: unknown): CalendarEntitySeenAnswer | null {
  if (!isRec(data) || !isStr(data.propertyId) || !isStr(data.entityKind) || !isStr(data.entityId) || typeof data.unread !== "boolean" || !isCount(data.count)) return null;
  if (!isWatermark(data.lastSeenWatermark) || !isWatermark(data.currentWatermark)) return null;
  return { propertyId: data.propertyId, entityKind: data.entityKind, entityId: data.entityId, lastSeenWatermark: data.lastSeenWatermark, unread: data.unread, count: data.count, currentWatermark: data.currentWatermark };
}

/**
 * Says "this Staff member has seen THIS Calendar object up to `observedWatermark`" (PR-12 route). Metadata like the other acknowledgements (`write: false`, safe to repeat). Never the menu-level
 * `calendar/seen` (a 400 by design) and never a segment id. A 404 means the Property or the object is no longer readable.
 */
export const markCalendarEntitySeen = (request: CalendarEntitySeenRequest, signal?: AbortSignal) =>
  call<CalendarEntitySeenAnswer>("POST", `${MENU_UNSEEN}/calendar/entities/seen`, {
    propertyId: request.propertyId, entityKind: request.entityKind, entityId: request.entityId, observedWatermark: request.observedWatermark,
  }, { write: false, parse: parseCalendarEntitySeen, signal });

/** The Hub's messages: `menuActivity` carries `{ menuKey, propertyId? }` and nothing to count; `menuActivityReady` says the connection is registered. */
export const MENU_ACTIVITY_EVENT = "menuActivity";
export const MENU_ACTIVITY_READY_EVENT = "menuActivityReady";
export const isMenuActivityHint = (value: unknown): boolean => isRec(value) && typeof value.menuKey === "string" && value.menuKey !== "";
export const menuActivityLiveTarget = () => target("/api/admin/v1/menu-unseen-live");

// ---------------------------------------------------------------- the unseen list (popover)

export interface ActivityActor {
  /** `Staff`, `Public` or `System`. */
  kind: string;
  staffId: string | null;
}

/** One group of the unseen list: one actor and one object. `events` counts logical events (the badge's number); `titleSnapshot` is text, never HTML. */
export interface UnseenGroup {
  entityKind: string;
  entityKey: string;
  titleSnapshot: string;
  action: string;
  events: number;
  itemCount: number;
  latestWatermark: string;
  occurredAtUtc: string;
  actors: ActivityActor[];
  /**
   * BHA-ADMIN-BADGE-001-PR13: only the Calendar's groups carry these three (the API's PR-12 contract). `entityId` is the object id (never a segment id); `presence` is the server's business state, not the
   * date window; `observedWatermark` is the newest number of the UNREAD rows of this snapshot, the only value a "mark seen" from this list may send back. An unknown `presence` is left out (no action).
   */
  entityId?: string;
  presence?: CalendarPresence;
  observedWatermark?: string;
}

export type CalendarPresence = "OnBoard" | "Removed";

/** `unseenEvents` is the exact total whatever the (at most 50) groups show; `hasMore` says more groups exist than are listed. */
export interface MenuChanges {
  menu: string;
  propertyId: string | null;
  unseenEvents: number;
  hasMore: boolean;
  lastSeenWatermark: string;
  snapshotWatermark: string;
  groups: UnseenGroup[];
}

const isStr = (value: unknown): value is string => typeof value === "string";
const isNullableStr = (value: unknown): value is string | null | undefined => value === null || value === undefined || isStr(value);

function parseActor(data: unknown): ActivityActor | null {
  return isRec(data) && isStr(data.kind) && isNullableStr(data.staffId) ? { kind: data.kind, staffId: data.staffId ?? null } : null;
}

function parseGroup(data: unknown): UnseenGroup | null {
  if (!isRec(data) || !isStr(data.entityKind) || !isStr(data.entityKey) || !isStr(data.titleSnapshot) || !isStr(data.action) || !isCount(data.events) || !isCount(data.itemCount)) return null;
  if (!isWatermark(data.latestWatermark) || !isStr(data.occurredAtUtc) || !Array.isArray(data.actors)) return null;
  const actors = data.actors.map(parseActor);
  if (actors.some((actor) => actor === null)) return null;
  if (data.observedWatermark !== undefined && !isWatermark(data.observedWatermark)) return null;
  if (data.entityId !== undefined && !isStr(data.entityId)) return null;
  return {
    entityKind: data.entityKind, entityKey: data.entityKey, titleSnapshot: data.titleSnapshot, action: data.action, events: data.events, itemCount: data.itemCount,
    latestWatermark: data.latestWatermark, occurredAtUtc: data.occurredAtUtc, actors: actors as ActivityActor[],
    ...(data.entityId !== undefined ? { entityId: data.entityId } : {}),
    ...(data.presence === "OnBoard" || data.presence === "Removed" ? { presence: data.presence } : {}),
    ...(data.observedWatermark !== undefined ? { observedWatermark: data.observedWatermark } : {}),
  };
}

export function parseMenuChanges(data: unknown): MenuChanges | null {
  if (!isRec(data) || !isStr(data.menu) || !isNullableStr(data.propertyId) || !isCount(data.unseenEvents) || typeof data.hasMore !== "boolean") return null;
  if (!isWatermark(data.lastSeenWatermark) || !isWatermark(data.snapshotWatermark) || !Array.isArray(data.groups)) return null;
  const groups = data.groups.map(parseGroup);
  if (groups.some((group) => group === null)) return null;
  return {
    menu: data.menu, propertyId: data.propertyId ?? null, unseenEvents: data.unseenEvents, hasMore: data.hasMore, lastSeenWatermark: data.lastSeenWatermark,
    snapshotWatermark: data.snapshotWatermark, groups: groups as UnseenGroup[],
  };
}

/** Reads only. A global menu sends no `propertyId`; a Property-scoped one sends exactly one. */
export const fetchMenuChanges = (menu: string, propertyId?: string, signal?: AbortSignal) =>
  call<MenuChanges>("GET", `${MENU_UNSEEN}/${encodeURIComponent(menu)}/changes${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`, undefined, { write: false, parse: parseMenuChanges, signal });

// ---------------------------------------------------------------- the history

export interface ActivityItem {
  /** The menu's own sequence, a decimal string. */
  sequence: string;
  occurredAtUtc: string;
  actorKind: string;
  actorStaffId: string | null;
  action: string;
  entityKind: string;
  entityKey: string;
  titleSnapshot: string;
  itemCount: number;
}

/** `nextCursor` is opaque: handed back exactly as received, `null` on the last page. */
export interface ActivityPage {
  menu: string;
  propertyId: string | null;
  items: ActivityItem[];
  nextCursor: string | null;
}

function parseItem(data: unknown): ActivityItem | null {
  if (!isRec(data) || !isWatermark(data.sequence) || !isStr(data.occurredAtUtc) || !isStr(data.actorKind) || !isNullableStr(data.actorStaffId)) return null;
  if (!isStr(data.action) || !isStr(data.entityKind) || !isStr(data.entityKey) || !isStr(data.titleSnapshot) || !isCount(data.itemCount)) return null;
  return {
    sequence: data.sequence, occurredAtUtc: data.occurredAtUtc, actorKind: data.actorKind, actorStaffId: data.actorStaffId ?? null, action: data.action,
    entityKind: data.entityKind, entityKey: data.entityKey, titleSnapshot: data.titleSnapshot, itemCount: data.itemCount,
  };
}

export function parseActivityPage(data: unknown): ActivityPage | null {
  if (!isRec(data) || !isStr(data.menu) || !isNullableStr(data.propertyId) || !Array.isArray(data.items) || !isNullableStr(data.nextCursor)) return null;
  const items = data.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  return { menu: data.menu, propertyId: data.propertyId ?? null, items: items as ActivityItem[], nextCursor: data.nextCursor ?? null };
}

export interface ActivityQuery {
  menu: string;
  propertyId?: string;
  actorStaffId?: string;
  /** Instants with an offset: `from` inclusive, `to` exclusive. */
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

/** Reads only. Empty filters are left out; the cursor is the one the previous page returned for THIS same query. */
export function fetchActivity(query: ActivityQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ menu: query.menu });
  for (const [name, value] of [["propertyId", query.propertyId], ["actorStaffId", query.actorStaffId], ["from", query.from], ["to", query.to], ["limit", query.limit === undefined ? undefined : String(query.limit)], ["cursor", query.cursor]] as const) {
    if (value) params.set(name, value);
  }
  return call<ActivityPage>("GET", `/api/admin/v1/activity?${params.toString()}`, undefined, { write: false, parse: parseActivityPage, signal });
}
