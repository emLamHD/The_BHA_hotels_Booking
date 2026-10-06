import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ServicePreview from "./ServicePreview";
import PreviewImage from "./PreviewImage";

describe("ServicePreview", () => {
  // children are passed as arguments (react/no-children-prop); the cast only relaxes the required-children typing
  const Preview = ServicePreview as React.FC<{ id?: string; children?: React.ReactNode }>;
  const markup = renderToStaticMarkup(
    React.createElement(
      Preview,
      { id: "services" },
      React.createElement("a", { href: "/listing-stay-map" }, "Explore"),
      React.createElement("button", null, "Become an author")
    )
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
    expect(intrinsic).toContain("width:400px"); // natural width, like next/image
  });

  it("renders nothing for out-of-flow decoration", () => {
    const decoration = renderToStaticMarkup(
      React.createElement(PreviewImage, { src: { src: "/q.png", width: 50, height: 50 }, className: "absolute top-9 -left-20", alt: "" })
    );
    expect(decoration).toBe("");
  });
});

// The sample sections must not read as statements about The BHA or Riverside: no testimonial,
// product-range claim or recommendation may carry the brand.
vi.mock("@/shared/Logo", () => ({
  default: () => React.createElement("span", null, "logo"),
}));

describe("sample section copy", () => {
  it.each([
    ["SectionClientSay", () => import("./SectionClientSay")],
    ["SectionBecomeAnAuthor", () => import("./SectionBecomeAnAuthor")],
    ["SectionOurFeatures", () => import("./SectionOurFeatures")],
    ["SectionHowItWork", () => import("./SectionHowItWork")],
    ["SectionSubscribe2", () => import("./SectionSubscribe2")],
    ["SectionGridAuthorBox", () => import("./SectionGridAuthorBox")],
    ["SectionGridCategoryBox", () => import("./SectionGridCategoryBox")],
    ["SectionVideos", () => import("./SectionVideos")],
  ])("%s carries no brand claim and no vendor name", async (_name, load) => {
    const Section = (await load()).default as React.ComponentType;
    const html = renderToStaticMarkup(React.createElement(Section));
    expect(html).not.toContain("The BHA");
    expect(html).not.toContain("Riverside");
    expect(html).not.toContain("Chisfis");
    expect(html).not.toContain("<img");
  });
});
