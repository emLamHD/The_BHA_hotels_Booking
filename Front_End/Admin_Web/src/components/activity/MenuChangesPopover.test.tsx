/**
 * BHA-ADMIN-BADGE-001-PR05: the unseen list itself. The provider's numbers and the API client are replaced, so each test plays the answers (deferred where the order matters) and asserts what
 * the list shows and asks: the API's own totals and order, at most 50 groups, `50+` from `hasMore`, text-only titles, the right history link, one scope per request, nothing shown from an
 * earlier scope or identity, a late answer dropped (and its request aborted), a 404 as one general message, and never a "seen".
 */
import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  menus: {} as Record<string, unknown>,
  scope: { identity: "staff-a", ready: true, propertyNames: {} as Record<string, string>, reportAuth: vi.fn() },
  changes: vi.fn(),
  seen: vi.fn(),
  calendarSeen: vi.fn(),
}));

vi.mock("@/components/website/NewsletterBadgeProvider", () => ({ useMenuUnseen: () => ui.menus, useUnseenScope: () => ui.scope, useCalendarSeen: () => ui.calendarSeen }));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()), fetchMenuChanges: ui.changes, markNewsletterSeen: ui.seen }));

import MenuChangesPopover, { type PopoverTarget } from "./MenuChangesPopover";
import { deferred } from "@/components/website/websiteTestUtils";

const global = (count: number) => ({ count, lastSeenWatermark: "0", currentWatermark: String(count) });
const perProperty = (...counts: number[]) => ({
  count: counts.reduce((sum, count) => sum + count, 0),
  byProperty: counts.map((count, index) => ({ propertyId: `p-${index}`, count, lastSeenWatermark: "0", currentWatermark: String(count) })),
});
const group = (title: string, events = 1, extra: Record<string, unknown> = {}) => ({
  entityKind: "post", entityKey: title, titleSnapshot: title, action: "Created", events, itemCount: 1, latestWatermark: "5", occurredAtUtc: "2026-11-20T03:00:00+00:00", actors: [{ kind: "Staff", staffId: "s-1" }], ...extra,
});
const body = (menu: string, groups: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: "ok",
  data: { menu, propertyId: null, unseenEvents: groups.length, hasMore: false, lastSeenWatermark: "0", snapshotWatermark: "9", groups, ...extra },
}) as never;
const target = (menus: PopoverTarget["menus"], initial: PopoverTarget["initial"], identity = "staff-a"): PopoverTarget => ({ menus, initial, anchor: document.createElement("button"), identity });
const mount = (value: PopoverTarget) => render(<MenuChangesPopover target={value} onClose={vi.fn()} />);

beforeEach(() => {
  ui.menus = { newsletter: global(4), "blog-posts": global(2), promotions: perProperty(2, 3) };
  ui.scope.identity = "staff-a";
  ui.scope.propertyNames = { "p-0": "Riverside" };
  ui.scope.reportAuth.mockReset();
  ui.changes.mockReset();
  ui.seen.mockReset();
  ui.calendarSeen.mockReset();
});
afterEach(cleanup);

