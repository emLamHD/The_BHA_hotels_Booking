/**
 * BHA-NEWSLETTER-BADGE-001: the two calls and what they accept. A watermark is opaque: it is read and written as the decimal string the API sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMenuUnseen, isWatermark, markNewsletterSeen, parseMenuUnseen } from "./website";

describe("isWatermark", () => {
  it("accepts a plain non-negative decimal integer, however large, and nothing else", () => {
    for (const good of ["0", "1", "10", "9223372036854775807", "99999999999999999999"]) expect(isWatermark(good)).toBe(true);
    for (const bad of ["", "01", "-1", "+1", "1.0", "1e3", " 1", "1 ", "abc", 1, null, undefined, {}]) expect(isWatermark(bad)).toBe(false);
  });
});

describe("parseMenuUnseen", () => {
  const valid = { newsletter: { count: 3, lastSeenWatermark: "7", currentWatermark: "10" } };
  it("reads the three numbers", () => {
    expect(parseMenuUnseen(valid)).toEqual({ count: 3, lastSeenWatermark: "7", currentWatermark: "10" });
  });
  it("refuses an answer it cannot read rather than guessing: a missing menu, a count that is not a whole number, a JSON number for a watermark", () => {
    expect(parseMenuUnseen(null)).toBeNull();
    expect(parseMenuUnseen({})).toBeNull();
    expect(parseMenuUnseen({ newsletter: { ...valid.newsletter, count: -1 } })).toBeNull();
    expect(parseMenuUnseen({ newsletter: { ...valid.newsletter, count: 1.5 } })).toBeNull();
    expect(parseMenuUnseen({ newsletter: { ...valid.newsletter, count: "3" } })).toBeNull();
    expect(parseMenuUnseen({ newsletter: { ...valid.newsletter, lastSeenWatermark: 7 } })).toBeNull();
    expect(parseMenuUnseen({ newsletter: { ...valid.newsletter, currentWatermark: "007" } })).toBeNull();
  });
});

describe("the calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_ACCESS_MODE", "Staff");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("GET asks for the counts, credentialed, uncached; POST sends the watermark as a string to the newsletter route and nothing else", async () => {
    const body = { newsletter: { count: 2, lastSeenWatermark: "7", currentWatermark: "9" } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

    const got = await fetchMenuUnseen();
    expect(got).toEqual({ kind: "ok", data: { count: 2, lastSeenWatermark: "7", currentWatermark: "9" } });
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(String(getUrl)).toBe("https://localhost:7145/api/admin/v1/website/menu-unseen");
    expect(getInit).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });

    await markNewsletterSeen("9");
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(String(postUrl)).toBe("https://localhost:7145/api/admin/v1/website/menu-unseen/newsletter/seen");
    expect(postInit).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(postInit.body as string)).toEqual({ viewWatermark: "9" });
  });

  it("401, 403 and a lost connection are told apart, and a lost POST is a plain network failure (not an 'unverified' write)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await fetchMenuUnseen()).toEqual({ kind: "unauthenticated" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await markNewsletterSeen("1")).toEqual({ kind: "denied" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await markNewsletterSeen("1")).kind).toBe("network");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ title: "x", code: "menu-unseen-watermark-invalid", field: "viewWatermark" }), { status: 400, headers: { "content-type": "application/problem+json" } }));
    expect((await markNewsletterSeen("99")).kind).toBe("refused");
  });
});
