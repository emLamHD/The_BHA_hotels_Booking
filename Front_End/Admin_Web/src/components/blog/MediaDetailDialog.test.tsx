/**
 * BHA-BLOG-001-CP03-C4 (F3, F4): the picture dialog. A successful save acknowledges only what was SENT, so what is typed (or moved on the focal picker)
 * after the click survives it; a lost answer is judged against what was sent; a stale version is a comparison of two complete states that keeps the local
 * input, locks Save, and moves the version only when the person says "keep mine".
 */
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  getMedia: vi.fn(), saveMedia: vi.fn(), getMediaUsage: vi.fn(), deleteMedia: vi.fn(),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));

import MediaDetailDialog, { canonicalMediaFields } from "./MediaDetailDialog";
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


// ---------------------------------------------------------------- C8 F3: a lost save is judged against what the SERVER would have stored

describe("C8 F3 — the read-back is compared with the server-normalised snapshot", () => {
  // `UpdateMediaAsync`: displayName, description, credit, sourceUrl and licence are each `BlogText.Normalize` = .NET `string.Trim()` ("" when empty); the focal point
  // is rounded to 4 decimals (`RoundFocal`). Nothing else is rewritten. The server's answers below are written out by hand, not computed by the code under test.
  const FIELDS: [string, () => HTMLInputElement | HTMLTextAreaElement, keyof ReturnType<typeof media>, string][] = [
    ["displayName", () => name(), "displayName", "Tên mới"],
    ["description", () => screen.getByLabelText(/^Mô tả/) as HTMLTextAreaElement, "description", "Mô tả mới"],
    ["credit", () => credit(), "credit", "Nhiếp ảnh gia"],
    ["sourceUrl", () => screen.getByLabelText(/^Nguồn/) as HTMLInputElement, "sourceUrl", "https://example.com/anh"],
    ["licence", () => screen.getByLabelText("Giấy phép") as HTMLInputElement, "licence", "CC BY 4.0"],
  ];
  const put = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => fireEvent.change(input, { target: { value } });
  /** Sends `raw` in the first field and loses the answer. */
  async function lose(field: () => HTMLInputElement | HTMLTextAreaElement, raw: string, extra?: () => void) {
    await open();
    write.mockResolvedValueOnce(unverified as never);
    put(field(), raw);
    extra?.();
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
  }

  it.each(FIELDS)("%s: surrounding whitespace that the server trims is not a conflict - confirmed once, nothing resent", async (_key, field, key, value) => {
    await lose(field, `  \t${value} \u00a0\u3000`);
    read.mockResolvedValueOnce(ok(media({ [key]: value, version: 4 })) as never); // the server committed the TRIMMED text
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/đã có đúng các giá trị đã gửi/);
    expect(screen.queryByTestId("media-conflict")).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2); // the dialog's own read + the one check
    expect(screen.queryByTestId("write-unverified")).toBeNull();
  });

  it("all five text fields at once, each with its own whitespace", async () => {
    await lose(() => name(), "  A ", () => {
      put(screen.getByLabelText(/^Mô tả/) as HTMLTextAreaElement, "\tB\t");
      put(credit(), "\u00a0C\u00a0");
      put(screen.getByLabelText(/^Nguồn/) as HTMLInputElement, " https://example.com/d ");
      put(screen.getByLabelText("Giấy phép") as HTMLInputElement, "\u3000E\u3000");
    });
    read.mockResolvedValueOnce(ok(media({ displayName: "A", description: "B", credit: "C", sourceUrl: "https://example.com/d", licence: "E", version: 4 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/đã có đúng các giá trị đã gửi/);
    expect(screen.queryByTestId("media-conflict")).toBeNull();
  });

  it("a field emptied to whitespace is the server's empty string (not null, not a mismatch)", async () => {
    await lose(() => credit(), "   ");
    read.mockResolvedValueOnce(ok(media({ credit: "", version: 4 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/đã có đúng các giá trị đã gửi/);
    expect(screen.queryByTestId("media-conflict")).toBeNull();
  });

  it.each([
    ["U+0085 (NEL) is trimmed by .NET", "\u0085x\u0085", "x", true],
    ["U+00A0, U+2003 and U+3000 are trimmed", "\u00a0\u2003x\u3000", "x", true],
    ["U+FEFF is NOT trimmed by .NET (JavaScript would)", "\ufeffx\ufeff", "\ufeffx\ufeff", true],
    ["U+200B is NOT trimmed", "\u200bx", "\u200bx", true],
    ["a server that trimmed U+FEFF is a different value", "\ufeffx", "x", false],
    ["a server that did not trim U+0085 is a different value", "\u0085x", "\u0085x", false],
  ])("%s", async (_name, sent, serverHas, expectMatch) => {
    await lose(() => credit(), sent);
    read.mockResolvedValueOnce(ok(media({ credit: serverHas, version: 4 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    if (expectMatch) {
      expect(await screen.findByTestId("media-note")).toHaveTextContent(/đã có đúng các giá trị đã gửi/);
      expect(screen.queryByTestId("media-conflict")).toBeNull();
    } else {
      expect(await screen.findByTestId("media-conflict")).toBeInTheDocument();
    }
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a changed focal point travels with the text: both must match", async () => {
    await lose(() => credit(), " Ghi công ", () => {
      fireEvent.change(screen.getByLabelText("Điểm lấy nét ngang"), { target: { value: "0.8" } });
    });
    read.mockResolvedValueOnce(ok(media({ credit: "Ghi công", focalX: 0.8, version: 4 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/đã có đúng các giá trị đã gửi/);
  });

  it("a real mismatch is still a conflict: the focal point is not what was sent", async () => {
    await lose(() => credit(), " Ghi công ", () => {
      fireEvent.change(screen.getByLabelText("Điểm lấy nét ngang"), { target: { value: "0.8" } });
    });
    read.mockResolvedValueOnce(ok(media({ credit: "Ghi công", focalX: 0.5, version: 4 })) as never); // someone else's version with the text only
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-conflict")).toBeInTheDocument();
  });

  it("a real mismatch is still a conflict: another text at another version", async () => {
    await lose(() => name(), " Của tôi ");
    read.mockResolvedValueOnce(ok(media({ displayName: "Của người khác", version: 5 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-conflict")).toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("the version still has to move: the trimmed values at the SAME version are not evidence", async () => {
    await lose(() => name(), "Đã gửi ");
    read.mockResolvedValueOnce(ok(media({ displayName: "Đã gửi", version: 3 })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/chưa đủ bằng chứng/);
  });

  it("input typed during the read-back stays unsaved, on the confirmed (server-normalised) base and version", async () => {
    await lose(() => credit(), " Beach ");
    const gate = deferred<ReturnType<typeof ok>>();
    read.mockReturnValueOnce(gate.promise as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await userEvent.type(credit(), "+ thêm"); // typed after the snapshot, while the server is being asked
    await act(async () => { gate.resolve(ok(media({ credit: "Beach", version: 4 }))); await Promise.resolve(); });
    expect(await screen.findByTestId("media-note")).toHaveTextContent(/Những chỉnh sửa mới hơn của bạn vẫn còn và chưa được lưu/);
    expect(credit().value).toBe(" Beach + thêm");
    expect(saveButton()).not.toBeDisabled(); // unsaved
    write.mockResolvedValueOnce(ok(media({ credit: "Beach + thêm", version: 5 })) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toBe(4); // on the version the read-back confirmed
    expect(write.mock.calls[1][2]).toMatchObject({ credit: " Beach + thêm" });
  });

  it("a SUCCESSFUL save with whitespace still clears nothing newer (the C4 behaviour, with trimmed answers)", async () => {
    await open();
    const gate = deferred<ReturnType<typeof ok>>();
    write.mockReturnValueOnce(gate.promise as never);
    put(credit(), " Beach ");
    await userEvent.click(saveButton());
    await userEvent.type(credit(), "x");
    gate.resolve(ok(media({ credit: "Beach", version: 4 })));
    await waitFor(() => expect(screen.getByTestId("media-note")).toHaveTextContent(/vẫn còn và chưa được lưu/));
    expect(credit().value).toBe(" Beach x");
  });
});

describe("C8 F3 — canonicalMediaFields (the client's copy of what UpdateMediaAsync stores)", () => {
  const base = { displayName: "a", description: "b", credit: "c", sourceUrl: "d", licence: "e", focalX: 0.5, focalY: 0.5 };
  it("trims the five text fields with .NET's set and rounds the focal point to 4 decimals, away from zero", () => {
    expect(canonicalMediaFields({ ...base, displayName: "\u0085a\ufeff ", description: " \t", credit: "\u2003c\u2003", sourceUrl: " d ", licence: "\u3000", focalX: 0.12345, focalY: 0.99995 })).toEqual({
      displayName: "a\ufeff", description: "", credit: "c", sourceUrl: "d", licence: "", focalX: 0.1235, focalY: 1,
    });
  });
  it("leaves already canonical values alone", () => {
    expect(canonicalMediaFields(base)).toEqual(base);
  });
});
