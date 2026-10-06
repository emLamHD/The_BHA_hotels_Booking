/**
 * Which page paths the public Customer Web serves.
 *
 * CP01 answered every template page with a 404 (default deny). CP02-C3 (Owner decision, 2026-10-07)
 * restores the Chisfis template for the demo, so the template's pages are served again with their own
 * demo content. What stays closed is the server side: `/api/*` (the template's NextAuth/hello stubs) is
 * never a capability of this site. Two names are redirected: the old internal entry `/showcase` goes to
 * `/`, and the template's `/pay-done` goes to the live receipt at `/paydone`.
 *
 * Framework internals (`/_next/…`) never reach this function — the middleware matcher excludes them.
 */

/** Former internal page name, retained as a canonical redirect alias. */
export const LIVE_ENTRY_PAGE = "/showcase";
/** The internal page that answers a denied path with a 404. */
export const UNAVAILABLE_PAGE = "/showcase-unavailable";
/** Same-fragment navigation has no native hashchange event; restart alignment explicitly. */
export const SHOWCASE_SECTION_NAVIGATION_EVENT = "showcase:section-navigation";
/** The room page (a template listing route made real). */
export const ROOM_DETAILS_PAGE = "/listing-stay-detail";
/** The live receipt after a hold; the template's `/pay-done` is an alias of it. */
export const RECEIPT_PAGE = "/paydone";
export const TEMPLATE_RECEIPT_ALIAS = "/pay-done";

export type RouteDecision =
  | { kind: "live" }
  | { kind: "redirect"; to: string }
  | { kind: "pass" }
  | { kind: "unavailable" };

/**
 * CUST-WEB-SHOWCASE-001-CP02: the controlled photograph namespace. One path segment under
 * /media/the-bha-riverside/, a lowercase hyphenated name, `.webp` only — no subfolders, dots
 * in the name, other extensions (the build manifest is `.json`) or trailing slash. Matched
 * on the pathname as received, before any trailing-slash tolerance, so a lookalike never passes.
 */
export const MEDIA_NAMESPACE_PATTERN = /^\/media\/the-bha-riverside\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;

/** `/api` and everything under it. Case-insensitive, so `/API/x` is not a way around it. */
const API_PREFIX = /^\/api(?:\/|$)/i;

export function decideRoute(pathname: string): RouteDecision {
  if (MEDIA_NAMESPACE_PATTERN.test(pathname)) return { kind: "pass" };
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  if (path === "/") return { kind: "live" };
  if (API_PREFIX.test(path)) return { kind: "unavailable" };
  if (path === LIVE_ENTRY_PAGE) return { kind: "redirect", to: "/" };
  if (path === TEMPLATE_RECEIPT_ALIAS) return { kind: "redirect", to: RECEIPT_PAGE };
  return { kind: "pass" };
}
