/** C11: real picker + browser + queue + Staff write slot; only the API boundary is deferred. */
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlogMedia, UploadOutcome } from "@/lib/api/blog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (original) => ({ ...(await original<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (original) => ({
  ...(await original<typeof import("@/lib/api/blog")>()), listMedia: vi.fn(), uploadMedia: vi.fn(), getMedia: vi.fn(),
  fetchStaffImage: vi.fn(async () => ({ kind: "config", message: "no thumbnail in jsdom" })),
}));
import MediaPickerDialog from "./MediaPickerDialog";
import { fetchStaffSession } from "@/lib/api/staff";
import { getMedia, listMedia, uploadMedia } from "@/lib/api/blog";
import { EDITOR, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { useWebsiteHost, type WebsiteHost } from "@/components/website/WebsiteAccessGate";

const picture = (id: string): BlogMedia => ({
  id, contentType: "image/png", byteSize: 1000, width: 800, height: 600, createdAtUtc: "2026-10-21T08:00:00Z", displayName: id, originalFileName: `${id}.png`,
  description: `description ${id}`, credit: "", sourceUrl: "", licence: "", focalX: 0.5, focalY: 0.5, version: 1, pipeline: "current", originalSha256: "sha",
  updatedAtUtc: "2026-10-21T08:00:00Z", variants: [], usage: { revisions: 0, inPublished: 0, inDrafts: 0 },
});
const absent = { kind: "refused" as const, status: 404, code: "blog.not-found", field: "id", detail: "missing" };
const choose = vi.fn();
const close = vi.fn();
let host: WebsiteHost;
const calls: { id: string; finish: (value: UploadOutcome) => void; abort: ReturnType<typeof vi.fn>; progress: (sent: number, total: number) => void }[] = [];
function HostProbe() { const current = useWebsiteHost(); React.useEffect(() => { host = current; }, [current]); return null; }
function Shell({ title = "Cover", multiple = false }: { title?: string; multiple?: boolean }) {
  const [open, setOpen] = React.useState(true);
  return <><HostProbe />{open && <MediaPickerDialog title={title} multiple={multiple} min={2} max={12} canUpload onChoose={(value) => { choose(value); setOpen(false); }} onClose={() => { close(); setOpen(false); }} />}</>;
}
const slotFree = () => { let free = false; act(() => { free = host.beginWrite(); if (free) host.endWrite(); }); return free; };
const files = () => ["a.png", "b.png"].map((name) => new File([new Uint8Array(1000)], name, { type: "image/png" }));
const add = () => fireEvent.change(screen.getByTestId("upload-input"), { target: { files: files() } });
const finish = async (index: number, outcome: UploadOutcome) => { await act(async () => calls[index].finish(outcome)); };
const rows = () => screen.getAllByTestId("upload-item").map((row) => row.getAttribute("data-status"));
async function open(props: { title?: string; multiple?: boolean } = {}) {
  renderInBlogGate(<Shell {...props} />);
  await screen.findAllByTestId("media-card");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
  vi.mocked(listMedia).mockResolvedValue(ok({ items: [picture("one"), picture("two")], total: 2, page: 1, pageSize: 24 }));
  vi.mocked(getMedia).mockReset();
  choose.mockReset(); close.mockReset(); calls.length = 0;
  vi.mocked(uploadMedia).mockImplementation((file, id, progress) => {
    const done = deferred<UploadOutcome>();
    const abort = vi.fn(() => done.resolve({ kind: "aborted" }));
    calls.push({ id, finish: done.resolve, abort, progress });
    return { done: done.promise, abort };
  });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("C11 F1 — single completion waits for uploads", () => {
  it.each(["Ảnh bìa", "Ảnh OG", "Ảnh nội dung"])("%s: selection retains the active and waiting upload, then chooses once", async (title) => {
    await open({ title });
    add();
    expect(calls).toHaveLength(1);
    // Dispatch directly too: the action must guard even when a disabled-looking button receives an event.
    fireEvent.click(screen.getAllByTestId("media-card")[0]);
    expect(choose).not.toHaveBeenCalled();
    expect(screen.getByTestId("media-picker")).toBeInTheDocument();
    expect(rows()).toEqual(["sending", "waiting"]);
    expect(calls[0].abort).not.toHaveBeenCalled();
    expect(slotFree()).toBe(false);
    expect(screen.getAllByTestId("media-card")[0]).toBeDisabled();
    await userEvent.type(screen.getAllByTestId("media-card")[0], "{Enter}{Space}");
    expect(choose).not.toHaveBeenCalled();
    await finish(0, { kind: "ok", media: picture(calls[0].id) });
    expect(calls).toHaveLength(2);
    await finish(1, { kind: "ok", media: picture(calls[1].id) });
    await userEvent.click(screen.getAllByTestId("media-card")[1]);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith([{ id: "two", description: "description two" }]);
    expect(calls.every((call) => call.abort.mock.calls.length === 0)).toBe(true);
    expect(slotFree()).toBe(true);
  });

  it("a card event in the same batch as upload starts cannot use the idle render", async () => {
    await open();
    const card = screen.getAllByTestId("media-card")[0];
    act(() => { add(); card.click(); });
    expect(choose).not.toHaveBeenCalled();
    expect(rows()).toEqual(["sending", "waiting"]);
    expect(calls[0].abort).not.toHaveBeenCalled();
  });

  it("multi selection keeps its order and confirmation stays guarded until both uploads end", async () => {
    await open({ multiple: true });
    await userEvent.click(screen.getAllByTestId("media-card")[1]);
    await userEvent.click(screen.getAllByTestId("media-card")[0]);
    const confirm = within(screen.getByTestId("picker-confirm")).getByRole("button");
    act(() => { add(); confirm.click(); });
    expect(choose).not.toHaveBeenCalled();
    expect(confirm).toBeDisabled();
    expect(rows()).toEqual(["sending", "waiting"]);
    await finish(0, { kind: "ok", media: picture(calls[0].id) });
    await finish(1, { kind: "ok", media: picture(calls[1].id) });
    await userEvent.click(within(screen.getByTestId("picker-confirm")).getByRole("button"));
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith([{ id: "two", description: "description two" }, { id: "one", description: "description one" }]);
  });
});

describe("C11 combined F1/F2 — a stale read cannot unlock completion during resend", () => {
  it("late 404 leaves progress, write ownership and picker lifetime intact, then drains the following item", async () => {
    await open();
    add();
    await finish(0, { kind: "unconfirmed", message: "lost answer" });
    // b is now sending; finish it so a's explicit same-id resend can start immediately.
    await finish(1, { kind: "ok", media: picture(calls[1].id) });
    vi.mocked(getMedia).mockResolvedValueOnce(absent);
    await userEvent.click(screen.getByRole("button", { name: "Kiểm tra máy chủ" }));
    const old = deferred<Awaited<ReturnType<typeof getMedia>>>();
    vi.mocked(getMedia).mockReturnValueOnce(old.promise);
    await userEvent.click(screen.getByRole("button", { name: "Kiểm tra máy chủ" }));
    await userEvent.click(screen.getByRole("button", { name: "Gửi lại (cùng mã)" }));
    expect(calls).toHaveLength(3);
    expect(calls[2].id).toBe(calls[0].id);
    act(() => calls[2].progress(400, 1000));
    // Add another file while resend owns the slot; it must remain waiting and then drain once.
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [files()[0]] } });
    await act(async () => old.resolve(absent));
    expect(rows()).toEqual(["sending", "done", "waiting"]);
    expect(within(screen.getAllByTestId("upload-item")[0]).getByRole("progressbar")).toHaveAttribute("value", "40");
    expect(slotFree()).toBe(false);
    fireEvent.click(screen.getAllByTestId("media-card")[0]);
    expect(choose).not.toHaveBeenCalled();
    expect(screen.getByTestId("media-picker")).toBeInTheDocument();
    expect(calls[2].abort).not.toHaveBeenCalled();
    await finish(2, { kind: "ok", media: picture(calls[2].id) });
    expect(calls).toHaveLength(4);
    await finish(3, { kind: "ok", media: picture(calls[3].id) });
    expect(vi.mocked(getMedia)).toHaveBeenCalledTimes(2);
    expect(slotFree()).toBe(true);
    await userEvent.click(screen.getAllByTestId("media-card")[0]);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(calls.every((call) => call.abort.mock.calls.length === 0)).toBe(true);
  });
});
