import { call, type WebsiteResult } from "./website";

/**
 * BHA-CHECKOUT-001-PR04: the Admin client of the per-Property booking-notification routes. Every route is authorized on the server (a Manager of that Property); nothing here decides access.
 * A write that got no answer is `unverified` and is never retried. The roster carries its own `propertyId` so a screen can refuse an answer that is not for the Property it shows.
 * The notification address is its own field: it is never the login address (which is not sent at all), and an unconfigured Staff member has `notificationEmail: null`.
 */

export type Coverage = "Local" | "Chain" | "OptedOut" | "NotConfigured";
const COVERAGES: readonly string[] = ["Local", "Chain", "OptedOut", "NotConfigured"];

export interface RecipientStaff {
  staffAccountId: string;
  /** The only identity sent for selection: masked login name, login domain and a short Staff id (`d***@hotel.example · #0f36aa6a`). The login address itself never reaches the browser and is never a recipient. */
  accountLabel: string;
  role: "FrontDesk" | "Manager";
  notificationEmail: string | null;
  isEnabled: boolean;
  /** The operator declared a chain work address for this Manager (the address itself is never sent here). */
  chainConfigured: boolean;
  coverage: Coverage;
  /** 0 until a row exists; a write quotes it. */
  version: number;
}

export interface RecipientFallback { email: string | null; version: number }
export interface RecipientRoster { propertyId: string; staff: RecipientStaff[]; fallback: RecipientFallback }

const rec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const optStr = (x: unknown) => x === null || typeof x === "string";

export function parseStaff(x: unknown): RecipientStaff | null {
  if (!rec(x) || typeof x.staffAccountId !== "string" || typeof x.accountLabel !== "string" || (x.role !== "FrontDesk" && x.role !== "Manager") || !optStr(x.notificationEmail) ||
      typeof x.isEnabled !== "boolean" || typeof x.chainConfigured !== "boolean" || !COVERAGES.includes(x.coverage as string) || !Number.isInteger(x.version)) return null;
  return x as unknown as RecipientStaff;
}

const parseFallback = (x: unknown): RecipientFallback | null =>
  rec(x) && optStr(x.email) && Number.isInteger(x.version) ? (x as unknown as RecipientFallback) : null;

export function parseRoster(x: unknown): RecipientRoster | null {
  if (!rec(x) || typeof x.propertyId !== "string" || !Array.isArray(x.staff) || !x.staff.every((row) => parseStaff(row) !== null) || parseFallback(x.fallback) === null) return null;
  return x as unknown as RecipientRoster;
}

const base = (propertyId: string) => `/api/admin/v1/properties/${encodeURIComponent(propertyId)}/booking-notification-recipients`;

export const readRecipientRoster = (propertyId: string, signal?: AbortSignal): Promise<WebsiteResult<RecipientRoster>> =>
  call<RecipientRoster>("GET", base(propertyId), undefined, { write: false, signal, parse: parseRoster });

/** `email` null (or blank) clears the address. */
export const saveStaffEmail = (propertyId: string, staffAccountId: string, expectedVersion: number, email: string | null) =>
  call<RecipientStaff>("POST", `${base(propertyId)}/staff/${encodeURIComponent(staffAccountId)}/email`, { expectedVersion, email }, { write: true, parse: parseStaff });

export const setStaffEnabled = (propertyId: string, staffAccountId: string, expectedVersion: number, enabled: boolean) =>
  call<RecipientStaff>("POST", `${base(propertyId)}/staff/${encodeURIComponent(staffAccountId)}/enabled`, { expectedVersion, enabled }, { write: true, parse: parseStaff });

export const saveFallbackEmail = (propertyId: string, expectedVersion: number, email: string | null) =>
  call<RecipientFallback>("POST", `${base(propertyId)}/fallback`, { expectedVersion, email }, { write: true, parse: parseFallback });
