import { afterEach, describe, expect, it, vi } from "vitest";
import { unsubscribeNewsletter } from "./newsletterApi";
import { NEWSLETTER_UNSUBSCRIBE, parseConfirmFragment } from "./newsletterUi";

const originalFetch = globalThis.fetch;
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

describe("unsubscribeNewsletter (BHA-NEWSLETTER-003)", () => {
  it("posts the token in the body, never in the URL, without credentials, once", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = reply(200, { status: "unsubscribed" });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(unsubscribeNewsletter("U".repeat(43))).resolves.toEqual({ kind: "unsubscribed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/website/newsletter-subscriptions/unsubscriptions");
    expect(url).not.toContain("U".repeat(10));
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({ token: "U".repeat(43) });
  });

  it.each([
    [200, { status: "already-unsubscribed" }, "already"],
    [200, { status: "something-else" }, "failed"],
    [400, { code: "newsletter-unsubscribe-invalid" }, "invalid"],
    [429, {}, "failed"],
    [500, {}, "failed"],
  ])("answers %i %j as %s and never retries", async (status, body, kind) => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    const fetchMock = reply(status, body);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(unsubscribeNewsletter("U".repeat(43))).resolves.toEqual({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a network failure is a failure that does not carry the token", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const result = await unsubscribeNewsletter("S".repeat(43));
    expect(result).toEqual({ kind: "failed" });
    expect(JSON.stringify(result)).not.toContain("S".repeat(10));
  });

  it("reads its token from the same fragment as a confirmation and has a key for every sentence of the page", () => {
    expect(parseConfirmFragment(`#t=${"U".repeat(43)}`)).toBe("U".repeat(43));
    expect(parseConfirmFragment("#other=1")).toBeNull();
    expect(Object.keys(NEWSLETTER_UNSUBSCRIBE).sort()).toEqual(["already", "button", "done", "failed", "heading", "home", "intro", "invalid", "meta", "working"]);
    for (const key of Object.values(NEWSLETTER_UNSUBSCRIBE)) expect(key).toMatch(/^customer\.newsletter\.unsubscribe\.[a-z]+$/);
  });
});
