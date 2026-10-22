/**
 * BHA-BLOG-001-CP03-C3 (F3): the Blog settings. A stale version shows the server's value BESIDE the local choice with both versions, locks Save, and moves the
 * version only on an explicit choice; a lost answer is judged against what was SENT, not against what the select shows now.
 */
import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  getSettings: vi.fn(), saveSettings: vi.fn(), listCategories: vi.fn(),
  fetchActiveLanguages: vi.fn(() => Promise.resolve({ kind: "ok", data: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true }] })),
}));

import SettingsScreen from "./SettingsScreen";
import { BOTH, EDITOR, ok, renderInBlogGate } from "./blogTestUtils";
import { getSettings, listCategories, saveSettings, type BlogCategory, type BlogSettings } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const read = vi.mocked(getSettings);
const write = vi.mocked(saveSettings);
const categories = vi.mocked(listCategories);

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const cat = (id: string, name: string): BlogCategory => ({ id, systemKey: null, sortOrder: 10, version: 1, translations: { vi: { name, slug: name.toLowerCase(), description: null } }, revisionCount: 0, pinCount: 0, isHomeSection: false });
const settings = (home: string | null, version: number): BlogSettings => ({ homeSectionCategoryId: home, version, updatedAtUtc: "2026-10-22T08:00:00Z" });
const stale = { kind: "refused", status: 409, code: "blog.stale-version", field: "expectedVersion", detail: "changed" } as const;
const unverified = { kind: "unverified", message: "Mất kết nối." } as const;

