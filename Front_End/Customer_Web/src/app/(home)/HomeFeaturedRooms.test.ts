import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderWithI18n } from "@/lib/i18n/testkit";
import { BookingHoldProvider } from "@/app/BookingHoldProvider";
import { StaySearchContextValue, StaySearchProvider, useStaySearch } from "@/components/StaySearchProvider";
import HomeFeaturedRooms from "./HomeFeaturedRooms";

// The router hooks need a mounted app router, which a node render does not have.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => null,
}));

/**
 * CUST-WEB-001-CP08a (replaces the CP02-C3 expectations, which described the three-brand Featured tabs and
 * the in-memory quotes the home page no longer has): the server render is the component's real first
 * (loading) state — effects have not run, so no request has resolved. Catalog data, the card links and the
 * missing/empty/error copy are verified in the browser against the real API (see the completion report); a
 * node-environment test cannot run effects.
 */
const wrap = (child: React.ReactElement) =>
  React.createElement(BookingHoldProvider, null, React.createElement(StaySearchProvider, null, child));

const markup = renderWithI18n(wrap(React.createElement(HomeFeaturedRooms)));

describe("HomeFeaturedRooms first render", () => {
  it("is the Riverside room-types section with the #rooms anchor exactly once", () => {
    expect(markup).toContain("Loại phòng tại The BHA Riverside");
    expect(markup.split('id="rooms"').length - 1).toBe(1);
  });

  it("offers no brand tabs, no House/Villa, none of the template's cities or its Featured heading", () => {
    for (const gone of ["The BHA House", "The BHA Villa", "Featured places to stay", "New York", "Tokyo", "Paris", "London", "Sắp ra mắt", "View all"]) {
      expect(markup).not.toContain(gone);
    }
    expect(markup).not.toContain("nc-SectionGridFeaturePlaces");
  });

  it("starts in a loading state with a link to the results page: no template listing, no card before the API has answered", () => {
    expect(markup).toContain("Đang tải phòng");
    expect(markup).toContain('href="/listing-stay"');
    expect(markup).not.toContain("nc-StayCard2");
    expect(markup).not.toContain("pexels");
  });

  it("shows no price and no sample rating or heart at any stage", () => {
    expect(markup).not.toMatch(/₫|VND|\/đêm|Đánh giá mẫu|Hết phòng/);
  });
});

describe("the shared stay search no longer carries a quote path", () => {
  let captured: StaySearchContextValue | null = null;
  const Probe = () => {
    captured = useStaySearch();
    return null;
  };
  renderWithI18n(wrap(React.createElement(Probe)));

  it("holds a draft, the Riverside catalog and a submit, and nothing that reads or keeps offers", () => {
    expect(captured).not.toBeNull();
    const keys = Object.keys(captured as unknown as Record<string, unknown>);
    for (const needed of ["draft", "updateDraft", "ensureCatalog", "riverside", "roomTypes", "submit", "problem", "clearProblem"]) {
      expect(keys).toContain(needed);
    }
    for (const gone of ["search", "activeTab", "setActiveTab"]) expect(keys).not.toContain(gone);
    expect(typeof (captured as unknown as StaySearchContextValue).submit).toBe("function");
  });

  it("starts as a Riverside draft with no dates and no problem", () => {
    const ctx = captured as unknown as StaySearchContextValue;
    expect(ctx.draft).toMatchObject({ brand: "The BHA Riverside", checkIn: "", checkOut: "", adults: 2, children: 0, rooms: 1 });
    expect(ctx.problem).toBeNull();
    expect(ctx.propsStatus).toBe("idle");
  });
});
