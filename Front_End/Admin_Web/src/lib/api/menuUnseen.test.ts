/**
 * BHA-ADMIN-BADGE-001-PR04: the shared unseen calls and what they accept. A watermark is opaque: it is read and written as the decimal string the API sent, and a menu the Staff may
 * not read is absent from the answer, never 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWatermark } from "./website";
import { fetchMenuUnseenSummary, isMenuActivityHint, markNewsletterSeen, menuActivityLiveTarget, parseMenuUnseenSummary } from "./menuUnseen";

describe("isWatermark", () => {
  it("accepts a plain non-negative decimal integer, however large, and nothing else", () => {
    for (const good of ["0", "1", "10", "9223372036854775807", "99999999999999999999"]) expect(isWatermark(good)).toBe(true);
    for (const bad of ["", "01", "-1", "+1", "1.0", "1e3", " 1", "1 ", "abc", 1, null, undefined, {}]) expect(isWatermark(bad)).toBe(false);
  });
});

const global = { count: 3, lastSeenWatermark: "7", currentWatermark: "10" };
const property = { propertyId: "p-1", count: 2, lastSeenWatermark: "1", currentWatermark: "4" };
const valid = { menus: { newsletter: global, "blog-posts": { ...global, count: 120 }, promotions: { count: 2, byProperty: [property] } } };

describe("parseMenuUnseenSummary", () => {
  it("reads a global menu's three numbers and a Property-scoped menu's total with its Properties", () => {
    expect(parseMenuUnseenSummary(valid)).toEqual({
      newsletter: global,
      "blog-posts": { ...global, count: 120 },
      promotions: { count: 2, byProperty: [property] },
    });
  });
  it("a menu that is not in the answer stays absent (never 0), and an empty answer is a valid 'nothing allowed'", () => {
    expect(parseMenuUnseenSummary({ menus: {} })).toEqual({});
    expect("calendar" in (parseMenuUnseenSummary(valid) ?? {})).toBe(false);
  });
  it("skips a key this build does not know, so a newer server never breaks an older Admin", () => {
    expect(parseMenuUnseenSummary({ menus: { newsletter: global, "future-menu": { nope: true } } })).toEqual({ newsletter: global });
  });
  it("refuses an answer it cannot read rather than guessing: the wrong shape for the key's scope, a bad count, a JSON number or a padded watermark", () => {
    expect(parseMenuUnseenSummary(null)).toBeNull();
    expect(parseMenuUnseenSummary({})).toBeNull();
    expect(parseMenuUnseenSummary({ newsletter: global })).toBeNull();                                               // not wrapped in `menus`
    expect(parseMenuUnseenSummary({ menus: { promotions: global } })).toBeNull();                                    // a Property menu needs byProperty
    expect(parseMenuUnseenSummary({ menus: { newsletter: { count: 1, byProperty: [] } } })).toBeNull();             // a global menu needs watermarks
    for (const bad of [{ count: -1 }, { count: 1.5 }, { count: "3" }, { lastSeenWatermark: 7 }, { currentWatermark: "007" }]) {
      expect(parseMenuUnseenSummary({ menus: { newsletter: { ...global, ...bad } } })).toBeNull();
    }
    expect(parseMenuUnseenSummary({ menus: { promotions: { count: 1, byProperty: [{ ...property, currentWatermark: 4 }] } } })).toBeNull();
    expect(parseMenuUnseenSummary({ menus: { promotions: { count: 1, byProperty: [{ ...property, propertyId: "" }] } } })).toBeNull();
  });
});

describe("isMenuActivityHint", () => {
  it("accepts a message that names a menu, whatever else it carries, and nothing else", () => {
    expect(isMenuActivityHint({ menuKey: "calendar", propertyId: "p-1" })).toBe(true);
    expect(isMenuActivityHint({ menuKey: "newsletter" })).toBe(true);
    for (const bad of [null, undefined, "calendar", 1, [], {}, { menuKey: "" }, { menuKey: 3 }]) expect(isMenuActivityHint(bad)).toBe(false);
  });
});

describe("the calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("GET asks the shared route for the numbers, credentialed, uncached; POST sends the watermark as a string to the newsletter route and reads a bare entry back", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(valid), { status: 200, headers: { "content-type": "application/json" } }));
    const got = await fetchMenuUnseenSummary();
    expect(got.kind).toBe("ok");
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(String(getUrl)).toBe("https://localhost:7145/api/admin/v1/menu-unseen");
    expect(getInit).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ count: 0, lastSeenWatermark: "9", currentWatermark: "9" }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await markNewsletterSeen("9")).toEqual({ kind: "ok", data: { count: 0, lastSeenWatermark: "9", currentWatermark: "9" } });
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(String(postUrl)).toBe("https://localhost:7145/api/admin/v1/menu-unseen/newsletter/seen");
    expect(postInit).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(postInit.body as string)).toEqual({ viewWatermark: "9" });
  });

  it("401, 403 and a lost connection are told apart, a lost POST is a plain network failure, and a 404 (menu no longer readable) is a refusal that says so", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await fetchMenuUnseenSummary()).toEqual({ kind: "unauthenticated" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await markNewsletterSeen("1")).toEqual({ kind: "denied" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await markNewsletterSeen("1")).kind).toBe("network");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ title: "x", code: "menu-unseen-watermark-invalid", field: "viewWatermark" }), { status: 400, headers: { "content-type": "application/problem+json" } }));
    expect((await markNewsletterSeen("99")).kind).toBe("refused");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ title: "x", code: "menu-unseen-unknown-menu" }), { status: 404, headers: { "content-type": "application/problem+json" } }));
    expect(await markNewsletterSeen("1")).toMatchObject({ kind: "refused", status: 404 });
  });

  it("the activity Hub lives at the shared prefix", () => {
    expect(menuActivityLiveTarget()).toEqual({ ok: true, url: "https://localhost:7145/api/admin/v1/menu-unseen-live" });
  });
});
