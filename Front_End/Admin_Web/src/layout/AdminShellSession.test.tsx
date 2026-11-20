/**
 * BHA-ADMIN-BADGE-001-PR04-C1: ONE Staff session for the Admin shell and for every Staff page gate under it. The real shell (`AdminStaffScope`: session + unseen provider) is rendered
 * with a real gate nested inside — the Website gate with a rule of its own (Blog, Promotions) and the Calendar gate — and only the network is replaced. Through the page's own Sign out
 * button: the sidebar's numbers go and both live connections stop; a different Staff member then sees only their own numbers; and what the first one left on the wire (a late GET, an
 * acknowledgement) can neither show a number nor end the second one's session.
 */
import React, { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  started: [] as Array<{ options: import("@/lib/website/newsletterLive").LiveOptions; controller: { retryNow: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
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
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(),
  markNewsletterSeen: vi.fn(),
}));
vi.mock("@/components/calendar/reservation-board/ReservationBoard", () => ({ default: () => <div data-testid="board" /> }));

import AdminStaffScope from "./AdminStaffScope";
import WebsiteAccessGate, { type GateRule } from "@/components/website/WebsiteAccessGate";
import CalendarAccessGate from "@/components/calendar/reservation-board/CalendarAccessGate";
import { BADGE_COALESCE_MS, useMenuUnseen, useSharedNewsletterLive } from "@/components/website/NewsletterBadgeProvider";
import { useStaffSession } from "@/components/auth/StaffSession";
import { ALLOWED, deferred } from "@/components/website/websiteTestUtils";
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markNewsletterSeen, type MenuUnseenEntry } from "@/lib/api/menuUnseen";

const getCount = vi.mocked(fetchMenuUnseenSummary);
const postSeen = vi.mocked(markNewsletterSeen);
const A = ALLOWED;
const B = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };

const entry = (count: number, last: string, current: string): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
const summary = (count: number, current: string) => ({ kind: "ok", data: { "blog-posts": entry(count, "0", current) } }) as never;

let session: ReturnType<typeof useStaffSession> | null = null;
let shared: ReturnType<typeof useSharedNewsletterLive> = null;
/** What the sidebar would show, read from the same provider the real sidebar reads. */
function Sidebar() {
  const unseen = useMenuUnseen();
  const sessionValue = useStaffSession();
  const sharedValue = useSharedNewsletterLive();
  useEffect(() => {
    session = sessionValue;
    shared = sharedValue;
  });
  return <span data-testid="badge">{unseen["blog-posts"]?.count ?? 0}</span>;
}

const own: GateRule = { isAllowed: () => true, noPermission: "no", signInPrompt: "sign in" };
const GATES: Array<[string, () => React.ReactNode, string]> = [
  ["a Website gate with a rule of its own (Blog, Promotions)", () => <WebsiteAccessGate returnTo="/website/blog/posts" rule={own}><p data-testid="page" /></WebsiteAccessGate>, "Đăng xuất"],
  ["the Calendar gate", () => <CalendarAccessGate />, "Sign out"],
];

const openOf = (kind: "legacy" | "activity") =>
  live.started.filter((started) => !started.controller.dispose.mock.calls.length && (kind === "activity") === (started.options.events !== undefined));
const badge = () => screen.getByTestId("badge").textContent;
const flush = (ms = BADGE_COALESCE_MS + 100) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  live.started.length = 0;
  session = null;
  shared = null;
  getCount.mockReset();
  postSeen.mockReset();
  vi.mocked(fetchStaffSession).mockReset();
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: A });
  vi.mocked(staffLogout).mockReset();
  vi.mocked(staffLogout).mockResolvedValue({ kind: "logged-out" });
  getCount.mockResolvedValue(summary(5, "5"));
});
afterEach(cleanup);

describe.each(GATES)("%s, under the real Admin shell", (_name, gate, signOutLabel) => {
  const mount = () => render(<AdminStaffScope><Sidebar />{gate()}</AdminStaffScope>);
  const signOutFromPage = async () => {
    fireEvent.click(await screen.findByRole("button", { name: signOutLabel }));
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
  };

  it("shares the shell's session: one `me` check serves the sidebar and the page", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("5"));
    await screen.findByRole("button", { name: signOutLabel });
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(1);
  });

  it("Sign out from the page ends the shell's session: the number is gone at once, both live connections stop, and nothing is asked afterwards", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      await vi.waitFor(() => expect(badge()).toBe("5"));
      expect(openOf("legacy")).toHaveLength(1);
      expect(openOf("activity")).toHaveLength(1);
      await signOutFromPage();
      expect(badge()).toBe("0");
      expect(openOf("legacy")).toHaveLength(0);
      expect(openOf("activity")).toHaveLength(0);
      const calls = getCount.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });                 // no poll, no timer of the old session is left
      expect(getCount.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a session that the page finds expired (a 401) ends the shell's too: the number goes, the connections stop", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("5"));
    act(() => session!.expire());                                                              // what a gate does when one of its calls answers 401
    expect(badge()).toBe("0");
    expect(openOf("legacy")).toHaveLength(0);
    expect(openOf("activity")).toHaveLength(0);
  });

  it("another Staff member after the sign-out sees only their own numbers; the first one's late GET and late acknowledgement can neither show a number nor end the second one's session", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("5"));
    const lateGet = deferred<ReturnType<typeof summary>>();
    getCount.mockImplementationOnce(() => lateGet.promise as never);
    await act(async () => { openOf("legacy")[0].options.handlers.onReady(); });
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));
    const lateAck = deferred<unknown>();
    postSeen.mockImplementationOnce(() => lateAck.promise as never);
    await act(async () => { shared!.ack("5", A.staffAccountId); });
    await vi.waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));

    await signOutFromPage();
    expect(badge()).toBe("0");

    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: B });
    getCount.mockResolvedValue(summary(7, "7"));
    await act(async () => { session!.retry(); });
    await waitFor(() => expect(badge()).toBe("7"));
    expect(openOf("legacy")).toHaveLength(1);
    expect(openOf("activity")).toHaveLength(1);

    await act(async () => { lateGet.resolve(summary(99, "99")); });
    await act(async () => { lateAck.resolve({ kind: "unauthenticated" }); });
    await flush(50);
    expect(badge()).toBe("7");
    expect(session!.state.status).toBe("authenticated");
    expect(openOf("legacy")).toHaveLength(1);
    expect(openOf("activity")).toHaveLength(1);
  });
});
