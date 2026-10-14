/**
 * CUST-WEB-001-CP08a-C2: where `/login` goes after a successful sign-in. There is exactly one non-default
 * destination, the customer's own account page, and it is reached only through the exact link the account
 * page itself builds. Any other value of `returnTo` — empty, repeated, malformed, absolute, protocol-relative,
 * an encoded variant that decodes to something else, a path of this site that is not the account page — means
 * the default (the home page): a sign-in link must never be a way to send a customer somewhere else.
 */

export const LOGIN_PATH = "/login";
export const RETURN_TO_PARAM = "returnTo";
export const ACCOUNT_RETURN_TARGET = "/account";
export const DEFAULT_RETURN_TARGET = "/";

export type AuthReturnTarget = typeof ACCOUNT_RETURN_TARGET | typeof DEFAULT_RETURN_TARGET;

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
  return values.length === 1 && values[0] === ACCOUNT_RETURN_TARGET ? ACCOUNT_RETURN_TARGET : DEFAULT_RETURN_TARGET;
}