describe("what the list shows", () => {
  it("the API's own order and totals: unseenEvents is the total, each group's events its own number, and the total is not summed from the groups", async () => {
    ui.changes.mockResolvedValue(body("newsletter", [group("Bài một", 3), group("Bài hai", 1)], { unseenEvents: 137 }));
    mount(target(["newsletter"], "newsletter"));
    await screen.findAllByTestId("unseen-popover-group");
    expect(screen.getAllByTestId("unseen-popover-group").map((node) => node.textContent?.startsWith("Bài một") ? "one" : "two")).toEqual(["one", "two"]);
    expect(screen.getAllByTestId("unseen-popover-group-events").map((node) => node.textContent)).toEqual(["×3", "×1"]);
    expect(screen.getByTestId("unseen-popover-total").textContent).toContain("137");
    expect(screen.getByTestId("unseen-popover-total").textContent).not.toContain("50+");
    expect(screen.queryByTestId("unseen-popover-more")).toBeNull();
  });

  it("a bulk picture upload has no title: it reads from its item count (one event, never the count of pictures), and a titled group is untouched", async () => {
    ui.menus = { ...ui.menus, "blog-media": global(2) };
    ui.changes.mockResolvedValue(body("blog-media", [group("", 1, { entityKind: "media-batch", itemCount: 12 }), group("Ảnh bìa", 1, { entityKind: "media", itemCount: 1 })], { unseenEvents: 2 }));
    mount(target(["blog-media"], "blog-media"));
    const groups = await screen.findAllByTestId("unseen-popover-group");
    expect(groups[0].textContent).toContain("Tải lên 12 ảnh");
    expect(groups[0].textContent).not.toContain("media-batch");
    expect(groups[1].textContent).toContain("Ảnh bìa");
    expect(screen.getAllByTestId("unseen-popover-group-events").map((node) => node.textContent)).toEqual(["×1", "×1"]);   // the server's events, not 12
    expect(screen.getByTestId("unseen-popover-total").textContent).toContain("2");
  });

  it("hasMore shows 50+ and the pointer to the history; at most 50 groups are drawn even if more are sent", async () => {
    const many = Array.from({ length: 60 }, (_, index) => group(`Nhóm ${index}`));
    ui.changes.mockResolvedValue(body("newsletter", many, { unseenEvents: 900, hasMore: true }));
    mount(target(["newsletter"], "newsletter"));
    await screen.findAllByTestId("unseen-popover-group");
    expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(50);
    expect(screen.getByTestId("unseen-popover-total").textContent).toContain("900");
    expect(screen.getByTestId("unseen-popover-total").textContent).toContain("50+");
    expect(screen.getByTestId("unseen-popover-more").textContent).toContain("50+");
  });

  it("a title is text, never markup, and nothing about the original object is fetched to show it", async () => {
    ui.changes.mockResolvedValue(body("newsletter", [group('<img src=x onerror="alert(1)"><b>đậm</b>')]));
    mount(target(["newsletter"], "newsletter"));
    await screen.findByTestId("unseen-popover-group");
    expect(document.querySelector("[data-testid='unseen-popover-group'] img, [data-testid='unseen-popover-group'] b")).toBeNull();
    expect(screen.getByTestId("unseen-popover-group").textContent).toContain('<img src=x onerror="alert(1)"><b>đậm</b>');
    expect(ui.changes).toHaveBeenCalledTimes(1);
  });

  it("an empty list says so", async () => {
    ui.changes.mockResolvedValue(body("newsletter", []));
    mount(target(["newsletter"], "newsletter"));
    expect(await screen.findByTestId("unseen-popover-none")).toBeTruthy();
  });

  it("links to the history of THIS menu (and Property): a global menu has no propertyId, Promotions carries the one on screen", async () => {
    ui.changes.mockResolvedValue(body("newsletter", [group("x")]));
    mount(target(["newsletter", "blog-posts"], "newsletter"));
    await screen.findByTestId("unseen-popover-group");
    expect(screen.getByTestId("unseen-popover-history").getAttribute("href")).toBe("/activity?menu=newsletter");
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-menu"), "blog-posts");
    await waitFor(() => expect(screen.getByTestId("unseen-popover-history").getAttribute("href")).toBe("/activity?menu=blog-posts"));
    cleanup();
    ui.changes.mockResolvedValue(body("promotions", [group("x")]));
    mount(target(["promotions"], "promotions"));
    await screen.findByTestId("unseen-popover-group");
    expect(screen.getByTestId("unseen-popover-history").getAttribute("href")).toBe("/activity?menu=promotions&propertyId=p-0");
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-property"), "p-1");
    await waitFor(() => expect(screen.getByTestId("unseen-popover-history").getAttribute("href")).toBe("/activity?menu=promotions&propertyId=p-1"));
  });

  it("is read-only: opening, picking, retrying and following the link never say 'seen'", async () => {
    ui.changes.mockResolvedValueOnce({ kind: "network", message: "offline" } as never).mockResolvedValue(body("newsletter", [group("x")]));
    mount(target(["newsletter", "blog-posts"], "newsletter"));
    await userEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    await screen.findByTestId("unseen-popover-group");
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-menu"), "blog-posts");
    expect(ui.seen).not.toHaveBeenCalled();
  });
});

