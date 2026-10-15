import { testT } from "@/lib/i18n/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  createHomeSearchDispatcher,
  decideHomeSearch,
  describeDraftProblems,
  draftPatchFromListingQuery,
  summarizeDraft,
} from "./homepageSearch";
import { StaySearchDraft, initialStayDraft } from "./staySearch";
import { parseStayListingQuery, stayListingKey } from "./stayListingQuery";

const RIVERSIDE = "The BHA Riverside";
const draft = (over: Partial<StaySearchDraft> = {}): StaySearchDraft => ({
  ...initialStayDraft(),
  brand: RIVERSIDE,
  checkIn: "2026-11-10",
  checkOut: "2026-11-12",
  adults: 2,
  children: 1,
  rooms: 1,
  ...over,
});
const parse = (href: string) => parseStayListingQuery(new URLSearchParams(href.split("?")[1] ?? ""));

describe("decideHomeSearch: the draft becomes the canonical listing URL, or says why not", () => {
  it("a complete Riverside draft navigates to the canonical URL with all five keys, and the listing parser reads it back", () => {
    const decision = decideHomeSearch(draft());
    expect(decision).toEqual({
      kind: "navigate",
      brand: "riverside",
      href: "/listing-stay?checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=1&rooms=1",
    });
    if (decision.kind !== "navigate") throw new Error("unreachable");
    expect(parse(decision.href)).toEqual({
      kind: "search",
      brand: "riverside",
      search: { checkIn: "2026-11-10", checkOut: "2026-11-12", adults: "2", children: "1", rooms: "1" },
    });
  });

  it("the default draft is Riverside and still has no dates: it asks for them, it never browses or guesses", () => {
    expect(initialStayDraft().brand).toBe(RIVERSIDE);
    expect(decideHomeSearch(initialStayDraft())).toEqual({ kind: "invalid", message: "customer.homeSearch.dates" });
  });

  it("partial dates (one missing) are invalid with the same message, and navigate to nothing", () => {
    for (const patch of [{ checkIn: "" }, { checkOut: "" }, { checkIn: "", checkOut: "" }]) {
      expect(decideHomeSearch(draft(patch))).toEqual({ kind: "invalid", message: "customer.homeSearch.dates" });
    }
  });

  it("malformed, impossible, reversed, equal and over-30-night ranges are invalid, each with its own words", () => {
    expect(decideHomeSearch(draft({ checkIn: "2026-02-31" }))).toMatchObject({ kind: "invalid", message: "customer.homeSearch.generic" });
    expect(decideHomeSearch(draft({ checkIn: "10/11/2026" }))).toMatchObject({ kind: "invalid" });
    expect(decideHomeSearch(draft({ checkIn: "2026-11-12", checkOut: "2026-11-10" }))).toEqual({ kind: "invalid", message: "shared.apiError.validation.dates-order" });
    expect(decideHomeSearch(draft({ checkOut: "2026-11-10" }))).toEqual({ kind: "invalid", message: "shared.apiError.validation.dates-order" });
    expect(decideHomeSearch(draft({ checkIn: "2026-11-01", checkOut: "2026-12-02" }))).toEqual({ kind: "invalid", message: "shared.apiError.validation.stay-too-long" });
  });

  it("accepts exactly 30 nights, 1 and 10 rooms; rejects 0 and 11 rooms and 0 adults; children 0 is fine", () => {
    expect(decideHomeSearch(draft({ checkIn: "2026-11-01", checkOut: "2026-12-01" })).kind).toBe("navigate");
    expect(decideHomeSearch(draft({ rooms: 10, children: 0 })).kind).toBe("navigate");
    expect(decideHomeSearch(draft({ rooms: 11 }))).toEqual({ kind: "invalid", message: "shared.apiError.validation.rooms-required" });
    expect(decideHomeSearch(draft({ rooms: 0 }))).toEqual({ kind: "invalid", message: "shared.apiError.validation.rooms-required" });
    expect(decideHomeSearch(draft({ adults: 0 }))).toEqual({ kind: "invalid", message: "shared.apiError.validation.adults-required" });
  });

  it("non-integer counts never become URLs (decimal, NaN, negative)", () => {
    for (const rooms of [1.5, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(decideHomeSearch(draft({ rooms })).kind).toBe("invalid");
    }
  });

  it("an unknown brand label is an error, never Riverside by default", () => {
    expect(decideHomeSearch(draft({ brand: "Tokyo" }))).toEqual({ kind: "invalid", message: "customer.homeSearch.brand" });
    expect(decideHomeSearch(draft({ brand: "" }))).toEqual({ kind: "invalid", message: "customer.homeSearch.brand" });
  });

  it("House and Villa are not bookable: their URL carries the brand, so the results page shows its own 'not supported' and asks the server for nothing", () => {
    for (const [label, brand] of [["The BHA House", "house"], ["The BHA Villa", "villa"]] as const) {
      const decision = decideHomeSearch(draft({ brand: label }));
      expect(decision).toMatchObject({ kind: "navigate", brand });
      if (decision.kind !== "navigate") throw new Error("unreachable");
      expect(decision.href.startsWith(`/listing-stay?brand=${brand}&checkIn=`)).toBe(true);
      expect(parse(decision.href)).toMatchObject({ kind: "search", brand });
    }
  });

  it("never carries anything but the whitelist: no price, contact, token", () => {
    const decision = decideHomeSearch(draft());
    if (decision.kind !== "navigate") throw new Error("unreachable");
    expect(Array.from(new URL(decision.href, "https://x.test").searchParams.keys())).toEqual(["checkIn", "checkOut", "adults", "children", "rooms"]);
  });
});

describe("describeDraftProblems", () => {
  it("is the form's wording, not the link's, and has a fallback", () => {
    expect(describeDraftProblems([{ key: "checkOut", reason: "missing" }])).toBe("customer.homeSearch.dates");
    expect(describeDraftProblems([{ key: "stay", reason: "malformed" }])).toBe("customer.homeSearch.generic");
    expect(describeDraftProblems([])).toBe("customer.homeSearch.generic");
    for (const problem of [{ key: "checkIn", reason: "malformed" }, { key: "rooms", reason: "out-of-range" }] as const) {
      expect(describeDraftProblems([problem])).not.toMatch(/Liên kết/);
    }
  });
});

describe("createHomeSearchDispatcher: one navigation per Search", () => {
  const make = (start = 1000) => {
    let clock = start;
    const navigate = vi.fn();
    const dispatcher = createHomeSearchDispatcher({ navigate, now: () => clock });
    return { navigate, dispatcher, tick: (ms: number) => (clock += ms) };
  };

  it("a valid draft navigates exactly once, to the canonical URL", () => {
    const { navigate, dispatcher } = make();
    const outcome = dispatcher.run(draft());
    expect(outcome.kind).toBe("navigate");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/listing-stay?checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=1&rooms=1");
  });

  it("a double click, or a click together with Enter (same draft, same moment), is one navigation", () => {
    const { navigate, dispatcher, tick } = make();
    expect(dispatcher.run(draft()).kind).toBe("navigate");
    tick(30);
    expect(dispatcher.run(draft()).kind).toBe("duplicate");
    tick(200);
    expect(dispatcher.run(draft()).kind).toBe("duplicate");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("a different search, or the same one after the window, is a new navigation", () => {
    const { navigate, dispatcher, tick } = make();
    dispatcher.run(draft());
    tick(50);
    expect(dispatcher.run(draft({ rooms: 2 })).kind).toBe("navigate");
    tick(5000);
    expect(dispatcher.run(draft({ rooms: 2 })).kind).toBe("navigate");
    expect(navigate).toHaveBeenCalledTimes(3);
  });

  it("an invalid draft navigates to nothing, any number of times, and does not arm the duplicate guard", () => {
    const { navigate, dispatcher } = make();
    expect(dispatcher.run(initialStayDraft()).kind).toBe("invalid");
    expect(dispatcher.run(initialStayDraft()).kind).toBe("invalid");
    expect(navigate).not.toHaveBeenCalled();
    expect(dispatcher.run(draft()).kind).toBe("navigate");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("asks the server for nothing: its only dependency is the navigation", () => {
    const navigate = vi.fn();
    createHomeSearchDispatcher({ navigate }).run(draft());
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("draftPatchFromListingQuery: what opening a header search copies from a results URL", () => {
  it("copies a complete valid Riverside search into the draft", () => {
    const query = parse("/listing-stay?checkIn=2026-11-10&checkOut=2026-11-12&adults=3&children=0&rooms=2");
    expect(draftPatchFromListingQuery(query)).toEqual({
      brand: RIVERSIDE,
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      adults: 3,
      children: 0,
      rooms: 2,
    });
  });

  it("copies nothing from a browse URL, an invalid one, or another brand (the draft is left as it is)", () => {
    expect(draftPatchFromListingQuery(parse("/listing-stay"))).toBeNull();
    expect(draftPatchFromListingQuery(parse("/listing-stay?checkIn=2026-11-10"))).toBeNull();
    expect(draftPatchFromListingQuery(parse("/listing-stay?brand=house&checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=1"))).toBeNull();
  });

  it("round trip: the patched draft decides to the very URL it came from", () => {
    const href = "/listing-stay?checkIn=2026-12-01&checkOut=2026-12-03&adults=2&children=1&rooms=1";
    const patch = draftPatchFromListingQuery(parse(href));
    const decision = decideHomeSearch({ ...initialStayDraft(), ...patch });
    expect(decision).toMatchObject({ kind: "navigate", href });
    expect(stayListingKey(parse(href))).toBe(stayListingKey(parse((decision as { href: string }).href)));
  });
});

describe("summarizeDraft", () => {
  it("says what to do while the draft has no dates, and the draft itself once it has", () => {
    expect(summarizeDraft(initialStayDraft(), testT("vi"))).toEqual({ title: "Tìm phòng tại The BHA Riverside", subtitle: "Chọn ngày · 2 khách · 1 phòng" });
    expect(summarizeDraft(draft(), testT("vi"))).toEqual({ title: RIVERSIDE, subtitle: "10/11 – 12/11 · 3 khách · 1 phòng" });
  });

  it("never shows the template's 'Anywhere / Any week' placeholder", () => {
    for (const d of [initialStayDraft(), draft()]) {
      const text = JSON.stringify(summarizeDraft(d, testT("vi")));
      expect(text).not.toMatch(/Anywhere|Any week|Where to/);
    }
  });
});
