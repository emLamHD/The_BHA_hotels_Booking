/**
 * BHA-NEWSLETTER-BADGE-001: the shell's unseen count and the one live connection behind it. The API client and the connection are replaced (the connection by a recorder), so each
 * test plays the answers itself, deferred, and asserts what was asked and what is shown: the number is the API's, never counted from signals; "seen" is said with the watermark a
 * list carried, never optimistically; an answer older than one already applied never wins; and a changed Staff identity, a sign-out or an unmount leave nothing alive.
 */
import React, { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  started: [] as Array<{ options: import("@/lib/website/newsletterLive").LiveOptions; controller: { retryNow: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } }>,
}));
/** What the sidebar is told about itself (the real sidebar is rendered in the C1 tests, with this state). */
const sidebar = vi.hoisted(() => ({ state: { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => sidebar.state }));
vi.mock("@/layout/SidebarWidget", () => ({ default: () => null }));
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
  fetchMenuUnseen: vi.fn(),
  markNewsletterSeen: vi.fn(),
}));

import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import WebsiteAccessGate from "./WebsiteAccessGate";
import AppSidebar from "@/layout/AppSidebar";
import { ACK_RETRY_MS, BADGE_COALESCE_MS, BADGE_POLL_MS, NewsletterBadgeProvider, useMenuUnseen, useNewsletterLiveFeed, useSharedNewsletterLive } from "./NewsletterBadgeProvider";
import { ALLOWED, WITHOUT_PERMISSION, deferred } from "./websiteTestUtils";
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { fetchMenuUnseen, markNewsletterSeen, type MenuUnseenEntry } from "@/lib/api/website";

const getCount = vi.mocked(fetchMenuUnseen);
const postSeen = vi.mocked(markNewsletterSeen);

const entry = (count: number, last: string, current: string): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
const answer = (value: MenuUnseenEntry) => ({ kind: "ok", data: value }) as never;

let shared: ReturnType<typeof useSharedNewsletterLive> = null;
let session: ReturnType<typeof useStaffSession> | null = null;
let feedCalls: Array<"ready" | `new:${number}`> = [];
function Probe() {
  const unseen = useMenuUnseen();
  const sharedValue = useSharedNewsletterLive();
  const sessionValue = useStaffSession();
  useEffect(() => {
    shared = sharedValue;
    session = sessionValue;
  });
  return <span data-testid="badge">{unseen.newsletter}</span>;
}
/** The Newsletter screen's side: it only listens, and says "seen". */
function Screen({ identity = ALLOWED.staffAccountId }: { identity?: string }) {
  const feed = useNewsletterLiveFeed(identity, { onReady: () => feedCalls.push("ready"), onNew: (n) => feedCalls.push(`new:${n}`) });
  return <button data-testid="screen" onClick={() => feed.ack("5", identity)}>screen</button>;
}

/** The screen as in the shell: inside the website gate, which reuses the shell's session. */
const gated = (screenNode: React.ReactNode) => <WebsiteAccessGate returnTo="/website/newsletter">{screenNode}</WebsiteAccessGate>;

const mount = (ui: React.ReactNode = null, strict = false) => {
  const tree = (
    <StaffSessionProvider>
      <NewsletterBadgeProvider>
        <Probe />
        {ui}
      </NewsletterBadgeProvider>
    </StaffSessionProvider>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
};
const badge = () => screen.getByTestId("badge").textContent;
const flush = (ms = BADGE_COALESCE_MS + 100) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const connection = () => {
  const open = live.started.filter((started) => !started.controller.dispose.mock.calls.length);
  expect(open.length).toBeGreaterThan(0);
  return open[open.length - 1];
};
const signal = (id: string) => act(async () => { connection().options.handlers.onSignal({ eventId: id, occurredAtUtc: "2026-11-19T01:00:00+00:00" }); });
const ready = () => act(async () => { connection().options.handlers.onReady(); });
const ack = (watermark: string, identity = ALLOWED.staffAccountId) => act(async () => { shared!.ack(watermark, identity); });

beforeEach(() => {
  live.started.length = 0;
  feedCalls = [];
  shared = null;
  session = null;
  getCount.mockReset();
  postSeen.mockReset();
  vi.mocked(fetchStaffSession).mockReset();
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  vi.mocked(staffLogout).mockReset();
  getCount.mockResolvedValue(answer(entry(3, "0", "3")));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("who gets a badge", () => {
  it("a confirmed session with the website permission asks the API once and shows ITS number", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    expect(getCount).toHaveBeenCalledTimes(1);
  });

  it("without the permission nothing is asked, nothing is connected and nothing is shown", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: WITHOUT_PERMISSION });
    mount();
    await flush(150);
    expect(getCount).not.toHaveBeenCalled();
    expect(live.started).toHaveLength(0);
    expect(badge()).toBe("0");
  });

  it("without a session nothing is asked either", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "unauthenticated" });
    mount();
    await flush(150);
    expect(getCount).not.toHaveBeenCalled();
    expect(live.started).toHaveLength(0);
  });

  it("outside the provider the count is 0 and the screen runs on its own connection", async () => {
    function Alone() {
      const unseen = useMenuUnseen();
      return <span data-testid="alone">{unseen.newsletter}</span>;
    }
    render(<Alone />);
    expect(screen.getByTestId("alone").textContent).toBe("0");
  });
});

