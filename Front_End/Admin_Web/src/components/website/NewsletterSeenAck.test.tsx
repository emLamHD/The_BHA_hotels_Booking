/**
 * BHA-NEWSLETTER-BADGE-001: the Newsletter screen says "seen" only with the watermark of a list that answered for the query on screen, through the shell's provider. These tests run the
 * real screen, gate, provider and shared session; the API client and the connection are replaced, and every answer is deferred or scripted by the test.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  inviteNewsletterSubscription: vi.fn(),
}));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(),
  markNewsletterSeen: vi.fn(),
}));

import NewsletterSubscriptionsPanel from "./NewsletterSubscriptionsPanel";
import WebsiteAccessGate from "./WebsiteAccessGate";
import { MenuUnseenProvider, useMenuUnseen } from "./NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { LIVE_COALESCE_MS } from "./useNewsletterLive";
import { ALLOWED, deferred, ok } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markNewsletterSeen, type MenuUnseenEntry } from "@/lib/api/menuUnseen";
import {
  inviteNewsletterSubscription,
  listNewsletterSubscriptions,
  type NewsletterSubscription,
  type NewsletterSubscriptionPage,
} from "@/lib/api/website";

const list = vi.mocked(listNewsletterSubscriptions);
const invite = vi.mocked(inviteNewsletterSubscription);
const getCount = vi.mocked(fetchMenuUnseenSummary);
const postSeen = vi.mocked(markNewsletterSeen);

const row = (email: string, overrides: Partial<NewsletterSubscription> = {}): NewsletterSubscription => ({
  id: `id-${email}`, email, receivedAtUtc: "2026-11-16T04:00:00+00:00", source: "homepage", status: "PendingVerification", verifiedAtUtc: null,
  language: "vi", version: 4, unsubscribedAtUtc: null, archivedAtUtc: null, verificationMail: null, ...overrides,
});
const page = (items: NewsletterSubscription[], number: number, total: number, viewWatermark?: string): NewsletterSubscriptionPage =>
  ({ items, page: number, pageSize: 20, total, ...(viewWatermark === undefined ? {} : { viewWatermark }) });
const entry = (count: number, last: string, current: string): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
/** `GET menu-unseen` for a Staff member who may read the Newsletter; `POST …/newsletter/seen` answers the bare entry. */
const answer = (value: MenuUnseenEntry) => ({ kind: "ok", data: { newsletter: value } }) as never;
const seen = (value: MenuUnseenEntry) => ({ kind: "ok", data: value }) as never;

const settle = (ms = LIVE_COALESCE_MS + 200) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const rowsOf = () => screen.queryAllByTestId(/^newsletter-row-/).map((node) => node.getAttribute("data-testid")!.replace("newsletter-row-", ""));
const buttonOf = (testId: string) => {
  const node = screen.getByTestId(testId);
  return (node.tagName === "BUTTON" ? node : within(node).getByRole("button")) as HTMLButtonElement;
};
const click = async (testId: string) => userEvent.click(buttonOf(testId));
const badge = () => screen.getByTestId("badge").textContent;
const openOf = (kind: "legacy" | "activity") =>
  live.started.filter((started) => !started.controller.dispose.mock.calls.length && (kind === "activity") === (started.options.events !== undefined));
// BHA-ADMIN-BADGE-001-PR14: the shell's shared activity Hub is the only connection; a hint for the Newsletter menu is what the screen hears (it carries no id: `_id` only labels the call site).
const connection = () => openOf("activity").at(-1)!;
const signal = (_id?: string) => { void _id; return act(async () => { connection().options.handlers.onSignal({ eventId: "", occurredAtUtc: "", menuKey: "newsletter" }); }); };

let server: NewsletterSubscription[];
let watermark: string | undefined;
const serve = () => list.mockImplementation(async (query) => ok(page(server.slice((query.page - 1) * 20, query.page * 20), query.page, server.length, watermark)) as never);

let staffSession: ReturnType<typeof useStaffSession> | null = null;
function SessionProbe() {
  const value = useStaffSession();
  React.useEffect(() => {
    staffSession = value;
  });
  return null;
}

