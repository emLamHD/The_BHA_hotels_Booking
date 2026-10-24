import { describe, expect, it } from "vitest";
import { category, item } from "@/lib/blog/blogTestkit";
import { robotsTxt, sitemapEntries, sitemapXml, SITEMAP_MAX_BYTES, SITEMAP_MAX_URLS, STATIC_PUBLIC_PATHS } from "./sitemap";

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

describe("the sitemap's two protocol limits (one file: 50,000 URLs, 52,428,800 bytes uncompressed)", () => {
  const post = (slug: string) => ({ id: slug, slug, modifiedAt: "2026-10-10T03:00:00+00:00" }) as unknown as ReturnType<typeof item>;
  const posts = (count: number) => Array.from({ length: count }, (_, i) => post(`p${i}`));
  const STATIC_AND_INDEX = STATIC_PUBLIC_PATHS.length + 1;        // the pages every run has, and the language's Blog index
  const bytes = (xml: string) => Buffer.byteLength(xml, "utf8");
  const entry = (url: string) => ({ url });
  /** One entry whose `url` is `filler` after a fixed prefix; the whole file is that entry alone. */
  const single = (filler: string) => sitemapXml([entry(`${ORIGIN}/${filler}`)]);

  it("takes exactly 50,000 URL entries and refuses 50,001, counting the static pages, the Blog index and the categories, after de-duplication", () => {
    const at = sitemapEntries(ORIGIN, ["vi"], { posts: { vi: posts(SITEMAP_MAX_URLS - STATIC_AND_INDEX) }, categories: { vi: [] } });
    expect(at).toHaveLength(SITEMAP_MAX_URLS);
    expect(() => sitemapXml(at)).not.toThrow();

    expect(() => sitemapEntries(ORIGIN, ["vi"], { posts: { vi: posts(SITEMAP_MAX_URLS - STATIC_AND_INDEX + 1) }, categories: { vi: [] } })).toThrow(/50000 URLs/);
    // a category is an entry too
    expect(() => sitemapEntries(ORIGIN, ["vi"], { posts: { vi: posts(SITEMAP_MAX_URLS - STATIC_AND_INDEX) }, categories: { vi: [category("diem-den")] } })).toThrow(/50000 URLs/);
    // two languages: every locale counts
    expect(() => sitemapEntries(ORIGIN, ["vi", "en"], { posts: { vi: posts(30_000), en: posts(30_000) }, categories: {} })).toThrow(/50000 URLs/);
    // the same URL listed twice is one entry: 60,000 posts that are 30,000 distinct slugs fit
    expect(sitemapEntries(ORIGIN, ["vi"], { posts: { vi: [...posts(30_000), ...posts(30_000)] }, categories: {} })).toHaveLength(30_000 + STATIC_AND_INDEX);
    // the XML builder refuses a list that is too long on its own, too
    expect(() => sitemapXml(Array.from({ length: SITEMAP_MAX_URLS + 1 }, (_, i) => entry(`${ORIGIN}/${i}`)))).toThrow(/50000 URLs/);
  });

  it("measures the file in UTF-8 bytes — header, markup and escaping included — and accepts exactly 52,428,800 of them", () => {
    const base = bytes(single(""));
    const atLimit = single("a".repeat(SITEMAP_MAX_BYTES - base));
    expect(bytes(atLimit)).toBe(SITEMAP_MAX_BYTES);
    expect(() => single("a".repeat(SITEMAP_MAX_BYTES - base + 1))).toThrow(/52428800 bytes/);
  });

  it("counts a multi-byte character by its bytes, not as one string character", () => {
    const base = bytes(single(""));
    const fits = Math.floor((SITEMAP_MAX_BYTES - base) / 3);              // "€" is 3 bytes
    expect(bytes(single("€".repeat(fits)))).toBeLessThanOrEqual(SITEMAP_MAX_BYTES);
    const tooBig = single.bind(null, "€".repeat(fits + 1));
    expect("€".repeat(fits + 1).length).toBeLessThan(SITEMAP_MAX_BYTES);  // a string.length check would let it through
    expect(tooBig).toThrow(/52428800 bytes/);
  });

  it("counts escaped text as the escaped bytes (& is 5 bytes as &amp;)", () => {
    const base = bytes(single(""));
    const fits = Math.floor((SITEMAP_MAX_BYTES - base) / 5);
    expect(bytes(single("&".repeat(fits)))).toBeLessThanOrEqual(SITEMAP_MAX_BYTES);
    expect("&".repeat(fits + 1).length).toBeLessThan(SITEMAP_MAX_BYTES / 4);
    expect(() => single("&".repeat(fits + 1))).toThrow(/52428800 bytes/);
  });

  it("leaves a sitemap inside both limits exactly as it was (same URLs, lastmod and markup)", () => {
    const entries = sitemapEntries(ORIGIN, ["vi"], { posts: { vi: [item(1, { id: "a", slug: "bai-a", modifiedAt: "2026-10-10T03:00:00+00:00" })] }, categories: { vi: [category("diem-den")] } });
    const out = sitemapXml(entries);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>')).toBe(true);
    expect(out.endsWith("</url>\n</urlset>\n")).toBe(true);
    expect(out).toContain(`<url><loc>${ORIGIN}/blog/bai-a?locale=vi</loc><lastmod>2026-10-10T03:00:00+00:00</lastmod></url>`);
    expect(out.match(/<url>/g)).toHaveLength(entries.length);
  });
});
