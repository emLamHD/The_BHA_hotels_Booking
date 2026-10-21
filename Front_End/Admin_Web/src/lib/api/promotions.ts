import { call, type WebsiteResult } from "./website";
import { getApiBaseUrl } from "./env";

/**
 * BHA-BOOKING-PROMOTIONS-001 (ADR 0009): the Admin client of the per-Property promotion routes. Every route is authorized on the
 * server (a Manager of that Property); nothing here decides access. A write that got no answer is `unverified` and is never retried.
 */

export type PromotionStatus = "Draft" | "Active" | "Disabled";
export type DiscountKind = "Percent" | "FixedAmount";

export interface PromotionTexts { title: string | null; summary: string | null; coverAltText: string | null; body: string[] | null }
export interface PromotionLanguage { code: string; displayName: string; isSource: boolean }
export interface RoomTypeChoice { id: string; code: string; name: string; isActive: boolean }
export interface PromotionMedia { id: string; contentType: string; width: number; height: number }

export interface PromotionSummary {
  id: string; propertyId: string; slug: string; title: string; summary: string; status: PromotionStatus; kind: DiscountKind; value: number;
  currencyCode: string | null; allRoomTypes: boolean; roomTypeCount: number; showOnHomepage: boolean; sortOrder: number;
  bookingFrom: string | null; bookingTo: string | null; stayFrom: string | null; stayTo: string | null; displayFrom: string | null; displayTo: string | null;
  minNights: number; publicNow: boolean; coverMediaId: string | null; version: number; updatedAtUtc: string;
}

export interface PromotionEditor {
  id: string; propertyId: string; slug: string; status: PromotionStatus; kind: DiscountKind; value: number; currencyCode: string | null;
  allRoomTypes: boolean; roomTypeIds: string[]; bookingFrom: string | null; bookingTo: string | null; stayFrom: string | null; stayTo: string | null;
  minNights: number; title: string; summary: string; body: string[]; coverMediaId: string | null; coverAltText: string | null;
  showOnHomepage: boolean; sortOrder: number; displayFrom: string | null; displayTo: string | null; publicNow: boolean;
  translations: Record<string, PromotionTexts>; languages: PromotionLanguage[]; version: number; createdAtUtc: string; updatedAtUtc: string; updatedByStaffId: string;
}

/** The request body of create and save: the rule and the content, and the texts of the other languages. */
export interface PromotionBody {
  slug: string; title: string; summary: string; body: string[]; coverMediaId: string | null; coverAltText: string | null; kind: DiscountKind; value: number;
  currencyCode: string | null; allRoomTypes: boolean; roomTypeIds: string[]; bookingFrom: string | null; bookingTo: string | null; stayFrom: string | null;
  stayTo: string | null; minNights: number; showOnHomepage: boolean; sortOrder: number; displayFrom: string | null; displayTo: string | null;
  translations?: Record<string, PromotionTexts>;
}

export interface PromotionFilter { status: PromotionStatus | ""; q: string; homepage: "" | "true" | "false" }

const rec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const str = (x: unknown) => typeof x === "string";
const optStr = (x: unknown) => x === null || typeof x === "string";
const STATUSES: readonly string[] = ["Draft", "Active", "Disabled"];
const KINDS: readonly string[] = ["Percent", "FixedAmount"];

export function parseSummary(x: unknown): PromotionSummary | null {
  if (!rec(x) || ![x.id, x.propertyId, x.slug, x.title, x.summary, x.updatedAtUtc].every(str) || !STATUSES.includes(x.status as string) || !KINDS.includes(x.kind as string) ||
      typeof x.value !== "number" || !optStr(x.currencyCode) || typeof x.allRoomTypes !== "boolean" || !Number.isInteger(x.roomTypeCount) ||
      typeof x.showOnHomepage !== "boolean" || !Number.isInteger(x.sortOrder) || !Number.isInteger(x.minNights) || typeof x.publicNow !== "boolean" ||
      !["bookingFrom", "bookingTo", "stayFrom", "stayTo", "displayFrom", "displayTo", "coverMediaId"].every(k => optStr(x[k])) || !Number.isInteger(x.version)) return null;
  return x as unknown as PromotionSummary;
}

const parseTexts = (x: unknown): boolean => rec(x) && ["title", "summary", "coverAltText"].every(k => optStr(x[k])) && (x.body === null || (Array.isArray(x.body) && x.body.every(str)));

