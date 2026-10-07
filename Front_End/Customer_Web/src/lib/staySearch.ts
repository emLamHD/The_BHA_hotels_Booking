import {
  AvailabilityDraft,
  validateAvailabilityDraft,
} from "@/lib/api/availabilityValidation";
import { DEFAULT_FEATURED_TAB } from "@/lib/featuredBrands";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the stay search draft shared by the home hero, the mobile search
 * modal, the Featured cards and the room page's booking panel. Dates are ISO calendar dates
 * ("YYYY-MM-DD") built from the *local* year/month/day of the picked `Date`, never from
 * `toISOString()` (which converts to UTC and shifts a local midnight in Vietnam back one day).
 */
export interface StaySearchDraft {
  /** Brand tab label: "The BHA House" | "The BHA Riverside" | "The BHA Villa". */
  brand: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The calendar day a `Date` shows in the browser's time zone, as `YYYY-MM-DD`. */
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of an ISO calendar date, or null when it is not a real date. */
export function isoToDate(iso: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // `new Date(2026, 1, 31)` rolls over to March: reject anything that is not the date that was asked for.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function initialStayDraft(): StaySearchDraft {
  return { brand: DEFAULT_FEATURED_TAB, checkIn: "", checkOut: "", adults: 2, children: 0, rooms: 1 };
}

/** The strings the availability form/validation use. */
export function toAvailabilityDraft(draft: Pick<StaySearchDraft, "checkIn" | "checkOut" | "adults" | "children" | "rooms">): AvailabilityDraft {
  return {
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: String(draft.adults),
    children: String(draft.children),
    rooms: String(draft.rooms),
  };
}

/** The query that carries a *valid* search to the room page. Nothing about the guest. */
export function searchQueryParams(draft: AvailabilityDraft): URLSearchParams {
  return new URLSearchParams({
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: draft.adults,
    children: draft.children,
    rooms: draft.rooms,
  });
}

interface QueryReader {
  getAll(name: string): string[];
}

/**
 * The search carried by a URL, only when every part is present once and passes the same structural
 * validation as the form. Anything else is ignored (the page then starts with an empty draft).
 */
export function parseSearchQuery(query: QueryReader | null | undefined): AvailabilityDraft | null {
  if (!query) return null;
  const read = (name: string): string | null => {
    const values = query.getAll(name);
    return values.length === 1 ? values[0] : null;
  };
  const draft = {
    checkIn: read("checkIn"),
    checkOut: read("checkOut"),
    adults: read("adults"),
    children: read("children"),
    rooms: read("rooms"),
  };
  if (Object.values(draft).some((value) => value === null)) return null;
  const candidate = draft as AvailabilityDraft;
  if (!isoToDate(candidate.checkIn) || !isoToDate(candidate.checkOut)) return null;
  return validateAvailabilityDraft(candidate).ok ? candidate : null;
}

/** The local calendar day today, for the pickers' earliest selectable date. */
export function todayLocal(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
