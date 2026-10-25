import { BLOG_ROOT, BLOG_SLUG, blogCategoryHref, blogPostHref, normalizeLocale, parsePage } from "./blog";

/**
 * BHA-BLOG-001-CP04: permanent redirects for the Blog's old addresses. Next 13.4's `redirect()` in a page is always a 307, so a PERMANENT redirect (the API's
 * contract for an old slug is `301`) has to be made here, in the middleware, before the page renders. The API's own `301` is read as data (`redirect: "manual"`):
 * the answer sends the reader to the CURRENT CUSTOMER URL, never to an `/api` address, and always in one hop (the API resolves an old slug straight to the
 * current one; this never looks the target up again), so there is no chain and no loop.
 *
 * Three cases: `/blog/<old-slug>`, `/blog/category/<old-slug>`, and the old compatibility address `/blog?category=<slug>` (→ `/blog/category/<current-slug>`).
 * Anything this cannot decide — an API error, an unknown locale, a path that is not one of these — is `null`: the request goes on to the page, which says
 * what it can. The language is the URL's explicit `?locale=`, else the visitor's language cookie resolved against the site's active languages (C9); the target always carries the language it was resolved in.
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

/** The languages the site serves, normalized like the backend keys them, and its default — one read of `/website/config` per resolve; `null` when it cannot be read (or says nothing usable). */
async function siteLanguages(input: RedirectInput): Promise<{ active: string[]; fallback: string } | null> {
  try {
    const response = await (input.fetcher ?? fetch)(`${input.apiBase}/api/v1/website/config`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const config = (await response.json()) as { defaultLocale?: unknown; locales?: unknown };
    const fallback = typeof config.defaultLocale === "string" ? normalizeLocale(config.defaultLocale) : null;
    const active = (Array.isArray(config.locales) ? config.locales : []).map((l) => normalizeLocale(typeof l?.code === "string" ? l.code : null)).filter((l): l is string => l !== null);
    return fallback && active.length > 0 ? { active, fallback } : null;
  } catch {
    return null;
  }
}

/**
 * The language a request WITHOUT `?locale=` means, by the rule the API's dictionary resolver (and so the page) already applies: the cookie's tag if the site serves it,
 * else the tag with its script/region dropped (`en-us` → `en`), else the site's default. A stale cookie (a language since deactivated) is therefore the default, never a
 * language the Blog API refuses; the cookie itself is not touched.
 */
function implicitLocale(cookie: string | undefined, site: { active: string[]; fallback: string }): string {
  const parts = (normalizeLocale(cookie) ?? "").split("-").filter(Boolean);
  for (let length = parts.length; length >= 1; length -= 1) {
    const candidate = parts.slice(0, length).join("-");
    if (site.active.includes(candidate)) return candidate;
  }
  return site.fallback;
}

/** The Customer path (with its query) to answer with a `301`, or `null` for "no redirect". */
export async function resolveBlogRedirect(input: RedirectInput): Promise<string | null> {
  const found = classify(input.pathname, input.searchParams);
  if (!found) return null;

  // A parameter given twice is not one the Blog page accepts (its parsers reject an array), so it is never resolved to its first or last value — not even when both are the same.
  if (input.searchParams.getAll("locale").length > 1 || input.searchParams.getAll("page").length > 1) return null;

  // An absent page is page 1; a page that is no page (`abc`, `0`, `1.5`, empty, too long) is NOT turned into one: no redirect, so the Blog page's own validation answers its 404.
  const page = parsePage(input.searchParams.get("page") ?? undefined);
  if (page === null) return null;
  // An explicit `?locale=` is used as written (strict: an unknown or inactive one is not turned into the default — the Blog answers its own 404). Without one the language
  // is resolved against the site's active languages first, so the lookup is never made in a language the site no longer serves; if the site cannot be read, nothing is guessed.
  const explicit = input.searchParams.get("locale");
  if (explicit !== null && normalizeLocale(explicit) === null) return null;
  const site = explicit === null ? await siteLanguages(input) : null;
  if (explicit === null && !site) return null;
  const locale = explicit !== null ? normalizeLocale(explicit) : implicitLocale(input.cookieLocale, site!);

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
      // The old filter address: the category's own page (a slug that is nobody's gets that page's 404), in the language the page itself resolves for this visitor.
      return locale ? blogCategoryHref(locale, found.slug, page) : null;
    }
    return null;
  } catch {
    return null;
  }
}
