/**
 * BHA-ADMIN-BADGE-001-PR07 (ADR 0011 §B, §D): the four Blog screens say "seen" — through the shell's provider, the real gate and the real session — for THEIR OWN stream with the watermark of the
 * list that answered for the view on screen, and for nothing else. The API client and the connections are replaced; every answer is scripted or deferred by the test, so the order of answers
 * is the test's, never a clock's. What is asserted is what went to `POST menu-unseen/{menu}/seen`.
 */
import React, { useEffect } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/website/newsletterLive", () => ({ startNewsletterLive: vi.fn(() => ({ retryNow: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  listPosts: vi.fn(), listCategories: vi.fn(), readCategories: vi.fn(), listMedia: vi.fn(), getPins: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn(),
  fetchActiveLanguages: vi.fn(() => Promise.resolve({ kind: "ok", data: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true }] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(), markMenuSeen: vi.fn(), markNewsletterSeen: vi.fn(),
}));

import PostsScreen from "./PostsScreen";
import CategoriesScreen from "./CategoriesScreen";
import MediaLibraryScreen from "./MediaLibraryScreen";
import MediaPickerDialog from "./MediaPickerDialog";
import SettingsScreen from "./SettingsScreen";
import BlogAccessGate from "./BlogAccessGate";
import { lowestMark, type ReadMark } from "./useMarkedList";
import { ACK_RETRY_MS, BADGE_COALESCE_MS, MenuUnseenProvider, useMenuSeen, useMenuUnseen } from "@/components/website/NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { BOTH, deferred, ok } from "./blogTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markMenuSeen, markNewsletterSeen, type MenuUnseenEntry } from "@/lib/api/menuUnseen";
import { getPins, getSettings, listCategories, listMedia, listPosts, readCategories, saveSettings, type BlogCategory, type BlogMedia, type BlogPostList } from "@/lib/api/blog";

const seenCall = vi.mocked(markMenuSeen);
const summary = vi.mocked(fetchMenuUnseenSummary);
const posts = vi.mocked(listPosts);
const pickerCategories = vi.mocked(listCategories);
const screenCategories = vi.mocked(readCategories);
const media = vi.mocked(listMedia);
const pins = vi.mocked(getPins);
const settings = vi.mocked(getSettings);
const saveSettingsCall = vi.mocked(saveSettings);

const STAFF_A = BOTH;
const STAFF_B = { ...BOTH, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };
const entry = (last: string, current: string, count = 0): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
const ALL_BLOG = { "blog-posts": entry("0", "100"), "blog-categories": entry("0", "100"), "blog-media": entry("0", "100"), "blog-settings": entry("0", "100") };

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cat = (id: string): BlogCategory => ({ id, systemKey: null, sortOrder: 10, version: 1, translations: { vi: { name: "Ẩm thực", slug: "am-thuc", description: null } }, revisionCount: 0, pinCount: 0, isHomeSection: false });
const postList = (titles: string[], over: Partial<BlogPostList> = {}): BlogPostList => ({
  page: 1, pageSize: 20, total: titles.length,
  items: titles.map((title, i) => ({ id: `id-${i}-${title}`, updatedAtUtc: "2026-10-21T08:00:00Z", translations: [{ locale: "vi", status: "Published", version: 1, title, slug: "s", hasDraft: false, updatedAtUtc: "2026-10-21T08:00:00Z", updatedBy: null, coverMediaId: null }] })),
  ...over,
});
const picture = (n: number): BlogMedia => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, contentType: "image/jpeg", byteSize: 1, width: 800, height: 600, createdAtUtc: "2026-10-20T08:00:00Z", displayName: `Ảnh ${n}`,
  originalFileName: `p${n}.jpg`, description: "", credit: "", sourceUrl: "", licence: "", focalX: 0.5, focalY: 0.5, version: 1, pipeline: "current", originalSha256: null,
  updatedAtUtc: "2026-10-20T08:00:00Z", variants: [], usage: { revisions: 0, inPublished: 0, inDrafts: 0 },
});

