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

export function sitemapEntries(origin: string, localeCodes: string[], blog: BlogSitemapData): SitemapEntry[] {
  const seen = new Map<string, SitemapEntry>();
  const add = (path: string, lastModified?: string) => {
    const url = `${origin}${path}`;
    if (!seen.has(url)) seen.set(url, lastModified ? { url, lastModified } : { url });
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
