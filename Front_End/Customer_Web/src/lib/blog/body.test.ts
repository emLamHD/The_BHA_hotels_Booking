import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BlogBody from "@/components/blog/BlogBody";
import { parsePostDetail } from "./blog";
import { parseBody, safeHref } from "./body";
import { API, apiDetail } from "./blogTestkit";

const MEDIA_A = "aaaaaaaa-0000-0000-0000-000000000001";
const MEDIA_B = "aaaaaaaa-0000-0000-0000-000000000002";
const PROPERTY = "bbbbbbbb-0000-0000-0000-000000000001";
const labels = { tocTitle: "Nội dung chính", galleryLabel: "Bộ ảnh", propertyCta: (name: string) => `Xem ${name}` };
const media = (id: string, n: number) => ({ url: `/api/v1/website/blog/media/${id}`, width: 800, height: 600, variants: [{ preset: "card", format: "webp", type: "image/webp", url: `/api/v1/website/blog/media/${id}/1/card.webp`, width: 640, height: 480 }] });

function render(blocks: unknown[], extra: Record<string, unknown> = {}) {
  const post = parsePostDetail(
    apiDetail({
      body: { schemaVersion: 1, blocks },
      media: { [MEDIA_A]: media(MEDIA_A, 1), [MEDIA_B]: media(MEDIA_B, 2) },
      properties: { [PROPERTY]: { slug: "the-bha-riverside", name: "The BHA Riverside" }, "bbbbbbbb-0000-0000-0000-000000000002": { slug: "villa-x", name: "Villa X" } },
      ...extra,
    }),
    API
  )!;
  return renderToStaticMarkup(React.createElement(BlogBody, { blocks: parseBody(post.body), media: post.media, properties: post.properties, labels }));
}

describe("only an internal path or an https address is a link", () => {
  it("decides on the text itself", () => {
    expect([safeHref("/offers"), safeHref("https://example.com/a")]).toEqual(["/offers", "https://example.com/a"]);
    for (const bad of ["//evil.test", "http://example.com", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "", "/a\nb", "https://", null, 5]) expect(safeHref(bad)).toBeNull();
  });
});

// A real backslash (code 92) after the slash: browsers read `/\host` as `//host`, so it must not be an internal link. The test origin is never visited.
const BACKSLASH = String.fromCharCode(92);
const SLASH_BACKSLASH_HOST = `/${BACKSLASH}evil.example`;

describe("a backslash never makes an internal link", () => {
  it("is a real backslash, and a browser's URL parser leaves the site with it", () => {
    expect(SLASH_BACKSLASH_HOST.charCodeAt(1)).toBe(92);
    expect(new URL(SLASH_BACKSLASH_HOST, "https://site.test").origin).toBe("https://evil.example");
    expect(new URL("/offers?a=1#b", "https://site.test").origin).toBe("https://site.test");
  });

  it("refuses it at the start, inside the path and in an https address, and keeps the allowed forms", () => {
    for (const bad of [SLASH_BACKSLASH_HOST, `/offers${BACKSLASH}evil.example`, `/a/${BACKSLASH}/b`, `https://site.test${BACKSLASH}@evil.example/`]) expect(safeHref(bad)).toBeNull();
    for (const ok of ["/offers", "/offers?a=1#b", "/", "https://example.com/a?b=1#c"]) expect(safeHref(ok)).toBe(ok);
    for (const bad of ["//evil.test", "http://example.com", "javascript:alert(1)", "/a\tb"]) expect(safeHref(bad)).toBeNull();
  });

  it("through parseBody and the renderer: no link, the text and the rest of the post stay", () => {
    const html = render([
      { type: "paragraph", inlines: [{ text: "đậm", bold: true, href: SLASH_BACKSLASH_HOST }, { text: "nghiêng", italic: true, href: `/offers${BACKSLASH}x` }, { text: "ưu đãi", href: "/offers" }, { text: "nguồn", href: "https://example.com/x" }] },
      { type: "paragraph", inlines: [{ text: "phần còn lại" }] },
    ]);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("%5C");
    expect(html).toContain("<strong>đậm</strong>");
    expect(html).toContain("<em>nghiêng</em>");
    expect(html).toContain("phần còn lại");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('href="/offers"');
    expect(html).toContain('href="https://example.com/x"');
  });
});

