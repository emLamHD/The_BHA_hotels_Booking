/**
 * CUST-WEB-001-CP08a-C2 / BHA-NEWSLETTER-001: the home page's newsletter form. `validateNewsletterEmail` checks that what
 * was typed looks like an e-mail address before anything is sent (the API checks it again: the browser is not a
 * boundary). Its result never contains the address, so a message built from it cannot echo it.
 */

/** Pack message KEYS: the form translates them when it renders. */
export const NEWSLETTER_HEADING = "customer.newsletter.heading";
export const NEWSLETTER_BENEFIT = "customer.newsletter.benefit";
export const NEWSLETTER_DISCLOSURE = "customer.newsletter.disclosure";
export const NEWSLETTER_RECEIVED_MESSAGE = "customer.newsletter.received";
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