let session: ReturnType<typeof useStaffSession> | null = null;
let say: ReturnType<typeof useMenuSeen> = () => undefined;
function Probe() {
  const value = useStaffSession();
  const seen = useMenuSeen();
  useEffect(() => {
    session = value;
    say = seen;
  });
  return null;
}

const mount = (node: React.ReactNode = null) =>
  render(
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Probe />
        <BlogAccessGate returnTo="/website/blog/posts">{node}</BlogAccessGate>
      </MenuUnseenProvider>
    </StaffSessionProvider>,
  );
const sent = () => seenCall.mock.calls.map((call) => `${call[0]}:${call[1]}`);
const flush = (ms = 60) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  for (const m of [seenCall, summary, posts, pickerCategories, screenCategories, media, pins, settings, saveSettingsCall, vi.mocked(markNewsletterSeen)]) m.mockReset();
  session = null;
  say = () => undefined;
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
  summary.mockResolvedValue({ kind: "ok", data: ALL_BLOG } as never);
  seenCall.mockImplementation((async (_menu: string, watermark: string) => ({ kind: "ok", data: entry(watermark, "100") })) as never);
  pickerCategories.mockResolvedValue(ok([]) as never);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllEnvs();
});

describe("each screen says 'seen' for its own stream with the watermark of its own read", () => {
  it("Posts → blog-posts, from GET /posts only (the category filter's read is another stream and says nothing)", async () => {
    posts.mockResolvedValue(ok(postList(["Bài một"], { viewWatermark: "7" })) as never);
    pickerCategories.mockResolvedValue(ok([cat(A)]) as never);
    mount(<PostsScreen />);
    await screen.findByText("Bài một");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:7"]));
    await flush();
    expect(sent()).toEqual(["blog-posts:7"]);
  });

  it("Categories → blog-categories, from the categories read's header watermark; the pins read and the posts offered for pinning add nothing of their own", async () => {
    screenCategories.mockResolvedValue(ok({ items: [cat(A)], viewWatermark: "20" }) as never);
    pins.mockResolvedValue(ok({ categoryId: A, version: 1, pins: [], viewWatermark: "25" }) as never);
    posts.mockResolvedValue(ok(postList([], { viewWatermark: "999" })) as never);       // a blog-posts watermark sitting right there: never used
    mount(<CategoriesScreen />);
    await screen.findByTestId("category-pins");
    await waitFor(() => expect(sent()).toEqual(["blog-categories:20"]));

    await userEvent.click(within(screen.getByTestId("category-pins")).getByRole("button"));
    await waitFor(() => expect(pins).toHaveBeenCalled());
    await waitFor(() => expect(posts).toHaveBeenCalled());
    await flush();
    expect(sent()).toEqual(["blog-categories:20"]);                                      // min(20, 25) = 20 is already said; 25 and 999 are not

    // closing the dialog reads the list again: a newer snapshot is a new thing to say
    screenCategories.mockResolvedValue(ok({ items: [cat(A)], viewWatermark: "30" }) as never);
    await userEvent.click(screen.getByRole("button", { name: /Đóng/ }));
    await waitFor(() => expect(sent()).toEqual(["blog-categories:20", "blog-categories:30"]));
  });

  it("Pins: while a category's pins are open the screen waits for the pins read and then says the LOWER of the two categories watermarks", async () => {
    // The first call (the categories list alone, 20) is refused, so the server's cursor did not move: what the open dialog adds is visible.
    seenCall.mockReset();
    seenCall.mockResolvedValueOnce({ kind: "refused", status: 400, code: "menu-unseen-watermark-invalid", field: "viewWatermark", detail: "x" } as never)
      .mockImplementation((async (_m: string, watermark: string) => ({ kind: "ok", data: entry(watermark, "100") })) as never);
    const pinsRead = deferred<ReturnType<typeof ok>>();
    screenCategories.mockResolvedValue(ok({ items: [cat(A)], viewWatermark: "20" }) as never);
    pins.mockReturnValue(pinsRead.promise as never);
    posts.mockResolvedValue(ok(postList([], { viewWatermark: "999" })) as never);
    mount(<CategoriesScreen />);
    await screen.findByTestId("category-pins");
    await waitFor(() => expect(sent()).toEqual(["blog-categories:20"]));

    await userEvent.click(within(screen.getByTestId("category-pins")).getByRole("button"));
    await waitFor(() => expect(pins).toHaveBeenCalled());
    await flush();
    expect(sent()).toEqual(["blog-categories:20"]);                                            // the pins read is still out: nothing more is said

    await act(async () => { pinsRead.resolve(ok({ categoryId: A, version: 1, pins: [], viewWatermark: "15" })); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["blog-categories:20", "blog-categories:15"]));  // min(20, 15); never 999 and never the posts stream
    await flush();
    expect(sent()).toEqual(["blog-categories:20", "blog-categories:15"]);
  });

  it("MediaLibrary → blog-media from GET /media; the picker dialog (the same grid inside an editor) says nothing", async () => {
    media.mockResolvedValue(ok({ items: [picture(1)], page: 1, pageSize: 24, total: 1, viewWatermark: "4" }) as never);
    const view = mount(<MediaLibraryScreen />);
    await screen.findByTestId("media-card");
    await waitFor(() => expect(sent()).toEqual(["blog-media:4"]));
    view.unmount();
    seenCall.mockClear();
    media.mockResolvedValue(ok({ items: [picture(1)], page: 1, pageSize: 24, total: 1, viewWatermark: "9" }) as never);
    mount(<MediaPickerDialog title="Chọn ảnh" multiple={false} canUpload onChoose={() => undefined} onClose={() => undefined} />);
    await screen.findByTestId("media-card");
    await flush();
    expect(sent()).toEqual([]);
  });

  it("Settings → blog-settings, from GET /settings, once the screen is shown (it waits for the category picker too); the picker's categories and a save's answer say nothing", async () => {
    const picker = deferred<ReturnType<typeof ok>>();
    settings.mockResolvedValue(ok({ homeSectionCategoryId: null, version: 1, updatedAtUtc: "2026-10-22T08:00:00Z", viewWatermark: "3" }) as never);
    pickerCategories.mockReturnValue(picker.promise as never);
    mount(<SettingsScreen />);
    await waitFor(() => expect(settings).toHaveBeenCalled());
    await flush();
    expect(sent()).toEqual([]);                                                          // the screen is still loading: nothing has been shown

    await act(async () => { picker.resolve(ok([cat(A)])); await Promise.resolve(); });
    await screen.findByTestId("home-section-select");
    await waitFor(() => expect(sent()).toEqual(["blog-settings:3"]));

    saveSettingsCall.mockResolvedValue(ok({ homeSectionCategoryId: A, version: 2, updatedAtUtc: "2026-10-22T09:00:00Z", viewWatermark: "50" }) as never);
    await userEvent.selectOptions(screen.getByTestId("home-section-select"), A);
    await userEvent.click(within(screen.getByTestId("settings-save")).getByRole("button"));
    await waitFor(() => expect(saveSettingsCall).toHaveBeenCalled());
    await flush();
    expect(sent()).toEqual(["blog-settings:3"]);
  });
});

