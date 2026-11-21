/**
 * BHA-NEWSLETTER-BADGE-001 / BHA-ADMIN-BADGE-001-PR04: the shell's unseen numbers and the live connections behind them. The API client and the connections are replaced (the connections
 * by a recorder), so each test plays the answers itself, deferred, and asserts what was asked and what is shown: a number is the API's, never counted from a hint or a signal; "seen"
 * is said with the watermark a list carried, never optimistically; an answer older than one already applied never wins; a menu or Property the latest answer leaves out is gone; and a
 * changed Staff identity, a sign-out or an unmount leave nothing alive (and nothing of the old identity on screen, from the very next render).
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
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(),
  markNewsletterSeen: vi.fn(),
}));

import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import WebsiteAccessGate from "./WebsiteAccessGate";
import AppSidebar from "@/layout/AppSidebar";
import { ACK_RETRY_MS, BADGE_COALESCE_MS, BADGE_POLL_MS, MenuUnseenProvider, useMenuUnseen, useNewsletterLiveFeed, useSharedNewsletterLive } from "./NewsletterBadgeProvider";
import { ALLOWED, WITHOUT_PERMISSION, deferred } from "./websiteTestUtils";
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markNewsletterSeen, type MenuUnseenEntry, type MenuUnseenSummary } from "@/lib/api/menuUnseen";

const getCount = vi.mocked(fetchMenuUnseenSummary);
const postSeen = vi.mocked(markNewsletterSeen);

const entry = (count: number, last: string, current: string): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
/** What `GET menu-unseen` answers for a Staff member who may read only the Newsletter (the number under test), or for a whole summary. */
const answer = (value: MenuUnseenEntry | MenuUnseenSummary) => ({ kind: "ok", data: "count" in value ? { newsletter: value } : value }) as never;
/** What `POST …/newsletter/seen` answers: the bare entry after the move. */
const seen = (value: MenuUnseenEntry) => ({ kind: "ok", data: value }) as never;

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
  return <span data-testid="badge">{unseen.newsletter?.count ?? 0}</span>;
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
      <MenuUnseenProvider>
        <Probe />
        {ui}
      </MenuUnseenProvider>
    </StaffSessionProvider>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
};
const badge = () => screen.getByTestId("badge").textContent;
const flush = (ms = BADGE_COALESCE_MS + 100) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
/** BHA-ADMIN-BADGE-001-PR14: the shared activity Hub (it names its own events) is the ONLY connection; "legacy" (a connection with no `events`: the old Newsletter Hub) must never exist. */
const openOf = (kind: "legacy" | "activity") =>
  live.started.filter((started) => !started.controller.dispose.mock.calls.length && (kind === "activity") === (started.options.events !== undefined));
const activityHub = () => {
  const open = openOf("activity");
  expect(open.length).toBeGreaterThan(0);
  return open[open.length - 1];
};
const hint = (payload: { menuKey: string; propertyId?: string; [extra: string]: unknown } = { menuKey: "calendar", propertyId: "prop-a" }) => act(async () => { activityHub().options.handlers.onSignal({ eventId: "", occurredAtUtc: "", ...payload }); });
const activityReady = () => act(async () => { activityHub().options.handlers.onReady(); });
/** A hint for the Newsletter menu: it schedules the GET and reaches a mounted Newsletter screen. `_id` only labels the call site (a hint carries no id). */
const signal = (_id?: string) => { void _id; return hint({ menuKey: "newsletter" }); };
const ready = () => activityReady();
const connection = () => activityHub();
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

