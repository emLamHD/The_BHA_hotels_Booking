import { getApiBaseUrl } from "@/lib/api/env";
import { NEWSLETTER_FAILED_MESSAGE, NEWSLETTER_INVALID_MESSAGE, NEWSLETTER_TOO_MANY_MESSAGE } from "./newsletterUi";

/**
 * BHA-NEWSLETTER-001: `POST /api/v1/website/newsletter-subscriptions`. Anonymous and uncredentialed. The API answers 202 with the
 * same body for a new and for an already known address, so `received` says only that the request was recorded. The result holds
 * message KEYS (the form translates them) and never the address. Nothing is retried here: a failed request is the visitor's
 * choice to send again, and the address stays in the field.
 */
export type NewsletterSubmitResult =
  | { kind: "received" }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string };

export async function submitNewsletterEmail(email: string, signal?: AbortSignal): Promise<NewsletterSubmitResult> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/v1/website/newsletter-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ email }),
      signal,
    });
  } catch {
    return { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE };
  }
  if (response.status === 202) return { kind: "received" };
  if (response.status === 400) return { kind: "refused", message: NEWSLETTER_INVALID_MESSAGE };
  if (response.status === 429) return { kind: "failed", message: NEWSLETTER_TOO_MANY_MESSAGE };
  return { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE };
}