describe("it stays inside the viewport", () => {
  const rectAt = (top: number, right = 250) => ({ top, bottom: top + 24, left: right - 24, right, width: 24, height: 24, x: right - 24, y: top, toJSON: () => ({}) }) as DOMRect;
  const withViewport = (width: number, height: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  };
  const anchorAt = (top: number) => {
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => rectAt(top);
    document.body.appendChild(anchor);                                                                   // a button that is on the page: the panel follows it
    return anchor;
  };
  const box = () => {
    const style = screen.getByTestId("unseen-popover").style;
    return { top: parseFloat(style.top), maxHeight: parseFloat(style.maxHeight), left: parseFloat(style.left), width: parseFloat(style.width) };
  };
  afterEach(() => withViewport(1024, 768));

  it("an anchor near the bottom of an 800 px viewport with a long list: top and the tallest the panel may be end at the bottom padding at the latest, and the panel scrolls", async () => {
    withViewport(1440, 800);
    ui.changes.mockResolvedValue(body("newsletter", Array.from({ length: 50 }, (_, index) => group(`Nhóm ${index}`)), { unseenEvents: 500, hasMore: true }));
    render(<MenuChangesPopover target={{ ...target(["newsletter"], "newsletter"), anchor: anchorAt(740) }} onClose={vi.fn()} />);
    await screen.findAllByTestId("unseen-popover-group");
    const { top, maxHeight } = box();
    expect(top).toBeGreaterThanOrEqual(8);
    expect(maxHeight).toBeGreaterThan(0);
    expect(top + maxHeight).toBeLessThanOrEqual(800 - 8);                                               // however tall the list, the panel ends inside the viewport
    expect(screen.getByTestId("unseen-popover").className).toContain("overflow-y-auto");               // and what does not fit scrolls (the last group and the history link stay reachable)
    expect(screen.getByTestId("unseen-popover-history")).toBeTruthy();
  });

  it("an anchor near the top keeps its place; a short viewport (390 x 360) gives the panel the rest of the screen, never more", async () => {
    withViewport(1440, 800);
    ui.changes.mockResolvedValue(body("newsletter", [group("x")]));
    render(<MenuChangesPopover target={{ ...target(["newsletter"], "newsletter"), anchor: anchorAt(100) }} onClose={vi.fn()} />);
    await screen.findByTestId("unseen-popover-group");
    expect(box().top).toBe(100);
    cleanup();
    withViewport(390, 360);
    render(<MenuChangesPopover target={{ ...target(["newsletter"], "newsletter"), anchor: anchorAt(300) }} onClose={vi.fn()} />);
    await screen.findByTestId("unseen-popover-group");
    const short = box();
    expect(short.top).toBeGreaterThanOrEqual(8);
    expect(short.top + short.maxHeight).toBeLessThanOrEqual(360 - 8);
    expect(short.left + short.width).toBeLessThanOrEqual(390);
  });

  it("follows a resize while open: the same limit holds in the new viewport", async () => {
    withViewport(1440, 800);
    ui.changes.mockResolvedValue(body("newsletter", [group("x")]));
    render(<MenuChangesPopover target={{ ...target(["newsletter"], "newsletter"), anchor: anchorAt(700) }} onClose={vi.fn()} />);
    await screen.findByTestId("unseen-popover-group");
    withViewport(1440, 500);
    act(() => { window.dispatchEvent(new Event("resize")); });
    await waitFor(() => expect(box().top + box().maxHeight).toBeLessThanOrEqual(500 - 8));
  });
});

describe("the history link", () => {
  it("closes the list when followed, even if the link keeps the same page (the history page itself)", async () => {
    ui.changes.mockResolvedValue(body("newsletter", [group("x")]));
    const onClose = vi.fn();
    render(<MenuChangesPopover target={target(["newsletter"], "newsletter")} onClose={onClose} />);
    await screen.findByTestId("unseen-popover-group");
    const link = screen.getByTestId("unseen-popover-history");
    link.addEventListener("click", (event) => event.preventDefault());                                  // no real navigation in jsdom
    await userEvent.click(link);
    expect(onClose).toHaveBeenCalledWith(false);
    expect(ui.seen).not.toHaveBeenCalled();
  });
});