const select = () => screen.getByTestId("home-section-select") as HTMLSelectElement;
const saveButton = () => within(screen.getByTestId("settings-save")).getByRole("button");
const btn = (id: string) => within(screen.getByTestId(id)).getByRole("button");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  for (const m of [read, write, categories]) m.mockReset();
  categories.mockImplementation((() => Promise.resolve(ok([cat(A, "Ẩm thực"), cat(B, "Điểm đến"), cat(C, "Lễ hội")]))) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** Opens the screen on the settings the server has, then picks `B` in the select (the local, unsaved choice). */
async function openAndPick(server: BlogSettings, pick: string | null = B) {
  read.mockResolvedValueOnce(ok(server) as never);
  renderInBlogGate(<SettingsScreen />);
  await screen.findByTestId("home-section-select");
  await userEvent.selectOptions(select(), pick ?? "");
}

describe("F3 — a stale version", () => {
  it("shows the server's value beside the local choice, locks Save, and does not move the version by reading", async () => {
    await openAndPick(settings(A, 3));
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]).toEqual([3, B]);

    read.mockResolvedValueOnce(ok(settings(C, 4)) as never); // another tab chose a third category
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("settings-conflict");
    expect(panel).toHaveTextContent("Điểm đến"); // mine
    expect(panel).toHaveTextContent("Lễ hội"); // theirs
    expect(panel).toHaveTextContent(/phiên bản 3/);
    expect(panel).toHaveTextContent(/phiên bản 4/);
    expect(select().value).toBe(B); // the local choice is untouched
    expect(saveButton()).toBeDisabled(); // an unresolved comparison cannot be saved over
    expect(write).toHaveBeenCalledTimes(1); // reading is not writing
  });

  it("shows 'no category' on either side", async () => {
    await openAndPick(settings(A, 3), null);
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    read.mockResolvedValueOnce(ok(settings(B, 4)) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("settings-conflict");
    expect(panel).toHaveTextContent("Không chọn");
    expect(panel).toHaveTextContent("Điểm đến");
  });

  it("keeping the local choice moves the version only then, sends nothing by itself, and a second race is a second comparison", async () => {
    await openAndPick(settings(A, 3));
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    read.mockResolvedValueOnce(ok(settings(C, 4)) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    await screen.findByTestId("settings-conflict");

    await userEvent.click(btn("settings-conflict-keep"));
    expect(screen.queryByTestId("settings-conflict")).toBeNull();
    expect(write).toHaveBeenCalledTimes(1); // "keep mine" does not write
    expect(select().value).toBe(B);
    expect(saveButton()).not.toBeDisabled();

    // The server moved again before the person pressed Save: the write carries 4, is refused, and the local choice is still there for a new comparison.
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    expect(write.mock.calls[1]).toEqual([4, B]);
    read.mockResolvedValueOnce(ok(settings(A, 5)) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("settings-conflict")).toHaveTextContent(/phiên bản 5/);
    expect(select().value).toBe(B);
    expect(saveButton()).toBeDisabled();

    await userEvent.click(btn("settings-conflict-keep"));
    write.mockResolvedValueOnce(ok(settings(B, 6)) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    expect(write.mock.calls[2]).toEqual([5, B]);
    await waitFor(() => expect(screen.queryByTestId("settings-save") && saveButton()).toBeDisabled()); // saved: nothing left to save
    expect(select().value).toBe(B);
  });

  it("using the server's value asks first, then drops the local choice without writing", async () => {
    await openAndPick(settings(A, 3));
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    read.mockResolvedValueOnce(ok(settings(C, 4)) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    await screen.findByTestId("settings-conflict");

    await userEvent.click(btn("settings-conflict-use-server"));
    expect(select().value).toBe(B); // not yet: it asked
    await userEvent.click(btn("settings-conflict-confirm"));
    await waitFor(() => expect(select().value).toBe(C));
    expect(screen.queryByTestId("settings-conflict")).toBeNull();
    expect(saveButton()).toBeDisabled(); // nothing differs now
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a reload that fails changes nothing", async () => {
    await openAndPick(settings(A, 3));
    write.mockResolvedValueOnce(stale as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-refused");
    read.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent(/Không đọc được/);
    expect(select().value).toBe(B);
    expect(screen.queryByTestId("settings-conflict")).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("F3 — an answer that never came", () => {
  async function lose(pick: string | null = B) {
    await openAndPick(settings(A, 3), pick);
    write.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    expect(saveButton()).toBeDisabled(); // no blind retry
    expect(write.mock.calls[0]).toEqual([3, pick]);
  }

  it("that was applied: the server shows what was sent at a later version", async () => {
    await lose();
    read.mockResolvedValueOnce(ok(settings(B, 4)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent(/đã có đúng lựa chọn đã gửi \(phiên bản 4\)/);
    expect(write).toHaveBeenCalledTimes(1);
    expect(saveButton()).toBeDisabled();
    expect(select().value).toBe(B);
  });

  it("is judged by what was SENT, not by a selection the person changed afterwards", async () => {
    await lose();
    await userEvent.selectOptions(select(), C); // typed on after the send, while the answer was missing
    read.mockResolvedValueOnce(ok(settings(B, 4)) as never); // the server has what was sent (B)
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent(/đã có đúng lựa chọn đã gửi \(phiên bản 4\)/);
    expect(screen.queryByTestId("write-unverified")).toBeNull(); // B is what was sent, and B is there: the old operation is settled
    expect(select().value).toBe(C); // the newer choice is kept, unsaved, on top of version 4
    expect(saveButton()).not.toBeDisabled();
    write.mockResolvedValueOnce(ok(settings(C, 5)) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]).toEqual([4, C]);
  });

  it("a server that already shows the live selection but not what was sent is not 'saved'", async () => {
    await lose();
    await userEvent.selectOptions(select(), C);
    read.mockResolvedValueOnce(ok(settings(C, 4)) as never); // someone else chose C; the person's own selection now happens to be C too
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-conflict")).toHaveTextContent("Lễ hội");
    expect(screen.queryByText(/đã lưu/)).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("that did not reach the server: says so, keeps the choice, and lets the person save again", async () => {
    await lose();
    read.mockResolvedValueOnce(ok(settings(A, 3)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent(/chưa có thay đổi/);
    expect(select().value).toBe(B);
    expect(saveButton()).not.toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("the same value at the same version is not evidence that this save ran", async () => {
    await openAndPick(settings(A, 3), B);
    write.mockResolvedValueOnce(unverified as never);
    await userEvent.click(saveButton());
    await screen.findByTestId("write-unverified");
    read.mockResolvedValueOnce(ok(settings(B, 3)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent(/chưa đủ bằng chứng/);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a read that fails keeps the operation unverified and the choice", async () => {
    await lose();
    read.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent(/Không đọc được/);
    expect(screen.getByTestId("write-unverified")).toBeInTheDocument();
    expect(select().value).toBe(B);
  });

  it("when the server moved to something else it is a comparison, not a success", async () => {
    await lose();
    read.mockResolvedValueOnce(ok(settings(C, 5)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("settings-conflict")).toHaveTextContent("Lễ hội");
    expect(saveButton()).toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("the comparison shows, and 'keep mine' keeps, the choice on screen NOW — also when it changed after the send", async () => {
    await lose(); // sent B at version 3
    await userEvent.selectOptions(select(), "");
    read.mockResolvedValueOnce(ok(settings(C, 5)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    const panel = await screen.findByTestId("settings-conflict");
    expect(panel).toHaveTextContent("Không chọn"); // mine, as the select shows it
    expect(panel).not.toHaveTextContent("Điểm đến"); // not the value that was sent
    await userEvent.click(btn("settings-conflict-keep"));
    expect(select().value).toBe("");
    expect(saveButton()).not.toBeDisabled();
    write.mockResolvedValueOnce(ok(settings(null, 6)) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]).toEqual([5, null]);
  });
});

describe("permissions", () => {
  it("a Blog editor without BlogPublish can read the setting but not change it", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
    read.mockResolvedValueOnce(ok(settings(A, 3)) as never);
    renderInBlogGate(<SettingsScreen />);
    await screen.findByTestId("home-section-select");
    expect(select()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
  });

  it("a plain save sends the version it was read at and shows the new one", async () => {
    await openAndPick(settings(A, 3), null);
    write.mockResolvedValueOnce(ok(settings(null, 4)) as never);
    read.mockResolvedValueOnce(ok(settings(null, 4)) as never); // an implementation that re-reads after a save may; one that uses the answer need not
    await userEvent.click(saveButton());
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]).toEqual([3, null]);
    expect(await screen.findByText(/Phiên bản cấu hình: 4/)).toBeInTheDocument();
  });
});