describe("when the count is asked for again", () => {
  it("a signal is only a prompt: three signals are ONE request, and the number is the API's, not 3 more", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue(answer(entry(4, "0", "4")));
    await signal("e1");
    await signal("e2");
    await signal("e3");
    await flush(300 + BADGE_COALESCE_MS + 200);                                                // the hook gathers for 300 ms, the provider for another 250
    expect(getCount).toHaveBeenCalledTimes(2);
    expect(badge()).toBe("4");
  });

  it("a reconnect (ready) asks again", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue(answer(entry(5, "0", "5")));
    await ready();
    await flush();
    expect(badge()).toBe("5");
  });

  it("a tab that comes back to the foreground, or gets focus, asks again; a hidden one does not", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const base = getCount.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(getCount).toHaveBeenCalledTimes(base);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(getCount).toHaveBeenCalledTimes(base + 1);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(getCount).toHaveBeenCalledTimes(base + 2);
  });

  it("every 30 s while the tab is visible, and not while it is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => { await vi.advanceTimersByTimeAsync(BADGE_POLL_MS + BADGE_COALESCE_MS + 50); });
    expect(getCount).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => { await vi.advanceTimersByTimeAsync(BADGE_POLL_MS * 2); });
    expect(getCount).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("one request is on the wire at a time: a request wanted meanwhile runs once afterwards", async () => {
    const first = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => first.promise as never);
    getCount.mockResolvedValue(answer(entry(6, "0", "6")));
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await ready();
    await flush();
    expect(getCount).toHaveBeenCalledTimes(1);                                                // still waiting for the first
    await act(async () => { first.resolve(answer(entry(3, "0", "3"))); });
    await waitFor(() => expect(badge()).toBe("6"));
    expect(getCount).toHaveBeenCalledTimes(2);
  });

  it("a failed request keeps the last number: not zero, not a sign-out", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue({ kind: "network", message: "offline" } as never);
    await ready();
    await flush();
    expect(badge()).toBe("3");
    getCount.mockResolvedValue({ kind: "error", status: 503, message: "down" } as never);
    await ready();
    await flush();
    expect(badge()).toBe("3");
    expect(session!.state.status).toBe("authenticated");
  });

  it("a 401 ends the session like any other 401; a 403 makes the session read `me` again and only an ended session ends it", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const checks = vi.mocked(fetchStaffSession).mock.calls.length;
    getCount.mockResolvedValue({ kind: "denied" } as never);
    await ready();
    await flush();
    await waitFor(() => expect(vi.mocked(fetchStaffSession).mock.calls.length).toBe(checks + 1));
    expect(session!.state.status).toBe("authenticated");                                     // `me` still says yes: nothing ended
    getCount.mockResolvedValue({ kind: "unauthenticated" } as never);
    await ready();
    await flush();
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
    await waitFor(() => expect(badge()).toBe("0"));                                           // and with the session the badge is gone
  });

  it("an answer older than one already applied (a lower watermark) never brings the old number back", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const slow = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => slow.promise as never);                             // started BEFORE the acknowledgement …
    await ready();
    await flush();
    postSeen.mockResolvedValue(answer(entry(0, "3", "3")));
    await ack("3");
    await waitFor(() => expect(badge()).toBe("0"));
    await act(async () => { slow.resolve(answer(entry(3, "0", "3"))); });                     // … and answered after it
    await flush(50);
    expect(badge()).toBe("0");
  });
});

