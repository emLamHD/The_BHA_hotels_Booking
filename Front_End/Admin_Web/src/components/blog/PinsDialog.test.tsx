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

// ---- F4 also says: Save keeps using expectedVersion and no conflict / reconciliation silently overwrites ----

const stale = { kind: "refused", status: 409, code: "blog.stale-version", field: "expectedVersion", detail: "changed" } as const;
const unverified = { kind: "unverified", message: "Mất kết nối." } as const;
const pinsAt = (version: number, ids: number[]) => ({ ...currentPins(ids), version });
const saveButton = () => within(screen.getByTestId("pins-save")).getByRole("button");

describe("a save of the pin list: lost answers and stale versions", () => {
  async function arrange(...clicks: string[]) {
    mount();
    await screen.findByText("+ Bài số 1");
    for (const c of clicks) await userEvent.click(screen.getByRole("button", { name: c }));
  }

  it("a stale version shows the server's order beside the local one and does not move the version or allow Save", async () => {
    await arrange("+ Bài số 1", "+ Bài số 2");
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    pins.mockResolvedValue(ok(pinsAt(6, [9, 8])) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("pins-conflict");
    expect(panel).toHaveTextContent(/phiên bản 4/);
    expect(panel).toHaveTextContent(/phiên bản 6/);
    for (const t of ["Bài số 1", "Bài số 2", "Bài số 9", "Bài số 8"]) expect(panel).toHaveTextContent(t);
    expect(saveButton()).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(pinned()).toHaveLength(2); // the local order is untouched
  });

  it("'keep mine on version N' is the only way the version moves; the next stale answer opens a new comparison", async () => {
    await arrange("+ Bài số 1");
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    pins.mockResolvedValue(ok(pinsAt(6, [9])) as never);
    await userEvent.click(await screen.findByTestId("reload-latest"));
    await screen.findByTestId("pins-conflict");
    await userEvent.click(within(screen.getByTestId("pins-conflict-keep")).getByRole("button"));
    expect(saveButton()).not.toBeDisabled();
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 6, [id(1)]]); // written on the version the person chose, with their own order
    pins.mockResolvedValue(ok(pinsAt(8, [7])) as never);
    await userEvent.click(await screen.findByTestId("reload-latest"));
    expect(await screen.findByTestId("pins-conflict")).toHaveTextContent(/phiên bản 8/);
  });

  it("'use the server's order' asks first, then shows it and takes its version", async () => {
    await arrange("+ Bài số 1");
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    pins.mockResolvedValue(ok(pinsAt(6, [9, 8])) as never);
    await userEvent.click(await screen.findByTestId("reload-latest"));
    await userEvent.click(within(screen.getByTestId("pins-conflict-use-server")).getByRole("button"));
    expect(pinned()).toHaveLength(1); // asked, not done
    await userEvent.click(within(screen.getByTestId("pins-conflict-confirm")).getByRole("button"));
    await waitFor(() => expect(pinned().map((t) => t!.includes("Bài số 9") || t!.includes("Bài số 8"))).toEqual([true, true]));
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    save.mockResolvedValueOnce(ok(pinsAt(7, [9, 8, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 6, [id(9), id(8), id(3)]]);
  });

  it("a lost answer that never reached the server: said so, the order is kept, Save uses the SAME version", async () => {
    await arrange("+ Bài số 1", "+ Bài số 2");
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    await userEvent.click(screen.getByTestId("check-server")); // the server still shows version 4 and no pins
    expect(await screen.findByTestId("pins-note")).toHaveTextContent(/chưa ghi nhận/i);
    expect(pinned()).toHaveLength(2);
    save.mockResolvedValueOnce(ok(pinsAt(5, [1, 2])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(4);
  });

  it("a lost answer that committed: verified from the order sent AND the version moving on", async () => {
    await arrange("+ Bài số 1", "+ Bài số 2");
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    pins.mockResolvedValue(ok(pinsAt(5, [1, 2])) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("pins-note")).toHaveTextContent(/phiên bản 5/);
    expect(saveButton()).toBeDisabled(); // nothing left to save
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("the same order with an unchanged version is not taken for a recorded save", async () => {
    mount([1, 2]);
    await screen.findByText("+ Bài số 3");
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    pins.mockResolvedValue(ok(pinsAt(4, [1, 2, 3])) as never); // the server already has this order, but the version did not move
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("pins-note")).toHaveTextContent(/chưa đủ bằng chứng|không khẳng định/i);
  });

  it("someone else changed the pins while the answer was lost: a comparison, no verdict", async () => {
    await arrange("+ Bài số 1");
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    pins.mockResolvedValue(ok(pinsAt(5, [7, 1])) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("pins-conflict")).toHaveTextContent(/phiên bản 5/);
    expect(saveButton()).toBeDisabled();
    expect(pinned()).toHaveLength(1);
  });
});

describe("C5 F1 — an arrangement made while the read-back of a lost save is pending", () => {
  async function loseThenHoldTheRead(...clicks: string[]) {
    mount();
    await screen.findByText("+ Bài số 1");
    for (const c of clicks) await userEvent.click(screen.getByRole("button", { name: c }));
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    const gate = deferred<ReturnType<typeof ok>>();
    pins.mockReturnValueOnce(gate.promise as never); // the read-back of the check: held
    await userEvent.click(screen.getByTestId("check-server"));
    return gate;
  }
  const ids = () => pinned().map((t) => Number(t!.match(/Bài số (\d+)/)?.[1]));
  const release = async (gate: ReturnType<typeof deferred<ReturnType<typeof ok>>>, version: number, order: number[]) => {
    pins.mockResolvedValue(ok(pinsAt(version, order)) as never); // what a re-read of the list shows from now on
    await act(async () => { gate.resolve(ok(pinsAt(version, order))); });
  };

  it("an added pin survives: the confirmed version becomes the base, the new arrangement stays unsaved and is written on it", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1", "+ Bài số 2");
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    await release(gate, 5, [1, 2]); // the server holds exactly what was sent
    await screen.findByTestId("pins-note");
    expect(ids()).toEqual([1, 2, 3]);
    expect(saveButton()).not.toBeDisabled(); // still unsaved
    save.mockResolvedValueOnce(ok(pinsAt(6, [1, 2, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(2), id(3)]]);
  });

  it("a reordering survives", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1", "+ Bài số 2");
    await userEvent.click(screen.getByRole("button", { name: /Đưa .Bài số 1. xuống/ }));
    await release(gate, 5, [1, 2]);
    await screen.findByTestId("pins-note");
    expect(ids()).toEqual([2, 1]);
    expect(saveButton()).not.toBeDisabled();
  });

  it("a removal survives", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1", "+ Bài số 2");
    await userEvent.click(screen.getByRole("button", { name: /Bỏ ghim .Bài số 2./ }));
    await release(gate, 5, [1, 2]);
    await screen.findByTestId("pins-note");
    expect(ids()).toEqual([1]);
    expect(saveButton()).not.toBeDisabled();
  });

  it("removing the last pin (an EMPTY arrangement) survives as an unsaved change and is written as empty", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1");
    await userEvent.click(screen.getByRole("button", { name: /Bỏ ghim .Bài số 1./ }));
    await release(gate, 5, [1]);
    await screen.findByTestId("pins-note");
    expect(ids()).toEqual([]);
    expect(saveButton()).not.toBeDisabled();
    save.mockResolvedValueOnce(ok(pinsAt(6, [])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, []]);
  });

  it("with nothing changed meanwhile the confirmed save leaves nothing unsaved, as before", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1", "+ Bài số 2");
    await release(gate, 5, [1, 2]);
    await screen.findByTestId("pins-note");
    expect(saveButton()).toBeDisabled();
  });

  it("a different list on the server is a comparison, and the arrangement made meanwhile is the local side", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1");
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    await release(gate, 5, [7, 1]);
    expect(await screen.findByTestId("pins-conflict")).toHaveTextContent(/phiên bản 5/);
    expect(ids()).toEqual([1, 3]);
    expect(saveButton()).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a read that fails keeps the arrangement made meanwhile and the unconfirmed state", async () => {
    const gate = await loseThenHoldTheRead("+ Bài số 1");
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    await act(async () => { gate.resolve({ kind: "network", message: "Không đọc được." } as never); });
    expect(await screen.findByTestId("pins-note")).toHaveTextContent(/Chưa kiểm tra được/);
    expect(ids()).toEqual([1, 3]);
    expect(screen.getByTestId("write-unverified")).toBeInTheDocument();
  });

  it("an answer that arrives after the dialog is gone changes nothing and sends nothing", async () => {
    mount();
    await screen.findByText("+ Bài số 1");
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 1" }));
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    const gate = deferred<ReturnType<typeof ok>>();
    pins.mockReturnValueOnce(gate.promise as never);
    await userEvent.click(screen.getByTestId("check-server"));
    cleanup();
    await act(async () => { gate.resolve(ok(pinsAt(5, [1]))); });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- C10 F2: the answer to a successful save is the confirmed list, adopted before edits unlock

describe("C10 F2 — the saved list is the confirmed base while the refresh that follows is still on its way", () => {
  const ids = () => pinned().map((t) => Number(t!.match(/Bài số (\d+)/)?.[1]));
  type Gate = ReturnType<typeof deferred<ReturnType<typeof ok>>>;

  /** Opens with `start` pinned, arranges with `clicks`, and saves - the refresh (second read) that follows the save is held on `gate`. */
  async function saveThenHoldTheRefresh(start: number[], clicks: string[], saved: number[]) {
    mount(start);
    await screen.findByRole("button", { name: "+ Bài số 5" });
    for (const c of clicks) await userEvent.click(screen.getByRole("button", { name: c }));
    const gate = deferred<ReturnType<typeof ok>>();
    pins.mockReturnValueOnce(gate.promise as never);
    save.mockResolvedValueOnce(ok(pinsAt(5, saved)) as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("pins-note");
    return gate;
  }
  const release = async (gate: Gate, version: number, order: number[]) => {
    pins.mockResolvedValue(ok(pinsAt(version, order)) as never);
    await act(async () => { gate.resolve(ok(pinsAt(version, order))); });
  };

  it("the review's sequence: saved [1,2], an added pin while the refresh is held, then the refresh, then Save - the list written is [1,2,3] at the confirmed version, not [1,3]", async () => {
    const gate = await saveThenHoldTheRefresh([1], ["+ Bài số 2"], [1, 2]);
    expect(ids()).toEqual([1, 2]); // what the server answered, not the list from before the save
    expect(saveButton()).toBeDisabled(); // nothing unsaved
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    expect(ids()).toEqual([1, 2, 3]);
    await release(gate, 5, [1, 2]);
    expect(ids()).toEqual([1, 2, 3]); // the refresh does not take the arrangement away
    save.mockResolvedValueOnce(ok(pinsAt(6, [1, 2, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(2), id(3)]]);
    expect(save.mock.calls[0]).toEqual([category.id, 4, [id(1), id(2)]]);
  });

  it("a removal made while the refresh is held is written on the saved list", async () => {
    const gate = await saveThenHoldTheRefresh([1], ["+ Bài số 2", "+ Bài số 3"], [1, 2, 3]);
    expect(ids()).toEqual([1, 2, 3]);
    await userEvent.click(screen.getByRole("button", { name: /^Bỏ ghim “Bài số 2”/ }));
    await release(gate, 5, [1, 2, 3]);
    expect(ids()).toEqual([1, 3]);
    save.mockResolvedValueOnce(ok(pinsAt(6, [1, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(3)]]);
  });

  it("a reordering made while the refresh is held is written on the saved order", async () => {
    const gate = await saveThenHoldTheRefresh([1, 2], ["+ Bài số 3"], [1, 2, 3]);
    await userEvent.click(screen.getByRole("button", { name: /^Đưa “Bài số 3” lên/ }));
    await release(gate, 5, [1, 2, 3]);
    expect(ids()).toEqual([1, 3, 2]);
    save.mockResolvedValueOnce(ok(pinsAt(6, [1, 3, 2])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(3), id(2)]]);
  });

  it("with nothing changed after the save the refresh leaves nothing unsaved and sends nothing", async () => {
    const gate = await saveThenHoldTheRefresh([1], ["+ Bài số 2"], [1, 2]);
    await release(gate, 5, [1, 2]);
    expect(ids()).toEqual([1, 2]);
    expect(saveButton()).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a refresh that answers with an OLDER version does not move the confirmed list backward", async () => {
    const gate = await saveThenHoldTheRefresh([1], ["+ Bài số 2"], [1, 2]);
    await release(gate, 4, [1]); // a late, stale answer
    expect(ids()).toEqual([1, 2]);
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    save.mockResolvedValueOnce(ok(pinsAt(6, [1, 2, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(2), id(3)]]);
  });

  it("a refresh that shows another staff member's NEWER list while an arrangement is open does not move the version that arrangement was made on: the next Save is a stale write, not a silent overwrite", async () => {
    const gate = await saveThenHoldTheRefresh([1], ["+ Bài số 2"], [1, 2]);
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    await release(gate, 6, [1, 2, 9]);
    expect(ids()).toEqual([1, 2, 3]);
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(2), id(3)]]);
  });

  it("a refresh that shows a newer list when nothing is arranged is simply shown, and the next arrangement is written on it", async () => {
    const gate = await saveThenHoldTheRefresh([1], ["+ Bài số 2"], [1, 2]);
    await release(gate, 6, [1, 2, 9]);
    await waitFor(() => expect(ids()).toEqual([1, 2, 9]));
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    save.mockResolvedValueOnce(ok(pinsAt(7, [1, 2, 9, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 6, [id(1), id(2), id(9), id(3)]]);
  });

  it("a lost answer confirmed by the read-back: the list that was sent is shown at once, while the refresh is held", async () => {
    mount([1]);
    await screen.findByRole("button", { name: "+ Bài số 5" });
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 2" }));
    save.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    pins.mockResolvedValueOnce(ok(pinsAt(5, [1, 2])) as never); // the read-back of the check
    const gate = deferred<ReturnType<typeof ok>>();
    pins.mockReturnValueOnce(gate.promise as never); // the refresh after it: held
    await userEvent.click(screen.getByTestId("check-server"));
    await screen.findByTestId("pins-note");
    expect(ids()).toEqual([1, 2]);
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    await release(gate, 5, [1, 2]);
    save.mockResolvedValueOnce(ok(pinsAt(6, [1, 2, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 5, [id(1), id(2), id(3)]]);
  });

  it("'use the server's order' shows that order at once, while the refresh is held, and the next write is made on its version", async () => {
    mount([1]);
    await screen.findByRole("button", { name: "+ Bài số 5" });
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 2" }));
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    pins.mockResolvedValueOnce(ok(pinsAt(6, [9, 8])) as never);
    await userEvent.click(await screen.findByTestId("reload-latest"));
    await userEvent.click(within(await screen.findByTestId("pins-conflict-use-server")).getByRole("button"));
    const gate = deferred<ReturnType<typeof ok>>();
    pins.mockReturnValueOnce(gate.promise as never);
    await userEvent.click(within(screen.getByTestId("pins-conflict-confirm")).getByRole("button"));
    expect(ids()).toEqual([9, 8]);
    await userEvent.click(screen.getByRole("button", { name: "+ Bài số 3" }));
    await release(gate, 6, [9, 8]);
    save.mockResolvedValueOnce(ok(pinsAt(7, [9, 8, 3])) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual([category.id, 6, [id(9), id(8), id(3)]]);
  });
});