describe("a read that is not applied to the view says nothing", () => {
  it("a list without a watermark (an older backend) renders and is never acknowledged", async () => {
    posts.mockResolvedValue(ok(postList(["Không có số"])) as never);
    mount(<PostsScreen />);
    await screen.findByText("Không có số");
    await flush();
    expect(sent()).toEqual([]);
  });

  // (Behaviour, not a single guard: the screen's own render-time page correction, `useWebsiteList`'s `pending` and the hook's `applies` each already keep the past-the-end answer from being acknowledged.)
  it("a page past the end (the total shrank) is replaced by the last real page, and only that one is acknowledged", async () => {
    const total = { value: 45 };
    posts.mockImplementation((async (query: { page: number }) => {
      if (query.page === 1 && total.value === 45) return ok(postList(["Trang 1"], { total: 45, page: 1, viewWatermark: "5" }));
      if (query.page === 2) return ok(postList([], { total: 20, page: 2, viewWatermark: "6" }));     // the page the person is on no longer exists
      return ok(postList(["Trang 1 sau khi co lai"], { total: 20, page: 1, viewWatermark: "8" }));
    }) as never);
    mount(<PostsScreen />);
    await screen.findByText("Trang 1");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:5"]));

    total.value = 20;
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("Trang 1 sau khi co lai");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:5", "blog-posts:8"]));         // never 6
  });

  it("an answer for an older filter that arrives after a newer one is dropped, and so is its watermark", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    const fast = deferred<ReturnType<typeof ok>>();
    posts.mockResolvedValueOnce(ok(postList(["Ban đầu"], { viewWatermark: "5" })) as never).mockReturnValueOnce(slow.promise as never).mockReturnValueOnce(fast.promise as never);
    mount(<PostsScreen />);
    await screen.findByText("Ban đầu");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:5"]));

    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Draft");
    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Published");
    await act(async () => { fast.resolve(ok(postList(["Mới nhất"], { viewWatermark: "8" }))); await Promise.resolve(); });
    await screen.findByText("Mới nhất");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:5", "blog-posts:8"]));
    await act(async () => { slow.resolve(ok(postList(["Cũ"], { viewWatermark: "6" }))); await Promise.resolve(); });
    await flush();
    expect(screen.queryByText("Cũ")).toBeNull();
    expect(sent()).toEqual(["blog-posts:5", "blog-posts:8"]);
  });

  // (Behaviour across layers: a new identity is a new read, an answer of the older one is superseded, the answer carries the identity that started it, and the provider drops a mismatch.)
  it("a read started by Staff A that answers after Staff B took over is not used to acknowledge for B (and A's identity is never used for B)", async () => {
    const late = deferred<ReturnType<typeof ok>>();
    posts.mockReturnValueOnce(late.promise as never);
    mount(<PostsScreen />);
    await waitFor(() => expect(posts).toHaveBeenCalledTimes(1));

    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    posts.mockResolvedValue(ok(postList(["Của B"], { viewWatermark: "9" })) as never);
    await act(async () => { await session!.refresh(); });
    await screen.findByText("Của B");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:9"]));

    await act(async () => { late.resolve(ok(postList(["Của A"], { viewWatermark: "5" }))); await Promise.resolve(); });
    await flush();
    expect(screen.queryByText("Của A")).toBeNull();
    expect(sent()).toEqual(["blog-posts:9"]);
  });

  it("an acknowledgement that fails never turns the list into an error", async () => {
    seenCall.mockResolvedValue({ kind: "network", message: "Không kết nối được." } as never);
    posts.mockResolvedValue(ok(postList(["Vẫn hiển thị"], { viewWatermark: "7" })) as never);
    mount(<PostsScreen />);
    await screen.findByText("Vẫn hiển thị");
    await waitFor(() => expect(sent()).toEqual(["blog-posts:7"]));
    expect(screen.queryByTestId("error-panel")).toBeNull();
    expect(screen.getByText("Vẫn hiển thị")).toBeInTheDocument();
  });
});