describe("saying 'seen'", () => {
  it("is never optimistic: the badge changes when the server answers, with the watermark given, once", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const pending = deferred<ReturnType<typeof answer>>();
    postSeen.mockImplementationOnce(() => pending.promise as never);
    await ack("3");
    expect(postSeen).toHaveBeenCalledTimes(1);
    expect(postSeen.mock.calls[0][0]).toBe("3");
    expect(badge()).toBe("3");                                                                 // still 3 while the server has not answered
    await act(async () => { pending.resolve(answer(entry(0, "3", "3"))); });
    await waitFor(() => expect(badge()).toBe("0"));
  });

  it("an activity that arrived after the list is still counted: the answer says 1 and that is what is shown", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue(answer(entry(1, "3", "4")));
    await ack("3");
    await waitFor(() => expect(badge()).toBe("1"));
  });

  it("a watermark that is not newer than what the server already knows is not sent", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue(answer(entry(0, "3", "3")));
    await ack("3");
    await waitFor(() => expect(badge()).toBe("0"));
    await ack("3");
    await ack("2");
    expect(postSeen).toHaveBeenCalledTimes(1);
  });

  it("a watermark that is not a plain decimal string is never sent", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    for (const bad of ["", "-1", "01", "1.5", "abc", " 3"]) await ack(bad);
    expect(postSeen).not.toHaveBeenCalled();
  });

  it("another Staff identity's watermark is not ours to say", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    await ack("3", "99999999-9999-9999-9999-999999999999");
    expect(postSeen).not.toHaveBeenCalled();
  });

  it("one call at a time: a newer watermark meanwhile goes out right after, a lower one never", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const first = deferred<ReturnType<typeof answer>>();
    postSeen.mockImplementationOnce(() => first.promise as never);
    postSeen.mockResolvedValue(answer(entry(0, "9", "9")));
    await ack("5");
    await ack("9");
    await ack("7");
    expect(postSeen).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(answer(entry(4, "5", "9"))); });
    await waitFor(() => expect(postSeen).toHaveBeenCalledTimes(2));
    expect(postSeen.mock.calls[1][0]).toBe("9");
    await waitFor(() => expect(badge()).toBe("0"));
  });

  it("a lost answer is tried again with the SAME watermark, a bounded number of times, and the badge keeps its number meanwhile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await vi.waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue({ kind: "network", message: "offline" } as never);
    await ack("3");
    expect(postSeen).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ACK_RETRY_MS[0] + 20); });
    expect(postSeen).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(ACK_RETRY_MS[1] + 20); });
    expect(postSeen).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(postSeen).toHaveBeenCalledTimes(3);                                                // bounded
    expect(postSeen.mock.calls.map((call) => call[0])).toEqual(["3", "3", "3"]);               // never a newer mark taken from a count
    expect(badge()).toBe("3");
    // The next list that loads says it again, and now it works.
    postSeen.mockResolvedValue(answer(entry(0, "3", "3")));
    await ack("3");
    await vi.waitFor(() => expect(badge()).toBe("0"));
  });

  it("a refusal is not retried (there is nothing different to send)", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue({ kind: "refused", status: 400, code: "menu-unseen-watermark-invalid", field: "viewWatermark", detail: "x" } as never);
    await ack("3");
    await flush(200);
    expect(postSeen).toHaveBeenCalledTimes(1);
    expect(badge()).toBe("3");
  });

  it("a 401 on the acknowledgement ends the session", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue({ kind: "unauthenticated" } as never);
    await ack("3");
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
  });
});

