/**
 * CUST-WEB-HEADER-001-CP02: where the Staff sign-in page may send a person after a confirmed sign-in. An exact
 * allowlist — the website pages and the default `/calendar` — and nothing else: no external URL, no
 * protocol-relative or scheme URL, no other path, no query or fragment, no `..`, no encoded variant. Anything
 * else is the default, silently, so the page never redirects anywhere it was not built to.
 */

export const DEFAULT_RETURN_TO = "/calendar";

export const WEBSITE_PAGES = ["/website/languages", "/website/translations", "/website/currencies", "/website/menus", "/website/hero", "/website/social-media"] as const;

/** BHA-BLOG-001-CP03: the Blog pages. A post's own page (`/website/blog/posts/<id>`) is not here: signing in from it comes back to the list. */
export const BLOG_PAGES = ["/website/blog/posts", "/website/blog/posts/new", "/website/blog/categories", "/website/blog/media", "/website/blog/settings"] as const;

const ALLOWED: ReadonlySet<string> = new Set<string>([DEFAULT_RETURN_TO, "/products", "/promotions", ...WEBSITE_PAGES, ...BLOG_PAGES]);

/** The sign-in destination: the value itself when it is exactly one allowed path, else `/calendar`. */
export function resolveReturnTo(value: string | string[] | null | undefined): string {
  return typeof value === "string" && ALLOWED.has(value) ? value : DEFAULT_RETURN_TO;
}

/** `/signin` with the page to come back to, for a website page; the plain `/signin` for anything else. */
export function signInUrlFor(path: string): string {
  return path !== DEFAULT_RETURN_TO && ALLOWED.has(path) ? `/signin?returnTo=${encodeURIComponent(path)}` : "/signin";
}
