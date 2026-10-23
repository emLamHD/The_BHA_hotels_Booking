/** BHA-BLOG-001-CP03: the list of posts — a filter change goes back to page 1, and an answer for an older filter never replaces a newer one. */
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  listPosts: vi.fn(), listCategories: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  fetchActiveLanguages: vi.fn(() => Promise.resolve({ kind: "ok", data: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true }] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));

import PostsScreen from "./PostsScreen";
import { BOTH, EDITOR, PUBLISHER, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { listPosts } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";
import type { BlogPostList } from "@/lib/api/blog";

const list = vi.mocked(listPosts);
const page = (titles: string[], total = titles.length): BlogPostList => ({
  page: 1, pageSize: 20, total,
  items: titles.map((title, i) => ({ id: `id-${i}-${title}`, updatedAtUtc: "2026-10-21T08:00:00Z", translations: [{ locale: "vi", status: "Published", version: 1, title, slug: "s", hasDraft: false, updatedAtUtc: "2026-10-21T08:00:00Z", updatedBy: null, coverMediaId: null }] })),
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  list.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the posts list", () => {
  it("drops an answer for an older filter that arrives after a newer one", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    const fast = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(Promise.resolve(ok(page(["Ban đầu"]))) as never).mockReturnValueOnce(slow.promise as never).mockReturnValueOnce(fast.promise as never);
    renderInBlogGate(<PostsScreen />);
    await screen.findByText("Ban đầu");

    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Draft");
    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Published");
    await act(async () => { fast.resolve(ok(page(["Mới nhất"]))); await Promise.resolve(); });
    await screen.findByText("Mới nhất");
    await act(async () => { slow.resolve(ok(page(["Cũ, về muộn"]))); await Promise.resolve(); });
    expect(screen.queryByText("Cũ, về muộn")).toBeNull();
    expect(screen.getByText("Mới nhất")).toBeInTheDocument();
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ status: "Published", page: 1 });
  });

  it("goes back to page 1 when a filter changes", async () => {
    list.mockResolvedValue(ok(page(["Bài"], 45)) as never);
    renderInBlogGate(<PostsScreen />);
    await screen.findByText(/Trang 1 \/ 3/);
    await userEvent.click(screen.getByText("Trang sau"));
    await screen.findByText(/Trang 2 \/ 3/);
    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Archived");
    await waitFor(() => expect(list.mock.calls.at(-1)![0]).toMatchObject({ status: "Archived", page: 1 }));
  });

  it("offers 'new post' to an editor and not to a publisher-only account", async () => {
    list.mockResolvedValue(ok(page(["Bài"])) as never);
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
    const first = renderInBlogGate(<PostsScreen />);
    expect(await screen.findByTestId("post-new")).toHaveAttribute("href", "/website/blog/posts/new");
    first.unmount();
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: PUBLISHER });
    renderInBlogGate(<PostsScreen />);
    await screen.findByTestId("posts-table");
    expect(screen.queryByTestId("post-new")).toBeNull();
  });

  it("says when nothing matches", async () => {
    list.mockResolvedValue(ok(page([])) as never);
    renderInBlogGate(<PostsScreen />);
    expect(await screen.findByTestId("posts-empty")).toBeInTheDocument();
  });

  it("C2 O1 — a translation with no content at all is labelled 'Chưa có nội dung', not left blank, and does not hide the others", async () => {
    const empty = { locale: "vi", status: "Archived", version: 3, title: "", slug: "", hasDraft: false, updatedAtUtc: "2026-10-21T08:00:00Z", updatedBy: null, coverMediaId: null };
    const normal = page(["Bài bình thường"]);
    list.mockResolvedValue(ok({ ...normal, total: 2, items: [{ id: "fixture-1", updatedAtUtc: "2026-10-21T08:00:00Z", translations: [empty] }, ...normal.items] }) as never);
    renderInBlogGate(<PostsScreen />);
    await screen.findByText("Bài bình thường");
    const rows = screen.getAllByTestId("post-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Chưa có nội dung");
    expect(rows[0]).not.toHaveTextContent("(chưa có tiêu đề)");
    expect(rows[1]).not.toHaveTextContent("Chưa có nội dung");
    expect(screen.getByTestId("posts-total")).toHaveTextContent("2 bài");
  });
});

// ---------------------------------------------------------------- C10 F4: a page past the end after the total shrank

