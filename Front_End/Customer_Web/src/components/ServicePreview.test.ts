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
  it("fetches nothing: a frame (fill) or an <img> whose source is an inline data URI", () => {
    const filled = renderToStaticMarkup(
      React.createElement("div", null, React.createElement(PreviewImage, { src: "https://images.pexels.com/x.jpg", fill: true, alt: "" }))
    );
    const intrinsic = renderToStaticMarkup(
      React.createElement(PreviewImage, { src: { src: "/x.png", width: 400, height: 300 }, alt: "" })
    );
    for (const html of [filled, intrinsic]) {
      expect(html).not.toContain("pexels");
      expect(html).not.toMatch(/src="(https?:|\/)/);
      expect(html).toContain('aria-hidden="true"');
    }
    expect(filled).not.toContain("<img");
    expect(intrinsic).toContain('src="data:image/svg+xml');
    expect(intrinsic).toContain('width="400"'); // natural size, like next/image
    expect(intrinsic).toContain('height="300"');
  });

  it("keeps the caller's classes, so w-full / mx-auto lay it out as they did the picture", () => {
    const html = renderToStaticMarkup(
      React.createElement(PreviewImage, { src: { src: "/x.png", width: 100, height: 100 }, className: "w-full mx-auto rounded-2xl", alt: "" })
    );
    expect(html).toContain("w-full mx-auto rounded-2xl");
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
    expect(html).not.toMatch(/src="(https?:|\/)/); // no picture is requested, only inline placeholders
  });
});
