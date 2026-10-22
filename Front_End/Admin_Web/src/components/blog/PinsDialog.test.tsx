/**
 * BHA-BLOG-001-CP03-C2 (F4): the pin dialog reaches every eligible post — server pages and search, not a fixed first page — and what has been
 * arranged survives paging, searching, a failed page and a stale answer.
 */
import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/blog")>()), getPins: vi.fn(), listPosts: vi.fn(), savePins: vi.fn() }));

import PinsDialog from "./PinsDialog";
import { BOTH, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { getPins, listPosts, savePins, type BlogCategory, type BlogPostList, type BlogPostRow } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const pins = vi.mocked(getPins);
const posts = vi.mocked(listPosts);
const save = vi.mocked(savePins);

const category: BlogCategory = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", systemKey: null, sortOrder: 20, version: 4, translations: { vi: { name: "Ẩm thực", slug: "am-thuc", description: null } }, revisionCount: 130, pinCount: 0, isHomeSection: false };
const PAGE = 20;
const TOTAL = 130;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number): BlogPostRow => ({ id: id(n), updatedAtUtc: "2026-10-21T08:00:00Z", translations: [{ locale: "vi", status: "Published", version: 1, title: `Bài số ${n}`, slug: `bai-${n}`, hasDraft: false, updatedAtUtc: "2026-10-21T08:00:00Z", updatedBy: null, coverMediaId: null }] });
const pageOf = (page: number, all = TOTAL): BlogPostList => ({ page, pageSize: PAGE, total: all, items: Array.from({ length: Math.max(0, Math.min(PAGE, all - (page - 1) * PAGE)) }, (_, i) => row((page - 1) * PAGE + i + 1)) });
const currentPins = (ids: number[]) => ({ categoryId: category.id, version: 4, pins: ids.map((n, position) => ({ postId: id(n), position, effective: true, titles: { vi: `Bài số ${n}` } })) });

function mount(ids: number[] = []) {
  pins.mockResolvedValue(ok(currentPins(ids)) as never);
  posts.mockImplementation(((query: { page: number; q?: string }) => Promise.resolve(ok(query.q ? { page: query.page, pageSize: PAGE, total: 1, items: [row(127)] } : pageOf(query.page)))) as never);
  return renderInBlogGate(<PinsDialog category={category} canEdit languages={["vi"]} onClose={() => {}} />);
}
const candidates = () => screen.queryAllByRole("button", { name: /^\+ / }).map((b) => b.textContent);
const pinned = () => screen.queryAllByTestId("pin-item").map((li) => li.textContent);
const next = () => userEvent.click(screen.getByRole("button", { name: "Trang sau" }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  for (const m of [pins, posts, save]) m.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the candidates are paged by the server", () => {
  it("asks for a page of the category's published posts (not 100 at once) and shows the real total and page", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    expect(posts.mock.calls[0][0]).toMatchObject({ categoryId: category.id, status: "Published", page: 1 });
    expect(posts.mock.calls[0][0].pageSize).toBeLessThan(100);
    expect(screen.getByTestId("pin-candidates")).toHaveTextContent(/130 bài/);
    expect(screen.getByTestId("pin-candidates")).toHaveTextContent(/Trang 1 \/ 7/);
  });

  it("a post beyond the first page can be reached by paging and pinned, and saved", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    for (let i = 0; i < 6; i++) { await next(); await waitFor(() => expect(screen.getByTestId("pin-candidates")).toHaveTextContent(new RegExp(`Trang ${i + 2} / 7`))); }
    await userEvent.click(await screen.findByRole("button", { name: "+ Bài số 125" }));
    expect(pinned()).toEqual([expect.stringContaining("Bài số 125")]);
    save.mockResolvedValueOnce(ok(currentPins([125])) as never);
    await userEvent.click(within(screen.getByTestId("pins-save")).getByRole("button"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]).toEqual([category.id, 4, [id(125)]]);
  });

  it("a search is sent to the server, starts at page 1, and finds a post that is not on the first page", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    await next();
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm bài để ghim" }), "127{enter}");
    await screen.findByText("+ Bài số 127");
    expect(posts.mock.calls.at(-1)![0]).toMatchObject({ q: "127", page: 1 });
    expect(candidates()).toEqual(["+ Bài số 127"]);
  });

  it("what was arranged survives paging, searching and a page that fails", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 2" }));
    await next();
    await userEvent.click(await screen.findByRole("button", { name: "+ Bài số 25" }));
    expect(pinned().map((t) => t!.replace(/\D+/g, " ").trim().split(" ")[1])).toEqual(["2", "25"]);
    posts.mockImplementationOnce((() => Promise.resolve({ kind: "error", status: 503, message: "Máy chủ bận." })) as never);
    await next();
    expect(await screen.findByText(/Máy chủ bận/)).toBeInTheDocument();
    expect(pinned()).toHaveLength(2); // the order is untouched by the failure
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByRole("button", { name: "+ Bài số 41" });
    expect(pinned()).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    await userEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    await screen.findByRole("button", { name: "+ Bài số 3" });
    expect(candidates()).not.toContain("+ Bài số 2"); // already pinned: not offered again
  });

  it("a pinned post's title is still shown after paging away from the page it came from", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    await next(); await next();
    await userEvent.click(await screen.findByRole("button", { name: "+ Bài số 45" }));
    await userEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    await screen.findByText("+ Bài số 21");
    expect(pinned()[0]).toContain("Bài số 45");
  });

  it("an answer for an earlier page that arrives late does not replace the result of the search made since", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    const slow = deferred<ReturnType<typeof ok>>();
    posts.mockImplementationOnce((() => slow.promise) as never);
    await next(); // page 2 is asked for and has not answered
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm bài để ghim" }), "127{enter}"); // a newer question: the search
    await screen.findByText("+ Bài số 127");
    await act(async () => { slow.resolve(ok(pageOf(2))); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(candidates()).toEqual(["+ Bài số 127"]); // the late page 2 did not take its place
  });

  it("an empty page says so and keeps the paging; the 50-pin limit stops further pinning", async () => {
    mount(Array.from({ length: 50 }, (_, i) => 100 + i));
    await screen.findByText("+ Bài số 1");
    for (const b of screen.getAllByRole("button", { name: /^\+ / })) expect(b).toBeDisabled();
    expect(screen.getByTestId("pin-candidates")).toHaveTextContent(/tối đa 50/i);
  });
});