describe("C10 F4 — the page the person is on no longer exists because the total shrank", () => {
  const PAGE = 20;
  /** A server whose number of matching posts can change between requests; it answers the page asked for, as the real one does (past the end: no items, the real total). */
  let matching = 0;
  const serve = (query: { page: number }) => {
    const first = (query.page - 1) * PAGE;
    const count = Math.max(0, Math.min(PAGE, matching - first));
    const titles = Array.from({ length: count }, (_, i) => `Bài ${first + i + 1}`);
    return { ...page(titles, matching), page: query.page };
  };
  const rows = () => screen.queryAllByTestId("post-row").length;

  beforeEach(() => {
    matching = 0;
    list.mockImplementation(((query: { page: number }) => Promise.resolve(ok(serve(query)))) as never);
  });

  it("the review's case: 21 published posts, page 2 is asked for, another editor unpublishes one first - page 1 is read again and shows the 20, the filter and the search are kept, and 'no matching posts' is never shown", async () => {
    matching = 21;
    renderInBlogGate(<PostsScreen />);
    await screen.findByText(/Trang 1 \/ 2/);
    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Published");
    await userEvent.type(screen.getByTestId("posts-search"), "bài{enter}");
    await screen.findByText(/Trang 1 \/ 2/);
    const before = list.mock.calls.length;

    const slow = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(slow.promise as never);
    await userEvent.click(screen.getByText("Trang sau"));
    matching = 20; // the other editor's unpublish lands before page 2 is answered
    const recovery = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(recovery.promise as never);
    await act(async () => { slow.resolve(ok({ ...serve({ page: 2 }), page: 2 })); await Promise.resolve(); });

    await waitFor(() => expect(list.mock.calls.length).toBe(before + 2));
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ status: "Published", q: "bài", page: 1 });
    expect(screen.queryByTestId("posts-empty")).toBeNull(); // not "nothing matches" while the page that exists is being read
    await act(async () => { recovery.resolve(ok(serve({ page: 1 }))); await Promise.resolve(); });
    await waitFor(() => expect(rows()).toBe(20));
    expect(screen.getByTestId("posts-total")).toHaveTextContent("20 bài");
    expect(screen.getByTestId("posts-status")).toHaveValue("Published");
    expect(screen.getByTestId("posts-search")).toHaveValue("bài");
    await new Promise((r) => setTimeout(r, 50));
    expect(list.mock.calls.length).toBe(before + 2); // two requests for the one shrink: no loop
  });

  it("a multi-page shrink goes to the last page that exists; a second shrink before that answer goes on to the next one down", async () => {
    matching = 100;
    renderInBlogGate(<PostsScreen />);
    await screen.findByText(/Trang 1 \/ 5/);
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByText("Trang sau"));
    await screen.findByText(/Trang 5 \/ 5/);

    const asked4 = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(asked4.promise as never);
    await userEvent.click(screen.getByText("Trang trước")); // page 4 is asked for ...
    matching = 45; // ... and the total shrinks to 3 pages before it is answered
    const asked3 = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(asked3.promise as never);
    await act(async () => { asked4.resolve(ok(serve({ page: 4 }))); await Promise.resolve(); });
    await waitFor(() => expect(list.mock.calls.at(-1)![0]).toMatchObject({ page: 3 })); // the last page of 45 posts, not page 1
    expect(screen.queryByTestId("posts-empty")).toBeNull();

    matching = 25; // shrinks again before page 3 is answered
    await act(async () => { asked3.resolve(ok(serve({ page: 3 }))); await Promise.resolve(); });
    await screen.findByText(/Trang 2 \/ 2/);
    expect(rows()).toBe(5);
    expect(list.mock.calls.slice(-3).map((c) => c[0].page)).toEqual([4, 3, 2]);
    expect(screen.queryByTestId("posts-empty")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(list.mock.calls.slice(-1)[0][0].page).toBe(2); // settled
  });

  it("when the total drops to zero the person lands on page 1, where 'no matching posts' is true - after exactly one more request, not a loop", async () => {
    matching = 45;
    renderInBlogGate(<PostsScreen />);
    await screen.findByText(/Trang 1 \/ 3/);
    const before = list.mock.calls.length;
    matching = 0;
    await userEvent.click(screen.getByText("Trang sau"));
    expect(await screen.findByTestId("posts-empty")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(list.mock.calls.length).toBe(before + 2);
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ page: 1 });
  });

  it("an answer for the page that was asked before the person changed the filter never moves the page of the new filter", async () => {
    matching = 21;
    renderInBlogGate(<PostsScreen />);
    await screen.findByText(/Trang 1 \/ 2/);
    const slow = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(slow.promise as never);
    await userEvent.click(screen.getByText("Trang sau")); // page 2, held
    await userEvent.selectOptions(screen.getByTestId("posts-status"), "Draft"); // page 1 of another filter: served by the default fake
    await waitFor(() => expect(list.mock.calls.at(-1)![0]).toMatchObject({ status: "Draft", page: 1 }));
    const calls = list.mock.calls.length;
    matching = 20;
    await act(async () => { slow.resolve(ok({ ...serve({ page: 2 }), page: 2 })); await Promise.resolve(); }); // the old, now empty and out-of-range answer arrives late
    await new Promise((r) => setTimeout(r, 50));
    expect(list.mock.calls.length).toBe(calls); // dropped: no recovery request for a page nobody is on
    expect(screen.getByTestId("posts-status")).toHaveValue("Draft");
  });
});
