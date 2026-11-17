/**
 * CUST-WEB-001-CP08a-C2 / BHA-NEWSLETTER-001: the home page's newsletter form. `validateNewsletterEmail` checks that what
 * was typed looks like an e-mail address before anything is sent (the API checks it again: the browser is not a
 * boundary). Its result never contains the address, so a message built from it cannot echo it.
 */

/** Pack message KEYS: the form translates them when it renders. */
export const NEWSLETTER_HEADING = "customer.newsletter.heading";
export const NEWSLETTER_BENEFIT = "customer.newsletter.benefit";
/**
 * C3: new keys, not the preview's `customer.newsletter.disclosure` / `customer.home.homeNewsletter.subscribeDemoYourEmailIs`.
 * A site whose built-in pack was installed before this form stored anything holds the old demo texts in `WebsiteTranslations`
 * (not manual) and the public dictionary prefers stored rows over the embedded pack, so reusing the old keys would keep saying
 * "not stored". The old keys stay in the packs for a preview front end served by the same API.
 */
export const NEWSLETTER_STORAGE_NOTICE = "customer.newsletter.storageNotice";
export const NEWSLETTER_SUBSCRIBE_LABEL = "customer.newsletter.subscribeLabel";
export const NEWSLETTER_RECEIVED_MESSAGE = "customer.newsletter.received";
/** BHA-NEWSLETTER-002: when the site can send a confirmation mail the form says so, with its own key (the V1 text stays for a site with no sender). */
export const NEWSLETTER_RECEIVED_CONFIRM_MESSAGE = "customer.newsletter.receivedConfirm";
export const NEWSLETTER_SENDING_MESSAGE = "customer.newsletter.sending";
export const NEWSLETTER_FAILED_MESSAGE = "customer.newsletter.failed";
export const NEWSLETTER_TOO_MANY_MESSAGE = "customer.newsletter.tooMany";
export const NEWSLETTER_REQUIRED_MESSAGE = "customer.newsletter.required";
export const NEWSLETTER_INVALID_MESSAGE = "customer.newsletter.invalid";

export type NewsletterValidation = { ok: true } | { ok: false; message: string };

const MAX_LENGTH = 254;
const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function validateNewsletterEmail(raw: string): NewsletterValidation {
  const value = raw.trim();
  if (value === "") return { ok: false, message: NEWSLETTER_REQUIRED_MESSAGE };
  const invalid: NewsletterValidation = { ok: false, message: NEWSLETTER_INVALID_MESSAGE };
  if (value.length > MAX_LENGTH) return invalid;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return invalid;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return invalid;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return invalid;
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return invalid;
  return { ok: true };
}

/** BHA-NEWSLETTER-002: the confirmation page (`/newsletter/confirm`). */
export const NEWSLETTER_CONFIRM = {
  meta: "customer.newsletter.confirm.meta",
  heading: "customer.newsletter.confirm.heading",
  intro: "customer.newsletter.confirm.intro",
  button: "customer.newsletter.confirm.button",
  working: "customer.newsletter.confirm.working",
  verified: "customer.newsletter.confirm.verified",
  already: "customer.newsletter.confirm.already",
  expired: "customer.newsletter.confirm.expired",
  invalid: "customer.newsletter.confirm.invalid",
  failed: "customer.newsletter.confirm.failed",
  home: "customer.newsletter.confirm.home",
} as const;

/**
 * The token of a confirmation link: `#t=<43 URL-safe characters>`. Anything else (no fragment, another key, a different length, a
 * character outside the token alphabet) is "no token", so the page says the link is not valid instead of sending a guess.
 */
export function parseConfirmFragment(hash: string): string | null {
  const match = /^#t=([A-Za-z0-9_-]{20,64})$/.exec(hash);
  return match ? match[1] : null;
}

/**
 * The address of the confirmation page without its fragment: same path, same query (if any). The page removes the token with
 * `router.replace(this)` of the App Router, not a bare `history.replaceState`: the router keeps its own copy of the address (fragment
 * included) and writes it back on every `router.refresh()`, and it ignores a Back to a history entry without its routing state.
 */
export function confirmUrlWithoutFragment(pathname: string, search: string): string {
  return pathname + search;
}
