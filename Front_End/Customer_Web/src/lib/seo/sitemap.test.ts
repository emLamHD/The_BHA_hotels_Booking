import { describe, expect, it } from "vitest";
import { category, item } from "@/lib/blog/blogTestkit";
import { robotsTxt, sitemapEntries, sitemapXml, STATIC_PUBLIC_PATHS } from "./sitemap";

const ORIGIN = "https://www.thebha.test";
const many = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => item(1, { id: `${prefix}-${i}`, slug: `${prefix}-${i}`, modifiedAt: `2026-10-${String(10 + (i % 15)).padStart(2, "0")}T03:00:00+00:00` }));

describe("the sitemap", () => {
  it("lists every post of every page of the API — more than one page of posts — once, in each language, with the post's own modified date", () => {
    const entries = sitemapEntries(ORIGIN, ["vi", "en-US"], { posts: { vi: many("bai", 130), "en-us": many("post", 3) }, categories: { vi: [category("diem-den")], "en-us": [category("places")] } });
    const urls = entries.map((e) => e.url);

    expect(urls.filter((u) => u.includes("/blog/bai-"))).toHaveLength(130);
    expect(urls).toContain(`${ORIGIN}/blog/post-2?locale=en-us`);
    expect(urls).toContain(`${ORIGIN}/blog/category/places?locale=en-us`);
    expect(urls).toContain(`${ORIGIN}/blog?locale=vi`);
    expect(new Set(urls).size).toBe(urls.length);
    expect(entries.find((e) => e.url.endsWith("/blog/bai-0?locale=vi"))?.lastModified).toBe("2026-10-10T03:00:00+00:00");
    expect(entries.find((e) => e.url === `${ORIGIN}/`)?.lastModified).toBeUndefined();               // a static page's date is never "now"
  });

  it("lists the public pages on purpose, and nothing that is not a page for the public", () => {
    const urls = sitemapEntries(ORIGIN, ["vi"], { posts: {}, categories: {} }).map((e) => e.url);
    expect(urls).toEqual(STATIC_PUBLIC_PATHS.map((p) => `${ORIGIN}${p}`));
    expect(urls.join(" ")).not.toMatch(/account|checkout|paydone|pay-done|admin|\/api|add-listing|login|signup|listing-/);
  });

  it("gives a language with nothing published no Blog page, so an empty language is not found", () => {
    const urls = sitemapEntries(ORIGIN, ["vi", "fr"], { posts: { vi: many("bai", 1) }, categories: { vi: [] } }).map((e) => e.url);
    expect(urls.some((u) => u.includes("locale=fr"))).toBe(false);
    expect(urls).toContain(`${ORIGIN}/blog/bai-0?locale=vi`);
  });

  it("de-duplicates the same address and ignores a language code that is not a tag", () => {
    const post = item(1);
    const urls = sitemapEntries(ORIGIN, ["vi", "VI", "not a tag"], { posts: { vi: [post, post] }, categories: {} }).map((e) => e.url);
    expect(urls.filter((u) => u === `${ORIGIN}/blog/bai-viet-1?locale=vi`)).toHaveLength(1);
  });
});

describe("the sitemap document and robots.txt", () => {
  it("is the sitemap protocol's urlset with every value escaped", () => {
    const xmlText = sitemapXml([{ url: "https://x.test/blog/a?locale=vi&page=2" }, { url: "https://x.test/b", lastModified: "2026-10-21T03:00:00+00:00" }, { url: "https://x.test/<c>" }]);
    expect(xmlText).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(xmlText).toContain("<loc>https://x.test/blog/a?locale=vi&amp;page=2</loc>");
    expect(xmlText).toContain("<lastmod>2026-10-21T03:00:00+00:00</lastmod>");
    expect(xmlText).toContain("<loc>https://x.test/&lt;c&gt;</loc>");
    expect(xmlText.match(/<url>/g)).toHaveLength(3);
  });

  it("names the sitemap on the configured origin only, keeps non-pages out, and does not lock the public site", () => {
    const withOrigin = robotsTxt("https://www.thebha.test");
    expect(withOrigin).toContain("Sitemap: https://www.thebha.test/sitemap.xml");
    expect(withOrigin).toContain("Allow: /\n");
    expect(withOrigin).not.toMatch(/^Disallow: \/$/m);
    for (const path of ["/api/", "/account", "/checkout", "/paydone"]) expect(withOrigin).toContain(`Disallow: ${path}`);
    expect(robotsTxt(null)).not.toContain("Sitemap:");
  });
});