describe("states", () => {
  it("loading, then an error with a retry that asks again for the same scope", async () => {
    const first = deferred<ReturnType<typeof body>>();
    ui.changes.mockImplementationOnce(() => first.promise as never).mockResolvedValue(body("newsletter", [group("sau khi thử lại")]));
    mount(target(["newsletter"], "newsletter"));
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();
    await act(async () => { first.resolve({ kind: "error", status: 503, message: "Máy chủ lỗi" } as never); });
    expect(screen.getByTestId("unseen-popover-error").textContent).toContain("Máy chủ lỗi");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("sau khi thử lại");
    expect(ui.changes.mock.calls.map((call) => call.slice(0, 2))).toEqual([["newsletter", undefined], ["newsletter", undefined]]);
  });

  it("a 404 drops the scope's data and says one general thing, whatever the reason", async () => {
    ui.changes.mockResolvedValueOnce(body("newsletter", [group("còn đây")])).mockResolvedValue({ kind: "refused", status: 404, code: "menu-unseen-unknown-menu", field: null, detail: "x" } as never);
    mount(target(["newsletter", "blog-posts"], "newsletter"));
    await screen.findByText("còn đây");
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-menu"), "blog-posts");
    expect((await screen.findByTestId("unseen-popover-gone")).textContent).toMatch(/không còn tồn tại hoặc tài khoản không còn quyền/);
    expect(screen.queryByText("còn đây")).toBeNull();
    expect(screen.queryAllByTestId("unseen-popover-group")).toHaveLength(0);
  });

  it("a 401 and a 403 go to the shared session", async () => {
    ui.changes.mockResolvedValueOnce({ kind: "unauthenticated" } as never);
    mount(target(["newsletter"], "newsletter"));
    await waitFor(() => expect(ui.scope.reportAuth).toHaveBeenCalledWith("unauthenticated"));
    cleanup();
    ui.changes.mockResolvedValueOnce({ kind: "denied" } as never);
    mount(target(["newsletter"], "newsletter"));
    await waitFor(() => expect(ui.scope.reportAuth).toHaveBeenCalledWith("denied"));
  });
});

describe("coming back to a scope just left (each load has its own life)", () => {
  // The mock ignores the AbortSignal on purpose: a late answer must be dropped by the popover itself, not by a well-behaved transport.
  type Answer = ReturnType<typeof body>;
  const held = () => {
    const pending: Array<{ menu: string; property: string | undefined; settle: (value: Answer) => void }> = [];
    ui.changes.mockImplementation((menu: string, property?: string) => new Promise<Answer>((resolve) => { pending.push({ menu, property, settle: resolve }); }));
    return pending;
  };

  it.each([
    ["menu", ["newsletter", "blog-posts"] as const, "unseen-popover-menu", "newsletter", "blog-posts"],
    ["Property", ["promotions"] as const, "unseen-popover-property", "p-0", "p-1"],
  ])("A loaded, B chosen and still out, back to A while its new GET is out (%s): loading at once and A's old groups and total are gone; B's late answer (even a 401/403) changes nothing; the new A shows what it answered, even an empty list", async (_kind, menus, selectId, a, b) => {
    const pending = held();
    mount(target(menus, menus[0]));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].settle(body(pending[0].menu, [group("A cũ 1"), group("A cũ 2")], { unseenEvents: 137 })); });
    await screen.findByText("A cũ 1");
    expect(screen.getByTestId("unseen-popover-total").textContent).toContain("137");

    await userEvent.selectOptions(screen.getByTestId(selectId), b);                                    // B, unanswered
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await userEvent.selectOptions(screen.getByTestId(selectId), a);                                    // back to A, whose NEW GET is unanswered
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();                                  // loading at once …
    expect(screen.queryByText("A cũ 1")).toBeNull();                                                    // … and nothing of the old A
    expect(screen.queryByTestId("unseen-popover-total")).toBeNull();
    expect(screen.queryAllByTestId("unseen-popover-group")).toHaveLength(0);

    await act(async () => { pending[1].settle({ kind: "denied" } as never); });                        // B answers late, with a 403
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();
    expect(screen.queryByTestId("unseen-popover-error")).toBeNull();
    expect(ui.scope.reportAuth).not.toHaveBeenCalled();                                                // a stale answer does not touch the session

    await act(async () => { pending[2].settle(body(pending[2].menu, [], { unseenEvents: 0 })); });
    expect(await screen.findByTestId("unseen-popover-none")).toBeTruthy();                              // the new A: an empty list, shown as such
    expect(screen.queryByText("A cũ 1")).toBeNull();
    expect(ui.seen).not.toHaveBeenCalled();
  });

  it("a retry is a new load: the error it follows is gone while the retry is out, and the retry's answer is the one shown", async () => {
    const pending = held();
    mount(target(["newsletter"], "newsletter"));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].settle({ kind: "network", message: "offline" } as never); });
    await userEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(screen.queryByTestId("unseen-popover-error")).toBeNull();
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();
    await act(async () => { pending[1].settle(body("newsletter", [group("sau retry")])); });
    await screen.findByText("sau retry");
  });

  it("another Staff member is a new load too, even for the same menu: the first member's result is not the second's while its GET is out", async () => {
    const pending = held();
    const view = mount(target(["newsletter"], "newsletter"));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0].settle(body("newsletter", [group("của A")])); });
    await screen.findByText("của A");
    ui.scope.identity = "staff-b";
    view.rerender(<MenuChangesPopover target={target(["newsletter"], "newsletter", "staff-b")} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    ui.scope.identity = "staff-a";                                                                      // and back to the first identity's value while the second's GET is out
    view.rerender(<MenuChangesPopover target={target(["newsletter"], "newsletter", "staff-a")} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(screen.queryByText("của A")).toBeNull();
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();
  });
});

