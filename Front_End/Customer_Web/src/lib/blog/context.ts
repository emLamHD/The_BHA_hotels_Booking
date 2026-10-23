import { getI18n } from "@/lib/i18n/server";
import { blogIndexHref, blogLocaleOf, blogPostHref, normalizeLocale, parsePage, type BlogPostDetail } from "./blog";

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