describe("nothing outlives the identity", () => {
  it("a sign-out during the acknowledgement: its late answer changes nothing and the badge is gone", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const pending = deferred<ReturnType<typeof answer>>();
    postSeen.mockImplementationOnce(() => pending.promise as never);
    await ack("3");
    vi.mocked(staffLogout).mockResolvedValue({ kind: "logged-out" });
    await act(async () => { await session!.signOut(); });
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
    expect(badge()).toBe("0");
    await act(async () => { pending.resolve(answer(entry(0, "3", "3"))); });
    await flush(50);
    expect(badge()).toBe("0");
    expect(postSeen).toHaveBeenCalledTimes(1);
  });

  it("a different Staff member signing in gets their own number and cannot be touched by the old one's late answers", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const lateForA = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => lateForA.promise as never);
    await ready();
    await flush();
    // A is replaced by B on this page (a new session read).
    const other = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: other });
    getCount.mockResolvedValue(answer(entry(7, "0", "7")));
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(badge()).toBe("7"));
    await act(async () => { lateForA.resolve(answer(entry(1, "9", "9"))); });
    await flush(50);
    expect(badge()).toBe("7");
    await ack("5", ALLOWED.staffAccountId);                                                    // A's mark is refused now
    expect(postSeen).not.toHaveBeenCalled();
  });

  it("unmounting stops the timers and listeners and lets nothing late write a number", async () => {
    const pending = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => pending.promise as never);
    const view = mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    view.unmount();
    const calls = getCount.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await act(async () => { pending.resolve(answer(entry(3, "0", "3"))); });
    await flush(400);
    expect(getCount.mock.calls.length).toBe(calls);
    expect(live.started.every((started) => started.controller.dispose.mock.calls.length > 0)).toBe(true);
  });
});

describe("which gates share the shell's session", () => {
  it("the default website gate shares it (ONE `me`); a gate with its own rule (Blog, Promotions) keeps a session of its own (a second `me`)", async () => {
    const own = { isAllowed: () => true, noPermission: "no", signInPrompt: "sign in" };
    mount(<WebsiteAccessGate returnTo="/website/languages"><p data-testid="default-child">default</p></WebsiteAccessGate>);
    await screen.findByTestId("default-child");
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(1);
    cleanup();
    vi.mocked(fetchStaffSession).mockClear();
    mount(<WebsiteAccessGate returnTo="/website/blog/posts" rule={own}><p data-testid="own-child">own</p></WebsiteAccessGate>);
    await screen.findByTestId("own-child");
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(2);                           // the shell's and the gate's own
  });
});

describe("one connection for the sidebar and the screen", () => {
  it("the shell and a mounted screen share ONE connection, also under Strict Mode; the screen never opens its own", async () => {
    mount(gated(<Screen />), true);
    await waitFor(() => expect(badge()).toBe("3"));
    const open = live.started.filter((started) => !started.controller.dispose.mock.calls.length);
    expect(open).toHaveLength(1);
  });

  it("the screen hears signals and reconnects while it is mounted, and nothing that happened before it is replayed", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    await signal("before");
    await flush(300 + BADGE_COALESCE_MS + 100);
    expect(feedCalls).toEqual([]);                                                             // no screen yet: nobody was told

    // A screen mounted later (inside the same provider) starts from now.
    cleanup();
    feedCalls = [];
    mount(gated(<Screen />));
    await waitFor(() => expect(badge()).toBe("3"));
    await screen.findByTestId("screen");
    expect(feedCalls).toEqual([]);
    await signal("after");
    await flush(300 + BADGE_COALESCE_MS + 100);
    expect(feedCalls).toEqual(["new:1"]);
    await ready();
    expect(feedCalls).toEqual(["new:1", "ready"]);
  });

  it("a screen that leaves stops being told, the connection stays for the badge", async () => {
    function Toggle() {
      const [on, setOn] = React.useState(true);
      return <>{on && <Screen />}<button data-testid="leave" onClick={() => setOn(false)}>leave</button></>;
    }
    mount(gated(<Toggle />));
    await waitFor(() => expect(badge()).toBe("3"));
    await screen.findByTestId("leave");
    fireEvent.click(screen.getByTestId("leave"));
    await signal("late");
    await flush(300 + BADGE_COALESCE_MS + 100);
    expect(feedCalls).toEqual([]);
    expect(live.started.filter((started) => !started.controller.dispose.mock.calls.length)).toHaveLength(1);
  });

  it("a 401 on the connection ends the session through the shell, a 403 asks it to read `me` again", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const checks = vi.mocked(fetchStaffSession).mock.calls.length;
    act(() => connection().options.handlers.onDenied());
    await waitFor(() => expect(vi.mocked(fetchStaffSession).mock.calls.length).toBe(checks + 1));
    expect(session!.state.status).toBe("authenticated");
    act(() => connection().options.handlers.onUnauthenticated());
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
  });
});