describe("who gets numbers", () => {
  it("a confirmed session asks the API once and shows ITS number", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    expect(getCount).toHaveBeenCalledTimes(1);
  });

  it("a Staff member without the website permission (Blog only, or Property only) is still served: one GET, the activity Hub, and no legacy Newsletter connection", async () => {
    for (const permissions of [["BlogEdit"], []]) {
      cleanup();
      live.started.length = 0;
      getCount.mockClear();
      vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: { ...WITHOUT_PERMISSION, permissions } });
      getCount.mockResolvedValue(answer({ "blog-posts": entry(2, "0", "2") }));
      function Blog() {
        return <span data-testid="blog">{useMenuUnseen()["blog-posts"]?.count ?? "-"}</span>;
      }
      mount(<Blog />);
      await waitFor(() => expect(screen.getByTestId("blog").textContent).toBe("2"));
      expect(getCount).toHaveBeenCalledTimes(1);
      expect(openOf("activity")).toHaveLength(1);
      expect(openOf("legacy")).toHaveLength(0);
      expect(badge()).toBe("0");                                                               // no Newsletter number for them
    }
  });

  it("a Staff member with the website permission has ONE connection, the shared activity Hub, and never the legacy Newsletter one, also under Strict Mode and with the screen mounted", async () => {
    mount(gated(<Screen />), true);
    await waitFor(() => expect(badge()).toBe("3"));
    expect(openOf("activity")).toHaveLength(1);
    expect(openOf("legacy")).toHaveLength(0);
    expect(live.started.every((started) => started.options.events?.signal === "menuActivity")).toBe(true);   // nothing was ever started on the legacy Hub's message names
  });

  it("without a session nothing is asked and nothing is connected", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "unauthenticated" });
    mount();
    await flush(150);
    expect(getCount).not.toHaveBeenCalled();
    expect(live.started).toHaveLength(0);
  });

  it("outside the provider (nothing mounted) the numbers are empty and nothing is requested", () => {
    function Alone() {
      return <span data-testid="alone">{Object.keys(useMenuUnseen()).length}</span>;
    }
    render(<Alone />);
    expect(screen.getByTestId("alone").textContent).toBe("0");
    expect(getCount).not.toHaveBeenCalled();
  });

  it("LocalGate: the shell mounts no provider, so no GET, no socket and no number anywhere in the sidebar", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    try {
      const { default: AdminStaffScope } = await import("@/layout/AdminStaffScope");
      render(<AdminStaffScope><AppSidebar /></AdminStaffScope>);
      await flush(150);
      expect(getCount).not.toHaveBeenCalled();
      expect(vi.mocked(fetchStaffSession)).not.toHaveBeenCalled();
      expect(live.started).toHaveLength(0);
      expect(document.querySelector('[data-testid^="menu-unseen-badge"]')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
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
    postSeen.mockResolvedValue(seen(entry(0, "3", "3")));
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
    await act(async () => { pending.resolve(seen(entry(0, "3", "3"))); });
    await waitFor(() => expect(badge()).toBe("0"));
  });

  it("an activity that arrived after the list is still counted: the answer says 1 and that is what is shown", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue(seen(entry(1, "3", "4")));
    await ack("3");
    await waitFor(() => expect(badge()).toBe("1"));
  });

  it("a watermark that is not newer than what the server already knows is not sent", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    postSeen.mockResolvedValue(seen(entry(0, "3", "3")));
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
    postSeen.mockResolvedValue(seen(entry(0, "9", "9")));
    await ack("5");
    await ack("9");
    await ack("7");
    expect(postSeen).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(seen(entry(4, "5", "9"))); });
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
    postSeen.mockResolvedValue(seen(entry(0, "3", "3")));
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
    await act(async () => { pending.resolve(seen(entry(0, "3", "3"))); });
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
  const own = { isAllowed: () => true, noPermission: "no", signInPrompt: "sign in" };

  it("every gate under the shell shares its session (ONE `me`), whatever its rule: the default website rule and a rule of its own (Blog, Promotions)", async () => {
    mount(<WebsiteAccessGate returnTo="/website/languages"><p data-testid="default-child">default</p></WebsiteAccessGate>);
    await screen.findByTestId("default-child");
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(1);
    cleanup();
    vi.mocked(fetchStaffSession).mockClear();
    mount(<WebsiteAccessGate returnTo="/website/blog/posts" rule={own}><p data-testid="own-child">own</p></WebsiteAccessGate>);
    await screen.findByTestId("own-child");
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(1);
  });

  it("a gate rendered on its own (no shell, no enclosing session) still makes its own", async () => {
    render(<WebsiteAccessGate returnTo="/website/blog/posts" rule={own}><p data-testid="alone-child">alone</p></WebsiteAccessGate>);
    await screen.findByTestId("alone-child");
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(1);
  });
});

