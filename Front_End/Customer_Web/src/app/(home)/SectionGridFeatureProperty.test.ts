import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SectionGridFeatureProperty from "./SectionGridFeatureProperty";

/**
 * CUST-WEB-SHOWCASE-001-CP01-C1 (F2): the header and hero CTA link to
 * #room-types and #booking. Those targets must exist — once — while the
 * catalog request is still pending, or a click during loading changes the
 * hash without scrolling. The server render is the component's real first
 * (loading) state: effects have not run, so no request has resolved.
 */
describe("SectionGridFeatureProperty while the catalog is loading", () => {
  const markup = renderToStaticMarkup(React.createElement(SectionGridFeatureProperty));
  const count = (id: string) => markup.split(`id="${id}"`).length - 1;

  it.each(["catalog", "room-types", "booking"])("renders the #%s anchor exactly once", (id) => {
    expect(count(id)).toBe(1);
  });

  it("keeps the anchors in page order", () => {
    const at = (id: string) => markup.indexOf(`id="${id}"`);
    expect(at("catalog")).toBeLessThan(at("room-types"));
    expect(at("room-types")).toBeLessThan(at("booking"));
  });

  it("explains inside the booking area that the form is still loading, with no form yet", () => {
    const booking = markup.slice(markup.indexOf('id="booking"'));
    expect(booking).toContain("Đang tải");
    expect(markup).not.toContain("<form");
  });
});