// ================================================================================================ BHA-NEWSLETTER-BADGE-001-C1

const Form = () => (
  <form data-testid="website-form">
    <input data-testid="website-input" />
  </form>
);
const gatedForm = () => <WebsiteAccessGate returnTo="/website/languages"><Form /></WebsiteAccessGate>;
const openConnections = () => live.started.filter((started) => !started.controller.dispose.mock.calls.length);
const meFails = () => vi.mocked(fetchStaffSession).mockResolvedValueOnce({ kind: "error", message: "Could not reach the Admin API." });

/**
 * C1 F1: a 403 on ANY path of the shell (the live connection, the count, the acknowledgement) asks the shared session to read `me`, exactly as the website gate does for its own
 * 403: a read that cannot answer closes access (an error with Retry) and never signs anybody out; a read that finds no session ends it; one that confirms keeps it.
 * Run through the real shared session, the real default-rule gate and a real form.
 */
describe("C1 F1: a 403 whose `me` check fails closes access", () => {
  const closedWithRetry = async () => {
    await screen.findByTestId("staff-session-error");
    expect(screen.queryByTestId("website-form")).toBeNull();
    expect(screen.queryByTestId("staff-session-required")).toBeNull();                       // not a sign-out
    return screen.getByRole("button", { name: "Thử lại" });
  };
  const retryReopens = async (retryButton: HTMLElement) => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
    fireEvent.click(retryButton);
    await screen.findByTestId("website-form");
    await waitFor(() => expect(badge()).toBe("3"));
    expect(openConnections()).toHaveLength(1);                                                 // the old one is gone, ONE shared connection serves the shell again
  };

  it("on the live connection: the form closes with Retry, and a Retry that succeeds reopens it", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    meFails();
    act(() => connection().options.handlers.onDenied());
    await retryReopens(await closedWithRetry());
  });

  it("on the count request (REST 403): the same", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    meFails();
    getCount.mockResolvedValue({ kind: "denied" } as never);
    await ready();
    await flush();
    getCount.mockResolvedValue(answer(entry(3, "0", "3")));
    await retryReopens(await closedWithRetry());
  });

  it("on the acknowledgement: the same", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    await waitFor(() => expect(badge()).toBe("3"));
    meFails();
    postSeen.mockResolvedValue({ kind: "denied" } as never);
    await ack("3");
    await retryReopens(await closedWithRetry());
  });

  it("`me` finds no session: the session ends (the gate asks to sign in again)", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    vi.mocked(fetchStaffSession).mockResolvedValueOnce({ kind: "unauthenticated" });
    act(() => connection().options.handlers.onDenied());
    await screen.findByTestId("staff-session-required");
    expect(screen.queryByTestId("website-form")).toBeNull();
  });

  it("`me` confirms the permission: nothing closes and nobody is signed out", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    act(() => connection().options.handlers.onDenied());
    await flush(200);
    expect(screen.getByTestId("website-form")).toBeTruthy();
    expect(session!.state.status).toBe("authenticated");
    expect(screen.queryByTestId("staff-session-error")).toBeNull();
  });

  it("`me` answers without the permission: the gate closes the form for that reason (no Retry-able error)", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    vi.mocked(fetchStaffSession).mockResolvedValueOnce({ kind: "authenticated", session: WITHOUT_PERMISSION });
    act(() => connection().options.handlers.onDenied());
    await screen.findByTestId("website-no-permission");
    expect(screen.queryByTestId("website-form")).toBeNull();
    await waitFor(() => expect(badge()).toBe("0"));
  });

  it("a `me` read that a newer read replaced (superseded) does not close anything", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    const first = deferred<Awaited<ReturnType<typeof fetchStaffSession>>>();
    vi.mocked(fetchStaffSession).mockImplementationOnce(() => first.promise);
    act(() => connection().options.handlers.onDenied());                                       // the shell's check is out …
    await flush(50);
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
    await act(async () => { await session!.refresh(); });                                      // … and a newer read takes over (the first is superseded)
    await act(async () => { first.resolve({ kind: "error", message: "late failure" }); });
    await flush(100);
    expect(screen.getByTestId("website-form")).toBeTruthy();
    expect(screen.queryByTestId("staff-session-error")).toBeNull();
  });

  it("a check that finishes after the Staff member signed out does not touch the session that follows", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    const late = deferred<Awaited<ReturnType<typeof fetchStaffSession>>>();
    vi.mocked(fetchStaffSession).mockImplementationOnce(() => late.promise);
    act(() => connection().options.handlers.onDenied());
    await flush(50);
    vi.mocked(staffLogout).mockResolvedValue({ kind: "logged-out" });
    await act(async () => { await session!.signOut(); });
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
    await act(async () => { late.resolve({ kind: "error", message: "late failure" }); });
    await flush(100);
    expect(session!.state.status).toBe("unauthenticated");                                    // not turned into an access error
  });

  it("a failing count request that is NOT a 403 (a network failure) closes nothing", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue({ kind: "network", message: "offline" } as never);
    await ready();
    await flush();
    expect(screen.getByTestId("website-form")).toBeTruthy();
    expect(badge()).toBe("3");
  });
});

