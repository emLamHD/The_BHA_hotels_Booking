/**
 * BHA-NEWSLETTER-LIVE-001: the Newsletter screen's reaction to "someone just verified". The connection is replaced by a recorder (`startNewsletterLive` is mocked; its own
 * behaviour is tested in lib/website/newsletterLive.test.ts), so each test plays the signals itself, against deferred list answers, and asserts what the API was asked and
 * what is on screen: a signal is only a prompt to read the SAME query again, and it must never touch a dialog, a hold, a stale row or a write.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  started: [] as Array<{ options: import("@/lib/website/newsletterLive").LiveOptions; controller: { retryNow: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  fetchStaffSession: vi.fn(),
  staffLogout: vi.fn(),
}));
vi.mock("@/lib/website/newsletterLive", () => ({
  startNewsletterLive: vi.fn((options: import("@/lib/website/newsletterLive").LiveOptions) => {
    const controller = { retryNow: vi.fn(), dispose: vi.fn() };
    live.started.push({ options, controller });
    return controller;
  }),
}));
vi.mock("@/lib/api/website", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/website")>()),
  listNewsletterSubscriptions: vi.fn(),
  createNewsletterSubscription: vi.fn(),
  updateNewsletterSubscription: vi.fn(),
  inviteNewsletterSubscription: vi.fn(),
  unsubscribeNewsletterSubscription: vi.fn(),
  archiveNewsletterSubscription: vi.fn(),
  restoreNewsletterSubscription: vi.fn(),
  deleteNewsletterSubscription: vi.fn(),
}));

import NewsletterSubscriptionsPanel from "./NewsletterSubscriptionsPanel";
import WebsiteAccessGate from "./WebsiteAccessGate";
import { LIVE_COALESCE_MS } from "./useNewsletterLive";
import { ALLOWED, deferred, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import {
  archiveNewsletterSubscription,
  createNewsletterSubscription,
  deleteNewsletterSubscription,
  inviteNewsletterSubscription,
  listNewsletterSubscriptions,
  restoreNewsletterSubscription,
  unsubscribeNewsletterSubscription,
  updateNewsletterSubscription,
  type NewsletterSubscription,
  type NewsletterSubscriptionPage,
} from "@/lib/api/website";

const list = vi.mocked(listNewsletterSubscriptions);
const invite = vi.mocked(inviteNewsletterSubscription);
const mutationMocks = [createNewsletterSubscription, updateNewsletterSubscription, inviteNewsletterSubscription, unsubscribeNewsletterSubscription, archiveNewsletterSubscription, restoreNewsletterSubscription, deleteNewsletterSubscription].map((fn) => vi.mocked(fn));

const row = (email: string, overrides: Partial<NewsletterSubscription> = {}): NewsletterSubscription => ({
  id: `id-${email}`, email, receivedAtUtc: "2026-11-16T04:00:00+00:00", source: "homepage", status: "PendingVerification", verifiedAtUtc: null,
  language: "vi", version: 4, unsubscribedAtUtc: null, archivedAtUtc: null, verificationMail: null, ...overrides,
});
const page = (items: NewsletterSubscription[], number = 1, total = items.length): NewsletterSubscriptionPage => ({ items, page: number, pageSize: 20, total });
const DEFAULT_QUERY = { search: "", status: "", scope: "active", page: 1, pageSize: 20, sort: "recent-activity" };

const buttonOf = (testId: string) => {
  const node = screen.getByTestId(testId);
  return (node.tagName === "BUTTON" ? node : within(node).getByRole("button")) as HTMLButtonElement;
};
const click = async (testId: string) => userEvent.click(buttonOf(testId));
const settle = (ms = LIVE_COALESCE_MS + 150) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const mutations = () => mutationMocks.reduce((sum, mock) => sum + mock.mock.calls.length, 0);
const rows = () => screen.queryAllByTestId(/^newsletter-row-/).map((node) => node.getAttribute("data-testid")!.replace("newsletter-row-", ""));
const reads = () => list.mock.calls.length;

/** The connection the screen has now: the last one started and not disposed. */
const connection = () => {
  const open = live.started.filter((entry) => !entry.controller.dispose.mock.calls.length);
  expect(open.length).toBeGreaterThan(0);
  return open[open.length - 1];
};
const signal = (eventId: string) => act(async () => { connection().options.handlers.onSignal({ eventId, occurredAtUtc: "2026-11-19T01:00:00+00:00" }); });
const ready = () => act(async () => { connection().options.handlers.onReady(); });