describe("one connection for the sidebar and the screen", () => {
  it("the shell and a mounted screen share ONE connection, also under Strict Mode; the screen never opens its own", async () => {
    mount(gated(<Screen />), true);
    await waitFor(() => expect(badge()).toBe("3"));
    expect(openOf("activity")).toHaveLength(1);
    expect(openOf("activity")).toHaveLength(1);
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

  it("the screen is told only about the Newsletter's hints (one `new` per hint, never a number of subscriptions); another menu's hint only schedules the GET", async () => {
    mount(gated(<Screen />));
    await waitFor(() => expect(badge()).toBe("3"));
    await screen.findByTestId("screen");
    feedCalls = [];
    await hint({ menuKey: "website-hero" });
    await hint({ menuKey: "calendar", propertyId: "prop-a" });
    await flush(300 + BADGE_COALESCE_MS + 100);
    expect(feedCalls).toEqual([]);
    expect(getCount.mock.calls.length).toBeGreaterThan(1);                                     // … yet each of them asked for the numbers again
    await hint({ menuKey: "newsletter" });
    await flush(300 + BADGE_COALESCE_MS + 100);
    expect(feedCalls).toEqual(["new:1"]);
  });

  it("the shared Hub's status and its retry reach the screen: the one connection serves both", async () => {
    mount(gated(<Screen />));
    await waitFor(() => expect(badge()).toBe("3"));
    expect(shared!.status).toBe("connecting");
    await act(async () => { activityHub().options.handlers.onStatus("connected"); });
    expect(shared!.status).toBe("connected");
    await act(async () => { activityHub().options.handlers.onStatus("stopped", "denied"); });
    expect(shared).toMatchObject({ status: "stopped", stoppedFor: "denied" });
    shared!.retry();
    expect(activityHub().controller.retryNow).toHaveBeenCalledTimes(1);
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
    expect(openOf("activity")).toHaveLength(1);
    expect(openOf("activity")).toHaveLength(1);
  });

  it("a 401 on the connection ends the session through the shell, a 403 asks it to read `me` again", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const checks = vi.mocked(fetchStaffSession).mock.calls.length;
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => connection().options.handlers.onDenied());
    await waitFor(() => expect(vi.mocked(fetchStaffSession).mock.calls.length).toBe(checks + 1));
    expect(session!.state.status).toBe("authenticated");
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
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
/** Every Staff member is served by ONE connection: the shared activity Hub (the legacy Newsletter Hub is no longer opened by this build). */
const BOTH = 1;
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
    expect(openConnections()).toHaveLength(BOTH);                                              // the old ones are gone, ONE of each serves the shell again
  };

  it("on the live connection: the form closes with Retry, and a Retry that succeeds reopens it", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    meFails();
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
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
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => connection().options.handlers.onDenied());
    await screen.findByTestId("staff-session-required");
    expect(screen.queryByTestId("website-form")).toBeNull();
  });

  it("`me` confirms the permission: nothing closes and nobody is signed out", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
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
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => connection().options.handlers.onDenied());
    await screen.findByTestId("website-no-permission");
    expect(screen.queryByTestId("website-form")).toBeNull();
    await waitFor(() => expect(openOf("legacy")).toHaveLength(0));                              // … and without the permission there is none of it either …
    expect(openOf("activity")).toHaveLength(1);                                                // … while the shared Hub stays: which menus they may read is the API's answer
  });

  it("a `me` read that a newer read replaced (superseded) does not close anything", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    const first = deferred<Awaited<ReturnType<typeof fetchStaffSession>>>();
    vi.mocked(fetchStaffSession).mockImplementationOnce(() => first.promise);
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
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
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
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

describe("C1 F1: a late result of the old identity or of an unmounted tree never reaches what follows", () => {
  it("another Staff member takes over while the 403's check is still out: that check's late FAILURE closes nothing, the badge is the new member's, ONE connection serves them", async () => {
    mount(gatedForm());
    await screen.findByTestId("website-form");
    await waitFor(() => expect(badge()).toBe("3"));
    const first = deferred<Awaited<ReturnType<typeof fetchStaffSession>>>();
    vi.mocked(fetchStaffSession).mockImplementationOnce(() => first.promise);
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => connection().options.handlers.onDenied());                                       // the old Staff member's 403: its `me` check is out
    await flush(50);
    const other = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: other });
    getCount.mockResolvedValue(answer(entry(7, "0", "7")));
    await act(async () => { await session!.refresh(); });                                      // a different Staff member (who has the permission) is now the session
    await waitFor(() => expect(badge()).toBe("7"));
    await act(async () => { first.resolve({ kind: "error", message: "late failure of the old check" }); });
    await flush(100);
    expect(screen.getByTestId("website-form")).toBeTruthy();                                   // nothing closed
    expect(screen.queryByTestId("staff-session-error")).toBeNull();
    expect(session!.state.status).toBe("authenticated");
    expect(badge()).toBe("7");
    const open = openConnections();
    expect(open).toHaveLength(BOTH);                                                           // the new member's one
    expect(live.started.length - open.length).toBe(live.started.length - BOTH);                // every earlier one disposed
  });

  it("the tree is unmounted while the check is out: its late failure changes nothing, and the next mount opens normally", async () => {
    const view = mount(gatedForm());
    await screen.findByTestId("website-form");
    const late = deferred<Awaited<ReturnType<typeof fetchStaffSession>>>();
    vi.mocked(fetchStaffSession).mockImplementationOnce(() => late.promise);
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => connection().options.handlers.onDenied());
    await flush(50);
    view.unmount();
    await act(async () => { late.resolve({ kind: "error", message: "late failure after unmount" }); });
    await flush(100);
    expect(openConnections()).toHaveLength(0);                                                 // the shell's connection went with it
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
    mount(gatedForm());
    await screen.findByTestId("website-form");
    expect(screen.queryByTestId("staff-session-error")).toBeNull();
    await waitFor(() => expect(badge()).toBe("3"));
    expect(openConnections()).toHaveLength(BOTH);
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
const parentBadge = () => screen.queryByTestId("menu-unseen-badge-parent");
const websiteButton = () => screen.getByText("Website").closest("button")!;

describe("C1 F2: the parent follows what the sidebar actually shows, and the sidebar never says 'seen'", () => {
  beforeEach(() => {
    sidebar.state = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
  });

  it("Website open then the sidebar collapses (no hover): the entry is not drawn, so the parent shows the sum; hovering shows the entry and its number again; nothing is acknowledged", async () => {
    mount(<SidebarHarness />);
    await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(parentBadge()).not.toBeNull());
    expect(parentBadge()!.textContent).toBe("3");                                              // closed: the sum on the parent
    fireEvent.click(websiteButton());                                                          // open
    expect(parentBadge()).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");

    setSidebar({ isExpanded: false });                                                         // collapsed, not hovered; Website is still the open submenu
    expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();                   // the number is not drawn …
    expect(parentBadge()!.textContent).toBe("3");                                              // … so the parent must say it

    setSidebar({ isHovered: true });                                                           // the sidebar opens again under the pointer
    expect(parentBadge()).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");
    setSidebar({ isHovered: false });
    expect(parentBadge()).not.toBeNull();

    expect(postSeen).not.toHaveBeenCalled();
    expect(getCount).toHaveBeenCalledTimes(1);
  });

  it("the mobile drawer: closed → sum; open submenu → number; the drawer itself shut (not shown) with the submenu open → sum", async () => {
    sidebar.state = { isExpanded: false, isMobileOpen: true, isHovered: false, setIsHovered: () => undefined };
    mount(<SidebarHarness />);
    await waitFor(() => expect(parentBadge()).not.toBeNull());
    fireEvent.click(websiteButton());
    expect(parentBadge()).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");
    setSidebar({ isMobileOpen: false });                                                       // the drawer is closed again: nothing of the submenu is drawn
    expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();
    expect(parentBadge()!.textContent).toBe("3");
    expect(postSeen).not.toHaveBeenCalled();
  });

  it("at 0 nothing shows in any state, and 99+ keeps the real number in its label", async () => {
    getCount.mockResolvedValue(answer(entry(0, "5", "5")));
    mount(<SidebarHarness />);
    await waitFor(() => expect(getCount).toHaveBeenCalled());
    await flush(100);
    for (const state of [{ isExpanded: true }, { isExpanded: false }, { isHovered: true }]) {
      setSidebar(state);
      expect(parentBadge()).toBeNull();
      expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();
    }
    cleanup();
    sidebar.state = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
    getCount.mockResolvedValue(answer(entry(150, "0", "150")));
    mount(<SidebarHarness />);
    await waitFor(() => expect(parentBadge()).not.toBeNull());
    expect(parentBadge()!.textContent).toBe("99+");
    expect(parentBadge()!.getAttribute("aria-label")).toBe("150 thay đổi chưa xem ở Website");
    fireEvent.click(websiteButton());
    expect(screen.getByTestId("menu-unseen-badge-newsletter").getAttribute("aria-label")).toBe("150 thay đổi chưa xem ở Đăng ký nhận tin");
  });
});

