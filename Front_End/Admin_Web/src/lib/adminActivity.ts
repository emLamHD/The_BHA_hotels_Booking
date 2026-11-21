/**
 * BHA-ADMIN-BADGE-001-PR05: what the unseen popover and the history screen share and nothing else needs — the Admin's day boundary, how a time and an actor are shown, and which menus and
 * Properties a Staff member's summary allows (the scopes they may pick).
 */

import { ADMIN_MENUS, ADMIN_MENU, type AdminMenuKey } from "@/lib/adminMenus";
import type { MenuUnseenSummary, PropertyUnseen } from "@/lib/api/menuUnseen";

/** The Admin's convention for a calendar day: Vietnam time, a fixed +07:00 with no daylight saving. */
export const ADMIN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const ADMIN_OFFSET = "+07:00";
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` for a real calendar date written `YYYY-MM-DD` (2026-02-30 is not one). */
export function isCalendarDay(day: string): boolean {
  const match = DAY.exec(day);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date;
}

/** The first instant of that day in the Admin's time zone: what the API's `from` (inclusive) takes. */
export const dayStart = (day: string) => `${day}T00:00:00${ADMIN_OFFSET}`;

/** The first instant AFTER that day: what the API's `to` (exclusive) takes, so "to 15 Nov" includes all of 15 Nov. */
export function dayAfter(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return dayStart(new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10));
}

export function formatActivityTime(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso : when.toLocaleString("vi-VN", { timeZone: ADMIN_TIME_ZONE, dateStyle: "short", timeStyle: "short" });
}

export const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Who did it, in words. No Staff name exists in this contract: a Staff actor is "Nhân viên", and the history can be narrowed to one by id. */
/**
 * What an event or group is called (BHA-ADMIN-BADGE-001-PR07): its safe title snapshot; a bulk picture upload has none (it is one event for many pictures), so it reads from its item count;
 * anything else without a title falls back to its kind. The count of events is never taken from here: it stays the server's.
 */
export function activityTitle(titleSnapshot: string, entityKind: string, itemCount: number): string {
  if (titleSnapshot) return titleSnapshot;
  return entityKind === "media-batch" ? `Tải lên ${itemCount} ảnh` : entityKind;
}

export function actorLabel(kind: string): string {
  return kind === "Staff" ? "Nhân viên" : kind === "Public" ? "Khách truy cập" : kind === "System" ? "Hệ thống" : kind;
}

/** The menus this summary allows, in the registry's order; `among` narrows them (a parent's children). Calendar included: it has no popover, but it has a history. */
export function allowedMenus(summary: MenuUnseenSummary, among?: readonly AdminMenuKey[]): AdminMenuKey[] {
  return ADMIN_MENUS.filter((menu) => summary[menu.key] !== undefined && (!among || among.includes(menu.key))).map((menu) => menu.key);
}

/** The Properties the summary allows for a Property-scoped menu; empty for a global one. */
export const allowedProperties = (summary: MenuUnseenSummary, menu: AdminMenuKey): PropertyUnseen[] =>
  ADMIN_MENU[menu].scope === "property" ? (summary[menu]?.byProperty ?? []) : [];

/**
 * The scope to request: the wanted menu if the summary allows it (else the first it allows), and for a Property-scoped menu exactly one allowed Property (the wanted one, else the first).
 * `null` when nothing is allowed. A global menu never carries a `propertyId`.
 */
export function resolveScope(summary: MenuUnseenSummary, menus: readonly AdminMenuKey[], wantedMenu?: string, wantedProperty?: string): { menu: AdminMenuKey; propertyId?: string } | null {
  const menu = menus.find((key) => key === wantedMenu) ?? menus[0];
  if (!menu) return null;
  if (ADMIN_MENU[menu].scope === "global") return { menu };
  const properties = allowedProperties(summary, menu);
  const property = properties.find((item) => item.propertyId === wantedProperty) ?? properties[0];
  return property ? { menu, propertyId: property.propertyId } : null;
}
