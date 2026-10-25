import { getI18n } from "@/lib/i18n/server";
import type { I18nSnapshot } from "@/lib/i18n/types";
import { blogIndexHref, blogLocaleOf, blogPostHref, legacyCategoryOf, normalizeLocale, parsePage, type BlogPostDetail } from "./blog";

/**
 * BHA-BLOG-001-CP04: what every Blog page needs from its request — the language its URL means and the page it asks for. `locale` / `page` are `null` when the
 * URL names something that is not a language tag / a positive integer: the page answers a real 404 for those, it does not guess.
 */
export interface BlogSearchParams {
  locale?: string | string[];
  page?: string | string[];
  category?: string | string[];
}

export async function blogRequest(searchParams: BlogSearchParams | undefined) {
  const snapshot = await getI18n();
  return { snapshot, locale: blogLocaleOf(searchParams?.locale, snapshot.locale), page: parsePage(searchParams?.page) };
}

/**
 * What the index makes of `?category=` — one verdict for the page and its metadata. `"not-found"`: the parameter is empty, malformed or repeated, or it is a legacy
 * filter in a language the site does not serve (the API would answer that language 400 for the posts too, so the index is a 404, as without a category). `"unresolved"`:
 * one valid slug the middleware could not look up, in a language the site serves — shown as "could not load", never as the unfiltered list. A site configuration that could
 * not be read proves nothing about languages, so it does not turn a legacy address into a 404.
 */
export function legacyCategoryVerdict(category: string | string[] | undefined, snapshot: I18nSnapshot, locale: string): "none" | "unresolved" | "not-found" {
  const legacy = legacyCategoryOf(category);
  if (legacy !== "slug") return legacy === "none" ? "none" : "not-found";
  const served = snapshot.degraded || snapshot.config.locales.some((l) => normalizeLocale(l.code) === locale);
  return served ? "unresolved" : "not-found";
}

/** Where the language switch goes from a page that has no translation of its own (an index, a category): each language's Blog index. */
export function indexTargets(siteLocales: { code: string }[]): Record<string, string> {
  return Object.fromEntries(siteLocales.map((l) => [l.code, blogIndexHref(normalizeLocale(l.code) ?? l.code)]));
}

/** For a post: the translation in each language when it is published, else that language's index (never another language's text under the wrong URL). */
export function postTargets(siteLocales: { code: string }[], post: BlogPostDetail): Record<string, string> {
  const own = { locale: post.locale, slug: post.slug };
  const known = [own, ...post.alternates];
  return Object.fromEntries(
    siteLocales.map((l) => {
      const key = normalizeLocale(l.code) ?? l.code;
      const match = known.find((k) => k.locale === key);
      return [l.code, match ? blogPostHref(key, match.slug) : blogIndexHref(key)];
    })
  );
}