/** Mounts the real sidebar under the shell with a state the test can change. */
function SidebarHarness() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    sidebarRefresh = () => setTick((tick) => tick + 1);
  }, []);
  return <AppSidebar />;
}
let sidebarRefresh: () => void = () => undefined;
const setSidebar = (state: Partial<typeof sidebar.state>) => {
  sidebar.state = { ...sidebar.state, ...state };
  act(() => sidebarRefresh());
};
const dot = () => screen.queryByTestId("menu-unseen-dot-parent");
const websiteButton = () => screen.getByText("Website").closest("button")!;

describe("C1 F2: the indicator follows what the sidebar actually shows, and the sidebar never says 'seen'", () => {
  beforeEach(() => {
    sidebar.state = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
  });

  it("Website open then the sidebar collapses (no hover): the entry is not drawn, so the parent shows the dot; hovering shows the entry and its number again; nothing is acknowledged", async () => {
    mount(<SidebarHarness />);
    await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector('[data-testid="menu-unseen-badge-newsletter"]')).not.toBeNull());
    expect(dot()).not.toBeNull();                                                              // closed: dot on the parent
    fireEvent.click(websiteButton());                                                          // open
    expect(dot()).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");

    setSidebar({ isExpanded: false });                                                         // collapsed, not hovered; Website is still the open submenu
    expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();                   // the number is not drawn …
    expect(dot()).not.toBeNull();                                                              // … so the parent must say it

    setSidebar({ isHovered: true });                                                           // the sidebar opens again under the pointer
    expect(dot()).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");
    setSidebar({ isHovered: false });
    expect(dot()).not.toBeNull();

    expect(postSeen).not.toHaveBeenCalled();
    expect(getCount).toHaveBeenCalledTimes(1);
  });

  it("the mobile drawer: closed → dot; open submenu → number; the drawer itself shut (not shown) with the submenu open → dot", async () => {
    sidebar.state = { isExpanded: false, isMobileOpen: true, isHovered: false, setIsHovered: () => undefined };
    mount(<SidebarHarness />);
    await waitFor(() => expect(dot()).not.toBeNull());
    fireEvent.click(websiteButton());
    expect(dot()).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");
    setSidebar({ isMobileOpen: false });                                                       // the drawer is closed again: nothing of the submenu is drawn
    expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();
    expect(dot()).not.toBeNull();
    expect(postSeen).not.toHaveBeenCalled();
  });

  it("at 0 nothing shows in any state, and 99+ keeps the real number in its label", async () => {
    getCount.mockResolvedValue(answer(entry(0, "5", "5")));
    mount(<SidebarHarness />);
    await waitFor(() => expect(getCount).toHaveBeenCalled());
    await flush(100);
    for (const state of [{ isExpanded: true }, { isExpanded: false }, { isHovered: true }]) {
      setSidebar(state);
      expect(dot()).toBeNull();
      expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();
    }
    cleanup();
    sidebar.state = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
    getCount.mockResolvedValue(answer(entry(150, "0", "150")));
    mount(<SidebarHarness />);
    await waitFor(() => expect(document.querySelector('[data-testid="menu-unseen-badge-newsletter"]')).not.toBeNull());
    const badgeNode = document.querySelector('[data-testid="menu-unseen-badge-newsletter"]')!;
    expect(badgeNode.textContent).toBe("99+");
    expect(badgeNode.getAttribute("aria-label")).toBe("150 đăng ký nhận tin mới chưa xem");
  });
});
