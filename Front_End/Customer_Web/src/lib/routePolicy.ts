/**
 * CUST-WEB-SHOWCASE-001-CP01: which page paths the public Customer Web may
 * serve. Default deny: only the home page and (CP02-C2) one room's details
 * page are pages; the template routes that would present unfinished
 * features (listings, checkout, pay-done, login, accounts, blog, …) are
 * answered by the unavailable page.
 *
 * Framework internals (`/_next/…`) never reach this function — the
 * middleware matcher excludes them — so a dotted path here is not trusted
 * just for having a dot.
 */

/** Former internal page name, retained as a canonical redirect alias. */
export const LIVE_ENTRY_PAGE = "/showcase";
/** The internal page that answers every denied path with a 404. */
export const UNAVAILABLE_PAGE = "/showcase-unavailable";
/** Same-fragment navigation has no native hashchange event; restart alignment explicitly. */
export const SHOWCASE_SECTION_NAVIGATION_EVENT = "showcase:section-navigation";

export type RouteDecision =
  | { kind: "live" }
  | { kind: "redirect-home" }
  | { kind: "pass" }
  | { kind: "unavailable" };

/** Old or internal names of the live entry: always sent to the one canonical `/`. */
const ALIASES = new Set(["/home-2", LIVE_ENTRY_PAGE]);
/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the one template listing route that is now real — a RoomType's page,
 * `/listing-stay-detail?propertyId=…&roomTypeId=…`. Allowing it opens nothing else of the listing group
 * (no `/listing-stay`, map, car, experience or other detail route).
 */
export const ROOM_DETAILS_PAGE = "/listing-stay-detail";
/** Files the live page itself needs (the app icon is the BHA Riverside logo). */
const PASS = new Set(["/icon.jpg", UNAVAILABLE_PAGE, ROOM_DETAILS_PAGE]);

/**
 * CUST-WEB-SHOWCASE-001-CP02: the controlled photograph namespace. One path segment under
 * /media/the-bha-riverside/, a lowercase hyphenated name, `.webp` only — no subfolders, dots
 * in the name, other extensions (the build manifest is `.json`) or trailing slash. Matched
 * on the pathname as received, before any trailing-slash tolerance, so a lookalike never passes.
 */
export const MEDIA_NAMESPACE_PATTERN = /^\/media\/the-bha-riverside\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;

export function decideRoute(pathname: string): RouteDecision {
  if (MEDIA_NAMESPACE_PATTERN.test(pathname)) return { kind: "pass" };
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  if (path === "/") return { kind: "live" };
  if (ALIASES.has(path)) return { kind: "redirect-home" };
  if (PASS.has(path)) return { kind: "pass" };
  return { kind: "unavailable" };
}