describe("a different scope, Staff member or permission while a request is out", () => {
  it("picking another menu: the old rows go in that render, the late answer of the first is dropped and its request was aborted", async () => {
    const first = deferred<ReturnType<typeof body>>();
    const signals: Array<AbortSignal | undefined> = [];
    ui.changes.mockImplementation((menu: string, _property: string | undefined, signal?: AbortSignal) => {
      signals.push(signal);
      return menu === "newsletter" ? (first.promise as never) : Promise.resolve(body("blog-posts", [group("của blog")]));
    });
    mount(target(["newsletter", "blog-posts"], "newsletter"));
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-menu"), "blog-posts");
    await screen.findByText("của blog");
    expect(signals[0]!.aborted).toBe(true);
    await act(async () => { first.resolve(body("newsletter", [group("muộn của newsletter")])); });
    expect(screen.queryByText("muộn của newsletter")).toBeNull();
    expect(screen.getByText("của blog")).toBeTruthy();
  });

  it("another Staff member: nothing of the first is on screen from the next render, and the first one's late answer never appears", async () => {
    const forA = deferred<ReturnType<typeof body>>();
    ui.changes.mockImplementationOnce(() => forA.promise as never);
    const view = mount(target(["newsletter"], "newsletter"));
    ui.changes.mockResolvedValue(body("newsletter", [group("của B")]));
    ui.scope.identity = "staff-b";
    view.rerender(<MenuChangesPopover target={target(["newsletter"], "newsletter", "staff-b")} onClose={vi.fn()} />);
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();
    await screen.findByText("của B");
    await act(async () => { forA.resolve(body("newsletter", [group("của A, muộn")])); });
    expect(screen.queryByText("của A, muộn")).toBeNull();
  });

  it("the first Staff member's loaded rows are gone in the render their identity changes in, before the new answer arrives", async () => {
    ui.changes.mockResolvedValueOnce(body("newsletter", [group("của A")]));
    const view = mount(target(["newsletter"], "newsletter"));
    await screen.findByText("của A");
    const forB = deferred<ReturnType<typeof body>>();
    ui.changes.mockImplementationOnce(() => forB.promise as never);
    ui.scope.identity = "staff-b";
    view.rerender(<MenuChangesPopover target={target(["newsletter"], "newsletter", "staff-b")} onClose={vi.fn()} />);
    expect(screen.queryByText("của A")).toBeNull();
    expect(screen.getByTestId("unseen-popover-loading")).toBeTruthy();
  });

  it("a menu that leaves the summary (permission lost) takes its rows with it: the list falls to what is still allowed, or says nothing is left", async () => {
    ui.changes.mockImplementation(async (menu: string) => body(menu, [group(`của ${menu}`)]));
    const view = mount(target(["newsletter", "blog-posts"], "newsletter"));
    await screen.findByText("của newsletter");
    ui.menus = { "blog-posts": global(2) };
    view.rerender(<MenuChangesPopover target={target(["newsletter", "blog-posts"], "newsletter")} onClose={vi.fn()} />);
    expect(screen.queryByText("của newsletter")).toBeNull();
    await screen.findByText("của blog-posts");
    ui.menus = {};
    view.rerender(<MenuChangesPopover target={target(["newsletter", "blog-posts"], "newsletter")} onClose={vi.fn()} />);
    expect(screen.queryByText("của blog-posts")).toBeNull();
    expect(screen.getByTestId("unseen-popover-empty")).toBeTruthy();
  });

  it("a Property that leaves byProperty is never requested again", async () => {
    ui.changes.mockImplementation(async (menu: string, property?: string) => body(menu, [group(`của ${property}`)], { propertyId: property }));
    const view = mount(target(["promotions"], "promotions"));
    await userEvent.selectOptions(await screen.findByTestId("unseen-popover-property"), "p-1");
    await screen.findByText("của p-1");
    ui.menus = { promotions: perProperty(2) };                                                          // only p-0 is left
    view.rerender(<MenuChangesPopover target={target(["promotions"], "promotions")} onClose={vi.fn()} />);
    await screen.findByText("của p-0");
    expect(screen.queryByText("của p-1")).toBeNull();
    expect(within(screen.getByTestId("unseen-popover-property")).getAllByRole("option")).toHaveLength(1);
  });
});


