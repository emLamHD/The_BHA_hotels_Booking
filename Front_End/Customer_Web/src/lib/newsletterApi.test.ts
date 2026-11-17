import { afterEach, describe, expect, it, vi } from "vitest";
import { submitNewsletterEmail } from "./newsletterApi";
import {
  NEWSLETTER_FAILED_MESSAGE,
  NEWSLETTER_INVALID_MESSAGE,
  NEWSLETTER_TOO_MANY_MESSAGE,
} from "./newsletterUi";

const originalFetch = globalThis.fetch;
const answer = (status: number) => vi.fn(async () => new Response(status === 202 ? '{"status":"received"}' : "{}", { status }));

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

describe("submitNewsletterEmail", () => {
  it("sends the address once, as JSON, without credentials, to the website newsletter route", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = answer(202);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(submitNewsletterEmail("ten@example.com")).resolves.toEqual({ kind: "received" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/website/newsletter-subscriptions");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ten@example.com" });
  });

  it.each([
    [400, { kind: "refused", message: NEWSLETTER_INVALID_MESSAGE }],
    [429, { kind: "failed", message: NEWSLETTER_TOO_MANY_MESSAGE }],
    [500, { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE }],
    [503, { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE }],
    [200, { kind: "failed", message: NEWSLETTER_FAILED_MESSAGE }],
  ])("answers %i as %j and never retries", async (status, expected) => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = answer(status);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(submitNewsletterEmail("ten@example.com")).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a network failure is a retryable failure whose result does not carry the address", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const result = await submitNewsletterEmail("private.person@example.com");
    expect(result).toEqual({ kind: "failed", message: NEWSLETTER_FAILED_MESSAGE });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
