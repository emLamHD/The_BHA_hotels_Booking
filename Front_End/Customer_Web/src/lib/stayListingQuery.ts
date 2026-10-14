import {
  AvailabilityDraft,
  MAX_REQUESTED_ROOMS,
  MAX_STAY_NIGHTS,
  calculateNights,
  validateAvailabilityDraft,
} from "@/lib/api/availabilityValidation";
import { FEATURED_BRAND_TABS } from "@/lib/featuredBrands";
import { isoToDate } from "@/lib/staySearch";

/**
 * CUST-WEB-001-CP05a: the URL contract of /listing-stay. The URL is the only authority for what the page
 * searches: this module is the one parser and serializer the page, its form and the /listing-stay-map
 * alias use. It is React-free, so the tests call exactly what the UI calls.
 *
 * Keys: `brand` (a logical frontend choice, not an API Property id) and the five availability fields.
 * Nothing else is read, echoed or propagated.
 */
export const LISTING_STAY_PATH = "/listing-stay";

export const SEARCH_KEYS = ["checkIn", "checkOut", "adults", "children", "rooms"] as const;
export type SearchKey = (typeof SEARCH_KEYS)[number];
export const KNOWN_KEYS = ["brand", ...SEARCH_KEYS] as const;

export type StayBrand = "riverside" | "house" | "villa";

export interface StayBrandInfo {
  id: StayBrand;
  /** The label the template location control and the Featured tabs already use. */
  label: string;
  /** The Property slug that backs the brand; null when the brand has no catalog (never bookable here). */
  slug: string | null;
}

export const DEFAULT_STAY_BRAND: StayBrand = "riverside";

export const STAY_BRANDS: readonly StayBrandInfo[] = [
  { id: "riverside", label: FEATURED_BRAND_TABS[0].label, slug: FEATURED_BRAND_TABS[0].slug },
  { id: "house", label: FEATURED_BRAND_TABS[1].label, slug: FEATURED_BRAND_TABS[1].slug },
  { id: "villa", label: FEATURED_BRAND_TABS[2].label, slug: FEATURED_BRAND_TABS[2].slug },
];

export function brandInfo(brand: StayBrand): StayBrandInfo {
  return STAY_BRANDS.find((item) => item.id === brand) as StayBrandInfo;
}

export function brandFromLabel(label: string): StayBrand | undefined {
  return STAY_BRANDS.find((item) => item.label === label)?.id;
}

export type ListingQueryProblemKey = "brand" | SearchKey | "stay";
export type ListingQueryProblemReason =
  | "repeated"
  | "missing"
  | "blank"
  | "malformed"
  | "unknown"
  | "out-of-range"
  | "order"
  | "too-long";

export interface ListingQueryProblem {
  key: ListingQueryProblemKey;
  reason: ListingQueryProblemReason;
}

export type StayListingQuery =
  /** None of the five search fields is present: browse the catalog, ask for no availability. */
  | { kind: "browse"; brand: StayBrand }
  /** All five present exactly once and valid: `search` is what the availability request uses. */
  | { kind: "search"; brand: StayBrand; search: AvailabilityDraft }
  /** Anything else. `brand` is null when the brand itself is the problem (never a fallback). */
  | { kind: "invalid"; brand: StayBrand | null; problems: ListingQueryProblem[] };

export interface QueryReader {
  getAll(name: string): string[];
}

const STRICT_INTEGER = /^(0|[1-9]\d*)$/;

