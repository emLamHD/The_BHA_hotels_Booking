/**
 * BHA-ADMIN-BADGE-001-PR05: the history screen, inside the real Website gate (with the activity rule) and a real session; the shell's summary and the API client are replaced. It reads for any
 * signed-in Staff member, shows only the scopes the current summary allows, converts days to instants the Admin way, pages with the server's cursor, and drops everything of a scope, filter or
 * identity the moment it changes (a late first page or "load more" is never shown). LocalGate sends nothing.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  menus: {} as Record<string, unknown>,
  scope: { identity: "staff-a", ready: true, propertyNames: {} as Record<string, string>, reportAuth: vi.fn() },
  search: "",
  activity: vi.fn(),
  seen: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(ui.search) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/components/website/NewsletterBadgeProvider", () => ({ useMenuUnseen: () => ui.menus, useUnseenScope: () => ui.scope }));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()), fetchActivity: ui.activity, markNewsletterSeen: ui.seen }));

import ActivityScreen from "./ActivityScreen";
import { ALLOWED, deferred } from "@/components/website/websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import type { ActivityQuery } from "@/lib/api/menuUnseen";

const global = (count: number) => ({ count, lastSeenWatermark: "0", currentWatermark: String(count) });
const perProperty = (...counts: number[]) => ({
  count: counts.reduce((sum, count) => sum + count, 0),
  byProperty: counts.map((count, index) => ({ propertyId: `p-${index}`, count, lastSeenWatermark: "0", currentWatermark: String(count) })),
});
const item = (sequence: number, title = `Mục ${sequence}`, extra: Record<string, unknown> = {}) => ({
  sequence: String(sequence), occurredAtUtc: "2026-11-20T03:00:00+00:00", actorKind: "Staff", actorStaffId: "11111111-1111-1111-1111-111111111111", action: "Created", entityKind: "post", entityKey: String(sequence), titleSnapshot: title, itemCount: 1, ...extra,
});
const page = (items: unknown[], nextCursor: string | null = null, menu = "blog-posts") => ({ kind: "ok", data: { menu, propertyId: null, items, nextCursor } }) as never;
const queries = () => ui.activity.mock.calls.map((call) => call[0] as ActivityQuery);
const rows = () => screen.queryAllByTestId("activity-row").map((row) => within(row).getAllByRole("cell")[3].textContent);

const mount = () => render(<ActivityScreen />);
const ready = async () => { await screen.findByTestId("activity-menu"); };

beforeEach(() => {
  ui.menus = { "blog-posts": global(0), newsletter: global(2), promotions: perProperty(1, 4), calendar: perProperty(0, 0) };
  ui.scope.identity = "staff-a";
  ui.scope.ready = true;
  ui.scope.propertyNames = { "p-0": "Riverside", "p-1": "Hillside" };
  ui.scope.reportAuth.mockReset();
  ui.search = "menu=blog-posts";
  ui.activity.mockReset();
  ui.seen.mockReset();
  ui.activity.mockResolvedValue(page([item(3), item(2), item(1)]));
  vi.mocked(fetchStaffSession).mockReset();
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
});
afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe("who can open it", () => {
  it("LocalGate: the gate's message, no session check and no history request, whatever the URL says", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    ui.search = "menu=blog-posts";
    mount();
    expect(await screen.findByTestId("website-needs-staff-mode")).toBeTruthy();
    expect(ui.activity).not.toHaveBeenCalled();
    expect(fetchStaffSession).not.toHaveBeenCalled();
  });

  it("with nothing unseen (count 0 everywhere) the history is still there and loads", async () => {
    ui.menus = { "blog-posts": global(0) };
    mount();
    await screen.findByTestId("activity-table");
    expect(rows()).toEqual(["Mục 3", "Mục 2", "Mục 1"]);                                              // the server's order, untouched
    expect(queries()[0]).toMatchObject({ menu: "blog-posts", limit: 50 });
    expect(queries()[0].propertyId).toBeUndefined();                                                   // a global menu sends no Property
  });

  it("no signed-in Staff member: sign-in is asked for and nothing is requested", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "unauthenticated" });
    mount();
    await screen.findByTestId("staff-session-required");
    expect(ui.activity).not.toHaveBeenCalled();
  });

  it("waits for the summary: no request until the shell's first answer, and a Staff member with no menu at all is told so", async () => {
    ui.scope.ready = false;
    ui.menus = {};
    const view = mount();
    await screen.findByTestId("activity-loading");
    expect(ui.activity).not.toHaveBeenCalled();
    ui.scope.ready = true;
    view.rerender(<ActivityScreen />);
    expect(await screen.findByTestId("activity-no-scope")).toBeTruthy();
    expect(ui.activity).not.toHaveBeenCalled();
  });
});

describe("the scopes", () => {
  it("a Blog-only Staff member can pick only Blog menus; a Property-only one only their Properties (names from the session), and never a menu or Property the summary lacks", async () => {
    ui.menus = { "blog-posts": global(1), "blog-media": global(0) };
    mount();
    await ready();
    expect(within(screen.getByTestId("activity-menu")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Blog: Bài viết", "Blog: Thư viện ảnh"]);
    expect(screen.queryByTestId("activity-property")).toBeNull();
    cleanup();
    ui.menus = { promotions: perProperty(1), calendar: perProperty(2, 3) };
    mount();
    await ready();
    expect(within(screen.getByTestId("activity-menu")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Ưu đãi đặt phòng", "Calendar"]);
    expect(queries().at(-1)).toMatchObject({ menu: "promotions", propertyId: "p-0" });                // exactly one Property per request
    await userEvent.selectOptions(screen.getByTestId("activity-menu"), "calendar");
    await waitFor(() => expect(queries().at(-1)).toMatchObject({ menu: "calendar", propertyId: "p-0" }));
    expect(within(screen.getByTestId("activity-property")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Riverside", "Hillside"]);
  });

  it("starts on the menu and Property of the link it was opened from, if the summary allows them; a scope it does not allow falls back to one it does, never requested", async () => {
    ui.search = "menu=calendar&propertyId=p-1";
    mount();
    await ready();
    await waitFor(() => expect(queries().at(-1)).toMatchObject({ menu: "calendar", propertyId: "p-1" }));
    cleanup();
    ui.activity.mockClear();
    ui.search = "menu=website-hero&propertyId=p-9";
    mount();
    await ready();
    await waitFor(() => expect(ui.activity).toHaveBeenCalled());
    expect(queries().every((query) => query.menu !== "website-hero")).toBe(true);
    cleanup();
    ui.activity.mockClear();
    ui.search = "menu=promotions&propertyId=p-not-yours";
    mount();
    await ready();
    await waitFor(() => expect(ui.activity).toHaveBeenCalled());
    expect(queries().every((query) => query.propertyId !== "p-not-yours")).toBe(true);
  });
});

describe("filters", () => {
  const type = async (testId: string, value: string) => { await userEvent.clear(screen.getByTestId(testId)); await userEvent.type(screen.getByTestId(testId), value); };

  it("a day range becomes instants in Admin time (UTC+7): from is the start of its day, to is the START OF THE DAY AFTER, so the last day is included (from inclusive, to exclusive)", async () => {
    mount();
    await ready();
    await type("activity-from", "2026-11-15");
    await type("activity-to", "2026-11-15");
    await waitFor(() => expect(queries().at(-1)).toMatchObject({ from: "2026-11-15T00:00:00+07:00", to: "2026-11-16T00:00:00+07:00" }));
    await type("activity-to", "2026-12-31");
    await waitFor(() => expect(queries().at(-1)?.to).toBe("2027-01-01T00:00:00+07:00"));              // across a year end
  });

  it("a Staff actor is passed as given; a wrong id or a reversed range is told and sends nothing", async () => {
    mount();
    await ready();
    await type("activity-actor", "11111111-1111-1111-1111-111111111111");
    await waitFor(() => expect(queries().at(-1)?.actorStaffId).toBe("11111111-1111-1111-1111-111111111111"));
    await type("activity-actor", "not-a-guid");
    expect(screen.getByTestId("activity-filter-problem").textContent).toMatch(/GUID/);
    await type("activity-from", "2026-11-20");
    await type("activity-to", "2026-11-10");
    expect(screen.getAllByTestId("activity-filter-problem").map((node) => node.textContent).join(" ")).toMatch(/trước hoặc bằng/);
    expect(queries().every((query) => query.actorStaffId !== "not-a-guid" && !(query.from && query.to && query.from > query.to))).toBe(true);

  });

  it("nothing in the query is empty: a filter left blank is left out", async () => {
    mount();
    await ready();
    await screen.findByTestId("activity-table");
    expect(Object.entries(queries()[0]).filter(([, value]) => value !== undefined).map(([name]) => name).sort()).toEqual(["limit", "menu"]);
  });
});

describe("paging", () => {
  it("'Tải thêm' sends the cursor the last page returned, exactly, appends in the server's order, and goes away on the last page", async () => {
    ui.activity.mockResolvedValueOnce(page([item(5), item(4)], "cur+/=1")).mockResolvedValueOnce(page([item(3), item(4)], null));
    mount();
    await screen.findByTestId("activity-table");
    await userEvent.click(screen.getByTestId("activity-more"));
    await waitFor(() => expect(rows()).toEqual(["Mục 5", "Mục 4", "Mục 3"]));                          // the repeated row is not shown twice
    expect(queries()[1].cursor).toBe("cur+/=1");
    expect(queries()[1]).toMatchObject({ menu: "blog-posts", limit: 50 });
    expect(screen.queryByTestId("activity-more")).toBeNull();
  });

  it("a filter, menu or Property change starts again: the rows and the cursor are gone and the next request carries none", async () => {
    ui.activity.mockResolvedValueOnce(page([item(5), item(4)], "next-1")).mockResolvedValueOnce(page([item(3)], "next-2"));
    mount();
    await screen.findByTestId("activity-table");
    await userEvent.click(screen.getByTestId("activity-more"));
    await waitFor(() => expect(rows()).toHaveLength(3));
    ui.activity.mockResolvedValue(page([item(9, "mới")], "fresh"));
    await userEvent.type(screen.getByTestId("activity-from"), "2026-11-01");
    await waitFor(() => expect(rows()).toEqual(["mới"]));
    expect(queries().at(-1)!.cursor).toBeUndefined();
    await userEvent.click(screen.getByTestId("activity-more"));
    await waitFor(() => expect(queries().at(-1)!.cursor).toBe("fresh"));
    ui.activity.mockResolvedValue(page([item(7, "newsletter")], null, "newsletter"));
    await userEvent.selectOptions(screen.getByTestId("activity-menu"), "newsletter");
    await waitFor(() => expect(rows()).toEqual(["newsletter"]));
    expect(queries().at(-1)).toMatchObject({ menu: "newsletter" });
    expect(queries().at(-1)!.cursor).toBeUndefined();
  });

  it("a 'load more' that answers after the filter changed is dropped (and its request was aborted)", async () => {
    ui.activity.mockResolvedValueOnce(page([item(5)], "next-1"));
    mount();
    await screen.findByTestId("activity-table");
    const late = deferred<ReturnType<typeof page>>();
    const signals: Array<AbortSignal | undefined> = [];
    ui.activity.mockImplementation((_query: ActivityQuery, signal?: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? (late.promise as never) : (Promise.resolve(page([item(9, "đúng bộ lọc mới")])) as never);
    });
    await userEvent.click(screen.getByTestId("activity-more"));
    await userEvent.type(screen.getByTestId("activity-from"), "2026-11-01");
    await screen.findByText("đúng bộ lọc mới");
    expect(signals[0]!.aborted).toBe(true);
    await act(async () => { late.resolve(page([item(4, "muộn của bộ lọc cũ")], null)); });
    expect(screen.queryByText("muộn của bộ lọc cũ")).toBeNull();
    expect(rows()).toEqual(["đúng bộ lọc mới"]);
  });

  it("a failed 'load more' keeps the rows and offers to try again with the same cursor", async () => {
    ui.activity.mockResolvedValueOnce(page([item(5)], "next-1")).mockResolvedValueOnce({ kind: "network", message: "offline" } as never).mockResolvedValueOnce(page([item(4)]));
    mount();
    await screen.findByTestId("activity-table");
    await userEvent.click(screen.getByTestId("activity-more"));
    expect((await screen.findByTestId("activity-more-error")).textContent).toContain("offline");
    expect(rows()).toEqual(["Mục 5"]);
    await userEvent.click(screen.getByTestId("activity-more"));
    await waitFor(() => expect(rows()).toEqual(["Mục 5", "Mục 4"]));
    expect(queries().map((query) => query.cursor)).toEqual([undefined, "next-1", "next-1"]);
  });
});

describe("states and a changing world", () => {
  it("empty, error with retry, and loading are each shown", async () => {
    const first = deferred<ReturnType<typeof page>>();
    ui.activity.mockImplementationOnce(() => first.promise as never).mockResolvedValueOnce(page([])).mockResolvedValueOnce({ kind: "error", status: 500, message: "Máy chủ lỗi" } as never);
    mount();
    await screen.findByTestId("activity-rows-loading");
    await act(async () => { first.resolve({ kind: "error", status: 500, message: "Máy chủ lỗi" } as never); });
    await userEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByTestId("activity-empty")).toBeTruthy();
  });

  it("a 404 clears that scope's rows and says one general thing", async () => {
    ui.activity.mockResolvedValueOnce(page([item(1, "còn đây")])).mockResolvedValue({ kind: "refused", status: 404, code: "menu-unseen-unknown-menu", field: null, detail: "x" } as never);
    mount();
    await screen.findByText("còn đây");
    await userEvent.selectOptions(screen.getByTestId("activity-menu"), "newsletter");
    expect((await screen.findByTestId("activity-gone")).textContent).toMatch(/không còn tồn tại hoặc tài khoản không còn quyền/);
    expect(screen.queryByText("còn đây")).toBeNull();
    expect(screen.queryByTestId("activity-table")).toBeNull();
  });

  it("another Staff member: the first one's rows are gone in the render the identity changes in, before the new answer arrives", async () => {
    ui.activity.mockResolvedValueOnce(page([item(1, "của A")]));
    const view = mount();
    await screen.findByText("của A");
    const forB = deferred<ReturnType<typeof page>>();
    ui.activity.mockImplementationOnce(() => forB.promise as never);
    ui.scope.identity = "staff-b";
    view.rerender(<ActivityScreen />);
    expect(screen.queryByText("của A")).toBeNull();
    expect(screen.queryByTestId("activity-table")).toBeNull();
    expect(screen.getByTestId("activity-rows-loading")).toBeTruthy();
  });

  it("the first Staff member's late first page, arriving after another Staff member took over, is never shown", async () => {
    const forA = deferred<ReturnType<typeof page>>();
    ui.activity.mockImplementationOnce(() => forA.promise as never);
    const view = mount();
    await vi.waitFor(() => expect(ui.activity).toHaveBeenCalledTimes(1));
    ui.activity.mockResolvedValue(page([item(2, "của B")]));
    ui.scope.identity = "staff-b";
    view.rerender(<ActivityScreen />);
    await screen.findByText("của B");
    await act(async () => { forA.resolve(page([item(3, "của A, muộn")])); });
    expect(screen.queryByText("của A, muộn")).toBeNull();
    expect(rows()).toEqual(["của B"]);
  });

  it("a menu that leaves the summary (permission lost) takes its rows with it and the screen falls to a scope still allowed", async () => {
    ui.activity.mockImplementation(async (query: ActivityQuery) => page([item(1, `của ${query.menu}`)], null, query.menu));
    ui.search = "menu=newsletter";
    const view = mount();
    await screen.findByText("của newsletter");
    ui.menus = { "blog-posts": global(0) };
    view.rerender(<ActivityScreen />);
    expect(screen.queryByText("của newsletter")).toBeNull();
    await screen.findByText("của blog-posts");
  });

  it("401 and 403 go to the shared session; nothing is ever acknowledged", async () => {
    ui.activity.mockResolvedValueOnce({ kind: "unauthenticated" } as never);
    mount();
    await waitFor(() => expect(ui.scope.reportAuth).toHaveBeenCalledWith("unauthenticated"));
    expect(ui.seen).not.toHaveBeenCalled();
  });
});
