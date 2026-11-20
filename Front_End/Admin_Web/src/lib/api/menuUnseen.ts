/**
 * BHA-ADMIN-BADGE-001-PR04 (ADR 0011 §B/§E): the typed client of the shared per-Staff unseen routes — `GET /api/admin/v1/menu-unseen`, `POST …/{menu}/seen` — and the address of the
 * activity hint Hub. Same outcomes as every Admin call (`call` in `./website`). A watermark is an opaque decimal STRING, never a JSON number, and is only compared as a BigInt.
 * A menu or Property the Staff may not read is ABSENT from the answer, never 0.
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

/** The Hub's messages: `menuActivity` carries `{ menuKey, propertyId? }` and nothing to count; `menuActivityReady` says the connection is registered. */
export const MENU_ACTIVITY_EVENT = "menuActivity";
export const MENU_ACTIVITY_READY_EVENT = "menuActivityReady";
export const isMenuActivityHint = (value: unknown): boolean => isRec(value) && typeof value.menuKey === "string" && value.menuKey !== "";
export const menuActivityLiveTarget = () => target("/api/admin/v1/menu-unseen-live");