function Badge() {
  return <span data-testid="badge">{useMenuUnseen().newsletter?.count ?? 0}</span>;
}
const mount = (strict = false) => {
  const tree = (
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Badge />
        <SessionProbe />
        <WebsiteAccessGate returnTo="/website/newsletter">
          <NewsletterSubscriptionsPanel />
        </WebsiteAccessGate>
      </MenuUnseenProvider>
    </StaffSessionProvider>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
};
const open = async () => {
  serve();
  mount();
  await screen.findByTestId("newsletter-row-r01@example.com");
};

beforeEach(() => {
  live.started.length = 0;
  server = Array.from({ length: 25 }, (_, index) => row(`r${String(index + 1).padStart(2, "0")}@example.com`));
  watermark = "7";
  for (const mock of [list, invite, getCount, postSeen]) mock.mockReset();
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  getCount.mockResolvedValue(answer(entry(3, "0", "10")));
  // The server moves the cursor to what it was given and counts what is after it.
  postSeen.mockImplementation(async (mark) => seen(entry(3, mark, "10")));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("saying 'seen' after the list answered", () => {
  it("sends the watermark of THAT list, once, and not the newest the count knows; an activity after it stays counted", async () => {
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    expect(postSeen.mock.calls[0][0]).toBe("7");                                              // the list's, not the count's "10"
    await waitFor(() => expect(badge()).toBe("3"));                                           // 3 after "7": the three newer ones are still unseen
    expect(getCount).toHaveBeenCalledTimes(1);
  });

  it("is not said before the list has answered, and not at all when it fails (401/403/500 or an unreadable answer): the badge keeps its number", async () => {
    list.mockResolvedValue({ kind: "error", status: 500, message: "down" } as never);
    mount();
    await screen.findByTestId("newsletter-table").catch(() => undefined);
    await settle(200);
    expect(postSeen).not.toHaveBeenCalled();
    await waitFor(() => expect(badge()).toBe("3"));
  });

  it("a list that carries no watermark (an older server) says nothing", async () => {
    watermark = undefined;
    await open();
    await settle(200);
    expect(postSeen).not.toHaveBeenCalled();
  });

  it("an answer to an older query (superseded) says nothing; the answer to the query on screen does", async () => {
    const old = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce(() => old.promise as never);
    mount();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    watermark = "9";
    serve();
    await userEvent.selectOptions(await screen.findByTestId("newsletter-status-filter"), "PendingVerification");     // a newer query supersedes the first
    await screen.findByTestId("newsletter-row-r01@example.com");
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    expect(postSeen.mock.calls[0][0]).toBe("9");
    await act(async () => { old.resolve(ok(page(server.slice(0, 20), 1, 25, "5"))); });        // the old one arrives late
    await settle(200);
    expect(postSeen.mock.calls.map((call) => call[0])).toEqual(["9"]);
  });

  it("the page does not narrow it: page 2 and a filter say the menu's watermark, and an older one never goes back", async () => {
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByTestId("newsletter-row-r21@example.com");
    await settle(200);
    expect(postSeen).toHaveBeenCalledTimes(1);                                                // the same watermark: nothing new to say
  });

  it("on page 2 a signal moves nothing and says nothing new: the rows stay, the badge shows the server's new count", async () => {
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByTestId("newsletter-row-r21@example.com");
    const reads = list.mock.calls.length;
    const posts = postSeen.mock.calls.length;
    getCount.mockResolvedValue(answer(entry(4, "7", "11")));
    await signal("e1");
    await settle(LIVE_COALESCE_MS + 600);
    expect(list.mock.calls.length).toBe(reads);                                               // frozen page: nothing read
    expect(postSeen.mock.calls.length).toBe(posts);                                           // and nothing "seen" because of a signal
    expect(rowsOf()[0]).toBe("r21@example.com");
    await waitFor(() => expect(badge()).toBe("4"));
    expect(screen.getByTestId("newsletter-live-banner")).toBeTruthy();
  });

  it("while a dialog is open the live read waits and so does the acknowledgement; they happen when it closes", async () => {
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    await click("newsletter-add");
    await screen.findByTestId("newsletter-add-dialog");
    watermark = "8";
    await signal("e1");
    await settle(LIVE_COALESCE_MS + 400);
    expect(postSeen).toHaveBeenCalledTimes(1);
    await click("newsletter-add-cancel");
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(2));
    expect(postSeen.mock.calls[1][0]).toBe("8");
  });

  it("a hold is not lifted by the acknowledgement: only Staff's recovery read lifts it, and that read's watermark is said", async () => {
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    invite.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời" } as never);
    await click("newsletter-invite-r01@example.com");
    await screen.findByTestId("newsletter-write-unverified");
    await signal("e1");
    await settle(LIVE_COALESCE_MS + 400);
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();                   // still held: nothing read, nothing said
    expect(postSeen).toHaveBeenCalledTimes(1);

    watermark = "8";
    await click("newsletter-reconcile");
    await waitFor(() => expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull());
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(2));
    expect(postSeen.mock.calls[1][0]).toBe("8");
    expect(invite).toHaveBeenCalledTimes(1);                                                  // nothing was sent again by itself
  });

  it("a failing acknowledgement never locks the screen: rows, dialogs and the invitation all work", async () => {
    postSeen.mockResolvedValue({ kind: "network", message: "offline" } as never);
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalled());
    expect(buttonOf("newsletter-add").disabled).toBe(false);
    expect(buttonOf("newsletter-edit-r01@example.com").disabled).toBe(false);
    invite.mockResolvedValueOnce({ kind: "ok", data: { status: "queued", retryAfterSeconds: null, subscription: row("r01@example.com") } } as never);
    await click("newsletter-invite-r01@example.com");
    await waitFor(() => expect(invite).toHaveBeenCalledTimes(1));
    await click("newsletter-add");
    expect(await screen.findByTestId("newsletter-add-dialog")).toBeTruthy();
  });
});