// ================================================================================================ BHA-ADMIN-BADGE-001-PR04

const property = (id: string, count: number, last = "0", current = String(count)) => ({ propertyId: id, count, lastSeenWatermark: last, currentWatermark: current });
const promotions = (...items: ReturnType<typeof property>[]): MenuUnseenEntry => ({ count: items.reduce((sum, item) => sum + item.count, 0), byProperty: items });
const OTHER_STAFF = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };

/** Every value the sidebar's consumers are rendered with, with the Staff identity the session had in that same render. */
let renders: Array<{ identity: string; newsletter: number | undefined }> = [];
function Recorder() {
  const unseen = useMenuUnseen();
  const state = useStaffSession().state;
  renders.push({ identity: state.status === "authenticated" ? state.session.staffAccountId : state.status, newsletter: unseen.newsletter?.count });
  return null;
}

describe("PR-4: the latest answer is the list of what this Staff member may read", () => {
  it("a menu the next answer leaves out disappears, and a Property it leaves out too; `byProperty` is kept and `count` is the API's own total", async () => {
    function Consumer() {
      const unseen = useMenuUnseen();
      return <span data-testid="consumer">{JSON.stringify({ blog: unseen["blog-posts"]?.count ?? null, promos: unseen.promotions?.count ?? null, properties: unseen.promotions?.byProperty?.map((item) => `${item.propertyId}:${item.count}`) ?? null })}</span>;
    }
    getCount.mockResolvedValue(answer({ newsletter: entry(3, "0", "3"), "blog-posts": entry(5, "0", "5"), promotions: promotions(property("A", 3), property("B", 4)) }));
    mount(<Consumer />);
    await waitFor(() => expect(screen.getByTestId("consumer").textContent).toBe('{"blog":5,"promos":7,"properties":["A:3","B:4"]}'));
    getCount.mockResolvedValue(answer({ newsletter: entry(3, "0", "3"), promotions: promotions(property("A", 3, "0", "3")) }));
    await ready();
    await flush();
    expect(screen.getByTestId("consumer").textContent).toBe('{"blog":null,"promos":3,"properties":["A:3"]}');
    expect(badge()).toBe("3");
  });

  it("an acknowledgement's late answer never puts a menu back that the latest answer left out", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const pending = deferred<ReturnType<typeof seen>>();
    postSeen.mockImplementationOnce(() => pending.promise as never);
    await ack("3");
    getCount.mockResolvedValue(answer({}));                                                    // the Staff member lost the website permission meanwhile
    await ready();
    await flush();
    await waitFor(() => expect(badge()).toBe("0"));
    await act(async () => { pending.resolve(seen(entry(0, "3", "3"))); });
    await flush(50);
    expect(badge()).toBe("0");
  });

  it("an answer that comes after an acknowledgement and started before it cannot restore the old count: on first load too, when the list's acknowledgement beats the first slow GET", async () => {
    const slow = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => slow.promise as never);
    postSeen.mockResolvedValue(seen(entry(0, "5", "5")));
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(shared).not.toBeNull());
    await ack("5");
    await vi.waitFor(() => expect(postSeen).toHaveBeenCalledTimes(1));
    await flush(50);
    await act(async () => { slow.resolve(answer(entry(3, "0", "3"))); });                    // issued before the acknowledgement, answered after it
    await flush(50);
    expect(badge()).toBe("0");
  });

  it("the same watermarks from a request issued BEFORE an acknowledgement do not undo it, but a request issued after it does apply (the Newsletter's cascade delete lowers a count without moving a watermark)", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const early = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => early.promise as never);
    await ready();
    await flush();
    postSeen.mockResolvedValue(seen(entry(2, "3", "3")));
    await ack("3");
    await waitFor(() => expect(badge()).toBe("2"));
    await act(async () => { early.resolve(answer(entry(3, "3", "3"))); });                    // equal watermarks, but issued earlier
    await flush(50);
    expect(badge()).toBe("2");
    getCount.mockResolvedValue(answer(entry(1, "3", "3")));                                    // a subscription deleted: same watermarks, one fewer
    await ready();
    await flush();
    await waitFor(() => expect(badge()).toBe("1"));
  });

  it("with both watermarks unchanged a newer answer still applies its count (3 → 2)", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue(answer(entry(2, "0", "3")));
    await ready();
    await flush();
    await waitFor(() => expect(badge()).toBe("2"));
  });

  it("a Property whose watermark went backwards keeps the menu's newer entry whole (never a mix)", async () => {
    function Promo() {
      return <span data-testid="promo">{useMenuUnseen().promotions?.count ?? "-"}</span>;
    }
    getCount.mockResolvedValue(answer({ promotions: promotions(property("A", 1, "0", "9")) }));
    mount(<Promo />);
    await waitFor(() => expect(screen.getByTestId("promo").textContent).toBe("1"));
    const slow = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => slow.promise as never);
    await ready();
    await flush();
    const next = deferred<ReturnType<typeof answer>>();
    getCount.mockImplementationOnce(() => next.promise as never);
    await ready();                                                                             // coalesced behind the first: it runs once the first answers
    await act(async () => { slow.resolve(answer({ promotions: promotions(property("A", 0, "0", "4")) })); });
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("promo").textContent).toBe("1");                                 // the older answer (current 4 < 9) changed nothing
    await act(async () => { next.resolve(answer({ promotions: promotions(property("A", 5, "0", "12")) })); });
    await waitFor(() => expect(screen.getByTestId("promo").textContent).toBe("5"));
  });
});

