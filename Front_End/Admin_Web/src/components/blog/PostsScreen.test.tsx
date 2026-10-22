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
});
