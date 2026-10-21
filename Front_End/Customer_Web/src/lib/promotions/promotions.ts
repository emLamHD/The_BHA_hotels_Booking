/**
 * BHA-BOOKING-PROMOTIONS-001: the public promotions the Admin manages, as the API serves them. The API has already chosen the language,
 * dropped everything that is not public today (draft, disabled, hidden, out of its window) and sent no Admin field; this module only
 * checks the shape (a proxy's error page or an older API is "not a promotion", never half of one) and makes a picture's address absolute.
 */

export type PromotionKind = "Percent" | "FixedAmount";

export interface PromotionTerms {
  kind: PromotionKind;
  value: number;
  currencyCode: string | null;
  bookingFrom: string | null;
  bookingTo: string | null;
  stayFrom: string | null;
  stayTo: string | null;
  minNights: number;
}

export interface PromotionCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverImageUrl: string | null;
  coverAltText: string | null;
  terms: PromotionTerms;
}

export interface PromotionDetail {
  promotion: PromotionCard;
  body: string[];
  property: { id: string; name: string; slug: string };
  allRoomTypes: boolean;
  roomTypes: { id: string; name: string }[];
}

const MEDIA_PATH = /^\/api\/v1\/website\/promotions\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const rec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const text = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
const optDate = (x: unknown): string | null | undefined => (x === null || x === undefined ? null : typeof x === "string" && DATE.test(x) ? x : undefined);

function parseTerms(x: unknown): PromotionTerms | null {
  if (!rec(x) || (x.kind !== "Percent" && x.kind !== "FixedAmount") || typeof x.value !== "number" || !(x.value > 0)) return null;
  if (!Number.isInteger(x.minNights) || (x.minNights as number) < 1) return null;
  const dates = [optDate(x.bookingFrom), optDate(x.bookingTo), optDate(x.stayFrom), optDate(x.stayTo)];
  if (dates.some((d) => d === undefined)) return null;
  return {
    kind: x.kind, value: x.value, currencyCode: typeof x.currencyCode === "string" ? x.currencyCode : null,
    bookingFrom: dates[0] as string | null, bookingTo: dates[1] as string | null, stayFrom: dates[2] as string | null, stayTo: dates[3] as string | null,
    minNights: x.minNights as number,
  };
}

export function parseCard(x: unknown, apiBase: string): PromotionCard | null {
  if (!rec(x) || !text(x.id) || !text(x.slug) || !SLUG.test(x.slug) || !text(x.title) || !text(x.summary)) return null;
  const terms = parseTerms(x.terms);
  if (!terms) return null;
  // A picture is only ever one of the API's own promotion media paths: no other host and no other scheme is rendered from this field.
  const cover = typeof x.coverImageUrl === "string" && MEDIA_PATH.test(x.coverImageUrl) ? `${apiBase}${x.coverImageUrl}` : null;
  return {
    id: x.id, slug: x.slug, title: x.title, summary: x.summary, coverImageUrl: cover,
    coverAltText: cover && text(x.coverAltText) ? x.coverAltText : null, terms,
  };
}

/** The list, or `null` when the answer is not one. A card that cannot be read is left out; it never breaks the others. */
export function parsePromotionList(json: unknown, apiBase: string): PromotionCard[] | null {
  if (!rec(json) || !Array.isArray(json.items)) return null;
  return json.items.map((item) => parseCard(item, apiBase)).filter((card): card is PromotionCard => card !== null);
}

export function parsePromotionDetail(json: unknown, apiBase: string): PromotionDetail | null {
  if (!rec(json) || !Array.isArray(json.body) || !json.body.every(text) || !Array.isArray(json.roomTypes) || typeof json.allRoomTypes !== "boolean") return null;
  const promotion = parseCard(json.promotion, apiBase);
  const property = json.property;
  if (!promotion || !rec(property) || !text(property.id) || !text(property.name) || !text(property.slug)) return null;
  const roomTypes = json.roomTypes.filter((r): r is { id: string; name: string } => rec(r) && text(r.id) && text(r.name));
  return { promotion, body: json.body as string[], property: { id: property.id, name: property.name, slug: property.slug }, allRoomTypes: json.allRoomTypes, roomTypes };
}

/** The ISO date of a window end, formatted by the caller. `null` = open. Which of the four sentences to say about a window. */
export type PeriodKind = "any" | "range" | "from" | "until";

export function periodKind(from: string | null, to: string | null): PeriodKind {
  return from && to ? "range" : from ? "from" : to ? "until" : "any";
}