describe("PR-4: the numbers of one Staff member are never shown to another", () => {
  it("a new identity shows nothing of the old one from its very first render, while its own GET is still out; a sign-out likewise", async () => {
    renders = [];
    mount(<Recorder />);
    await waitFor(() => expect(badge()).toBe("3"));
    const forB = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => forB.promise as never);
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: OTHER_STAFF });
    renders.length = 0;
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    expect(renders.some((render) => render.identity === OTHER_STAFF.staffAccountId)).toBe(true);
    expect(renders.filter((render) => render.identity === OTHER_STAFF.staffAccountId).every((render) => render.newsletter === undefined)).toBe(true);
    expect(badge()).toBe("0");
    await act(async () => { forB.resolve(answer(entry(7, "0", "7"))); });
    await waitFor(() => expect(badge()).toBe("7"));

    vi.mocked(staffLogout).mockResolvedValue({ kind: "logged-out" });
    renders.length = 0;
    await act(async () => { await session!.signOut(); });
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every((render) => render.newsletter === undefined)).toBe(true);
  });

  it("the same Staff member signing in again does not see the snapshot of their earlier session while the first GET is out", async () => {
    renders = [];
    mount(<Recorder />);
    await waitFor(() => expect(badge()).toBe("3"));
    vi.mocked(staffLogout).mockResolvedValue({ kind: "logged-out" });
    await act(async () => { await session!.signOut(); });
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
    const again = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => again.promise as never);
    renders.length = 0;
    await act(async () => { session!.retry(); });
    await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    expect(renders.every((render) => render.newsletter === undefined)).toBe(true);
    expect(badge()).toBe("0");
  });
});

