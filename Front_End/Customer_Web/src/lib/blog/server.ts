import { cache } from "react";
import { getApiBaseUrl } from "@/lib/api/env";
import {
  BLOG_SLUG,
  parseCategory,
  parseCategoryList,
  parseHomeSection,
  parsePostDetail,
  parsePostList,
  type BlogCategory,
  type BlogHomeSection,
  type BlogPostDetail,
  type BlogPostItem,
  type BlogPostList,
} from "./blog";

/**
 * BHA-BLOG-001-CP04: the server's reads of the public Blog. Every read is `no-store` (Next 13 caches server fetches by default, which would keep a post the
 * Admin has since unpublished) and there is NO last-good copy: a post that may since have been unpublished must not be shown during an outage, so a failed
 * read is `error` and the page says it could not load — never a 404, an empty list or a post from anywhere else. No Staff cookie or session is sent.
 * `missing` is only what the API itself answers 404 (or "no such language") for; `moved` is the API's 301, read as data — the redirect to the Customer URL is the
 * caller's, so a reader is never sent to an `/api` address and there is no chain.
 */
export type BlogRead<T> = { status: "ok"; value: T } | { status: "missing" } | { status: "moved"; slug: string } | { status: "error" };

const PREFIX = "/api/v1/website/blog";

const PARSERS = {
  posts: parsePostList,
  post: parsePostDetail,
  categories: (json: unknown) => parseCategoryList(json),
  category: (json: unknown) => parseCategory(json),
  home: parseHomeSection,
} as const;
type Kind = keyof typeof PARSERS;

/** One read per request and address: the page and its `generateMetadata` ask for the same thing and share the answer (the key is two plain strings). */
const readOnce = cache(async (kind: Kind, path: string): Promise<BlogRead<unknown>> => {
  try {
    const base = getApiBaseUrl();
    // `manual`: a 301 is answered by this function, not followed to an API address.
    const response = await fetch(`${base}${PREFIX}${path}`, { cache: "no-store", redirect: "manual", headers: { Accept: "application/json" } });
    if (response.status === 404) return { status: "missing" };
    if (response.status === 301) {
      const moved = (await response.json()) as { slug?: unknown };
      if (typeof moved?.slug === "string" && BLOG_SLUG.test(moved.slug)) return { status: "moved", slug: moved.slug };
      throw new Error("a 301 without a usable slug");
    }
    if (response.status === 400) {
      const problem = (await response.json().catch(() => null)) as { code?: unknown } | null;
      if (problem?.code === "blog.locale-unsupported") return { status: "missing" };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = (PARSERS[kind] as (json: unknown, base: string) => unknown)(await response.json(), base);
    if (value === null) throw new Error("the answer is not a Blog answer");
    return { status: "ok", value };
  } catch (error) {
    console.error(`[blog] ${kind} ${path.split("?")[0]} could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
    return { status: "error" };
  }
});

const read = <T>(kind: Kind, path: string) => readOnce(kind, path) as Promise<BlogRead<T>>;

const q = (locale: string, more: Record<string, string | number | undefined> = {}) => {
  const query = new URLSearchParams({ locale });
  for (const [key, value] of Object.entries(more)) if (value !== undefined) query.set(key, String(value));
  return `?${query.toString()}`;
};

export const getBlogPosts = (locale: string, options: { category?: string; page?: number; pageSize?: number } = {}) =>
  read<BlogPostList>("posts", `/posts${q(locale, options)}`);

export const getBlogPost = (locale: string, slug: string) =>
  read<BlogPostDetail>("post", `/posts/${encodeURIComponent(slug)}${q(locale)}`);

export const getBlogCategories = (locale: string) => read<BlogCategory[]>("categories", `/categories${q(locale)}`);

export const getBlogCategory = (locale: string, slug: string) =>
  read<BlogCategory>("category", `/categories/${encodeURIComponent(slug)}${q(locale)}`);

export const getBlogHomeSection = (locale: string, limit = 6) =>
  read<BlogHomeSection>("home", `/home-section${q(locale, { limit })}`);

/**
 * Every published post of a language, all pages (a sitemap is not the first page of the API). Throws when any page cannot be read, or when the pages do not agree
 * with each other (a total that moves, a page that is not the one asked for, a post twice, a count that is not the total): a partial or mixed list is never returned
 * as complete. This catches a list that changed in a way the pages show; it is not a snapshot — a change that keeps the total and the counts is not detected.
 */
export async function getAllBlogPosts(locale: string): Promise<BlogPostItem[]> {
  const pageSize = 50;
  const all: BlogPostItem[] = [];
  const ids = new Set<string>();
  let total = -1;
  const moved = (page: number, why: string) => new Error(`the Blog posts of ${locale} changed while it was read (page ${page}: ${why})`);
  for (let page = 1; ; page += 1) {
    const result = await getBlogPosts(locale, { page, pageSize });
    if (result.status !== "ok") throw new Error(`the Blog posts of ${locale} (page ${page}) could not be read`);
    const list = result.value;
    if (list.page !== page || list.pageSize !== pageSize) throw moved(page, `the API sent page ${list.page} of ${list.pageSize}`);
    if (page === 1) total = list.total;
    else if (list.total !== total) throw moved(page, `the total went from ${total} to ${list.total}`);
    for (const post of list.items) {
      if (ids.has(post.id)) throw new Error(`the Blog posts of ${locale} list a post twice (page ${page})`);
      ids.add(post.id);
      all.push(post);
    }
    if (page * pageSize >= total) {
      if (all.length !== total) throw moved(page, `${all.length} posts found for a total of ${total}`);
      return all;
    }
    // The API says there is more but sent nothing: the list moved under us, so it is not complete.
    if (list.items.length === 0) throw new Error(`the Blog posts of ${locale} ended early at page ${page}`);
  }
}

export async function getAllBlogCategories(locale: string): Promise<BlogCategory[]> {
  const result = await getBlogCategories(locale);
  if (result.status !== "ok") throw new Error(`the Blog categories of ${locale} could not be read`);
  return result.value;
}
