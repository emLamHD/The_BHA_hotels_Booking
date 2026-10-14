import { StayListingQuery, ListingQueryProblem, brandFromLabel, brandInfo, buildStayListingHref, parseStayListingQuery, StayBrand } from "@/lib/stayListingQuery";
import { StaySearchDraft } from "@/lib/staySearch";

/**
 * CUST-WEB-001-CP08a: what every live search entry outside the results page (the home hero, the header's
 * mobile search, the room page's mobile header) does with the shared draft. There is exactly one decision
 * and it is made by the CP05a URL contract: the draft is written as the six listing keys, read back by
 * `parseStayListingQuery`, and either becomes the canonical `/listing-stay` URL or says what is missing.
 * Nothing here reads availability: the results page is the only place that asks the server for a price.
 */
/** The page-level "Tìm phòng" button asks whichever search is on screen to open (the mobile modal listens). */
export const OPEN_SEARCH_EVENT = "bha:open-search";

export type HomeSearchDecision =
  | { kind: "navigate"; href: string; brand: StayBrand }
  | { kind: "invalid"; message: string };

const MESSAGES = {
  brand: "Chọn chỗ nghỉ để tìm phòng.",
  dates: "Chọn ngày nhận phòng và trả phòng.",
  order: "Ngày trả phòng phải sau ngày nhận phòng.",
  tooLong: "Thời gian lưu trú tối đa 30 đêm.",
  rooms: "Số phòng phải từ 1 đến 10.",
  adults: "Cần ít nhất 1 người lớn.",
  generic: "Kiểm tra lại ngày và số khách.",
} as const;

/** The first thing wrong with a draft the URL contract rejected, in the form's words (not the link's). */
export function describeDraftProblems(problems: readonly ListingQueryProblem[]): string {
  const has = (key: ListingQueryProblem["key"], reason?: ListingQueryProblem["reason"]) =>
    problems.some((problem) => problem.key === key && (!reason || problem.reason === reason));
  if (has("brand")) return MESSAGES.brand;
  if (has("checkIn") || has("checkOut")) {
    return problems.some((p) => (p.key === "checkIn" || p.key === "checkOut") && (p.reason === "missing" || p.reason === "blank"))
      ? MESSAGES.dates
      : MESSAGES.generic;
  }
  if (has("stay", "order")) return MESSAGES.order;
  if (has("stay", "too-long")) return MESSAGES.tooLong;
  if (has("rooms")) return MESSAGES.rooms;
  if (has("adults")) return MESSAGES.adults;
  return MESSAGES.generic;
}

/**
 * Draft → canonical results URL, or the reason there is none. An unknown brand label is a problem, never
 * Riverside by default. Missing dates are a problem too: browsing without dates is a deliberate action of
 * its own (a link to /listing-stay), never something a Search button infers.
 */
export function decideHomeSearch(draft: StaySearchDraft): HomeSearchDecision {
  const brand = brandFromLabel(draft.brand);
  if (!brand) return { kind: "invalid", message: MESSAGES.brand };
  if (!draft.checkIn || !draft.checkOut) return { kind: "invalid", message: MESSAGES.dates };

  const search = {
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: String(draft.adults),
    children: String(draft.children),
    rooms: String(draft.rooms),
  };
  const candidate = buildStayListingHref(brand, search);
  const query = parseStayListingQuery(new URLSearchParams(candidate.split("?")[1] ?? ""));
  if (query.kind !== "search") {
    return { kind: "invalid", message: query.kind === "invalid" ? describeDraftProblems(query.problems) : MESSAGES.generic };
  }
  return { kind: "navigate", href: buildStayListingHref(query.brand, query.search), brand: query.brand };
}

export type HomeSearchOutcome = HomeSearchDecision | { kind: "duplicate"; href: string };

export interface HomeSearchDispatcherDeps {
  navigate: (href: string) => void;
  now?: () => number;
  /** A second request for the very same URL inside this window is the same click, not a new search. */
  duplicateWindowMs?: number;
}

export interface HomeSearchDispatcher {
  /** Decides, and — only for a valid draft that is not a repeat — starts exactly one navigation. */
  run(draft: StaySearchDraft): HomeSearchOutcome;
}

const DUPLICATE_WINDOW_MS = 1500;

/**
 * One navigation per Search. A double click, or a click that arrives together with Enter, asks for the
 * same URL twice within a moment; the second asks for nothing. The guard is by URL and time, so a real
 * second search (another URL, or the same one a moment later) still goes through.
 */
export function createHomeSearchDispatcher(deps: HomeSearchDispatcherDeps): HomeSearchDispatcher {
  const now = deps.now ?? (() => Date.now());
  const windowMs = deps.duplicateWindowMs ?? DUPLICATE_WINDOW_MS;
  let last: { href: string; at: number } | null = null;
  return {
    run(draft) {
      const decision = decideHomeSearch(draft);
      if (decision.kind !== "navigate") return decision;
      const at = now();
      if (last && last.href === decision.href && at - last.at < windowMs) return { kind: "duplicate", href: decision.href };
      last = { href: decision.href, at };
      deps.navigate(decision.href);
      return decision;
    },
  };
}

/**
 * The draft a valid results URL stands for, to prefill a search form when it opens. Only a complete valid
 * search of Riverside is carried over: a browse URL, an invalid one or another brand leaves the draft as
 * it is (the header never turns a House/Villa URL into a Riverside search or the other way round).
 */
export function draftPatchFromListingQuery(query: StayListingQuery): Partial<StaySearchDraft> | null {
  if (query.kind !== "search" || query.brand !== "riverside") return null;
  return {
    brand: brandInfo(query.brand).label,
    checkIn: query.search.checkIn,
    checkOut: query.search.checkOut,
    adults: Number(query.search.adults),
    children: Number(query.search.children),
    rooms: Number(query.search.rooms),
  };
}

const dayMonth = (iso: string) => iso.split("-").slice(1).reverse().join("/");

export interface DraftSummary {
  title: string;
  subtitle: string;
}

/** What the collapsed mobile search says: the draft when it has dates, otherwise what to do. */
export function summarizeDraft(draft: StaySearchDraft): DraftSummary {
  const guests = draft.adults + draft.children;
  const party = `${guests} khách · ${draft.rooms} phòng`;
  if (draft.checkIn && draft.checkOut) {
    return { title: draft.brand, subtitle: `${dayMonth(draft.checkIn)} – ${dayMonth(draft.checkOut)} · ${party}` };
  }
  return { title: "Tìm phòng tại The BHA Riverside", subtitle: `Chọn ngày · ${party}` };
}