describe("PR-4: a hint, a poll and a reconnect only schedule the GET", () => {
  it("a hint carrying a number changes nothing by itself: the badge is the API's answer, read after the hint", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const answerLater = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => answerLater.promise as never);
    await hint({ menuKey: "newsletter", count: 999, title: "x" });
    expect(badge()).toBe("3");                                                                 // nothing counted from the payload
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    expect(badge()).toBe("3");                                                                 // and nothing before the GET answers
    await act(async () => { answerLater.resolve(answer(entry(4, "0", "4"))); });
    await waitFor(() => expect(badge()).toBe("4"));
  });

  it("the activity Hub's reconnect asks again", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue(answer(entry(6, "0", "6")));
    await activityReady();
    await waitFor(() => expect(badge()).toBe("6"));
  });

  it("a poll, a hint, two reconnects, focus and a visibility change inside one GET never put two on the wire; they cost exactly one more afterwards", async () => {
    let inFlight = 0;
    let most = 0;
    const gates: Array<() => void> = [];
    getCount.mockReset();
    getCount.mockImplementation(() => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise((resolve) => {
        gates.push(() => {
          inFlight -= 1;
          resolve(answer(entry(3, "0", "3")));
        });
      }) as never;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => { await vi.advanceTimersByTimeAsync(BADGE_POLL_MS + 20); });         // the poll fires while the first is still out
    await hint();
    await activityReady();
    await ready();
    act(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BADGE_COALESCE_MS + 100); });
    expect(getCount).toHaveBeenCalledTimes(1);
    await act(async () => { gates.shift()!(); });
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));                         // the wanted request ran once, after the first answered
    await act(async () => { gates.shift()!(); await vi.advanceTimersByTimeAsync(BADGE_COALESCE_MS + 100); });
    expect(getCount).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });

  it("a 401 on the activity Hub ends the session through the shell; a 403 asks it to read `me` again", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    const checks = vi.mocked(fetchStaffSession).mock.calls.length;
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => activityHub().options.handlers.onDenied());
    await waitFor(() => expect(vi.mocked(fetchStaffSession).mock.calls.length).toBe(checks + 1));
    expect(session!.state.status).toBe("authenticated");
    await waitFor(() => expect(openOf("activity")).toHaveLength(1));                      // the live connection is registered before it is handed a 401/403
    act(() => activityHub().options.handlers.onUnauthenticated());
    await waitFor(() => expect(session!.state.status).toBe("unauthenticated"));
  });

  it("a hint never opens the sidebar's menus to the Staff: a menu the API did not return stays absent", async () => {
    function Calendar() {
      return <span data-testid="calendar">{useMenuUnseen().calendar?.count ?? "-"}</span>;
    }
    mount(<Calendar />);
    await waitFor(() => expect(badge()).toBe("3"));
    await hint({ menuKey: "calendar", propertyId: "prop-a" });
    await flush();
    expect(screen.getByTestId("calendar").textContent).toBe("-");
  });
});