export function parseEditor(x: unknown): PromotionEditor | null {
  if (!rec(x) || ![x.id, x.propertyId, x.slug, x.title, x.summary, x.createdAtUtc, x.updatedAtUtc, x.updatedByStaffId].every(str) || !STATUSES.includes(x.status as string) ||
      !KINDS.includes(x.kind as string) || typeof x.value !== "number" || !optStr(x.currencyCode) || typeof x.allRoomTypes !== "boolean" ||
      !Array.isArray(x.roomTypeIds) || !x.roomTypeIds.every(str) || !Array.isArray(x.body) || !x.body.every(str) ||
      !["bookingFrom", "bookingTo", "stayFrom", "stayTo", "displayFrom", "displayTo", "coverMediaId", "coverAltText"].every(k => optStr(x[k])) ||
      !Number.isInteger(x.minNights) || typeof x.showOnHomepage !== "boolean" || !Number.isInteger(x.sortOrder) || typeof x.publicNow !== "boolean" ||
      !Number.isInteger(x.version) || Number(x.version) < 1 || !rec(x.translations) || !Object.values(x.translations).every(parseTexts) ||
      !Array.isArray(x.languages) || !x.languages.every(l => rec(l) && str(l.code) && str(l.displayName) && typeof l.isSource === "boolean")) return null;
  return x as unknown as PromotionEditor;
}

const base = (propertyId: string) => `/api/admin/v1/properties/${encodeURIComponent(propertyId)}/promotions`;

export const listPromotions = (propertyId: string, filter: PromotionFilter, signal?: AbortSignal): Promise<WebsiteResult<PromotionSummary[]>> => {
  const query = new URLSearchParams();
  if (filter.status) query.set("status", filter.status);
  if (filter.q.trim()) query.set("q", filter.q.trim());
  if (filter.homepage) query.set("homepage", filter.homepage);
  const text = query.toString();
  return call<PromotionSummary[]>("GET", `${base(propertyId)}${text ? `?${text}` : ""}`, undefined, {
    write: false, signal, parse: x => Array.isArray(x) && x.every(v => parseSummary(v) !== null) ? x as PromotionSummary[] : null,
  });
};

export const getPromotion = (propertyId: string, id: string, signal?: AbortSignal) =>
  call<PromotionEditor>("GET", `${base(propertyId)}/${encodeURIComponent(id)}`, undefined, { write: false, signal, parse: parseEditor });

export const getPromotionRoomTypes = (propertyId: string, signal?: AbortSignal) =>
  call<RoomTypeChoice[]>("GET", `${base(propertyId)}/room-types`, undefined, {
    write: false, signal, parse: x => Array.isArray(x) && x.every(v => rec(v) && str(v.id) && str(v.code) && str(v.name) && typeof v.isActive === "boolean") ? x as RoomTypeChoice[] : null,
  });

/** A create carries its operation id: a lost answer can be sent again with the same id and never makes a second promotion. */
export const createPromotion = (propertyId: string, body: PromotionBody, operationId: string) =>
  call<PromotionEditor>("POST", base(propertyId), body, { write: true, parse: parseEditor, headers: { "Idempotency-Key": operationId } });

export const savePromotion = (propertyId: string, id: string, expectedVersion: number, promotion: PromotionBody) =>
  call<PromotionEditor>("POST", `${base(propertyId)}/${encodeURIComponent(id)}/save`, { expectedVersion, promotion }, { write: true, parse: parseEditor });

export const setPromotionStatus = (propertyId: string, id: string, expectedVersion: number, status: "Active" | "Disabled") =>
  call<PromotionEditor>("POST", `${base(propertyId)}/${encodeURIComponent(id)}/status`, { expectedVersion, status }, { write: true, parse: parseEditor });

export const uploadPromotionCover = (propertyId: string, file: File) => {
  const form = new FormData();
  form.append("file", file, file.name);
  return call<PromotionMedia>("POST", `${base(propertyId)}/media`, form, {
    write: true, parse: x => rec(x) && str(x.id) && str(x.contentType) && Number.isInteger(x.width) && Number.isInteger(x.height) ? x as unknown as PromotionMedia : null,
  });
};

/** Where the Manager's own preview of a cover is served (Staff session only), or `null` when the API address is not configured. */
export function promotionCoverSrc(propertyId: string, mediaId: string): string | null {
  const api = getApiBaseUrl();
  return api.ok ? `${api.baseUrl}${base(propertyId)}/media/${encodeURIComponent(mediaId)}` : null;
}
