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
    const slug = searchParams.get("category");
    return slug !== null && BLOG_SLUG.test(slug) ? { kind: "legacy-category", slug } : null;
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

/** The Customer path (with its query) to answer with a `301`, or `null` for "no redirect". */
export async function resolveBlogRedirect(input: RedirectInput): Promise<string | null> {
  const found = classify(input.pathname, input.searchParams);
  if (!found) return null;

  const explicit = input.searchParams.get("locale");
  if (explicit !== null && normalizeLocale(explicit) === null) return null;
  const locale = explicit !== null ? normalizeLocale(explicit) : normalizeLocale(input.cookieLocale);
  const page = parsePage(input.searchParams.get("page") ?? undefined) ?? 1;

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
      // The old filter address: the category's own page (a slug that is nobody's gets that page's 404).
      return locale ? blogCategoryHref(locale, found.slug, page) : `${BLOG_ROOT}/category/${found.slug}${page > 1 ? `?page=${page}` : ""}`;
    }
    return null;
  } catch {
    return null;
  }
}
