import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingHoldProvider } from "@/app/BookingHoldProvider";
import HomeFeaturedRooms from "./HomeFeaturedRooms";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the server render is the component's real first (loading) state —
 * effects have not run, so no request has resolved. Data, tab switching and the card links are
 * verified in the browser against the real API (see the completion report); a node-environment test
 * cannot run effects.
 */
const markup = renderToStaticMarkup(
  React.createElement(BookingHoldProvider, null, React.createElement(HomeFeaturedRooms))
);

describe("HomeFeaturedRooms first render", () => {
  it("is the Featured places section with the #rooms anchor exactly once", () => {
    expect(markup).toContain("Featured places to stay");
    expect(markup.split('id="rooms"').length - 1).toBe(1);
  });

  it("offers exactly the three brand tabs, Riverside first", () => {
    const at = (label: string) => markup.indexOf(`>${label}<`);
    expect(at("The BHA Riverside")).toBeGreaterThan(-1);
    expect(at("The BHA Riverside")).toBeLessThan(at("The BHA House"));
    expect(at("The BHA House")).toBeLessThan(at("The BHA Villa"));
    for (const demoTab of ["New York", "Tokyo", "Paris", "London"]) expect(markup).not.toContain(demoTab);
  });

  it("starts on Riverside in a loading state, with no template demo listing and no endless spinner button", () => {
    expect(markup).toContain("Đang tải phòng");
    expect(markup).not.toContain("Show me more");
    expect(markup).not.toContain("View all");
    expect(markup).not.toContain("/listing-stay"); // no mock listing link; room links appear only with API data
    expect(markup).not.toContain("pexels");
  });

  it("does not show the coming-soon panel for the default tab", () => {
    expect(markup).not.toContain("Sắp ra mắt");
  });
});