describe("PR-4: a 404 on the acknowledgement", () => {
  it("is not retried, and the numbers are read again so the menu can leave the sidebar", async () => {
    mount();
    await waitFor(() => expect(badge()).toBe("3"));
    getCount.mockResolvedValue(answer({}));
    postSeen.mockResolvedValue({ kind: "refused", status: 404, code: "menu-unseen-unknown-menu", field: null, detail: "x" } as never);
    await ack("3");
    await waitFor(() => expect(badge()).toBe("0"));
    expect(postSeen).toHaveBeenCalledTimes(1);
    expect(getCount.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ================================================================================================ BHA-ADMIN-BADGE-001-PR04-C1 (P2)

describe("C1: a stream of hints never starves the refresh", () => {
  const hintBurst = async (everyMs: number, forMs: number) => {
    for (let elapsed = 0; elapsed < forMs; elapsed += everyMs) {
      await act(async () => {
        activityHub().options.handlers.onSignal({ eventId: "calendar", occurredAtUtc: "" });
        await vi.advanceTimersByTimeAsync(everyMs);
      });
    }
  };

  it("a hint every 200 ms for 60 s (tab visible) still refreshes: the first deadline is kept, so a GET runs about every window instead of never", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await hintBurst(200, 1_000);
    expect(getCount.mock.calls.length).toBeGreaterThanOrEqual(3);                              // the hints did not keep moving the 250 ms deadline
    const afterFirstSecond = getCount.mock.calls.length;
    await hintBurst(200, 59_000);
    expect(getCount.mock.calls.length).toBeGreaterThan(afterFirstSecond + 50);
    expect(badge()).toBe("3");
  });

  it("while one GET is unanswered the hints add none: nothing runs in parallel, and exactly one more runs once it answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => first.promise as never);
    getCount.mockResolvedValue(answer(entry(6, "0", "6")));
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await hintBurst(200, 10_000);
    expect(getCount).toHaveBeenCalledTimes(1);                                                 // still waiting for the first: no second request
    await act(async () => { first.resolve(answer(entry(3, "0", "3"))); });
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));                         // one dragged-along refresh
    await act(async () => { await vi.advanceTimersByTimeAsync(BADGE_COALESCE_MS * 4); });
    expect(getCount).toHaveBeenCalledTimes(2);                                                 // and only one
    expect(badge()).toBe("6");
  });
});

// ================================================================================================ BHA-ADMIN-BADGE-001-PR04-C2

describe("C2: a GET covers every refresh asked for before it started", () => {
  /** GET1 (the mount's) and GET2 are held; the rest answer at once. Returns the way to answer each. */
  const holdTwo = () => {
    const first = deferred<ReturnType<typeof answer>>();
    const second = deferred<ReturnType<typeof answer>>();
    getCount.mockReset();
    getCount.mockImplementationOnce(() => first.promise as never);
    getCount.mockImplementationOnce(() => second.promise as never);
    getCount.mockResolvedValue(answer(entry(9, "0", "9")));
    return { first, second };
  };
  const hintNow = () => act(async () => { activityHub().options.handlers.onSignal({ eventId: "calendar", occurredAtUtc: "" }); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  /** hint at 0 ms, its timer ends at 250 (GET1 still out), a second hint at 300, GET1 answers at 400 and GET2 starts at once. */
  const untilSecondGetRuns = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const held = holdTwo();
    mount();
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));
    await hintNow();                                                                           // 0 ms
    await advance(250);                                                                        // the first deadline ends while GET1 is out: it only marks "run again"
    expect(getCount).toHaveBeenCalledTimes(1);
    await advance(50);
    await hintNow();                                                                           // 300 ms: arrives BEFORE GET2 starts
    await advance(100);
    await act(async () => { held.first.resolve(answer(entry(3, "0", "3"))); });                // 400 ms
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));
    return held;
  };

  it("the hint that arrived before GET2 started is covered by GET2: after its timer would have ended (550 ms) and after GET2 answers there is no third GET", async () => {
    const { second } = await untilSecondGetRuns();
    await advance(200);                                                                        // past 550 ms
    expect(getCount).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(answer(entry(4, "0", "4"))); });
    await advance(BADGE_COALESCE_MS * 4);
    expect(getCount).toHaveBeenCalledTimes(2);
    expect(badge()).toBe("4");
  });

  it("a hint that arrives while GET2 runs still earns exactly one more GET, when GET2 ends", async () => {
    const { second } = await untilSecondGetRuns();
    await advance(200);
    await hintNow();                                                                           // after GET2 started
    await advance(BADGE_COALESCE_MS + 50);
    expect(getCount).toHaveBeenCalledTimes(2);                                                 // never in parallel
    await act(async () => { second.resolve(answer(entry(4, "0", "4"))); });
    await vi.waitFor(() => expect(getCount).toHaveBeenCalledTimes(3));
    await advance(BADGE_COALESCE_MS * 4);
    expect(getCount).toHaveBeenCalledTimes(3);
    expect(badge()).toBe("9");
  });
});