/** 25 rows over two pages, newest first, served by the (mocked) API like the real one would. */
const serverRows = (): NewsletterSubscription[] => Array.from({ length: 25 }, (_, index) => row(`r${String(index + 1).padStart(2, "0")}@example.com`));
let server: NewsletterSubscription[];
const serve = () =>
  list.mockImplementation(async (query) => ok(page(server.slice((query.page - 1) * 20, query.page * 20), query.page, server.length)) as never);

const open = async () => {
  serve();
  renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
  await screen.findByTestId("newsletter-row-r01@example.com");
};
const goToPage2 = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
  await screen.findByTestId("newsletter-row-r21@example.com");
};

beforeEach(() => {
  live.started.length = 0;
  server = serverRows();
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const mock of [list, ...mutationMocks]) mock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("page 1", () => {
  it("a signal shows a toast and reads the same query again: the row that was just verified leads, and nothing is sent", async () => {
    await open();
    expect(reads()).toBe(1);
    server = [row("new@example.com", { status: "Verified", verifiedAtUtc: "2026-11-19T01:00:00+00:00" }), ...server.slice(0, 24)];
    await signal("e1");
    await screen.findByTestId("newsletter-live-toast");
    expect(screen.getByTestId("newsletter-live-toast-text").textContent).toBe("Có đăng ký mới");
    await waitFor(() => expect(rows()[0]).toBe("new@example.com"));
    expect(reads()).toBe(2);
    expect(list).toHaveBeenLastCalledWith(DEFAULT_QUERY, expect.anything());
    expect(mutations()).toBe(0);
    expect(screen.queryByTestId("newsletter-live-banner")).toBeNull();                      // nothing is behind: the rows are on screen
  });

  it("keeps the typed search, the status and the scope: the same query is read again, and the server alone says which rows match", async () => {
    await open();
    await userEvent.type(screen.getByTestId("newsletter-search"), "gmail");
    await click("newsletter-search-submit");
    await userEvent.selectOptions(screen.getByTestId("newsletter-status-filter"), "Verified");
    await userEvent.selectOptions(screen.getByTestId("newsletter-scope-filter"), "all");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ search: "gmail", status: "Verified", scope: "all", page: 1, pageSize: 20, sort: "recent-activity" }, expect.anything()));
    const before = reads();
    await userEvent.type(screen.getByTestId("newsletter-search"), "x");                      // typed but not submitted: it must survive the refresh
    list.mockImplementation(async () => ok(page([])) as never);                              // the new row does not match this filter
    await signal("e1");
    await settle();
    expect(reads()).toBe(before + 1);
    expect(list).toHaveBeenLastCalledWith({ search: "gmail", status: "Verified", scope: "all", page: 1, pageSize: 20, sort: "recent-activity" }, expect.anything());
    expect((screen.getByTestId("newsletter-search") as HTMLInputElement).value).toBe("gmailx");
    expect((screen.getByTestId("newsletter-status-filter") as HTMLSelectElement).value).toBe("Verified");
    expect((screen.getByTestId("newsletter-scope-filter") as HTMLSelectElement).value).toBe("all");
    expect(screen.getByTestId("newsletter-empty").textContent).toContain("Không có đăng ký nào khớp");   // not inserted, and no filter cleared to show it
  });

  it("a burst is ONE toast and ONE read; a repeated event id counts once, also after a reconnect", async () => {
    await open();
    await signal("e1");
    await signal("e1");
    await signal("e2");
    await settle();
    expect(screen.getAllByTestId("newsletter-live-toast")).toHaveLength(1);
    expect(screen.getByTestId("newsletter-live-toast-text").textContent).toBe("Có 2 đăng ký mới");
    expect(reads()).toBe(2);
    await dismissToast();
    await signal("e1");                                                                       // the same verification delivered again
    await signal("e2");
    await settle();
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();
    expect(reads()).toBe(2);
  });

  it("a signal during the first load is not lost, and an older answer that arrives late never covers the newer one", async () => {
    const first = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce(() => first.promise as never);
    list.mockImplementation(async () => ok(page([row("fresh@example.com", { status: "Verified", verifiedAtUtc: "2026-11-19T01:00:00+00:00" })])) as never);
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await waitFor(() => expect(reads()).toBe(1));
    await signal("e1");
    await settle();
    await screen.findByTestId("newsletter-row-fresh@example.com");
    expect(reads()).toBe(2);
    await act(async () => { first.resolve(ok(page([row("stale@example.com")]))); });
    await settle(50);
    expect(rows()).toEqual(["fresh@example.com"]);
  });

  it("the live read is never started while the previous live read is still out: what came meanwhile is read once afterwards", async () => {
    await open();
    const slow = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce(() => slow.promise as never);
    await signal("e1");
    await settle();
    expect(reads()).toBe(2);
    await signal("e2");
    await settle();
    expect(reads()).toBe(2);                                                                  // not a second concurrent request
    await act(async () => { slow.resolve(ok(page(server.slice(0, 20)))); });
    await settle(50);
    expect(reads()).toBe(3);                                                                  // exactly one more, for e2
  });
});

