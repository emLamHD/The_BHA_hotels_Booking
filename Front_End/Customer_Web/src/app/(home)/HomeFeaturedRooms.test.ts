import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingHoldProvider } from "@/app/BookingHoldProvider";
import { StaySearchProvider } from "@/components/StaySearchProvider";
import HomeFeaturedRooms from "./HomeFeaturedRooms";

// The router hooks need a mounted app router, which a node render does not have.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => null,
}));

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the server render is the component's real first (loading) state —
 * effects have not run, so no request has resolved. Data, tab switching, quotes and the card links
 * are verified in the browser against the real API (see the completion report); a node-environment test
 * cannot run effects.
 */
const markup = renderToStaticMarkup(
  React.createElement(
    BookingHoldProvider,
    null,
    React.createElement(StaySearchProvider, null, React.createElement(HomeFeaturedRooms))
  )
);

describe("HomeFeaturedRooms first render", () => {
  it("is the template's Featured places section with the #rooms anchor exactly once", () => {
    expect(markup).toContain("Featured places to stay");
    expect(markup).toContain("nc-SectionGridFeaturePlaces");
    expect(markup.split('id="rooms"').length - 1).toBe(1);
  });

  it("offers exactly the three brand tabs, Riverside first, and none of the template's cities", () => {
    const at = (label: string) => markup.indexOf(`>${label}<`);
    expect(at("The BHA Riverside")).toBeGreaterThan(-1);
    expect(at("The BHA Riverside")).toBeLessThan(at("The BHA House"));
    expect(at("The BHA House")).toBeLessThan(at("The BHA Villa"));
    for (const demoTab of ["New York", "Tokyo", "Paris", "London"]) expect(markup).not.toContain(demoTab);
  });

  it("starts on Riverside in a loading state: no template demo listing, no endless spinner button", () => {
    expect(markup).toContain("Đang tải phòng");
    expect(markup).not.toContain("Show me more");
    expect(markup).not.toContain("nc-StayCard2"); // cards exist only once the API has answered
    expect(markup).not.toContain("pexels");
  });

  it("does not show the coming-soon panel for the default tab", () => {
    expect(markup).not.toContain("Sắp ra mắt");
  });
});
