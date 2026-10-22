/**
 * BHA-BLOG-001-CP03-C4 (F3, F4): the picture dialog. A successful save acknowledges only what was SENT, so what is typed (or moved on the focal picker)
 * after the click survives it; a lost answer is judged against what was sent; a stale version is a comparison of two complete states that keeps the local
 * input, locks Save, and moves the version only when the person says "keep mine".
 */
import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  getMedia: vi.fn(), saveMedia: vi.fn(), getMediaUsage: vi.fn(), deleteMedia: vi.fn(),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));

import MediaDetailDialog from "./MediaDetailDialog";
import { BOTH, EDITOR, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { getMedia, getMediaUsage, saveMedia, type BlogMedia } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const read = vi.mocked(getMedia);
const write = vi.mocked(saveMedia);
const usage = vi.mocked(getMediaUsage);

const M = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const stale = { kind: "refused", status: 409, code: "blog.stale-version", field: "expectedVersion", detail: "changed" } as const;
const unverified = { kind: "unverified", message: "Mất kết nối." } as const;
const media = (over: Partial<BlogMedia> = {}): BlogMedia => ({
  id: M, contentType: "image/jpeg", byteSize: 2048, width: 800, height: 600, createdAtUtc: "2026-10-20T08:00:00Z", displayName: "Ảnh biển", originalFileName: "beach.jpg",
  description: "Mô tả", credit: "Ban biên tập", sourceUrl: "", licence: "", focalX: 0.5, focalY: 0.5, version: 3, pipeline: "current", originalSha256: null,
  updatedAtUtc: "2026-10-20T08:00:00Z", variants: [], usage: { revisions: 0, inPublished: 0, inDrafts: 0 }, ...over,
});

const name = () => screen.getByTestId("media-name") as HTMLInputElement;
const credit = () => screen.getByTestId("media-credit") as HTMLInputElement;
const focalX = () => screen.getByLabelText("Điểm lấy nét ngang") as HTMLInputElement;
const saveButton = () => within(screen.getByTestId("media-save")).getByRole("button");
const btn = (id: string) => within(screen.getByTestId(id)).getByRole("button");

async function open(as = BOTH, onChanged = vi.fn(), onClose = vi.fn()) {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: as });
  read.mockResolvedValueOnce(ok(media()) as never);
  const view = renderInBlogGate(<MediaDetailDialog mediaId={M} onClose={onClose} onChanged={onChanged} />);
  await screen.findByTestId("media-name");
  return { ...view, onChanged, onClose };
}
async function type(input: HTMLInputElement, value: string) {
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  for (const m of [read, write]) m.mockReset();
  usage.mockReset();
  usage.mockResolvedValue(ok({ items: [], total: 0, truncated: false }) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("F3 — a save that succeeds does not clear what was typed after it was sent", () => {
  it("keeps newer metadata and a newer focal point, marks them unsaved, and writes them on the confirmed version next", async () => {
    const { onChanged } = await open();
    const gate = deferred<ReturnType<typeof ok>>();
    write.mockReturnValueOnce(gate.promise as never);
    await type(name(), "Tên đã gửi");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-pending");
    expect(write.mock.calls[0][1]).toBe(3);
    expect(write.mock.calls[0][2]).toMatchObject({ displayName: "Tên đã gửi", focalX: 0.5 });

    // typed after the click, while the answer is on its way: another field, the same field again, and the focal point
    await type(credit(), "Nhiếp ảnh gia mới");
    await userEvent.type(name(), " thêm");
    await userEvent.clear(focalX());
    await userEvent.type(focalX(), "0.8");
    gate.resolve(ok(media({ displayName: "Tên đã gửi", version: 4 })));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    expect(name().value).toBe("Tên đã gửi thêm");
    expect(credit().value).toBe("Nhiếp ảnh gia mới");
    expect(focalX().value).toBe("0.8");
    expect(saveButton()).not.toBeDisabled(); // still unsaved: they were not part of the request
    write.mockResolvedValueOnce(ok(media({ displayName: "Tên đã gửi thêm", credit: "Nhiếp ảnh gia mới", focalX: 0.8, version: 5 })) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toBe(4); // the confirmed version, not the one first read
    expect(write.mock.calls[1][2]).toMatchObject({ displayName: "Tên đã gửi thêm", credit: "Nhiếp ảnh gia mới", focalX: 0.8 });
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it("with nothing typed after the click the dialog shows the saved values and is not unsaved", async () => {
    await open();
    write.mockResolvedValueOnce(ok(media({ displayName: "Tên mới", version: 4 })) as never);
    await type(name(), "Tên mới");
    await userEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(name().value).toBe("Tên mới");
  });

  it("an edit that puts a field back to what the server had is not unsaved either", async () => {
    await open();
    const gate = deferred<ReturnType<typeof ok>>();
    write.mockReturnValueOnce(gate.promise as never);
    await type(name(), "Tên mới");
    await userEvent.click(saveButton());
    await type(name(), "Ảnh biển"); // back to the original while pending
    gate.resolve(ok(media({ displayName: "Tên mới", version: 4 })));
    await waitFor(() => expect(name().value).toBe("Ảnh biển"));
    expect(saveButton()).not.toBeDisabled(); // the server now holds "Tên mới": "Ảnh biển" IS a change
  });
});

describe("F3 — a lost answer is judged against what was sent", () => {
  async function lose() {
    const view = await open();
    write.mockResolvedValueOnce(unverified as never);
    await type(name(), "Đã gửi");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    return view;
  }

  it("recognises the sent values although the person has typed on since, and keeps the newer input unsaved", async () => {
    await lose();
    await userEvent.type(name(), " + mới");
    read.mockResolvedValueOnce(ok(media({ displayName: "Đã gửi", version: 4 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/đã có đúng các giá trị đã gửi/);
    expect(name().value).toBe("Đã gửi + mới");
    expect(saveButton()).not.toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not call a server that merely shows what is typed NOW 'saved'", async () => {
    await lose();
    await userEvent.type(name(), " + mới"); // now "Đã gửi + mới"
    read.mockResolvedValueOnce(ok(media({ displayName: "Đã gửi + mới", version: 5 })) as never); // someone else wrote exactly that
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-conflict")).toBeInTheDocument();
    expect(screen.queryByText(/đã có đúng các giá trị đã gửi/)).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("says 'not recorded' when the server did not move, and keeps the input", async () => {
    await lose();
    read.mockResolvedValueOnce(ok(media()) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/chưa ghi nhận/);
    expect(name().value).toBe("Đã gửi");
    expect(saveButton()).not.toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("the same values at the same version are not evidence that this save ran", async () => {
    await lose();
    read.mockResolvedValueOnce(ok(media({ displayName: "Đã gửi", version: 3 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/chưa đủ bằng chứng/);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a read that fails keeps it unconfirmed and keeps the input", async () => {
    await lose();
    read.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/Không đọc được/);
    expect(screen.getByTestId("write-unverified")).toBeInTheDocument();
    expect(name().value).toBe("Đã gửi");
  });
});

describe("F4 — a stale version is an explicit comparison", () => {
  const theirs = () => media({ displayName: "Người khác đặt", credit: "Nguồn khác", focalX: 0.2, focalY: 0.9, version: 5 });
  async function conflict(fresh = theirs()) {
    const view = await open();
    write.mockResolvedValueOnce(stale as never);
    await type(name(), "Của tôi");
    await userEvent.clear(focalX());
    await userEvent.type(focalX(), "0.7");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    read.mockResolvedValueOnce(ok(fresh) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    await screen.findByTestId("media-conflict");
    return view;
  }

  it("shows the server's complete state beside the local one, with both versions, and keeps the input, the version and the lock", async () => {
    await conflict();
    const panel = screen.getByTestId("media-conflict");
    for (const text of ["Của tôi", "Người khác đặt", "Nguồn khác", "0.7", "0.2", "0.9", "phiên bản 3", "phiên bản 5"]) expect(panel).toHaveTextContent(text);
    expect(name().value).toBe("Của tôi"); // the local input is untouched
    expect(focalX().value).toBe("0.7");
    expect(saveButton()).toBeDisabled(); // an unresolved comparison cannot be saved over
    expect(write).toHaveBeenCalledTimes(1); // reading is not writing
  });

  it("'keep mine' is the only thing that moves the version, sends nothing itself, and says the next Save overwrites", async () => {
    await conflict();
    expect(screen.getByTestId("media-conflict")).toHaveTextContent(/ghi đè/);
    await userEvent.click(btn("media-conflict-keep"));
    expect(screen.queryByTestId("media-conflict")).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    expect(name().value).toBe("Của tôi");
    expect(saveButton()).not.toBeDisabled();
    write.mockResolvedValueOnce(ok(media({ displayName: "Của tôi", focalX: 0.7, focalY: 0.9, credit: "Nguồn khác", version: 6 })) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toBe(5); // on the compared server version
    expect(write.mock.calls[1][2]).toMatchObject({ displayName: "Của tôi", focalX: 0.7 });
  });

  it("a second writer racing the next Save is a new comparison and the local input is still there", async () => {
    await conflict();
    await userEvent.click(btn("media-conflict-keep"));
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    expect(write.mock.calls[1][1]).toBe(5);
    read.mockResolvedValueOnce(ok(media({ displayName: "Lần hai", version: 7 })) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("media-conflict");
    expect(panel).toHaveTextContent("Lần hai");
    expect(panel).toHaveTextContent(/phiên bản 7/);
    expect(name().value).toBe("Của tôi");
    expect(saveButton()).toBeDisabled();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("'use the server's copy' asks first, then replaces the input with the server's and writes nothing", async () => {
    await conflict();
    await userEvent.click(btn("media-conflict-use-server"));
    expect(name().value).toBe("Của tôi"); // not yet
    await userEvent.click(btn("media-conflict-confirm"));
    await waitFor(() => expect(name().value).toBe("Người khác đặt"));
    expect(focalX().value).toBe("0.2");
    expect(saveButton()).toBeDisabled(); // nothing differs now
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a reload that fails keeps the input and opens no comparison", async () => {
    await open();
    write.mockResolvedValueOnce(stale as never);
    await type(name(), "Của tôi");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    read.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/Không đọc được/);
    expect(name().value).toBe("Của tôi");
    expect(screen.queryByTestId("media-conflict")).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a late answer of an older reload cannot override the newer one", async () => {
    await open();
    write.mockResolvedValueOnce(stale as never);
    await type(name(), "Của tôi");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    const first = deferred<ReturnType<typeof ok>>();
    read.mockReturnValueOnce(first.promise as never); // the first reload: its answer is held
    read.mockResolvedValueOnce(ok(media({ displayName: "Bản mới hơn", version: 7 })) as never); // the second reload answers at once
    await userEvent.click(screen.getByTestId("reload-latest"));
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("media-conflict")).toHaveTextContent(/phiên bản 7/);
    await act(async () => { first.resolve(ok(media({ displayName: "Bản cũ hơn", version: 5 }))); }); // arrives last, but it is about an older read
    expect(screen.getByTestId("media-conflict")).toHaveTextContent(/phiên bản 7/);
    expect(screen.getByTestId("media-conflict")).not.toHaveTextContent("Bản cũ hơn");
    expect(name().value).toBe("Của tôi");
  });

  it("an answer that arrives after the dialog is gone changes nothing and reports nothing", async () => {
    const { onChanged, unmount } = await open();
    write.mockResolvedValueOnce(stale as never);
    await type(name(), "Của tôi");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    const gate = deferred<ReturnType<typeof ok>>();
    read.mockReturnValueOnce(gate.promise as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    unmount();
    gate.resolve(ok(theirs()));
    await Promise.resolve();
    expect(onChanged).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("permissions", () => {
  it("a Blog editor edits; an account without BlogEdit sees the values and cannot change or save them", async () => {
    await open(EDITOR);
    expect(name()).not.toBeDisabled();
    cleanup();
    await open(session("BlogPublish"));
    expect(name()).toBeDisabled();
    expect(screen.queryByTestId("media-save")).toBeNull();
  });
});

function session(permission: string) {
  return { ...BOTH, permissions: [permission] };
}