describe("page 2 and later", () => {
  it("keeps the rows being read, offers the way to the new ones, and goes to page 1 with the same filters only when asked", async () => {
    await open();
    await goToPage2();
    const before = reads();
    const visible = rows();
    await signal("e1");
    await screen.findByTestId("newsletter-live-toast");
    expect(reads()).toBe(before);                                                             // nothing was read, nothing moved
    expect(rows()).toEqual(visible);
    expect(screen.getByTestId("newsletter-live-toast-view")).toBeTruthy();
    expect(screen.getByTestId("newsletter-live-banner-text").textContent).toContain("giữ nguyên");

    await userEvent.click(screen.getByTestId("newsletter-live-toast-view"));
    await screen.findByTestId("newsletter-row-r01@example.com");
    expect(list).toHaveBeenLastCalledWith(DEFAULT_QUERY, expect.anything());
    expect(screen.queryByTestId("newsletter-live-banner")).toBeNull();
    expect(mutations()).toBe(0);
  });

  it("the way to the new rows is still there after the toast has gone, and the button keeps the search and the filters", async () => {
    await open();
    await userEvent.selectOptions(screen.getByTestId("newsletter-scope-filter"), "all");
    await goToPage2();
    await signal("e1");
    await screen.findByTestId("newsletter-live-toast");
    await dismissToast();
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();
    expect(screen.getByTestId("newsletter-live-view")).toBeTruthy();
    await click("newsletter-live-view");
    await screen.findByTestId("newsletter-row-r01@example.com");
    expect(list).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, scope: "all" }, expect.anything());
    expect((screen.getByTestId("newsletter-scope-filter") as HTMLSelectElement).value).toBe("all");
  });

  it("Staff reaching page 1 by themselves clears the notice (that page is read fresh)", async () => {
    await open();
    await goToPage2();
    await signal("e1");
    await screen.findByTestId("newsletter-live-banner");
    await userEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    await screen.findByTestId("newsletter-row-r01@example.com");
    expect(screen.queryByTestId("newsletter-live-banner")).toBeNull();
  });
});

