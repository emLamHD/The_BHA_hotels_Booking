import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BlogPagination, { pageWindow } from "./BlogPagination";
import { blogCategoryHref } from "@/lib/blog/blog";

const labels = { navigation: "Phân trang", previous: "Trang trước", next: "Trang sau", goTo: (p: number) => `Đến trang ${p}` };

describe("the pages shown", () => {
  it("is the first, the last and the neighbours of the current one, with a gap where pages are left out", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 12)).toEqual([1, null, 4, 5, 6, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 11, 12]);
  });
});

describe("pagination links", () => {
  it("are plain links that keep the language and the category, mark the current page, and show prev/next only where they lead somewhere", () => {
    const html = renderToStaticMarkup(React.createElement(BlogPagination, { current: 2, last: 4, hrefFor: (p) => blogCategoryHref("en-us", "places", p), labels }));
    expect(html).toContain('href="/blog/category/places?locale=en-us"');                // page 1 has no ?page=
    expect(html).toContain('href="/blog/category/places?locale=en-us&amp;page=3"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    const first = renderToStaticMarkup(React.createElement(BlogPagination, { current: 1, last: 4, hrefFor: (p) => blogCategoryHref("vi", "x", p), labels }));
    expect(first).not.toContain('rel="prev"');
  });

  it("render nothing for a single page", () => {
    expect(renderToStaticMarkup(React.createElement(BlogPagination, { current: 1, last: 1, hrefFor: () => "/", labels }))).toBe("");
  });
});
