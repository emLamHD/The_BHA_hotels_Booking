/**
 * BHA-BLOG-001-CP03-C7 (F4): the library is read a page at a time. When the total shrinks (a deletion, a filter, another person) the page the person is on can be
 * past the last one; the server then answers that page with NO items and the real total. The browser must go to the last page that exists - not show an empty
 * library and a navigation that has disappeared. A fake server with real paging semantics answers every read; the reads are deferred promises, so the order of
 * answers is the test's, not a clock's.
 */
import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlogMedia, BlogMediaList } from "@/lib/api/blog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  listMedia: vi.fn(),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));

import MediaBrowser from "./MediaBrowser";
import { BOTH, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { listMedia } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const read = vi.mocked(listMedia);
const PAGE_SIZE = 24;

const picture = (n: number): BlogMedia => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, contentType: "image/jpeg", byteSize: 1, width: 800, height: 600, createdAtUtc: "2026-10-20T08:00:00Z", displayName: `Ảnh ${n}`,
  originalFileName: `p${n}.jpg`, description: "", credit: "", sourceUrl: "", licence: "", focalX: 0.5, focalY: 0.5, version: 1, pipeline: "current", originalSha256: null,
  updatedAtUtc: "2026-10-20T08:00:00Z", variants: [], usage: { revisions: 0, inPublished: 0, inDrafts: 0 },
});