// ================================================================================================ BHA-ADMIN-BADGE-001-PR13
// The Calendar's list: «Đánh dấu đã xem» for a Removed group only, with the group's own entityId and observedWatermark. The provider (one call per object, stale-life drop) is replaced by `ui.calendarSeen`.

const calendarGroup = (id: string, presence: "OnBoard" | "Removed" | undefined, observed = "8", extra: Record<string, unknown> = {}) => ({
  entityKind: "room-block", entityKey: `key-${id}`, entityId: id, titleSnapshot: `Room ${id}`, action: "Cancelled", events: 2, itemCount: 1, latestWatermark: "9",
  occurredAtUtc: "2026-11-20T03:00:00+00:00", actors: [{ kind: "Staff", staffId: "s-1" }], ...(presence ? { presence } : {}), observedWatermark: observed, ...extra,
});
const calendarBody = (propertyId: string, groups: unknown[]) => body("calendar", groups, { propertyId, snapshotWatermark: "99", lastSeenWatermark: "77", unseenEvents: groups.length });
const answer = (unread: boolean, lastSeenWatermark: string) => ({ kind: "ok", answer: { propertyId: "p-0", entityKind: "room-block", entityId: "b-1", lastSeenWatermark, unread, count: 0, currentWatermark: "9" } });
const mountCalendar = () => mount(target(["calendar"], "calendar"));

