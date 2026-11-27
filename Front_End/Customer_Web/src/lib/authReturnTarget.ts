/**
 * CUST-WEB-001-CP08a-C2: where `/login` goes after a successful sign-in. The only non-default destinations are the
 * customer's own account page and (BHA-CHECKOUT-001-PR09-C8) the canonical management page of one reservation,
 * `/reservations/<lowercase uuid>/manage`, and each is reached only through the exact link its own page builds.
 * Any other value of `returnTo` — empty, repeated, malformed, absolute, protocol-relative, an encoded variant that
 * decodes to something else, a query or fragment inside the target, an upper-case or malformed id, an extra path
 * segment, any other path of this site — means the default (the home page): a sign-in link must never be a way to
 * send a customer somewhere else. Signing in proves who the customer is; whether they may read that reservation is
 * still the API's answer on the destination page.
 */

export const LOGIN_PATH = "/login";
export const RETURN_TO_PARAM = "returnTo";
export const ACCOUNT_RETURN_TARGET = "/account";
export const DEFAULT_RETURN_TARGET = "/";

export type ManageReturnTarget = `/reservations/${string}/manage`;
export type AuthReturnTarget = typeof ACCOUNT_RETURN_TARGET | typeof DEFAULT_RETURN_TARGET | ManageReturnTarget;

/** The one shape of a management destination: a lowercase 36-character id, nothing before, after or inside it. */
const MANAGE_TARGET = /^\/reservations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/manage$/;

/** The sign-in link of a management page: built from the route's canonical reservation id alone (never from the current URL, so no query, fragment or link secret), or null for an id that is not canonical. */
export function loginForReservationHref(canonicalReservationId: string): string | null {
  const target = `/reservations/${canonicalReservationId}/manage`;
  return MANAGE_TARGET.test(target) ? `${LOGIN_PATH}?${RETURN_TO_PARAM}=${target}` : null;
}

/** The link the account page sends an anonymous visitor to. */
export const LOGIN_FOR_ACCOUNT_HREF = `${LOGIN_PATH}?${RETURN_TO_PARAM}=${ACCOUNT_RETURN_TARGET}`;

/** `search` is `window.location.search` (with or without the leading "?"). */
export function resolveAuthReturnTarget(search: string): AuthReturnTarget {
  let values: string[];
  try {
    values = new URLSearchParams(search).getAll(RETURN_TO_PARAM);
  } catch {
    return DEFAULT_RETURN_TARGET;
  }
  if (values.length !== 1) return DEFAULT_RETURN_TARGET;
  if (values[0] === ACCOUNT_RETURN_TARGET) return ACCOUNT_RETURN_TARGET;
  return MANAGE_TARGET.test(values[0]) ? (values[0] as ManageReturnTarget) : DEFAULT_RETURN_TARGET;
}
