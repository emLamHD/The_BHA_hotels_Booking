import { BLOG_ROOT, BLOG_SLUG, blogCategoryHref, blogPostHref, normalizeLocale, parsePage } from "./blog";

/**
 * BHA-BLOG-001-CP04: permanent redirects for the Blog's old addresses. Next 13.4's `redirect()` in a page is always a 307, so a PERMANENT redirect (the API's
 * contract for an old slug is `301`) has to be made here, in the middleware, before the page renders. The API's own `301` is read as data (`redirect: "manual"`):
 * the answer sends the reader to the CURRENT CUSTOMER URL, never to an `/api` address, and always in one hop (the API resolves an old slug straight to the
 * current one; this never looks the target up again), so there is no chain and no loop.
 *
 * Three cases: `/blog/<old-slug>`, `/blog/category/<old-slug>`, and the old compatibility address `/blog?category=<slug>` (→ `/blog/category/<current-slug>`).
 * Anything this cannot decide — an API error, an unknown locale, a path that is not one of these — is `null`: the request goes on to the page, which says
 * what it can. The language is the URL's explicit `?locale=`, else the visitor's language cookie; the target always carries the language it was resolved in.
 */
export interface RedirectInput {
  pathname: string;
  searchParams: URLSearchParams;
  /** The visitor's language cookie (a language code of the site), if any. */
  cookieLocale?: string;
  apiBase: string;
  fetcher?: typeof fetch;
}

type Kind = { kind: "post" | "category"; slug: string } | { kind: "legacy-category"; slug: string };

function classify(pathname: string, searchParams: URLSearchParams): Kind | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === BLOG_ROOT) {
    // Exactly one value: a repeated `category` (even twice the same) is not resolved to its first or last — the index page answers its 404.
    const values = searchParams.getAll("category");
    return values.length === 1 && BLOG_SLUG.test(values[0]) ? { kind: "legacy-category", slug: values[0] } : null;
  }
  const category = /^\/blog\/category\/([^/]+)$/.exec(path);
  if (category) return BLOG_SLUG.test(category[1]) ? { kind: "category", slug: category[1] } : null;
  const post = /^\/blog\/([^/]+)$/.exec(path);
  return post && post[1] !== "category" && BLOG_SLUG.test(post[1]) ? { kind: "post", slug: post[1] } : null;
}

async function movedTo(response: Response): Promise<{ slug: string; locale: string | null } | null> {
  const body = (await response.json().catch(() => null)) as { slug?: unknown; locale?: unknown } | null;
  if (!body || typeof body.slug !== "string" || !BLOG_SLUG.test(body.slug)) return null;
  return { slug: body.slug, locale: typeof body.locale === "string" ? normalizeLocale(body.locale) : null };
}

/** The site's default language, normalized like the backend keys it, from the same website settings the pages resolve their language from; `null` when they cannot be read. */
async function defaultLocale(input: RedirectInput): Promise<string | null> {
  try {
    const response = await (input.fetcher ?? fetch)(`${input.apiBase}/api/v1/website/config`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const config = (await response.json()) as { defaultLocale?: unknown };
    return typeof config.defaultLocale === "string" ? normalizeLocale(config.defaultLocale) : null;
  } catch {
    return null;
  }
}

/** The Customer path (with its query) to answer with a `301`, or `null` for "no redirect". */
export async function resolveBlogRedirect(input: RedirectInput): Promise<string | null> {
  const found = classify(input.pathname, input.searchParams);
  if (!found) return null;

  // A parameter given twice is not one the Blog page accepts (its parsers reject an array), so it is never resolved to its first or last value — not even when both are the same.
  if (input.searchParams.getAll("locale").length > 1 || input.searchParams.getAll("page").length > 1) return null;

  const explicit = input.searchParams.get("locale");
  if (explicit !== null && normalizeLocale(explicit) === null) return null;
  const locale = explicit !== null ? normalizeLocale(explicit) : normalizeLocale(input.cookieLocale);
  // An absent page is page 1; a page that is no page (`abc`, `0`, `1.5`, empty, too long) is NOT turned into one: no redirect, so the Blog page's own validation answers its 404.
  const page = parsePage(input.searchParams.get("page") ?? undefined);
  if (page === null) return null;

  const route = found.kind === "post" ? "posts" : "categories";
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  try {
    const response = await (input.fetcher ?? fetch)(`${input.apiBase}/api/v1/website/blog/${route}/${encodeURIComponent(found.slug)}${query}`, {
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    if (response.status === 301) {
      const moved = await movedTo(response);
      const resolved = moved?.locale ?? locale;
      if (!moved || !resolved) return null;
      return found.kind === "post" ? blogPostHref(resolved, moved.slug) : blogCategoryHref(resolved, moved.slug, page);
    }
    if (found.kind === "legacy-category" && (response.ok || response.status === 404)) {
      // The old filter address: the category's own page (a slug that is nobody's gets that page's 404), in the language the page itself would resolve for this visitor:
      // the explicit one, the cookie's, else the site's DEFAULT as the API reports it — read, never assumed. If it cannot be read, no redirect (the page answers).
      const resolved = locale ?? (await defaultLocale(input));
      return resolved ? blogCategoryHref(resolved, found.slug, page) : null;
    }
    return null;
  } catch {
    return null;
  }
}
