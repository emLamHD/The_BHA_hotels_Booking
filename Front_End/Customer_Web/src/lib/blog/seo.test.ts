import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import JsonLd, { serializeJsonLd } from "@/components/JsonLd";
import { detail } from "./blogTestkit";
import { postJsonLd, postMetadata } from "./seo";

const ORIGIN = "https://www.thebha.test";
const crumbs = { home: "Trang chủ", blog: "Blog" };

describe("what a crawler reads from a post", () => {
  it("uses the published revision's SEO text, else its title and summary, with the canonical on the configured public origin", () => {
    const meta = postMetadata(ORIGIN, detail({ seo: { metaTitle: "Tiêu đề SEO", metaDescription: "Mô tả SEO", ogImageUrl: null } }));
    expect(meta.title).toBe("Tiêu đề SEO — The BHA");
    expect(meta.description).toBe("Mô tả SEO");
    expect(meta.alternates?.canonical).toBe("https://www.thebha.test/blog/bai-viet-1?locale=vi");
    expect(meta.openGraph).toMatchObject({ type: "article", locale: "vi", publishedTime: "2026-10-20T03:00:00+00:00", modifiedTime: "2026-10-21T03:00:00+00:00" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });

    const plain = postMetadata(ORIGIN, detail());
    expect(plain.title).toBe("Bài viết 1 — The BHA");
    expect(plain.description).toBe("Tóm tắt bài viết 1");
  });

  it("lists in hreflang only the post's own language and the translations the API says are published", () => {
    const meta = postMetadata(ORIGIN, detail({ locale: "vi", alternates: [{ locale: "en-US", slug: "article-1" }] }));
    expect(meta.alternates?.languages).toEqual({
      vi: "https://www.thebha.test/blog/bai-viet-1?locale=vi",
      "en-US": "https://www.thebha.test/blog/article-1?locale=en-us",
    });
    expect(postMetadata(ORIGIN, detail()).alternates?.languages).toEqual({ vi: "https://www.thebha.test/blog/bai-viet-1?locale=vi" });
  });

  it("says nothing that needs an absolute address when the site origin is not configured — and never guesses one", () => {
    const meta = postMetadata(null, detail());
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph?.url).toBeUndefined();
    expect(postJsonLd(null, detail(), crumbs)).toBeNull();
    expect(JSON.stringify(meta)).not.toContain("localhost");
  });

  it("builds BlogPosting and BreadcrumbList from the real data: the API's dates, no invented author", () => {
    const [post, breadcrumb] = postJsonLd(ORIGIN, detail(), crumbs) as Record<string, any>[];
    expect(post).toMatchObject({ "@type": "BlogPosting", headline: "Bài viết 1", datePublished: "2026-10-20T03:00:00+00:00", dateModified: "2026-10-21T03:00:00+00:00", inLanguage: "vi", author: { name: "Ban biên tập" } });
    expect(breadcrumb.itemListElement.map((i: any) => [i.position, i.name])).toEqual([[1, "Trang chủ"], [2, "Blog"], [3, "Điểm đến"], [4, "Bài viết 1"]]);
    expect(breadcrumb.itemListElement.at(-1).item).toBe("https://www.thebha.test/blog/bai-viet-1?locale=vi");

    const [noAuthor] = postJsonLd(ORIGIN, detail({ author: "  " }), crumbs) as Record<string, any>[];
    expect(noAuthor).not.toHaveProperty("author");
    expect(JSON.stringify(noAuthor)).not.toMatch(/rating|aggregateRating|review/i);
  });
});

describe("structured data is escaped so no text can leave its JSON string", () => {
  it("escapes the characters that could close the script or break a parser, and round-trips", () => {
    const hostile = { headline: '</script><script>alert(1)</script> & <b> \u2028 \u2029 "quotes"' };
    const text = serializeJsonLd(hostile);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual(hostile);
    const html = renderToStaticMarkup(React.createElement(JsonLd, { data: hostile }));
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