function strictInteger(value: string): number | null {
  if (!STRICT_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readBrand(reader: QueryReader, problems: ListingQueryProblem[]): StayBrand | null {
  const values = reader.getAll("brand");
  if (values.length === 0) return DEFAULT_STAY_BRAND;
  if (values.length > 1) {
    problems.push({ key: "brand", reason: "repeated" });
    return null;
  }
  const [value] = values;
  const match = STAY_BRANDS.find((item) => item.id === value);
  if (match) return match.id;
  problems.push({ key: "brand", reason: value === "" ? "blank" : "unknown" });
  return null;
}

/**
 * Reads a URL. Without any search field it is the deliberate browse mode; with any search field all five
 * must be present exactly once and valid — nothing is filled in, no repeated value is silently chosen.
 * The Property-local past-date rule is the server's: the browser's "today" is never used here.
 */
export function parseStayListingQuery(reader: QueryReader | null | undefined): StayListingQuery {
  const problems: ListingQueryProblem[] = [];
  const brand = readBrand(reader ?? { getAll: () => [] }, problems);

  const values = SEARCH_KEYS.map((key) => ({ key, all: reader?.getAll(key) ?? [] }));
  const anySearchField = values.some((entry) => entry.all.length > 0);

  if (!anySearchField) {
    return brand === null ? { kind: "invalid", brand, problems } : { kind: "browse", brand };
  }

  const fields: Partial<Record<SearchKey, string>> = {};
  for (const { key, all } of values) {
    if (all.length === 0) problems.push({ key, reason: "missing" });
    else if (all.length > 1) problems.push({ key, reason: "repeated" });
    else if (all[0] === "") problems.push({ key, reason: "blank" });
    else fields[key] = all[0];
  }

  const checkIn = fields.checkIn;
  const checkOut = fields.checkOut;
  if (checkIn !== undefined && !isoToDate(checkIn)) problems.push({ key: "checkIn", reason: "malformed" });
  if (checkOut !== undefined && !isoToDate(checkOut)) problems.push({ key: "checkOut", reason: "malformed" });

  const adults = fields.adults === undefined ? undefined : strictInteger(fields.adults);
  const children = fields.children === undefined ? undefined : strictInteger(fields.children);
  const rooms = fields.rooms === undefined ? undefined : strictInteger(fields.rooms);
  if (fields.adults !== undefined && adults === null) problems.push({ key: "adults", reason: "malformed" });
  if (fields.children !== undefined && children === null) problems.push({ key: "children", reason: "malformed" });
  if (fields.rooms !== undefined && rooms === null) problems.push({ key: "rooms", reason: "malformed" });

  if (typeof adults === "number" && adults < 1) problems.push({ key: "adults", reason: "out-of-range" });
  if (typeof rooms === "number" && (rooms < 1 || rooms > MAX_REQUESTED_ROOMS)) {
    problems.push({ key: "rooms", reason: "out-of-range" });
  }

  const hasRealDates =
    checkIn !== undefined && checkOut !== undefined && !!isoToDate(checkIn) && !!isoToDate(checkOut);
  if (hasRealDates) {
    const nights = calculateNights(checkIn as string, checkOut as string);
    if (nights === null || nights <= 0) problems.push({ key: "stay", reason: "order" });
    else if (nights > MAX_STAY_NIGHTS) problems.push({ key: "stay", reason: "too-long" });
  }

  if (problems.length > 0) return { kind: "invalid", brand, problems };

  const candidate: AvailabilityDraft = {
    checkIn: checkIn as string,
    checkOut: checkOut as string,
    adults: fields.adults as string,
    children: fields.children as string,
    rooms: fields.rooms as string,
  };
  // The form's own validation stays the final authority; it cannot disagree with the checks above.
  if (!validateAvailabilityDraft(candidate).ok) {
    return { kind: "invalid", brand, problems: [{ key: "stay", reason: "malformed" }] };
  }
  return { kind: "search", brand: brand as StayBrand, search: candidate };
}

/**
 * The canonical URL for a brand and an optional valid search: `brand` only when it is not the default,
 * then the five fields in a fixed order. Nothing about prices, rate plans, contact or session.
 */
export function buildStayListingHref(brand: StayBrand, search?: AvailabilityDraft | null): string {
  const query = new URLSearchParams();
  if (brand !== DEFAULT_STAY_BRAND) query.set("brand", brand);
  if (search) {
    query.set("checkIn", search.checkIn);
    query.set("checkOut", search.checkOut);
    query.set("adults", search.adults);
    query.set("children", search.children);
    query.set("rooms", search.rooms);
  }
  const text = query.toString();
  return text ? `${LISTING_STAY_PATH}?${text}` : LISTING_STAY_PATH;
}

/** The URL a parsed query stands for; null for an invalid one (it has no canonical form). */
export function hrefForQuery(query: StayListingQuery): string | null {
  if (query.kind === "invalid") return null;
  return buildStayListingHref(query.brand, query.kind === "search" ? query.search : null);
}

/** Identity of what the page shows: results, price and summary all carry the key they were made for. */
export function stayListingKey(query: StayListingQuery): string {
  if (query.kind === "invalid") {
    return `invalid:${query.brand ?? "-"}:${query.problems.map((p) => `${p.key}.${p.reason}`).join(",")}`;
  }
  return `${query.kind}:${hrefForQuery(query)}`;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The target of /listing-stay-map: always the fixed /listing-stay path, carrying only the known keys with
 * every value they had — repeated ones included, so the destination can still report them as invalid
 * instead of the alias turning a bad URL into a good one. Unknown keys are dropped.
 */
export function buildListingAliasHref(params: RawSearchParams | null | undefined): string {
  const query = new URLSearchParams();
  for (const key of KNOWN_KEYS) {
    if (!params || !Object.prototype.hasOwnProperty.call(params, key)) continue;
    const raw = params[key];
    if (raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) query.append(key, value);
  }
  const text = query.toString();
  return text ? `${LISTING_STAY_PATH}?${text}` : LISTING_STAY_PATH;
}

const FIELD_LABEL: Record<ListingQueryProblemKey, string> = {
  brand: "thương hiệu",
  checkIn: "ngày nhận phòng",
  checkOut: "ngày trả phòng",
  adults: "số người lớn",
  children: "số trẻ em",
  rooms: "số phòng",
  stay: "thời gian lưu trú",
};

/** What is wrong with an invalid URL, in the visitor's language. */
export function describeListingProblems(problems: readonly ListingQueryProblem[]): string[] {
  return problems.map(({ key, reason }) => {
    const field = FIELD_LABEL[key];
    switch (reason) {
      case "repeated":
        return `Liên kết có ${field} lặp lại.`;
      case "missing":
        return `Liên kết thiếu ${field}.`;
      case "blank":
        return `Liên kết để trống ${field}.`;
      case "unknown":
        return `Liên kết có ${field} không được hỗ trợ.`;
      case "out-of-range":
        return `Liên kết có ${field} nằm ngoài giới hạn.`;
      case "order":
        return "Ngày trả phòng phải sau ngày nhận phòng.";
      case "too-long":
        return `Thời gian lưu trú tối đa ${MAX_STAY_NIGHTS} đêm.`;
      default:
        return `Liên kết có ${field} không hợp lệ.`;
    }
  });
}