describe("a Staff identity change while the screen stays mounted", () => {
  it("never says the previous Staff member's list watermark under the new identity (the screen's effect runs before the shell's)", async () => {
    // A's acknowledgement is refused, so the shell's known watermark stays below "7": only the identity check can stop the next one.
    postSeen.mockResolvedValue({ kind: "refused", status: 400, code: "menu-unseen-watermark-invalid", field: "viewWatermark", detail: "x" } as never);
    await open();
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    expect(postSeen.mock.calls[0][0]).toBe("7");
    const forB = deferred<ReturnType<typeof ok>>();
    list.mockImplementation(() => forB.promise as never);                                      // B's own list has not answered yet
    const other = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: other });
    await act(async () => { await staffSession!.refresh(); });
    await settle(300);
    expect(postSeen).toHaveBeenCalledTimes(1);                                                 // nothing was said for B from A's list
    await act(async () => { forB.resolve(ok(page(server.slice(0, 20), 1, 25, "9"))); });      // B's own list says its own watermark
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(2));
    expect(postSeen.mock.calls[1][0]).toBe("9");
  });
});

describe("one source, one connection", () => {
  it("the shell and the screen use ONE connection and ONE count request source, also under Strict Mode", async () => {
    serve();
    mount(true);
    await screen.findByTestId("newsletter-row-r01@example.com");
    expect(openOf("legacy")).toHaveLength(0);                                                 // the legacy Newsletter Hub is never opened by this build
    expect(openOf("activity")).toHaveLength(1);                                               // the screen shares the shell's one shared Hub
    await signal("e1");
    await screen.findByTestId("newsletter-live-toast");
    expect(screen.getAllByTestId("newsletter-live-toast")).toHaveLength(1);
  });

  it("C1: from the shared Hub through the provider to the panel, a burst is one notice and exactly ONE list reload, and a later burst is one more", async () => {
    await open();
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    const reads = list.mock.calls.length;
    vi.useFakeTimers();
    await signal();
    await advance(150);
    await signal();
    await advance(140);
    await signal();                                                                           // three hints inside the window opened by the first
    await advance(5);
    expect(list.mock.calls.length).toBe(reads);                                               // the window (300 ms from the first hint) has not ended
    expect(screen.queryByTestId("newsletter-live-toast")).toBeNull();
    await advance(10);
    expect(list.mock.calls.length).toBe(reads + 1);                                           // ONE reload for the whole burst
    expect(screen.getAllByTestId("newsletter-live-toast")).toHaveLength(1);
    expect(screen.getByTestId("newsletter-live-toast-text").textContent).toBe("Có thay đổi đăng ký");
    await advance(3000);
    expect(list.mock.calls.length).toBe(reads + 1);
    await signal();
    await advance(301);
    expect(list.mock.calls.length).toBe(reads + 2);                                           // the next burst, one more
    expect(screen.getAllByTestId("newsletter-live-toast")).toHaveLength(1);
  });
});
