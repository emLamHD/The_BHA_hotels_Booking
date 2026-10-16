import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAsGiven, formatMoney, requestDisplayQuote } from "./display";

const quote = (total: string) => ({
  currency: "USD", minorUnits: 2, isBase: false,
  rate: { vndPerUnit: "26060", updatedAtUtc: "2026-10-15T09:54:46Z", version: 3 },
  lines: [{ ref: "a", unit: total, quantity: 1, total }], sums: [],
});

describe("display quotes", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks once for the same screen, even when two components ask together", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(quote("40.00")), { status: 200 }));
    const lines = [{ ref: "a", unitVnd: "1042400", quantity: 1 }];
    const [first, second] = await Promise.all([requestDisplayQuote("USD", lines, []), requestDisplayQuote("USD", lines, [])]);
    expect(first).toBe(second);
    await requestDisplayQuote("USD", lines, []);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is a different request for a different currency or different lines (a late answer cannot be taken for another screen's)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(quote("1.00")), { status: 200 }));
    await requestDisplayQuote("USD", [{ ref: "a", unitVnd: "26060", quantity: 1 }], []);
    await requestDisplayQuote("EUR", [{ ref: "a", unitVnd: "26060", quantity: 1 }], []);
    await requestDisplayQuote("USD", [{ ref: "a", unitVnd: "26060", quantity: 2 }], []);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failure: the next ask tries again", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(quote("2.00")), { status: 200 }));
    const lines = [{ ref: "z", unitVnd: "52120", quantity: 1 }];
    await expect(requestDisplayQuote("USD", lines, [])).rejects.toThrow("HTTP 503");
    await expect(requestDisplayQuote("USD", lines, [])).resolves.toMatchObject({ currency: "USD" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends no cookies with the price request", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(quote("3.00")), { status: 200 }));
    await requestDisplayQuote("USD", [{ ref: "c", unitVnd: "78180", quantity: 1 }], []);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "omit" });
  });
});

describe("money formatting", () => {
  it("uses the currency's own digits and the visitor's format locale", () => {
    expect(formatMoney("1089000", "VND", 0, "vi-VN")).toContain("₫");
    expect(formatMoney("40.00", "USD", 2, "en-US")).toBe("$40.00");
    expect(formatMoney("36.50", "EUR", 2, "fr-FR").replace(/\s/g, " ")).toBe("36,50 €");
  });

  it("shows an amount in a currency without a rate as given", () => {
    expect(formatAsGiven(12.5, "GBP", "en-US")).toBe("£12.50");
    expect(formatAsGiven(12.5, null, "en-US")).toBe("12.50");
  });
});
