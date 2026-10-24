import { blogCategoryHref, blogIndexHref, blogPostHref, normalizeLocale, type BlogCategory, type BlogPostItem } from "@/lib/blog/blog";
import { OFFERS_PATH, RIVERSIDE_PATH } from "@/lib/riversideHomeContent";

/**
 * BHA-BLOG-001-CP05: the sitemap — the public pages this site means to have found, and every published Blog page of every language. Not in it: the account,
 * checkout and receipt pages, the template's demo pages, a draft / unpublished / archived post, an old slug (it is a redirect, not a page). Every address is
 * the canonical one (`?locale=` always spelled out), listed once; `lastmod` is a post's published `modifiedAt` and is never "now".
 */
export interface SitemapEntry {
  url: string;
  lastModified?: string;
}

/** The pages that are meant to be found. */
export const STATIC_PUBLIC_PATHS = ["/", RIVERSIDE_PATH, OFFERS_PATH, "/faq"] as const;

export interface BlogSitemapData {
  /** Normalized language code → every published post of that language (all pages of the API, not the first). */
  posts: Record<string, BlogPostItem[]>;
  categories: Record<string, BlogCategory[]>;
}

/**
 * One sitemap file is what this site serves (a sitemap index is DEFERRED), and the protocol's limits for one file are 50,000 URLs and 52,428,800 bytes
 * uncompressed (https://www.sitemaps.org/protocol.html). A list beyond either is an error — the route answers its "not available" 500 — never a truncated file,
 * a file with URLs left out, or an oversized one.
 */
export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 52_428_800;

export function sitemapEntries(origin: string, localeCodes: string[], blog: BlogSitemapData): SitemapEntry[] {
  const seen = new Map<string, SitemapEntry>();
  const add = (path: string, lastModified?: string) => {
    const url = `${origin}${path}`;
    if (seen.has(url)) return;
    // Counted after de-duplication, over the static pages and every language; refused as soon as it is passed, before the rest is walked or any XML is built.
    if (seen.size >= SITEMAP_MAX_URLS) throw new Error(`the sitemap would have more than ${SITEMAP_MAX_URLS} URLs, the limit of one file`);
    seen.set(url, lastModified ? { url, lastModified } : { url });
  };
  STATIC_PUBLIC_PATHS.forEach((path) => add(path));
  for (const code of localeCodes) {
    const locale = normalizeLocale(code);
    if (!locale) continue;
    const posts = blog.posts[locale] ?? [];
    const categories = blog.categories[locale] ?? [];
    if (posts.length === 0 && categories.length === 0) continue; // a language with nothing published has no Blog page to find
    add(blogIndexHref(locale));
    categories.forEach((category) => add(blogCategoryHref(locale, category.slug)));
    posts.forEach((post) => add(blogPostHref(locale, post.slug), post.modifiedAt));
  }
  return Array.from(seen.values());
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The sitemap protocol's `urlset` (one `<url>` per entry), every value escaped. Throws when the list or the file is beyond the limits of one file (see `SITEMAP_MAX_URLS`). */
export function sitemapXml(entries: SitemapEntry[]): string {
  if (entries.length > SITEMAP_MAX_URLS) throw new Error(`the sitemap would have more than ${SITEMAP_MAX_URLS} URLs, the limit of one file`);
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  const tail = "\n</urlset>\n";
  // UTF-8 bytes of the whole file (header, markup, escaping and the "\n" between rows), checked as the rows are made so an oversized file is never joined.
  let size = Buffer.byteLength(head) + Buffer.byteLength(tail);
  const rows: string[] = [];
  for (const e of entries) {
    const row = `<url><loc>${xml(e.url)}</loc>${e.lastModified ? `<lastmod>${xml(e.lastModified)}</lastmod>` : ""}</url>`;
    size += Buffer.byteLength(row) + (rows.length > 0 ? 1 : 0);
    if (size > SITEMAP_MAX_BYTES) throw new Error(`the sitemap would be more than ${SITEMAP_MAX_BYTES} bytes, the limit of one file`);
    rows.push(row);
  }
  return `${head}${rows.join("\n")}${tail}`;
}

/** Everything public may be crawled; only what is not a page for the public is kept out. The sitemap is named from the configured origin, and not at all when there is none. */
export function robotsTxt(origin: string | null): string {
  const lines = ["User-Agent: *", "Allow: /", ...["/api/", "/account", "/checkout", "/paydone", "/pay-done"].map((p) => `Disallow: ${p}`)];
  if (origin) lines.push("", `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join("\n")}\n`;
}
