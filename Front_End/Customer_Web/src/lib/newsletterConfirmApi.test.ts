import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmNewsletter, submitNewsletterEmail } from "./newsletterApi";
import { confirmUrlWithoutFragment, parseConfirmFragment } from "./newsletterUi";

const originalFetch = globalThis.fetch;
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

describe("confirmNewsletter", () => {
  it("posts the token in the body, never in the URL, without credentials, once", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = reply(200, { status: "verified" });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(confirmNewsletter("T".repeat(43))).resolves.toEqual({ kind: "verified" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/website/newsletter-subscriptions/confirmations");
    expect(url).not.toContain("T".repeat(10));
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({ token: "T".repeat(43) });
  });

  it.each([
    [200, { status: "already-verified" }, "already"],
    [200, { status: "something-else" }, "failed"],
    [410, { code: "newsletter-confirmation-expired" }, "expired"],
    [400, { code: "newsletter-confirmation-invalid" }, "invalid"],
    [429, {}, "failed"],
    [500, {}, "failed"],
  ])("answers %i %j as %s and never retries", async (status, body, kind) => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = reply(status, body);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(confirmNewsletter("T".repeat(43))).resolves.toEqual({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a network failure is a failure that does not carry the token", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const result = await confirmNewsletter("S".repeat(43));
    expect(result).toEqual({ kind: "failed" });
    expect(JSON.stringify(result)).not.toContain("S".repeat(10));
  });
});

describe("submitNewsletterEmail (V2)", () => {
  it("sends the visitor's language and reads the site-wide confirmation flag", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = reply(202, { status: "received", confirmation: "email" });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(submitNewsletterEmail("a@example.com", undefined, "fr")).resolves.toEqual({ kind: "received", confirmation: "email" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@example.com", language: "fr" });
  });

  it("treats a missing or unknown flag as no confirmation mail", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    for (const body of [{ status: "received" }, { status: "received", confirmation: "sms" }]) {
      globalThis.fetch = reply(202, body) as unknown as typeof fetch;
      await expect(submitNewsletterEmail("a@example.com")).resolves.toEqual({ kind: "received", confirmation: "none" });
    }
  });
});

describe("parseConfirmFragment", () => {
  it.each([
    ["#t=" + "a".repeat(43), "a".repeat(43)],
    ["#t=A-b_C1" + "x".repeat(20), "A-b_C1" + "x".repeat(20)],
  ])("reads %s", (hash, token) => expect(parseConfirmFragment(hash)).toBe(token));

  it.each(["", "#", "#t=", "#t=short", "t=" + "a".repeat(43), "#x=" + "a".repeat(43), "#t=" + "a".repeat(65), "#t=" + "a".repeat(43) + "&y=1", "#t=" + "a".repeat(42) + "!", "#t=%61" + "a".repeat(40)])(
    "refuses %j",
    (hash) => expect(parseConfirmFragment(hash)).toBeNull(),
  );
});

describe("confirmUrlWithoutFragment", () => {
  it("keeps the path and the query and drops nothing but the fragment (which is never passed in)", () => {
    expect(confirmUrlWithoutFragment("/newsletter/confirm", "")).toBe("/newsletter/confirm");
    expect(confirmUrlWithoutFragment("/newsletter/confirm", "?utm_source=mail")).toBe("/newsletter/confirm?utm_source=mail");
  });
});
