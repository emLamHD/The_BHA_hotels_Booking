import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("@/lib/api/env", () => ({ getApiBaseUrl: () => "https://api.test" }));

import { getPromotion, getPromotions } from "./server";
import { parseCard, parsePromotionDetail, parsePromotionList, periodKind } from "./promotions";

const MEDIA = "/api/v1/website/promotions/media/aaaaaaaa-0000-0000-0000-000000000001";
const card = (patch: Record<string, unknown> = {}) => ({
  id: "p1", slug: "dat-som", title: "Đặt sớm", summary: "Giảm 15%", coverImageUrl: MEDIA, coverAltText: "Phòng",
  terms: { kind: "Percent", value: 15, currencyCode: null, bookingFrom: null, bookingTo: "2026-12-31", stayFrom: null, stayTo: null, minNights: 2 },
  ...patch,
});
const list = (...items: unknown[]) => ({ revision: "r", locale: "vi", generatedAtUtc: "2026-10-21T00:00:00Z", items });
const detail = (patch: Record<string, unknown> = {}) => ({
  revision: "r", locale: "vi", generatedAtUtc: "2026-10-21T00:00:00Z", promotion: card(), body: ["Một", "Hai"],
  property: { id: "prop", name: "The BHA Riverside", slug: "the-bha-riverside" }, allRoomTypes: false, roomTypes: [{ id: "r1", name: "Căn hộ" }], ...patch,
});
const answer = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

describe("parsing what the API serves", () => {
  it("makes a picture's address absolute, and only for the API's own promotion media path", () => {
    expect(parseCard(card(), "https://api.test")?.coverImageUrl).toBe(`https://api.test${MEDIA}`);
    for (const url of ["https://evil.test/x.png", "/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000001", "//evil.test/a", "javascript:alert(1)", MEDIA + "/x", ""]) {
      const parsed = parseCard(card({ coverImageUrl: url, coverAltText: "x" }), "https://api.test");
      expect(parsed?.coverImageUrl).toBeNull();
      expect(parsed?.coverAltText).toBeNull();                           // no alt text for a picture that is not shown
    }
  });

  it("leaves out a card that is not one, and keeps the rest", () => {
    const parsed = parsePromotionList(list(card(), { id: "x" }, card({ slug: "Not A Slug" }), card({ id: "p2", slug: "cuoi-tuan" })), "https://api.test");

    expect(parsed?.map((c) => c.slug)).toEqual(["dat-som", "cuoi-tuan"]);
    expect(parsePromotionList({ hello: "proxy page" }, "https://api.test")).toBeNull();
    expect(parsePromotionList(null, "https://api.test")).toBeNull();
  });

  it("refuses a rule that is not a real discount", () => {
    for (const terms of [{ kind: "Free", value: 100 }, { kind: "Percent", value: 0 }, { kind: "Percent", value: -5 }, { kind: "Percent", value: "15" }, { kind: "Percent", value: 15, minNights: 0 }, { kind: "Percent", value: 15, bookingFrom: "01/11/2026" }]) {
      expect(parseCard(card({ terms: { ...card().terms, ...terms } }), "https://api.test")).toBeNull();
    }
  });

  it("parses a detail with its property and room types, and refuses a half-detail", () => {
    const parsed = parsePromotionDetail(detail(), "https://api.test");

    expect(parsed).toMatchObject({ body: ["Một", "Hai"], property: { slug: "the-bha-riverside" }, allRoomTypes: false, roomTypes: [{ id: "r1" }] });
    expect(parsePromotionDetail(detail({ property: null }), "https://api.test")).toBeNull();
    expect(parsePromotionDetail(detail({ body: ["ok", 5] }), "https://api.test")).toBeNull();
  });

  it("tells which of the four sentences to say about a window", () => {
    expect([periodKind("2026-01-01", "2026-02-01"), periodKind("2026-01-01", null), periodKind(null, "2026-02-01"), periodKind(null, null)]).toEqual(["range", "from", "until", "any"]);
  });
});

describe("the server's read of the promotions", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is read fresh (no Next fetch cache), in the visitor's language", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(list(card())));

    const result = await getPromotions("en");

    expect(result).toMatchObject({ status: "ok", items: [{ slug: "dat-som" }] });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.test/api/v1/website/promotions?locale=en");
  });

  it("keeps NO last good copy: after a good read, a failed one is an error and shows nothing, never the old cards", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(list(card())));
    expect((await getPromotions("vi")).status).toBe("ok");

    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await getPromotions("vi")).toEqual({ status: "error" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ title: "boom" }, 500));
    expect(await getPromotions("vi")).toEqual({ status: "error" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ hello: "a proxy's page" }));
    expect(await getPromotions("vi")).toEqual({ status: "error" });
  });

  it("an empty list is a successful, empty answer — not an error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(list()));

    expect(await getPromotions("vi")).toEqual({ status: "ok", items: [] });
  });

  it("a detail: found, missing (404) and failed are three different answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer(detail()));
    expect(await getPromotion("dat-som", "vi")).toMatchObject({ status: "ok", detail: { promotion: { slug: "dat-som" } } });

    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ title: "Not found" }, 404));
    expect(await getPromotion("an-nhap", "vi")).toEqual({ status: "missing" });

    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ title: "boom" }, 500));
    expect(await getPromotion("dat-som", "vi")).toEqual({ status: "error" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ hello: "proxy" }));
    expect(await getPromotion("dat-som", "vi")).toEqual({ status: "error" });
  });

  it("encodes the slug it asks for", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => answer({ title: "Not found" }, 404));

    await getPromotion("a/../b?x=1", "vi");

    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.test/api/v1/website/promotions/a%2F..%2Fb%3Fx%3D1?locale=vi");
  });
});