describe("the Calendar's «Đánh dấu đã xem» (PR-13)", () => {
  beforeEach(() => {
    ui.menus = { calendar: perProperty(3, 2) };
  });

  it("only a Removed group has the button; an OnBoard group has a pointer to its bar and no button; a group of any other menu never has one", async () => {
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed"), calendarGroup("b-2", "OnBoard"), calendarGroup("b-3", undefined)]));
    mountCalendar();
    const groups = await screen.findAllByTestId("unseen-popover-group");
    expect(within(groups[0]).getByTestId("unseen-popover-mark-seen").textContent).toBe("Đánh dấu đã xem");
    expect(within(groups[1]).queryByTestId("unseen-popover-mark-seen")).toBeNull();
    expect(within(groups[1]).getByTestId("unseen-popover-onboard-hint")).toBeTruthy();
    expect(within(groups[2]).queryByTestId("unseen-popover-mark-seen")).toBeNull();
    cleanup();
    ui.menus = { newsletter: global(4) };
    ui.changes.mockResolvedValue(body("newsletter", [group("Bài", 1, { entityId: "x", presence: "Removed", observedWatermark: "3" })]));
    mount(target(["newsletter"], "newsletter"));
    await screen.findAllByTestId("unseen-popover-group");
    expect(screen.queryByTestId("unseen-popover-mark-seen")).toBeNull();
    expect(ui.calendarSeen).not.toHaveBeenCalled();
  });

  it("sends the group's own entityId and observedWatermark for the listed Property — never entityKey, latestWatermark, snapshotWatermark or the list's lastSeenWatermark — and the Staff identity", async () => {
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed", "8")]));
    ui.calendarSeen.mockResolvedValue(answer(false, "8"));
    mountCalendar();
    await userEvent.click(await screen.findByTestId("unseen-popover-mark-seen"));
    expect(ui.calendarSeen).toHaveBeenCalledTimes(1);
    expect(ui.calendarSeen).toHaveBeenCalledWith("staff-a", { propertyId: "p-0", entityKind: "room-block", entityId: "b-1", observedWatermark: "8" });
  });

  it("an answer that says no longer unread removes the group and reads the list again (fresh totals); the viewing alone never sends anything", async () => {
    ui.changes.mockResolvedValueOnce(calendarBody("p-0", [calendarGroup("b-1", "Removed"), calendarGroup("b-2", "Removed", "5")]));
    ui.changes.mockResolvedValueOnce(calendarBody("p-0", [calendarGroup("b-2", "Removed", "5")]));
    ui.calendarSeen.mockResolvedValue(answer(false, "8"));
    mountCalendar();
    await screen.findAllByTestId("unseen-popover-group");
    expect(ui.calendarSeen).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getAllByTestId("unseen-popover-group")[0]).getByTestId("unseen-popover-mark-seen"));
    await waitFor(() => expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1));
    expect(screen.getByTestId("unseen-popover-group").textContent).toContain("Room b-2");
    await waitFor(() => expect(ui.changes).toHaveBeenCalledTimes(2));
    expect(ui.calendarSeen).toHaveBeenCalledTimes(1);
    expect(popoverPanel().contains(document.activeElement)).toBe(true);                                  // focus did not fall out of the dialog with the removed group
  });

  it("an answer whose cursor is below the group's watermark does not hide it", async () => {
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed", "8")]));
    ui.calendarSeen.mockResolvedValue(answer(false, "7"));
    mountCalendar();
    await userEvent.click(await screen.findByTestId("unseen-popover-mark-seen"));
    await waitFor(() => expect(ui.changes).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1);
  });

  it("a failure keeps the group, says so, and the same button tries again", async () => {
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed")]));
    ui.calendarSeen.mockResolvedValueOnce({ kind: "failed" }).mockResolvedValueOnce(answer(false, "8"));
    mountCalendar();
    await userEvent.click(await screen.findByTestId("unseen-popover-mark-seen"));
    expect(await screen.findByTestId("unseen-popover-mark-error")).toBeTruthy();
    expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1);
    expect(ui.changes).toHaveBeenCalledTimes(1);                                                           // a failure changes nothing and re-reads nothing
    ui.changes.mockResolvedValue(calendarBody("p-0", []));
    await userEvent.click(screen.getByTestId("unseen-popover-mark-seen"));
    await waitFor(() => expect(screen.queryByTestId("unseen-popover-group")).toBeNull());
    expect(ui.calendarSeen).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("unseen-popover-mark-error")).toBeNull();
  });

  it("an answer that says still unread reads the list again and keeps what is still unread — with the newer watermark, which the next call sends", async () => {
    ui.changes.mockResolvedValueOnce(calendarBody("p-0", [calendarGroup("b-1", "Removed", "8")]));
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed", "10")]));
    ui.calendarSeen.mockResolvedValue(answer(true, "8"));
    mountCalendar();
    await userEvent.click(await screen.findByTestId("unseen-popover-mark-seen"));
    await waitFor(() => expect(ui.changes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("unseen-popover-mark-seen"));
    expect(ui.calendarSeen).toHaveBeenLastCalledWith("staff-a", expect.objectContaining({ observedWatermark: "10" }));
  });

  it("while a call is on the wire the button is aria-disabled (still focusable) and a second click sends nothing; nothing was dropped from the group meanwhile", async () => {
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed")]));
    const wire = deferred<unknown>();
    ui.calendarSeen.mockReturnValue(wire.promise);
    mountCalendar();
    const button = await screen.findByTestId("unseen-popover-mark-seen");
    await userEvent.click(button);
    await userEvent.click(button);
    expect(ui.calendarSeen).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => wire.resolve({ kind: "dropped" }));
    expect(button.getAttribute("aria-disabled")).toBeNull();                                                 // dropped: nothing sent, nothing painted, the button is usable again
    expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1);
  });

  it("an answer that arrives after the popover closed paints nothing and reads nothing", async () => {
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed")]));
    const wire = deferred<unknown>();
    ui.calendarSeen.mockReturnValue(wire.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = mountCalendar();
    await userEvent.click(await screen.findByTestId("unseen-popover-mark-seen"));
    view.unmount();
    await act(async () => wire.resolve(answer(false, "8")));
    expect(ui.changes).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("an older answer that arrives after a NEWER list of the same scope cannot hide the group that list shows with a higher watermark", async () => {
    ui.changes.mockResolvedValueOnce(calendarBody("p-0", [calendarGroup("b-1", "Removed", "8"), calendarGroup("b-2", "Removed", "5")]));
    ui.changes.mockResolvedValue(calendarBody("p-0", [calendarGroup("b-1", "Removed", "9")]));            // b-2 is gone; b-1 changed again
    const slow = deferred<unknown>();
    ui.calendarSeen.mockImplementation((_identity: string, request: { entityId: string }) => (request.entityId === "b-1" ? slow.promise : Promise.resolve(answer(false, "5"))));
    mountCalendar();
    const groups = await screen.findAllByTestId("unseen-popover-group");
    await userEvent.click(within(groups[0]).getByTestId("unseen-popover-mark-seen"));                      // b-1 at 8: stays on the wire
    await userEvent.click(within(groups[1]).getByTestId("unseen-popover-mark-seen"));                      // b-2: answered, the list is read again
    await waitFor(() => expect(ui.changes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1));
    await act(async () => slow.resolve(answer(false, "8")));                                               // the old answer for b-1 at 8, unread:false
    expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1);                                 // b-1 at 9 is still shown …
    expect(screen.getByTestId("unseen-popover-mark-seen").getAttribute("aria-disabled")).toBeNull();      // … and can be acknowledged
    await userEvent.click(screen.getByTestId("unseen-popover-mark-seen"));
    expect(ui.calendarSeen).toHaveBeenLastCalledWith("staff-a", expect.objectContaining({ entityId: "b-1", observedWatermark: "9" }));
  });

  it("an answer for Property A that arrives after Property B was chosen leaves B's list and groups alone", async () => {
    ui.changes.mockImplementation(async (_menu: string, propertyId: string) => calendarBody(propertyId, [calendarGroup("b-1", "Removed", "8")]));
    const wire = deferred<unknown>();
    ui.calendarSeen.mockReturnValue(wire.promise);
    mountCalendar();
    await userEvent.click(await screen.findByTestId("unseen-popover-mark-seen"));
    expect(ui.calendarSeen).toHaveBeenCalledWith("staff-a", expect.objectContaining({ propertyId: "p-0" }));
    await userEvent.selectOptions(screen.getByTestId("unseen-popover-property"), "p-1");
    await waitFor(() => expect(ui.changes).toHaveBeenCalledTimes(2));
    await screen.findAllByTestId("unseen-popover-group");
    await act(async () => wire.resolve(answer(false, "8")));
    expect(screen.getAllByTestId("unseen-popover-group")).toHaveLength(1);                                   // B's group with the same id and watermark is still there
    expect(screen.getByTestId("unseen-popover-mark-seen").getAttribute("aria-disabled")).toBeNull();
    expect(ui.changes).toHaveBeenCalledTimes(2);                                                             // and A's answer re-read nothing
  });
});

const popoverPanel = () => screen.getByTestId("unseen-popover");
