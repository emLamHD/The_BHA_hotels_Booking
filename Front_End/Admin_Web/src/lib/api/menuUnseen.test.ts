/**
 * BHA-ADMIN-BADGE-001-PR04: the shared unseen calls and what they accept. A watermark is opaque: it is read and written as the decimal string the API sent, and a menu the Staff may
 * not read is absent from the answer, never 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWatermark } from "./website";
import { fetchActivity, fetchMenuChanges, fetchMenuUnseenSummary, isMenuActivityHint, markCalendarEntitySeen, markNewsletterSeen, menuActivityLiveTarget, parseActivityPage, parseCalendarEntitySeen, parseMenuChanges, parseMenuUnseenSummary } from "./menuUnseen";

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

// ================================================================================================ BHA-ADMIN-BADGE-001-PR05
// The JSON below is the shape AdminMenuUnseenController answers today (camelCase, watermarks and sequences as strings, `nextCursor` always present, null on the last page).

const changesJson = {
  menu: "blog-posts", propertyId: null, unseenEvents: 137, hasMore: true, lastSeenWatermark: "7", snapshotWatermark: "144",
  groups: [{ entityKind: "post", entityKey: "0a1b", titleSnapshot: "Bài viết <b>mới</b>", action: "Created", events: 3, itemCount: 1, latestWatermark: "144", occurredAtUtc: "2026-11-20T03:00:00+00:00", actors: [{ kind: "Staff", staffId: "11111111-1111-1111-1111-111111111111" }, { kind: "Public", staffId: null }] }],
};
const activityJson = {
  menu: "promotions", propertyId: "p-1", nextCursor: "eyJtIjoicHJvbW90aW9ucyJ9",
  items: [{ sequence: "42", occurredAtUtc: "2026-11-20T03:00:00+00:00", actorKind: "Staff", actorStaffId: "11111111-1111-1111-1111-111111111111", action: "Published", entityKind: "promotion", entityKey: "9c", titleSnapshot: "Mùa hè", itemCount: 1 },
    { sequence: "41", occurredAtUtc: "2026-11-19T03:00:00+00:00", actorKind: "Public", actorStaffId: null, action: "verified", entityKind: "subscription", entityKey: "8d", titleSnapshot: "a subscription", itemCount: 1 }],
};

describe("parseMenuChanges", () => {
  it("reads the list as the API writes it, keeping every watermark a string", () => {
    const parsed = parseMenuChanges(changesJson)!;
    expect(parsed).toMatchObject({ menu: "blog-posts", propertyId: null, unseenEvents: 137, hasMore: true, lastSeenWatermark: "7", snapshotWatermark: "144" });
    expect(parsed.groups[0]).toMatchObject({ titleSnapshot: "Bài viết <b>mới</b>", events: 3, latestWatermark: "144", actors: [{ kind: "Staff" }, { kind: "Public", staffId: null }] });
    expect(parseMenuChanges({ ...changesJson, propertyId: "p-1" })!.propertyId).toBe("p-1");
  });
  it("refuses an answer it cannot trust: a JSON number for a watermark, a negative or fractional count, hasMore as text, a broken group", () => {
    for (const bad of [{ snapshotWatermark: 144 }, { lastSeenWatermark: "07" }, { unseenEvents: -1 }, { unseenEvents: 1.5 }, { hasMore: "true" }, { groups: "x" }, { groups: [{ ...changesJson.groups[0], events: "3" }] }, { groups: [{ ...changesJson.groups[0], latestWatermark: 144 }] }, { groups: [{ ...changesJson.groups[0], actors: [{ staffId: "x" }] }] }]) {
      expect(parseMenuChanges({ ...changesJson, ...bad })).toBeNull();
    }
    expect(parseMenuChanges(null)).toBeNull();
  });
});

describe("parseActivityPage", () => {
  it("reads a page, with the sequence a string and the cursor opaque (and null on the last page)", () => {
    const parsed = parseActivityPage(activityJson)!;
    expect(parsed.items.map((item) => item.sequence)).toEqual(["42", "41"]);
    expect(parsed.items[1]).toMatchObject({ actorKind: "Public", actorStaffId: null, titleSnapshot: "a subscription" });
    expect(parsed.nextCursor).toBe("eyJtIjoicHJvbW90aW9ucyJ9");
    expect(parseActivityPage({ ...activityJson, nextCursor: null })!.nextCursor).toBeNull();
  });
  it("refuses a numeric sequence, a missing item field or a cursor that is not text", () => {
    expect(parseActivityPage({ ...activityJson, items: [{ ...activityJson.items[0], sequence: 42 }] })).toBeNull();
    expect(parseActivityPage({ ...activityJson, items: [{ ...activityJson.items[0], action: undefined }] })).toBeNull();
    expect(parseActivityPage({ ...activityJson, nextCursor: 7 })).toBeNull();
    expect(parseActivityPage({ ...activityJson, items: "x" })).toBeNull();
  });
});

describe("the list calls", () => {
  const fetchMock = vi.fn();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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

  it("changes: a global menu sends no propertyId, a Property-scoped one sends exactly one; always GET, credentialed, uncached, with a signal", async () => {
    fetchMock.mockResolvedValueOnce(json(changesJson)).mockResolvedValueOnce(json({ ...changesJson, menu: "promotions", propertyId: "p 1/&" }));
    const controller = new AbortController();
    expect((await fetchMenuChanges("blog-posts", undefined, controller.signal)).kind).toBe("ok");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://localhost:7145/api/admin/v1/menu-unseen/blog-posts/changes");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "include", cache: "no-store", signal: controller.signal });
    await fetchMenuChanges("promotions", "p 1/&");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://localhost:7145/api/admin/v1/menu-unseen/promotions/changes?propertyId=p%201%2F%26");
  });

  it("activity: filters and the cursor are encoded, blank ones are left out, and the cursor is sent exactly as received", async () => {
    fetchMock.mockResolvedValue(json(activityJson));
    await fetchActivity({ menu: "calendar", propertyId: "p-1", actorStaffId: "", from: "2026-11-15T00:00:00+07:00", to: "2026-11-16T00:00:00+07:00", limit: 50, cursor: "a+b/c==" });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/admin/v1/activity");
    expect(Object.fromEntries(url.searchParams)).toEqual({ menu: "calendar", propertyId: "p-1", from: "2026-11-15T00:00:00+07:00", to: "2026-11-16T00:00:00+07:00", limit: "50", cursor: "a+b/c==" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "include" });
    await fetchActivity({ menu: "blog-posts" });
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://localhost:7145/api/admin/v1/activity?menu=blog-posts");
  });

  it("a 404 is a refusal that says so (the one answer for unknown, not yours and no membership), 401 and 403 are told apart", async () => {
    fetchMock.mockResolvedValueOnce(json({ title: "x", code: "menu-unseen-unknown-menu" }, 404));
    expect(await fetchMenuChanges("catalog")).toMatchObject({ kind: "refused", status: 404 });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await fetchActivity({ menu: "catalog" })).toEqual({ kind: "unauthenticated" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await fetchActivity({ menu: "catalog" })).toEqual({ kind: "denied" });
  });
});


// ================================================================================================ BHA-ADMIN-BADGE-001-PR13
// The JSON below is what the PR-12 Calendar list and entity-seen route answer (camelCase, watermarks as decimal strings).

const calendarGroup = {
  entityKind: "room-block", entityKey: "9d41", entityId: "9d41", titleSnapshot: "Room S2 2026-09-10 to 2026-09-12", action: "Cancelled", events: 2, itemCount: 2,
  latestWatermark: "8", occurredAtUtc: "2026-11-20T03:00:00+00:00", actors: [{ kind: "Staff", staffId: "s-1" }], presence: "Removed", observedWatermark: "8",
};
const calendarChanges = (groups: unknown[]) => ({ menu: "calendar", propertyId: "p-1", unseenEvents: 2, hasMore: false, lastSeenWatermark: "0", snapshotWatermark: "8", groups });

describe("the Calendar's unseen list (PR-13)", () => {
  it("reads entityId, presence and observedWatermark exactly as sent; the list's own watermarks are separate fields", () => {
    const parsed = parseMenuChanges(calendarChanges([calendarGroup]));
    expect(parsed?.groups[0]).toMatchObject({ entityId: "9d41", presence: "Removed", observedWatermark: "8", latestWatermark: "8" });
    expect(parsed?.snapshotWatermark).toBe("8");
  });
  it("an OnBoard group reads too; an unknown presence is dropped (no action) without failing the list", () => {
    expect(parseMenuChanges(calendarChanges([{ ...calendarGroup, presence: "OnBoard" }]))?.groups[0].presence).toBe("OnBoard");
    const odd = parseMenuChanges(calendarChanges([{ ...calendarGroup, presence: "Gone" }]));
    expect(odd?.groups).toHaveLength(1);
    expect("presence" in odd!.groups[0]).toBe(false);
  });
  it("a malformed observedWatermark (a JSON number, padded, signed) makes the answer unreadable", () => {
    for (const bad of [8, "08", "-1", "", " 8"]) expect(parseMenuChanges(calendarChanges([{ ...calendarGroup, observedWatermark: bad }]))).toBeNull();
    expect(parseMenuChanges(calendarChanges([{ ...calendarGroup, entityId: 5 }]))).toBeNull();
  });
  it("another menu's groups parse as before and carry none of the three fields", () => {
    const parsed = parseMenuChanges(changesJson);
    for (const key of ["entityId", "presence", "observedWatermark"]) expect(key in parsed!.groups[0]).toBe(false);
  });
});

describe("the Calendar's one-object acknowledgement (PR-13)", () => {
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
  const answer = { propertyId: "p-1", entityKind: "reservation-unit", entityId: "5b0c", lastSeenWatermark: "1", unread: true, count: 2, currentWatermark: "3" };

  it("POSTs exactly { propertyId, entityKind, entityId, observedWatermark } to calendar/entities/seen, credentialed, and reads the whole answer back", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await markCalendarEntitySeen({ propertyId: "p-1", entityKind: "reservation-unit", entityId: "5b0c", observedWatermark: "1" });
    expect(result).toEqual({ kind: "ok", data: answer });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://localhost:7145/api/admin/v1/menu-unseen/calendar/entities/seen");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(init.body as string)).toEqual({ propertyId: "p-1", entityKind: "reservation-unit", entityId: "5b0c", observedWatermark: "1" });
  });
  it("keeps watermarks beyond 2^53 as strings end to end", async () => {
    const big = "9223372036854775807";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...answer, lastSeenWatermark: big, currentWatermark: big }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await markCalendarEntitySeen({ propertyId: "p-1", entityKind: "room-block", entityId: "9d41", observedWatermark: big });
    expect(result).toMatchObject({ kind: "ok", data: { lastSeenWatermark: big, currentWatermark: big } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).observedWatermark).toBe(big);
  });
  it("parseCalendarEntitySeen refuses a missing flag, a JSON-number watermark or a bad count", () => {
    expect(parseCalendarEntitySeen(answer)).toEqual(answer);
    for (const bad of [{ unread: "true" }, { lastSeenWatermark: 1 }, { currentWatermark: "01" }, { count: -1 }, { count: 1.5 }, { entityId: undefined }]) expect(parseCalendarEntitySeen({ ...answer, ...bad })).toBeNull();
    expect(parseCalendarEntitySeen(null)).toBeNull();
  });
  it("401, 403, a lost connection and the 400/404 refusals are told apart", async () => {
    const request = { propertyId: "p-1", entityKind: "room-block" as const, entityId: "9d41", observedWatermark: "1" };
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await markCalendarEntitySeen(request)).toEqual({ kind: "unauthenticated" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await markCalendarEntitySeen(request)).toEqual({ kind: "denied" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await markCalendarEntitySeen(request)).kind).toBe("network");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ title: "x", code: "menu-unseen-unknown-menu" }), { status: 404, headers: { "content-type": "application/problem+json" } }));
    expect(await markCalendarEntitySeen(request)).toMatchObject({ kind: "refused", status: 404 });
  });
});
