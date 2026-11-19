import { getApiBaseUrl } from "@/lib/api/env";
import { NEWSLETTER_FAILED_MESSAGE, NEWSLETTER_INVALID_MESSAGE, NEWSLETTER_TOO_MANY_MESSAGE } from "./newsletterUi";

/**
 * BHA-NEWSLETTER-001: `POST /api/v1/website/newsletter-subscriptions`. Anonymous and uncredentialed. The API answers 202 with the
 * same body for a new and for an already known address, so `received` says only that the request was recorded. The result holds
 * message KEYS (the form translates them) and never the address. Nothing is retried here: a failed request is the visitor's
 * choice to send again, and the address stays in the field.
 *
 * BHA-NEWSLETTER-002: `confirmation` is a fact about the SITE, not the address: `email` = a confirmation mail will be sent,
 * `none` = no sender is connected (V1 behaviour). The visitor's language is sent so the mail is written in it.
 */
export type NewsletterSubmitResult =
  | { kind: "received"; confirmation: "email" | "none" }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string };

export async function submitNewsletterEmail(email: string, signal?: AbortSignal, language?: string): Promise<NewsletterSubmitResult> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/v1/website/newsletter-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ email, language }),
      signal,
    });
  } catch {
    return { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE };
  }
  if (response.status === 202) {
    const body = (await response.json().catch(() => null)) as { confirmation?: unknown } | null;
    return { kind: "received", confirmation: body?.confirmation === "email" ? "email" : "none" };
  }
  if (response.status === 400) return { kind: "refused", message: NEWSLETTER_INVALID_MESSAGE };
  if (response.status === 429) return { kind: "failed", message: NEWSLETTER_TOO_MANY_MESSAGE };
  return { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE };
}

/**
 * BHA-NEWSLETTER-002: `POST …/newsletter-subscriptions/confirmations`. The token comes from the link's URL FRAGMENT (never sent to a
 * server by the browser) and goes in the BODY, never in a query. Sent once; nothing is retried.
 */
export type NewsletterConfirmResult = { kind: "verified" | "already" | "expired" | "invalid" | "failed" };

export async function confirmNewsletter(token: string, signal?: AbortSignal): Promise<NewsletterConfirmResult> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/v1/website/newsletter-subscriptions/confirmations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ token }),
      signal,
    });
  } catch {
    return { kind: "failed" };
  }
  if (response.status === 200) {
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (body?.status === "verified") return { kind: "verified" };
    if (body?.status === "already-verified") return { kind: "already" };
    return { kind: "failed" };
  }
  if (response.status === 410) return { kind: "expired" };
  if (response.status === 400) return { kind: "invalid" };
  return { kind: "failed" };
}