/** The server: `count` pictures, newest first; a page past the end is an empty list with the real total (the page is echoed). */
let count = 25;
let matching: ((p: BlogMedia) => boolean) | null = null;
const serve = (page: number, q?: string): BlogMediaList => {
  let all = Array.from({ length: count }, (_, i) => picture(i + 1));
  if (q) all = all.filter((p) => p.displayName.includes(q));
  if (matching) all = all.filter(matching);
  return { items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pageSize: PAGE_SIZE, total: all.length };
};
/** Reads that are answered when the test says so. */
interface Pending { page: number; q?: string; answer: (list?: BlogMediaList) => void }
let pending: Pending[] = [];
let manual = true;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  count = 25;
  matching = null;
  pending = [];
  manual = true;
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  read.mockReset();
  read.mockImplementation(((query: { page: number; q?: string }) => {
    if (!manual) return Promise.resolve(ok(serve(query.page, query.q)));
    const gate = deferred<ReturnType<typeof ok<BlogMediaList>>>();
    pending.push({ page: query.page, q: query.q, answer: (list) => gate.resolve(ok(list ?? serve(query.page, query.q))) });
    return gate.promise;
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function Harness({ selected }: { selected?: ReadonlySet<string> }) {
  const [token, setToken] = React.useState(0);
  return (
    <>
      <button type="button" data-testid="outside-change" onClick={() => setToken((n) => n + 1)} />
      <MediaBrowser canUpload={false} reloadToken={token} onActivate={() => {}} selectedIds={selected} />
    </>
  );
}
const requested = () => read.mock.calls.map((call) => (call[0] as { page: number }).page);
/** Answers the oldest unanswered read the way the server would. */
const answerNext = async () => { const next = pending.shift(); expect(next, "a read is waiting").toBeDefined(); await act(async () => { next!.answer(); await Promise.resolve(); }); };
const cards = () => screen.queryAllByTestId("media-card");
const goTo = async (page: number) => { for (let p = 1; p < page; p++) { await userEvent.click(screen.getByRole("button", { name: "Trang sau" })); await answerNext(); } };
const open = async () => { renderInBlogGate(<Harness />); await waitFor(() => expect(pending).toHaveLength(1)); await answerNext(); await screen.findByTestId("media-total"); };
const outsideChange = async () => { await userEvent.click(screen.getByTestId("outside-change")); };

describe("C7 F4 — the page shrinks away under the person", () => {
  it("25 pictures: the only picture of page 2 is deleted elsewhere - the library moves to page 1, the remaining 24 are there, and the empty message is never shown", async () => {
    await open();
    await goTo(2);
    expect(cards()).toHaveLength(1);
    count = 24; // the picture of page 2 was deleted
    await outsideChange();
    expect(pending.map((p) => p.page)).toEqual([2]);
    await answerNext(); // page 2 of 24 pictures: no items, total 24
    // the browser must already be reading page 1, and must not announce an empty library meanwhile
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([1]));
    expect(screen.queryByText(/Chưa có ảnh nào/)).toBeNull();
    await answerNext();
    await waitFor(() => expect(cards()).toHaveLength(24));
    expect(screen.getByTestId("media-total")).toHaveTextContent("24 ảnh");
    expect(requested()).toEqual([1, 2, 2, 1]); // no loop
    expect(screen.queryByText(/Chưa có ảnh nào/)).toBeNull();
  });

  it("a shrink of several pages lands on the new last page, not on page 1 and not on an empty page", async () => {
    count = 60; // 3 pages
    await open();
    await goTo(3);
    count = 30; // 2 pages now
    await outsideChange();
    await answerNext(); // page 3 of 30: empty
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([2]));
    await answerNext();
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(screen.getByText(/Trang 2 \/ 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeEnabled(); // the way back stays
  });

  it("down to a single page from page 4", async () => {
    count = 100;
    await open();
    await goTo(4);
    count = 10;
    await outsideChange();
    await answerNext();
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([1]));
    await answerNext();
    await waitFor(() => expect(cards()).toHaveLength(10));
    expect(requested().at(-1)).toBe(1);
  });

  it("everything deleted: page 1 is read, the library really is empty and says so, and nothing is read again", async () => {
    await open();
    await goTo(2);
    count = 0;
    await outsideChange();
    await answerNext(); // page 2 of 0
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([1]));
    await answerNext();
    expect(await screen.findByText(/Chưa có ảnh nào/)).toBeInTheDocument();
    expect(screen.getByTestId("media-total")).toHaveTextContent("0 ảnh");
    const total = read.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(read.mock.calls).toHaveLength(total); // no loop
    expect(pending).toHaveLength(0);
  });

  it("an empty library on page 1 is not a reason to read again", async () => {
    count = 0;
    await open();
    expect(await screen.findByText(/Chưa có ảnh nào/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("the search stays: the corrected read is the same query, one page earlier", async () => {
    count = 60;
    await open();
    await userEvent.type(screen.getByLabelText("Tìm ảnh"), "Ảnh 1");
    await userEvent.click(screen.getByRole("button", { name: "Tìm" }));
    await answerNext(); // page 1 of the matches (Ảnh 1, 10..19, 100.. -> 11 of 60)
    expect(requested().at(-1)).toBe(1);
    expect(read.mock.calls.at(-1)![0]).toMatchObject({ q: "Ảnh 1", page: 1 });
    manual = false;
    matching = null;
    // make the matches span two pages, go to page 2, then shrink them
    count = 100; // Ảnh 1, 10-19, 100: 12 matches - one page; to get two pages use a broader text
    await userEvent.clear(screen.getByLabelText("Tìm ảnh"));
    await userEvent.type(screen.getByLabelText("Tìm ảnh"), "Ảnh");
    await userEvent.click(screen.getByRole("button", { name: "Tìm" }));
    await waitFor(() => expect(screen.getByTestId("media-total")).toHaveTextContent("100 ảnh khớp"));
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await waitFor(() => expect(screen.getByText(/Trang 2 \/ 5/)).toBeInTheDocument());
    const before = read.mock.calls.length;
    count = 10; // the matches fit on one page now
    await outsideChange();
    await waitFor(() => expect(cards()).toHaveLength(10));
    expect(read.mock.calls.slice(before).every((call) => (call[0] as { q?: string }).q === "Ảnh")).toBe(true);
    expect(read.mock.calls.at(-1)![0]).toMatchObject({ q: "Ảnh", page: 1 });
    expect(screen.getByTestId("media-total")).toHaveTextContent("10 ảnh khớp “Ảnh”");
  });

  it("a late answer for the page the person already left does not move them, and an out-of-range answer for it is dropped, not obeyed", async () => {
    await open();
    await goTo(2);
    count = 24;
    await outsideChange(); // read A: page 2, will be answered late
    const a = pending.shift()!;
    await userEvent.click(screen.getByRole("button", { name: "Trang trước" })); // read B: page 1
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([1]));
    await answerNext(); // B: 24 pictures on page 1
    await waitFor(() => expect(cards()).toHaveLength(24));
    await act(async () => { a.answer(); await Promise.resolve(); }); // A, late: page 2 of 24 - empty
    await new Promise((r) => setTimeout(r, 30));
    expect(requested()).toEqual([1, 2, 2, 1]); // nothing was asked again because of A
    expect(cards()).toHaveLength(24);
    expect(screen.getByTestId("media-total")).toHaveTextContent("24 ảnh");
  });

  it("a click on Next while a corrected read is on its way does not fight it", async () => {
    count = 60;
    await open();
    await goTo(3);
    count = 30;
    await outsideChange();
    await answerNext(); // page 3 of 30: empty -> reads page 2
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([2]));
    await answerNext();
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  });

  it("the picker's selection is kept across the correction (the same component serves the picker)", async () => {
    const chosen = picture(3).id;
    renderInBlogGate(<Harness selected={new Set([chosen])} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await answerNext();
    await screen.findByTestId("media-total");
    await goTo(2);
    count = 24;
    await outsideChange();
    await answerNext();
    await waitFor(() => expect(pending.map((p) => p.page)).toEqual([1]));
    await answerNext();
    await waitFor(() => expect(cards()).toHaveLength(24));
    const card = cards().find((c) => c.getAttribute("data-media-id") === chosen)!;
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByText("Ảnh 3")).toBeInTheDocument();
  });

  it("an ordinary page 2 that exists is read once and left alone", async () => {
    await open();
    await goTo(2);
    expect(cards()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(requested()).toEqual([1, 2]);
    expect(screen.getByText(/Trang 2 \/ 2/)).toBeInTheDocument();
  });
});