describe("the body is React, never HTML", () => {
  it("shows markup and script text as text, and a javascript: link as plain text", () => {
    const html = render([
      { type: "paragraph", inlines: [{ text: "<img src=x onerror=alert(1)> & <script>alert(2)</script>" }, { text: "bấm", href: "javascript:alert(3)" }] },
    ]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("bấm");
  });

  it("renders bold, italic, internal and external links; the external one is not given the referrer or the window", () => {
    const html = render([{ type: "paragraph", inlines: [{ text: "đậm", bold: true }, { text: "nghiêng", italic: true }, { text: "ưu đãi", href: "/offers" }, { text: "nguồn", href: "https://example.com/x" }] }]);
    expect(html).toContain("<strong>đậm</strong>");
    expect(html).toContain("<em>nghiêng</em>");
    expect(html).toContain('href="/offers"');
    expect(html).toMatch(/<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer"/);
  });

  it("leaves out a block it does not know or that is malformed, and renders the rest", () => {
    const html = render([
      { type: "embed", src: "https://evil.test" }, { type: "paragraph", inlines: "not an array" }, { type: "heading", level: 1, text: "H1 is the page's" }, { type: "heading", level: 5, text: "x" },
      { type: "image", mediaId: "not-a-guid", alt: "" }, { type: "paragraph", inlines: [{ text: "còn lại" }] },
    ]);
    expect(html).toContain("còn lại");
    expect(html).not.toContain("evil.test");
    expect(html).not.toMatch(/<h[1-6]/);                                                             // the body has no H1, and nothing but H2–H4 is a heading
    expect(parseBody({ schemaVersion: 2, blocks: [] })).toEqual([]);
  });
});

describe("headings and the table of contents", () => {
  const blocks = [
    { type: "toc" },
    { type: "heading", level: 2, text: "Điểm đến" }, { type: "heading", level: 3, text: "Điểm đến" }, { type: "heading", level: 2, text: "Điểm Đến!" }, { type: "heading", level: 4, text: "???" },
  ];

  it("gives every heading a stable id that never repeats, and the TOC links to exactly those ids", () => {
    const ids = parseBody({ schemaVersion: 1, blocks }).flatMap((b) => (b.type === "heading" ? [b.id] : []));
    expect(ids).toEqual(["diem-den", "diem-den-2", "diem-den-3", "section"]);
    expect(parseBody({ schemaVersion: 1, blocks }).flatMap((b) => (b.type === "heading" ? [b.id] : []))).toEqual(ids);   // the same text gives the same ids
    const html = render(blocks);
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).toContain("<h4");
  });

  it("shows no TOC when the body has no heading", () => {
    expect(render([{ type: "toc" }, { type: "paragraph", inlines: [{ text: "x" }] }])).not.toContain("blog-toc");
  });
});

describe("pictures, gallery and the Property block", () => {
  it("shows a picture with its alt and caption as <picture> at the API's address, WebP first", () => {
    const html = render([{ type: "image", mediaId: MEDIA_A, alt: "Cầu Rồng", caption: "Cầu Rồng về đêm" }]);
    expect(html).toContain('alt="Cầu Rồng"');
    expect(html).toContain("<figcaption");
    expect(html).toContain('type="image/webp"');
    expect(html).toContain(`${API}/api/v1/website/blog/media/${MEDIA_A}/1/card.webp 640w`);
    expect(html).not.toContain("/_next/image");                                                      // not through the optimizer's copy
  });

  it("skips a picture the API did not send instead of showing a broken image", () => {
    expect(render([{ type: "image", mediaId: "cccccccc-0000-0000-0000-000000000009", alt: "x" }])).not.toContain("<img");
    const gallery = render([{ type: "gallery", items: [{ mediaId: MEDIA_A, alt: "a" }, { mediaId: "cccccccc-0000-0000-0000-000000000009", alt: "gone" }, { mediaId: MEDIA_B, alt: "b", caption: "chú thích" }] }]);
    expect(gallery.match(/<img/g)).toHaveLength(2);
    expect(gallery).toContain('data-testid="blog-gallery"');
  });

  it("links the Property block only to a page the site has, names the others, and drops one that is no longer public", () => {
    const html = render([{ type: "propertyIntro", propertyId: PROPERTY }, { type: "propertyIntro", propertyId: "bbbbbbbb-0000-0000-0000-000000000002" }, { type: "propertyIntro", propertyId: "bbbbbbbb-0000-0000-0000-000000000003" }]);
    expect(html).toContain('href="/riverside"');
    expect(html).toContain("Xem The BHA Riverside");
    expect(html).toContain("Villa X");
    expect(html).not.toContain("Xem Villa X");                                                       // no page to send a reader to
    expect(html.match(/blog-property/g)).toHaveLength(2);
    expect(html).not.toMatch(/₫|\$|giá|price/i);                                                    // no price or availability is stated
  });
});