describe("the provider's pipeline is per menu", () => {
  const say_ = (menu: Parameters<typeof say>[0], watermark: string, identity = STAFF_A.staffAccountId) => act(async () => { say(menu, watermark, identity); });
  const ready = async () => {
    mount();
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1));
    await flush();
  };

  it("one menu's call in flight does not hold up another's; behind a call only the newest waiting watermark follows, once", async () => {
    await ready();
    const first = deferred<{ kind: "ok"; data: MenuUnseenEntry }>();
    seenCall.mockReset();
    seenCall.mockReturnValueOnce(first.promise as never).mockImplementation((async (_m: string, w: string) => ({ kind: "ok", data: entry(w, "100") })) as never);
    await say_("blog-posts", "5");
    await say_("blog-posts", "7");
    await say_("blog-posts", "6");
    await say_("blog-media", "3");
    expect(sent()).toEqual(["blog-posts:5", "blog-media:3"]);                              // media did not wait for posts

    await act(async () => { first.resolve({ kind: "ok", data: entry("5", "100") }); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["blog-posts:5", "blog-media:3", "blog-posts:7"]));      // 6 never goes out
    await flush();
    expect(sent()).toHaveLength(3);
  });

  it("says nothing for a menu the latest answer leaves out, another identity, a watermark that is not canonical, or one the server already has", async () => {
    summary.mockResolvedValue({ kind: "ok", data: { "blog-posts": entry("10", "100") } } as never);
    await ready();
    await say_("blog-settings", "4");                                                      // this Staff member may not read it: not allowed, and nothing brings it back
    await say_("blog-posts", "5", STAFF_B.staffAccountId);                                 // not this identity's to say
    await say_("blog-posts", "007");
    await say_("blog-posts", "-1");
    await say_("blog-posts", "10");                                                        // the server's last seen is already 10
    expect(sent()).toEqual([]);
  });

  it("never invents a watermark: nothing is sent just because the summary arrived", async () => {
    await ready();
    await flush(BADGE_COALESCE_MS + 100);
    expect(seenCall).not.toHaveBeenCalled();
  });

  it("a failed call is tried again with the SAME watermark a bounded number of times, and then left", async () => {
    await ready();
    seenCall.mockReset();
    seenCall.mockResolvedValue({ kind: "network", message: "x" } as never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await say_("blog-media", "3");
    await act(async () => { await vi.advanceTimersByTimeAsync(ACK_RETRY_MS[0] + 20); });
    await act(async () => { await vi.advanceTimersByTimeAsync(ACK_RETRY_MS[1] + 20); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sent()).toEqual(Array(ACK_RETRY_MS.length + 1).fill("blog-media:3"));
  });

  it("a 404 (the permission is gone) reads the numbers again so the menu leaves; it is not retried", async () => {
    await ready();
    seenCall.mockReset();
    seenCall.mockResolvedValue({ kind: "refused", status: 404, code: "menu-unseen-unknown-menu", field: null, detail: "x" } as never);
    await say_("blog-media", "3");
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual(["blog-media:3"]);
  });

  it("the badge takes the number from the server's answer to 'seen' (no GET needed), and a summary that was already on its way with older marks cannot bring the old number back", async () => {
    function Count() {
      return <span data-testid="posts-count">{useMenuUnseen()["blog-posts"]?.count ?? "-"}</span>;
    }
    summary.mockResolvedValue({ kind: "ok", data: { "blog-posts": entry("0", "100", 3) } } as never);
    mount(<Count />);
    await waitFor(() => expect(screen.getByTestId("posts-count").textContent).toBe("3"));

    const late = deferred<unknown>();
    summary.mockReturnValueOnce(late.promise as never);
    await act(async () => { window.dispatchEvent(new Event("focus")); });                      // asks for the numbers again …
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2), { timeout: BADGE_COALESCE_MS + 2000 });
    seenCall.mockResolvedValue({ kind: "ok", data: { count: 0, lastSeenWatermark: "7", currentWatermark: "100" } } as never);
    await say_("blog-posts", "7");                                                             // … and the screen says "seen" while that GET is still out
    await waitFor(() => expect(screen.getByTestId("posts-count").textContent).toBe("0"));
    expect(summary).toHaveBeenCalledTimes(2);                                                  // the server's answer to the POST changed the badge; no new GET

    await act(async () => { late.resolve({ kind: "ok", data: { "blog-posts": entry("0", "100", 3) } }); await Promise.resolve(); });
    await flush();
    expect(screen.getByTestId("posts-count").textContent).toBe("0");                           // older marks (last 0 < 7): it never wins
  });

  it("the Newsletter keeps its own call, and a screen outside the shell (no provider, LocalGate) sends nothing", async () => {
    vi.mocked(markNewsletterSeen).mockResolvedValue({ kind: "ok", data: entry("4", "100") } as never);
    summary.mockResolvedValue({ kind: "ok", data: { ...ALL_BLOG, newsletter: entry("0", "100") } } as never);
    await ready();
    await say_("newsletter", "4");
    expect(markNewsletterSeen).toHaveBeenCalledWith("4");
    expect(seenCall).not.toHaveBeenCalled();

    cleanup();
    let bare: ReturnType<typeof useMenuSeen> = () => undefined;
    function Bare() {
      const seen = useMenuSeen();
      useEffect(() => {
        bare = seen;
      });
      return null;
    }
    render(<Bare />);
    bare("blog-posts", "5", STAFF_A.staffAccountId);
    expect(seenCall).not.toHaveBeenCalled();
  });
});