describe("the connection became ready (first start, reconnect)", () => {
  it("on page 1 it reads the query again without announcing anything", async () => {
    await open();
    server = [row("missed@example.com", { status: "Verified", verifiedAtUtc: "2026-11-19T01:00:00+00:00" }), ...server.slice(0, 24)];
    await ready();
    await settle(50);
    await waitFor(() => expect(rows()[0]).toBe("missed@example.com"));
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();                       // no toast replays for data Staff may already have seen
    expect(reads()).toBe(2);
    await settle(50);
  });

  it("on page 2 it keeps the snapshot and says the connection may have missed something, with the way to page 1", async () => {
    await open();
    await goToPage2();
    const before = reads();
    await ready();
    expect(reads()).toBe(before);
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();
    expect(screen.getByTestId("newsletter-live-banner-text").textContent).toContain("có thể có đăng ký mới");
    await click("newsletter-live-view");
    await screen.findByTestId("newsletter-row-r01@example.com");
  });
});

describe("something is in progress: the update waits, nothing of Staff's is touched", () => {
  it("an open dialog keeps its draft, nothing is read, and the read happens when it closes", async () => {
    await open();
    await click("newsletter-add");
    await userEvent.type(await screen.findByTestId("newsletter-add-email"), "draft@example.com");
    await signal("e1");
    await settle();
    expect(reads()).toBe(1);
    expect((screen.getByTestId("newsletter-add-email") as HTMLInputElement).value).toBe("draft@example.com");
    expect(screen.getByTestId("newsletter-add-dialog")).toBeTruthy();
    expect(screen.getByTestId("newsletter-live-banner-text").textContent).toContain("xong thao tác");
    expect(screen.queryByTestId("newsletter-live-view")).toBeNull();                         // not a button to press while something is open

    await click("newsletter-add-cancel");
    await waitFor(() => expect(reads()).toBe(2));
    expect(screen.queryByTestId("newsletter-live-banner")).toBeNull();
    expect(mutations()).toBe(0);
  });

  it("a callback taken before the dialog was opened still sees it (the state is read from refs, not from that render)", async () => {
    await open();
    const early = connection().options.handlers;                                              // the closure of the very first render
    await click("newsletter-add");
    await screen.findByTestId("newsletter-add-dialog");
    act(() => early.onSignal({ eventId: "late-callback", occurredAtUtc: "" }));
    await settle();
    expect(reads()).toBe(1);
    await click("newsletter-add-cancel");
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("in the same tick as the click that opens a dialog or starts a write, the update already waits (before any re-render)", async () => {
    await open();
    act(() => {
      buttonOf("newsletter-add").click();
      connection().options.handlers.onReady();
    });
    await screen.findByTestId("newsletter-add-dialog");
    expect(reads()).toBe(1);
    await click("newsletter-add-cancel");
    await waitFor(() => expect(reads()).toBe(2));

    const wire = deferred<ReturnType<typeof ok>>();
    invite.mockImplementationOnce(() => wire.promise as never);
    act(() => {
      buttonOf("newsletter-invite-r01@example.com").click();
      connection().options.handlers.onReady();
    });
    await settle();
    expect(invite).toHaveBeenCalledTimes(1);
    expect(reads()).toBe(2);                                                                  // the write is on the wire: no read now
    await act(async () => { wire.resolve(ok({ status: "cooldown", retryAfterSeconds: 30, subscription: row("r01@example.com") })); });
    await waitFor(() => expect(reads()).toBeGreaterThan(2));
    expect(invite).toHaveBeenCalledTimes(1);
  });

  it("a write in flight: no read until it has ended, and the live update does not repeat or replace the write's own read", async () => {
    await open();
    const wire = deferred<ReturnType<typeof ok>>();
    invite.mockImplementationOnce(() => wire.promise as never);
    await click("newsletter-invite-r01@example.com");
    await signal("e1");
    await settle();
    expect(reads()).toBe(1);
    expect(screen.getByTestId("newsletter-live-banner-text").textContent).toContain("xong thao tác");
    await act(async () => { wire.resolve(ok({ status: "queued", retryAfterSeconds: null, subscription: row("r01@example.com") })); });
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(2));
    await settle(100);
    expect(invite).toHaveBeenCalledTimes(1);
    expect(mutations()).toBe(1);                                                              // only Staff's own invitation
    expect(screen.queryByTestId("newsletter-live-banner")).toBeNull();
  });

  it("a write whose answer is unknown keeps its hold through the signal; only Staff's own recovery lifts it, and then the waiting update is read", async () => {
    await open();
    invite.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời" } as never);
    await click("newsletter-invite-r01@example.com");
    await screen.findByTestId("newsletter-write-unverified");
    await signal("e1");
    await settle();
    expect(reads()).toBe(1);                                                                  // not read: the hold is not a quiet state
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();
    expect(buttonOf("newsletter-add").disabled).toBe(true);                                   // still held
    expect(buttonOf("newsletter-invite-r02@example.com").disabled).toBe(true);
    expect(screen.getByTestId("newsletter-live-banner-text").textContent).toContain("xong thao tác");

    await click("newsletter-reconcile");                                                      // Staff's explicit recovery
    await waitFor(() => expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull());
    await waitFor(() => expect(reads()).toBe(3));                                             // the recovery read, then the waiting update
    expect(buttonOf("newsletter-add").disabled).toBe(false);
    expect(invite).toHaveBeenCalledTimes(1);                                                  // nothing was sent again by itself
  });

  it("a stale row stays locked through the signal; the explicit reload frees it, then the waiting update is read", async () => {
    await open();
    invite.mockResolvedValueOnce({ kind: "refused", status: 409, code: "newsletter-version-conflict", field: null, detail: "stale" } as never);
    await click("newsletter-invite-r01@example.com");
    await screen.findByTestId("newsletter-stale");
    await signal("e1");
    await settle();
    expect(reads()).toBe(1);
    expect(screen.getByTestId("newsletter-stale")).toBeTruthy();
    expect(buttonOf("newsletter-invite-r01@example.com").disabled).toBe(true);
    await click("newsletter-stale-reload");
    await waitFor(() => expect(screen.queryByTestId("newsletter-stale")).toBeNull());
    await waitFor(() => expect(reads()).toBe(3));
    expect(buttonOf("newsletter-invite-r01@example.com").disabled).toBe(false);
    expect(invite).toHaveBeenCalledTimes(1);
  });

  it("a recovery read that is out is never replaced by a live read; when it ends the waiting update is read", async () => {
    await open();
    invite.mockResolvedValueOnce({ kind: "refused", status: 409, code: "newsletter-version-conflict", field: null, detail: "stale" } as never);
    await click("newsletter-invite-r01@example.com");
    await screen.findByTestId("newsletter-stale");
    const recovery = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce(() => recovery.promise as never);
    await click("newsletter-stale-reload");
    await waitFor(() => expect(reads()).toBe(2));
    await signal("e1");
    await settle();
    expect(reads()).toBe(2);                                                                  // the recovery read is still the only one out
    await act(async () => { recovery.resolve(ok(page(server.slice(0, 20)))); });
    await waitFor(() => expect(screen.queryByTestId("newsletter-stale")).toBeNull());         // the recovery succeeded as if nothing had happened
    await waitFor(() => expect(reads()).toBe(3));
  });

  it("an answer to an older query never covers the answer to the one now on screen", async () => {
    await open();
    const old = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce(() => old.promise as never);
    await signal("e1");
    await settle();
    expect(reads()).toBe(2);                                                                  // the live read of the default query is out
    list.mockImplementation(async (query) => ok(page(query.status === "Verified" ? [row("verified-only@example.com", { status: "Verified", verifiedAtUtc: "2026-11-19T00:00:00+00:00" })] : server.slice(0, 20))) as never);
    await userEvent.selectOptions(screen.getByTestId("newsletter-status-filter"), "Verified");
    await screen.findByTestId("newsletter-row-verified-only@example.com");
    await act(async () => { old.resolve(ok(page([row("old-query@example.com")]))); });
    await settle(50);
    expect(rows()).toEqual(["verified-only@example.com"]);
  });
});

describe("the connection's own lifecycle", () => {
  it("is closed when the screen goes away, and Strict Mode leaves exactly one connection with exactly one toast per signal", async () => {
    serve();
    const { unmount } = render(<React.StrictMode><WebsiteAccessGate returnTo="/website/newsletter"><NewsletterSubscriptionsPanel /></WebsiteAccessGate></React.StrictMode>);
    await screen.findByTestId("newsletter-row-r01@example.com");
    const open = live.started.filter((entry) => !entry.controller.dispose.mock.calls.length);
    expect(open).toHaveLength(1);
    expect(live.started.length - open.length).toBe(live.started.length - 1);                // every earlier one was disposed
    await signal("e1");
    await settle();
    expect(screen.getAllByTestId("newsletter-live-toast")).toHaveLength(1);
    unmount();
    expect(live.started.every((entry) => entry.controller.dispose.mock.calls.length > 0)).toBe(true);
  });

  it("a 401 on the connection ends the session the way a 401 on a read does", async () => {
    await open();
    act(() => connection().options.handlers.onUnauthenticated());
    expect((await screen.findByTestId("staff-session-required")).textContent).toContain("Phiên đăng nhập Staff của bạn đã kết thúc");
    expect(screen.queryByTestId("newsletter-table")).toBeNull();
    expect(live.started.every((entry) => entry.controller.dispose.mock.calls.length > 0)).toBe(true);   // the screen is gone, so is the connection
  });

  it("a 403 on the connection makes the gate read `me` again (the permission may be gone); it does not sign anyone out by itself", async () => {
    await open();
    const checks = vi.mocked(fetchStaffSession).mock.calls.length;
    act(() => connection().options.handlers.onDenied());
    await waitFor(() => expect(vi.mocked(fetchStaffSession).mock.calls.length).toBe(checks + 1));
    expect(screen.queryByTestId("staff-session-required")).toBeNull();
  });

  it("a lost connection is a short message with a way to retry, never a sign-out, and the list keeps working", async () => {
    await open();
    expect(screen.getByTestId("newsletter-live-status").getAttribute("data-status")).toBe("connecting");
    act(() => connection().options.handlers.onStatus("connected"));
    expect(screen.getByTestId("newsletter-live-status").getAttribute("data-status")).toBe("connected");
    expect(screen.queryByTestId("newsletter-live-retry")).toBeNull();
    act(() => connection().options.handlers.onStatus("retrying"));
    expect(screen.getByTestId("newsletter-live-status").textContent).toContain("Mất kết nối");
    expect(screen.queryByTestId("staff-session-required")).toBeNull();
    expect(screen.getByTestId("newsletter-table")).toBeTruthy();
    await click("newsletter-live-retry");
    expect(connection().controller.retryNow).toHaveBeenCalledTimes(1);
    act(() => connection().options.handlers.onStatus("stopped", "denied"));
    expect(screen.getByTestId("newsletter-live-status").textContent).toContain("từ chối");
  });
});

describe("the toast", () => {
  it("is a polite status message that takes no focus, can be closed, and goes away by itself", async () => {
    await open();
    const focusBefore = document.activeElement;
    await signal("e1");
    await settle();
    const toast = await screen.findByTestId("newsletter-live-toast");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(focusBefore);
    await dismissToast();
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();

    vi.useFakeTimers();
    act(() => connection().options.handlers.onSignal({ eventId: "e2", occurredAtUtc: "" }));
    act(() => { vi.advanceTimersByTime(LIVE_COALESCE_MS); });
    expect(screen.getByTestId("newsletter-live-toast")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();
    vi.useRealTimers();
    await settle(50);
  });
});

const dismissToast = async () => {
  fireEvent.click(screen.getByTestId("newsletter-live-toast-close"));
  await waitFor(() => expect(screen.queryByTestId("newsletter-live-toast")).toBeNull());
};
