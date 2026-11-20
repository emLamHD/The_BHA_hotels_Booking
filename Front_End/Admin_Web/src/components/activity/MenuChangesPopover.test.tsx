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
}));

vi.mock("@/components/website/NewsletterBadgeProvider", () => ({ useMenuUnseen: () => ui.menus, useUnseenScope: () => ui.scope }));
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