describe("an acknowledgement for a menu the latest summary does not list yet is kept, not lost (BHA-ADMIN-BADGE-001-PR07-C2)", () => {
  /** A summary that does not list the Blog menus: the permission was just granted (or restored) and the cached answer has not caught up. */
  const NOT_YET = { kind: "ok", data: {} } as never;
  const granted = (count = 3) => ({ kind: "ok", data: { "blog-posts": entry("0", "9", count) } }) as never;
  const refresh = async () => {
    const before = summary.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(before), { timeout: BADGE_COALESCE_MS + 2000 });
    await flush();
  };
  function Count() {
    return <span data-testid="posts-count">{useMenuUnseen()["blog-posts"]?.count ?? "-"}</span>;
  }
  const say_ = (menu: Parameters<typeof say>[0], watermark: string, identity = STAFF_A.staffAccountId) => act(async () => { say(menu, watermark, identity); });
  const ready = async (node: React.ReactNode = null) => {
    mount(node);
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1));
    await flush();
  };

  it("the page read succeeded once, with no menu in the summary: no POST yet; the next summary lists the menu: exactly ONE POST with the watermark of that read, the badge follows the answer, and the page is not reloaded", async () => {
    summary.mockResolvedValue(NOT_YET);
    posts.mockResolvedValue(ok(postList(["Bài một"], { viewWatermark: "5" })) as never);
    await ready(<><Count /><PostsScreen /></>);
    await screen.findByText("Bài một");
    await flush();
    expect(sent()).toEqual([]);                                                              // the menu is not listed: nothing is said yet
    expect(posts).toHaveBeenCalledTimes(1);

    await refresh();                                                                         // still not listed: it keeps waiting
    expect(sent()).toEqual([]);

    const answer = deferred<unknown>();
    seenCall.mockReturnValueOnce(answer.promise as never);                                   // the server's answer to that POST is held
    summary.mockResolvedValue(granted(3));                                                   // the same Staff member's next summary lists it
    await refresh();
    await waitFor(() => expect(sent()).toEqual(["blog-posts:5"]));                           // the watermark of the read that was shown, never the summary's 9
    expect(screen.getByTestId("posts-count").textContent).toBe("3");                         // nothing lowers the badge before the server answers
    await act(async () => { answer.resolve({ kind: "ok", data: { count: 1, lastSeenWatermark: "5", currentWatermark: "9" } }); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId("posts-count").textContent).toBe("1"));    // the badge is the server's own number, not a zero of our making
    expect(posts).toHaveBeenCalledTimes(1);                                                  // no reload was needed

    await refresh();                                                                         // later summaries do not say it again
    await refresh();
    expect(sent()).toEqual(["blog-posts:5"]);
  });

  it("several reads wait: only the largest watermark that is newer than the cursor goes out, once, when the menu is listed", async () => {
    summary.mockResolvedValue(NOT_YET);
    await ready();
    await say_("blog-posts", "5");
    await say_("blog-posts", "8");
    await say_("blog-posts", "6");
    expect(sent()).toEqual([]);

    summary.mockResolvedValue({ kind: "ok", data: { "blog-posts": entry("0", "100", 4) } } as never);
    await refresh();
    await waitFor(() => expect(sent()).toEqual(["blog-posts:8"]));
    await refresh();
    expect(sent()).toEqual(["blog-posts:8"]);
  });

  it("a waiting watermark the server's cursor already covers is dropped when the menu is listed", async () => {
    summary.mockResolvedValue(NOT_YET);
    await ready();
    await say_("blog-posts", "5");
    summary.mockResolvedValue({ kind: "ok", data: { "blog-posts": entry("7", "100", 1) } } as never);       // the cursor is already at 7
    await refresh();
    await flush();
    expect(sent()).toEqual([]);
  });

  it("a waiting acknowledgement does not survive another Staff member taking over", async () => {
    summary.mockResolvedValue(NOT_YET);
    await ready();
    await say_("blog-posts", "7");

    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    summary.mockResolvedValue(granted(2));
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(1));
    await flush();
    await refresh();
    expect(sent()).toEqual([]);                                                              // A's 7 was dropped with A's session; B's own page would say its own
  });

  it("a waiting acknowledgement does not survive a sign-out", async () => {
    summary.mockResolvedValue(NOT_YET);
    await ready();
    await say_("blog-posts", "7");

    await act(async () => { session!.expire(); });
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
    summary.mockResolvedValue(granted(2));
    await act(async () => { session!.retry(); });                                            // the same Staff member signs in again: a new life
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(1));
    await flush();
    await refresh();
    expect(sent()).toEqual([]);
  });

  it("a summary of the old session that answers late cannot send anything", async () => {
    summary.mockResolvedValue(NOT_YET);
    await ready();
    await say_("blog-posts", "7");

    const late = deferred<unknown>();
    summary.mockReturnValueOnce(late.promise as never);
    await act(async () => { window.dispatchEvent(new Event("focus")); });                    // A asks again …
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2), { timeout: BADGE_COALESCE_MS + 2000 });
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    summary.mockResolvedValue(NOT_YET);
    await act(async () => { await session!.refresh(); });                                    // … B takes over before it answers
    await flush();
    await act(async () => { late.resolve(granted(3)); await Promise.resolve(); });           // A's late summary now lists the menu
    await flush();
    expect(sent()).toEqual([]);
  });

  it("the Newsletter is untouched: it never waited for the summary", async () => {
    vi.mocked(markNewsletterSeen).mockResolvedValue({ kind: "ok", data: entry("4", "100") } as never);
    summary.mockResolvedValue(NOT_YET);
    await ready();
    await say_("newsletter", "4");
    expect(markNewsletterSeen).toHaveBeenCalledWith("4");
    expect(seenCall).not.toHaveBeenCalled();
  });
});

describe("two reads of one stream are only as seen as the older of them", () => {
  const mark = (watermark: string, by = "A"): ReadMark => ({ watermark, by, source: {} });
  it("is the lower watermark, compared as integers, and only for the same identity", () => {
    expect(lowestMark(mark("20"), mark("25"))?.watermark).toBe("20");
    expect(lowestMark(mark("25"), mark("20"))?.watermark).toBe("20");
    expect(lowestMark(mark("9"), mark("10"))?.watermark).toBe("9");                         // never by text
    expect(lowestMark(mark("9223372036854775807"), mark("9223372036854775806"))?.watermark).toBe("9223372036854775806");
    expect(lowestMark(mark("5", "A"), mark("6", "B"))).toBeNull();
  });
});
