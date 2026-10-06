import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ServicePreview from "./ServicePreview";
import PreviewImage from "./PreviewImage";

describe("ServicePreview", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ServicePreview, {
      id: "services",
      children: React.createElement(
        React.Fragment,
        null,
        React.createElement("a", { href: "/listing-stay-map" }, "Explore"),
        React.createElement("button", null, "Become an author")
      ),
    })
  );

  it("makes its content inert so no sample link or button can be used", () => {
    expect(markup).toMatch(/<div[^>]*pointer-events-none[^>]*inert=""/);
    expect(markup).toContain("Explore");
  });

  it("says what the block is and keeps its anchor", () => {
    expect(markup).toContain("Dịch vụ đang được phát triển");
    expect(markup).toContain('id="services"');
  });
});

describe("PreviewImage", () => {
  it("renders a frame, never an <img> that would request a template or third-party picture", () => {
    const filled = renderToStaticMarkup(
      React.createElement("div", null, React.createElement(PreviewImage, { src: "https://images.pexels.com/x.jpg", fill: true, alt: "" }))
    );
    const intrinsic = renderToStaticMarkup(
      React.createElement(PreviewImage, { src: { src: "/x.png", width: 400, height: 300 }, alt: "" })
    );
    for (const html of [filled, intrinsic]) {
      expect(html).not.toContain("<img");
      expect(html).not.toContain("pexels");
      expect(html).toContain('aria-hidden="true"');
    }
    expect(intrinsic).toContain("aspect-ratio:400 / 300");
  });
});
