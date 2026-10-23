/**
 * BHA-BLOG-001-CP03-C2 (F1, F2): saving a category. An update whose answer was lost is verified against what was SENT, not by the id existing; a stale
 * version shows the server's copy next to the local one and moves the version only on an explicit choice; a locale that was not sent is never judged or removed.
 */
import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  listCategories: vi.fn(), saveCategory: vi.fn(), createCategory: vi.fn(), deleteCategory: vi.fn(), getPins: vi.fn(), listPosts: vi.fn(),
  fetchActiveLanguages: vi.fn(() => Promise.resolve({ kind: "ok", data: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true }, { code: "en", displayName: "English", nativeName: "English", isDefault: false }] })),
}));

import CategoriesScreen from "./CategoriesScreen";
import { BOTH, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { createCategory, listCategories, saveCategory, type BlogCategory } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const list = vi.mocked(listCategories);
const save = vi.mocked(saveCategory);
const create = vi.mocked(createCategory);

const text = (name: string, slug: string, description: string | null = null) => ({ name, slug, description });
const cat = (id: string, over: Partial<BlogCategory> = {}): BlogCategory => ({
  id, systemKey: null, sortOrder: 20, version: 3, translations: { vi: text("Ẩm thực", "am-thuc", "Mô tả"), en: text("Cuisine", "cuisine") }, revisionCount: 0, pinCount: 0, isHomeSection: false, ...over,
});
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const unverified = { kind: "unverified", message: "Mất kết nối." } as const;
const stale = { kind: "refused", status: 409, code: "blog.stale-version", field: "expectedVersion", detail: "changed" } as const;

let server: BlogCategory[] = [];
const rows = () => screen.findAllByTestId("category-row");
const editRow = async (index: number) => { const r = await rows(); await userEvent.click(within(r[index]).getByTestId("category-edit").querySelector("button")!); await screen.findByTestId("category-dialog"); };
const btn = (id: string) => within(screen.getByTestId(id)).getByRole("button");
const name = () => screen.getByTestId("category-name-vi") as HTMLInputElement;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  for (const m of [list, save, create]) m.mockReset();
  server = [cat(A)];
  list.mockImplementation((() => Promise.resolve(ok(server))) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function typeName(value: string) {
  await userEvent.clear(name());
  await userEvent.type(name(), value);
}

describe("F1 — an update whose answer was lost", () => {
  it("that never reached the server: the category exists, but the edits are kept and nothing is called saved", async () => {
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Ẩm thực & quán ăn");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/chưa ghi nhận/i);
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument(); // not closed
    expect(name()).toHaveValue("Ẩm thực & quán ăn"); // the edit is still there
    expect(screen.queryByText(/đã lưu/i)).toBeNull();
    expect(save).toHaveBeenCalledTimes(1); // nothing was sent again
    expect(btn("category-save")).not.toBeDisabled(); // the person may press Save themselves
  });

  it("that committed: verified from what was sent and the version moving on, then the dialog closes", async () => {
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Ẩm thực & quán ăn");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    server = [cat(A, { version: 4, translations: { vi: text("Ẩm thực & quán ăn", "am-thuc", "Mô tả"), en: text("Cuisine", "cuisine") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
    expect(screen.getByTestId("categories-note")).toHaveTextContent(/phiên bản 4/);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("whose re-read failed: stays unconfirmed with the form intact", async () => {
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Đang sửa");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    list.mockImplementation((() => Promise.resolve({ kind: "error", status: 503, message: "Máy chủ bận." })) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(screen.getByTestId("categories-note")).toHaveTextContent(/chưa kiểm tra được/i));
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
    expect(name()).toHaveValue("Đang sửa");
    expect(screen.getByTestId("write-unverified")).toBeInTheDocument();
  });

  it("whose re-read shows someone else's change: a comparison, the form kept, no save", async () => {
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Của tôi");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    server = [cat(A, { version: 5, translations: { vi: text("Của người khác", "am-thuc"), en: text("Cuisine", "cuisine") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    const panel = await screen.findByTestId("category-conflict");
    expect(panel).toHaveTextContent("Của tôi");
    expect(panel).toHaveTextContent("Của người khác");
    expect(name()).toHaveValue("Của tôi");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("with identical values but an unchanged version: says what is known, does not claim the request ran", async () => {
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await userEvent.click(btn("category-save")); // nothing changed in the form
    await screen.findByTestId("write-unverified");
    await userEvent.click(screen.getByTestId("check-server"));
    const note = await screen.findByTestId("categories-note");
    expect(note).toHaveTextContent(/đúng các giá trị/i);
    expect(note).toHaveTextContent(/không khẳng định|chưa đủ bằng chứng|chưa đổi/i);
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
  });

  it("while the check is pending the person keeps typing: the dialog stays, the newer text is kept, the base is the verified one", async () => {
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Bản gửi");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    const gate = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce((() => gate.promise) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await userEvent.type(name(), " thêm");
    server = [cat(A, { version: 4, translations: { vi: text("Bản gửi", "am-thuc", "Mô tả"), en: text("Cuisine", "cuisine") } })];
    await act(async () => { gate.resolve(ok(server)); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId("categories-note")).toHaveTextContent(/phiên bản 4/));
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
    expect(name()).toHaveValue("Bản gửi thêm");
    save.mockResolvedValueOnce(ok(cat(A, { version: 5 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(4); // the newer edit is written on the version the verified save produced
  });

  it("another category opened while the check is pending is not closed or confirmed by the old answer", async () => {
    server = [cat(A), cat(B, { translations: { vi: text("Du lịch", "du-lich") }, version: 1 })];
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Bản gửi cho A");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    const gate = deferred<ReturnType<typeof ok>>();
    list.mockImplementationOnce((() => gate.promise) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await userEvent.click(btn("category-cancel"));
    await editRow(1);
    server = [cat(A, { version: 4, translations: { vi: text("Bản gửi cho A", "am-thuc", "Mô tả"), en: text("Cuisine", "cuisine") } }), cat(B, { translations: { vi: text("Du lịch", "du-lich") }, version: 1 })];
    await act(async () => { gate.resolve(ok(server)); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument(); // B's dialog
    expect(name()).toHaveValue("Du lịch");
    expect(screen.queryByTestId("categories-note")?.textContent ?? "").not.toMatch(/phiên bản 4/);
  });

  it("a locale that was not sent is not compared and not removed", async () => {
    server = [cat(A, { translations: { vi: text("Ẩm thực", "am-thuc") } })];
    save.mockResolvedValueOnce(unverified as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Ẩm thực mới");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    expect(Object.keys(save.mock.calls[0][3])).toEqual(["vi"]); // en was blank: omitted
    server = [cat(A, { version: 4, translations: { vi: text("Ẩm thực mới", "am-thuc"), en: text("Added by someone", "added") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull()); // verified on vi alone; en is theirs
  });
});

describe("F1 — a create whose answer was lost", () => {
  async function startCreate() {
    server = [];
    renderInBlogGate(<CategoriesScreen />);
    await screen.findByTestId("category-new");
    await userEvent.click(btn("category-new"));
    await screen.findByTestId("category-dialog");
    await userEvent.type(name(), "Mới");
    await userEvent.type(screen.getByTestId("category-slug-vi"), "moi");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
  }

  it("is found by its own id with the values that were sent: done, and nothing was sent twice", async () => {
    create.mockResolvedValueOnce(unverified as never);
    await startCreate();
    const id = create.mock.calls[0][0];
    server = [cat(id, { version: 1, sortOrder: 10, translations: { vi: text("Mới", "moi") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is not on the server: the same id is sent again only when the person presses Save", async () => {
    create.mockResolvedValueOnce(unverified as never);
    await startCreate();
    const id = create.mock.calls[0][0];
    await userEvent.click(screen.getByTestId("check-server"));
    await screen.findByTestId("categories-note");
    expect(create).toHaveBeenCalledTimes(1);
    create.mockResolvedValueOnce(ok(cat(id, { version: 1 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toBe(id);
  });

  it("an id that exists with other values is not taken for the create", async () => {
    create.mockResolvedValueOnce(unverified as never);
    await startCreate();
    const id = create.mock.calls[0][0];
    server = [cat(id, { version: 1, translations: { vi: text("Khác hẳn", "khac-han") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("category-conflict")).toBeInTheDocument();
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
  });
});

describe("F2 — a stale version", () => {
  async function openStale(localName = "Bản của tôi") {
    save.mockResolvedValueOnce(stale as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName(localName);
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-refused");
  }

  it("shows the server's copy beside the local one and does not move the version or allow Save", async () => {
    await openStale();
    server = [cat(A, { version: 6, sortOrder: 40, translations: { vi: text("Bản của server", "am-thuc-server", "Mô tả server"), en: text("Cuisine", "cuisine") } })];
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("category-conflict");
    for (const t of ["Bản của tôi", "Bản của server", "am-thuc-server", "Mô tả server", "40"]) expect(panel).toHaveTextContent(t);
    expect(panel).toHaveTextContent(/phiên bản 3/);
    expect(panel).toHaveTextContent(/phiên bản 6/);
    expect(name()).toHaveValue("Bản của tôi");
    expect(btn("category-save")).toBeDisabled(); // not before a choice
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("'use the server's copy' asks first, then replaces the form and takes the server's version", async () => {
    await openStale();
    server = [cat(A, { version: 6, translations: { vi: text("Bản của server", "am-thuc"), en: text("Cuisine", "cuisine") } })];
    await userEvent.click(screen.getByTestId("reload-latest"));
    await userEvent.click(btn("category-conflict-use-server"));
    expect(name()).toHaveValue("Bản của tôi"); // asked, not done
    await userEvent.click(btn("category-conflict-confirm"));
    await waitFor(() => expect(name()).toHaveValue("Bản của server"));
    save.mockResolvedValueOnce(ok(cat(A, { version: 7 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(6);
  });

  it("'keep mine on the new version' is the only way the version moves; a locale only the server has is not deleted", async () => {
    server = [cat(A, { translations: { vi: text("Ẩm thực", "am-thuc") } })];
    await openStale();
    server = [cat(A, { version: 6, translations: { vi: text("Của người khác", "am-thuc"), en: text("Added", "added") } })];
    await userEvent.click(screen.getByTestId("reload-latest"));
    await screen.findByTestId("category-conflict");
    await userEvent.click(btn("category-conflict-keep"));
    expect(btn("category-save")).not.toBeDisabled();
    save.mockResolvedValueOnce(ok(cat(A, { version: 7 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(6);
    expect(save.mock.calls[1][3].vi.name).toBe("Bản của tôi");
    expect(Object.keys(save.mock.calls[1][3])).toEqual(["vi"]); // en is not in the request, so it is not removed
  });

  it("a second stale answer after the choice keeps the data and asks for a fresh comparison", async () => {
    await openStale();
    server = [cat(A, { version: 6 })];
    await userEvent.click(screen.getByTestId("reload-latest"));
    await userEvent.click(btn("category-conflict-keep"));
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("write-refused")).toBeInTheDocument();
    expect(name()).toHaveValue("Bản của tôi");
    server = [cat(A, { version: 8, translations: { vi: text("Lần hai", "am-thuc"), en: text("Cuisine", "cuisine") } })];
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("category-conflict")).toHaveTextContent("Lần hai");
  });
});

describe("C4 F2 — a save that succeeds acknowledges only what was SENT", () => {
  const nameEn = () => screen.getByTestId("category-name-en") as HTMLInputElement;
  const slugEn = () => screen.getByTestId("category-slug-en") as HTMLInputElement;

  it("update: newer edits typed while the request was on its way keep the dialog open, stay unsaved, and are written on the confirmed version", async () => {
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    const gate = deferred<ReturnType<typeof ok>>();
    save.mockReturnValueOnce(gate.promise as never);
    await typeName("Đã gửi");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-pending");
    expect(save.mock.calls[0][1]).toBe(3);
    expect(save.mock.calls[0][3].vi.name).toBe("Đã gửi");

    await userEvent.type(name(), " + mới"); // the same field again
    await userEvent.clear(nameEn());
    await userEvent.type(nameEn(), "Newer English"); // another language
    await userEvent.clear(slugEn());
    await userEvent.type(slugEn(), "newer-english");
    server = [cat(A, { version: 4, translations: { vi: text("Đã gửi", "am-thuc", "Mô tả"), en: text("Cuisine", "cuisine") } })];
    gate.resolve(ok(server[0]));
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());

    expect(screen.getByTestId("category-dialog")).toBeInTheDocument(); // not closed
    expect(name()).toHaveValue("Đã gửi + mới");
    expect(nameEn()).toHaveValue("Newer English");
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/chưa được lưu/);
    expect(btn("category-save")).not.toBeDisabled();

    save.mockResolvedValueOnce(ok(cat(A, { version: 5 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(4); // the version the first save returned
    expect(save.mock.calls[1][3].vi.name).toBe("Đã gửi + mới"); // the live input, not the first snapshot
    expect(save.mock.calls[1][3].en.name).toBe("Newer English");
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull()); // nothing newer now: closes
  });

  it("create: newer edits keep the dialog, and the next Save is an UPDATE of the created category (no second create)", async () => {
    server = [];
    renderInBlogGate(<CategoriesScreen />);
    await screen.findByTestId("category-new");
    await userEvent.click(btn("category-new"));
    await screen.findByTestId("category-dialog");
    const gate = deferred<ReturnType<typeof ok>>();
    create.mockReturnValueOnce(gate.promise as never);
    await userEvent.type(name(), "Mới");
    await userEvent.type(screen.getByTestId("category-slug-vi"), "moi");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-pending");
    const id = create.mock.calls[0][0];

    await userEvent.type(name(), " hơn");
    server = [cat(id, { version: 1, sortOrder: 10, translations: { vi: text("Mới", "moi") } })];
    gate.resolve(ok(server[0]));
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
    expect(name()).toHaveValue("Mới hơn");

    save.mockResolvedValueOnce(ok(cat(id, { version: 2 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe(id);
    expect(save.mock.calls[0][1]).toBe(1);
    expect(save.mock.calls[0][3].vi.name).toBe("Mới hơn");
  });

  it("with nothing typed after the click the dialog closes as before", async () => {
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    save.mockResolvedValueOnce(ok(cat(A, { version: 4 })) as never);
    await typeName("Chỉ đã gửi");
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
  });

  it("an edit that goes back to what was sent is not 'newer'", async () => {
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    const gate = deferred<ReturnType<typeof ok>>();
    save.mockReturnValueOnce(gate.promise as never);
    await typeName("Đã gửi");
    await userEvent.click(btn("category-save"));
    await userEvent.type(name(), "X");
    await userEvent.type(name(), "{Backspace}");
    gate.resolve(ok(cat(A, { version: 4 })));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
  });
});


// ---------------------------------------------------------------- C8 F2: the comparison is built from the LIVE draft

describe("C8 F2 — the comparison represents what is on screen now", () => {
  const nameEn = () => screen.getByTestId("category-name-en") as HTMLInputElement;
  const slugVi = () => screen.getByTestId("category-slug-vi") as HTMLInputElement;
  const replace = async (input: HTMLInputElement, value: string) => { await userEvent.clear(input); if (value) await userEvent.type(input, value); };
  const SERVER_NEWER = () => cat(A, { version: 6, sortOrder: 40, translations: { vi: text("Của server", "am-thuc-server", "Mô tả server"), en: text("Server EN", "server-en") } });

  async function openStale() {
    save.mockResolvedValueOnce(stale as never);
    renderInBlogGate(<CategoriesScreen />);
    await editRow(0);
    await typeName("Bản đã gửi");
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-refused");
  }
  /** "Tải bản mới nhất" with the read HELD: returns the gate that answers it. */
  async function holdLoadLatest() {
    const gate = deferred<ReturnType<typeof ok<BlogCategory[]>>>();
    list.mockImplementationOnce((() => gate.promise) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    return gate;
  }
  const release = async (gate: { resolve: (v: never) => void }, data: BlogCategory[] = [SERVER_NEWER()]) => { await act(async () => { gate.resolve(ok(data) as never); await Promise.resolve(); }); };

  it("edits typed in several languages while 'load latest' is pending are in the comparison, and 'keep mine' writes exactly them", async () => {
    await openStale();
    const gate = await holdLoadLatest();
    await typeName("Tên gõ sau khi bấm tải");
    await replace(slugVi(), "slug-go-sau");
    await replace(nameEn(), "English typed meanwhile");
    await release(gate);
    const panel = await screen.findByTestId("category-conflict");
    for (const t of ["Tên gõ sau khi bấm tải", "slug-go-sau", "English typed meanwhile", "Của server", "Server EN"]) expect(panel).toHaveTextContent(t);
    expect(panel).not.toHaveTextContent("Bản đã gửi"); // the older text is not what the person sees or writes
    expect(btn("category-save")).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1); // nothing was sent by comparing
    await userEvent.click(btn("category-conflict-keep"));
    save.mockResolvedValueOnce(ok(cat(A, { version: 7 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(6);
    expect(save.mock.calls[1][3].vi).toMatchObject({ name: "Tên gõ sau khi bấm tải", slug: "slug-go-sau" });
    expect(save.mock.calls[1][3].en.name).toBe("English typed meanwhile");
  });

  it("editing while the comparison is OPEN keeps the displayed local side and what 'keep mine' writes the same", async () => {
    await openStale();
    server = [SERVER_NEWER()];
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("category-conflict");
    expect(panel).toHaveTextContent("Bản đã gửi");
    await typeName("Sửa khi so sánh đang mở");
    await replace(nameEn(), "EN while open");
    expect(screen.getByTestId("category-conflict")).toHaveTextContent("Sửa khi so sánh đang mở");
    expect(screen.getByTestId("category-conflict")).toHaveTextContent("EN while open");
    expect(screen.getByTestId("category-conflict")).not.toHaveTextContent("Bản đã gửi");
    expect(btn("category-save")).toBeDisabled(); // still not before a choice
    await userEvent.click(btn("category-conflict-keep"));
    save.mockResolvedValueOnce(ok(cat(A, { version: 7 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][3].vi.name).toBe("Sửa khi so sánh đang mở");
    expect(save.mock.calls[1][3].en.name).toBe("EN while open");
  });

  it("a language emptied meanwhile shows as empty on the local side and is not sent", async () => {
    await openStale();
    const gate = await holdLoadLatest();
    await replace(nameEn(), "");
    await replace(screen.getByTestId("category-slug-en") as HTMLInputElement, "");
    await release(gate);
    const panel = await screen.findByTestId("category-conflict");
    expect(panel).toHaveTextContent("Server EN");
    expect(within(panel).getByText("[en] Tên").closest("tr")!.textContent).toBe("[en] Tên—Server EN"); // the local side is empty ("—"), not the text from before
    await userEvent.click(btn("category-conflict-keep"));
    save.mockResolvedValueOnce(ok(cat(A, { version: 7 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(Object.keys(save.mock.calls[1][3])).toEqual(["vi"]); // a blank language is not sent, so the server's is not removed
  });

  it("'use the server's copy' still asks first and then replaces everything typed, including what was typed during the read", async () => {
    await openStale();
    const gate = await holdLoadLatest();
    await typeName("Gõ trong lúc chờ");
    await release(gate);
    await screen.findByTestId("category-conflict");
    await userEvent.click(btn("category-conflict-use-server"));
    expect(name()).toHaveValue("Gõ trong lúc chờ"); // asked, not done
    await userEvent.click(btn("category-conflict-confirm"));
    await waitFor(() => expect(name()).toHaveValue("Của server"));
    expect(nameEn()).toHaveValue("Server EN");
  });

  it("a failed read keeps every input, opens no comparison and sends nothing", async () => {
    await openStale();
    const gate = await holdLoadLatest();
    await typeName("Còn nguyên");
    await act(async () => { gate.resolve({ kind: "network", message: "Mất kết nối." } as never); await Promise.resolve(); });
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/Chưa tải được/);
    expect(screen.queryByTestId("category-conflict")).toBeNull();
    expect(name()).toHaveValue("Còn nguyên");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("another writer racing the next Save: the second stale answer opens a FRESH comparison of the latest input and the latest server copy", async () => {
    await openStale();
    server = [SERVER_NEWER()];
    await userEvent.click(screen.getByTestId("reload-latest"));
    await screen.findByTestId("category-conflict");
    await userEvent.click(btn("category-conflict-keep"));
    await typeName("Lần hai của tôi");
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await screen.findByTestId("write-refused");
    server = [cat(A, { version: 9, translations: { vi: text("Người thứ ba", "am-thuc"), en: text("Third EN", "third") } })];
    const gate = await holdLoadLatest();
    await typeName("Sau khi bấm tải lần hai");
    await release(gate, server);
    const panel = await screen.findByTestId("category-conflict");
    expect(panel).toHaveTextContent("Sau khi bấm tải lần hai");
    expect(panel).toHaveTextContent("Người thứ ba");
    expect(panel).toHaveTextContent(/phiên bản 9/);
  });

  it("the SAME category closed and reopened while 'load latest' is pending: the old answer does not open a comparison over the new dialog", async () => {
    await openStale();
    const gate = await holdLoadLatest();
    await userEvent.click(btn("category-cancel"));
    await editRow(0); // the same category, a fresh dialog: its id matches the old read's
    await typeName("Hộp thoại mới");
    await release(gate); // v6 server copy arrives late
    expect(screen.queryByTestId("category-conflict")).toBeNull();
    expect(name()).toHaveValue("Hộp thoại mới");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("two 'load latest' reads answered in reverse order: the newer read decides, the older answer is dropped", async () => {
    await openStale();
    const first = await holdLoadLatest();
    const second = await holdLoadLatest();
    await release(second, [cat(A, { version: 6, translations: { vi: text("Bản mới nhất", "am-thuc"), en: text("Cuisine", "cuisine") } })]);
    await screen.findByTestId("category-conflict");
    await release(first, [cat(A, { version: 5, translations: { vi: text("Bản cũ hơn", "am-thuc"), en: text("Cuisine", "cuisine") } })]); // the older read finishes last
    expect(screen.getByTestId("category-conflict")).toHaveTextContent("Bản mới nhất");
    expect(screen.getByTestId("category-conflict")).toHaveTextContent(/phiên bản 6/);
    expect(screen.getByTestId("category-conflict")).not.toHaveTextContent("Bản cũ hơn");
  });

  it("a Save pressed while 'load latest' is pending supersedes it: the old answer does not open a comparison over the new outcome", async () => {
    await openStale();
    const gate = await holdLoadLatest();
    save.mockResolvedValueOnce(stale as never); // the Save is refused as stale again
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await screen.findByTestId("write-refused");
    await release(gate); // the read that started BEFORE that Save
    expect(screen.queryByTestId("category-conflict")).toBeNull();
    expect(name()).toHaveValue("Bản đã gửi");
  });

  it("an answer for a dialog that was closed, or for another category, or an older 'load latest', is dropped", async () => {
    server = [cat(A), cat(B, { translations: { vi: text("Đồ uống", "do-uong") } })];
    await openStale();
    const gate = await holdLoadLatest();
    await userEvent.click(btn("category-cancel")); // closed
    await release(gate, [SERVER_NEWER(), cat(B)]);
    expect(screen.queryByTestId("category-conflict")).toBeNull();
    await editRow(1); // another category now
    expect(screen.queryByTestId("category-conflict")).toBeNull();
    expect(name()).toHaveValue("Đồ uống");
  });
});

describe("C9 F1 — a create whose read-back said 'not there yet' and whose same-id retry is answered 409 blog.duplicate-id", () => {
  const duplicate = { kind: "refused", status: 409, code: "blog.duplicate-id", field: "id", detail: "A category with this id already exists." } as const;

  /** Create lost → read-back finds nothing → Save again → 409 duplicate-id. Resolves with the id the create was sent under. */
  async function reachDuplicate(retryName?: string) {
    server = [];
    renderInBlogGate(<CategoriesScreen />);
    await screen.findByTestId("category-new");
    await userEvent.click(btn("category-new"));
    await screen.findByTestId("category-dialog");
    await userEvent.type(name(), "Mới");
    await userEvent.type(screen.getByTestId("category-slug-vi"), "moi");
    create.mockResolvedValueOnce(unverified as never);
    await userEvent.click(btn("category-save"));
    await screen.findByTestId("write-unverified");
    const id = create.mock.calls[0][0];
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/cùng mã/);
    if (retryName) await typeName(retryName);
    create.mockResolvedValueOnce(duplicate as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toBe(id); // the same id, never a replacement
    return id;
  }

  it("keeps the read-back action: the duplicate is not an ordinary refusal and Save does not offer another create", async () => {
    await reachDuplicate();
    expect(await screen.findByTestId("check-server")).toBeInTheDocument();
    expect(btn("category-save")).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a read-back that shows the category created from what was sent confirms it and closes: one create row, no third send", async () => {
    const id = await reachDuplicate();
    server = [cat(id, { version: 1, sortOrder: 10, translations: { vi: text("Mới", "moi") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
    expect(screen.getByTestId("categories-note")).toHaveTextContent(/đọc lại, không phải gửi lại/);
    expect(create).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("judges the read-back against what the lost create SENT, not the refused retry: the retry's newer text stays unsaved and Save then UPDATES the confirmed version", async () => {
    const id = await reachDuplicate("Mới, sửa lại");
    server = [cat(id, { version: 1, sortOrder: 10, translations: { vi: text("Mới", "moi") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/Những chỉnh sửa mới hơn.*chưa được lưu/);
    expect(screen.queryByTestId("category-conflict")).toBeNull();
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
    expect(name()).toHaveValue("Mới, sửa lại");
    save.mockResolvedValueOnce(ok(cat(id, { version: 2 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe(id);
    expect(save.mock.calls[0][1]).toBe(1); // the confirmed version
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("text typed while the read-back is on its way stays unsaved and is written on the confirmed version", async () => {
    const id = await reachDuplicate();
    const gate = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(gate.promise as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await userEvent.type(name(), " thêm");
    gate.resolve(ok([cat(id, { version: 1, sortOrder: 10, translations: { vi: text("Mới", "moi") } })]));
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/Những chỉnh sửa mới hơn.*chưa được lưu/);
    expect(name()).toHaveValue("Mới thêm");
    save.mockResolvedValueOnce(ok(cat(id, { version: 2 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 2)).toEqual([id, 1]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a category under that id with other values is a comparison, never a success; 'keep mine' then UPDATES it on the server's version instead of creating a second row", async () => {
    const id = await reachDuplicate();
    server = [cat(id, { version: 3, translations: { vi: text("Khác hẳn", "khac-han") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    const panel = await screen.findByTestId("category-conflict");
    expect(panel).toHaveTextContent("Khác hẳn");
    expect(panel).not.toHaveTextContent(/đóng và tạo lại/); // closing and creating again would be a second row
    expect(screen.getByTestId("categories-note")).not.toHaveTextContent(/đã xác nhận/i);
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
    expect(name()).toHaveValue("Mới");
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(btn("category-conflict-keep"));
    expect(save).not.toHaveBeenCalled(); // choosing sends nothing
    save.mockResolvedValueOnce(ok(cat(id, { version: 4 })) as never);
    await userEvent.click(btn("category-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 2)).toEqual([id, 3]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unauthenticated", { kind: "unauthenticated" }],
    ["denied (403)", { kind: "denied" }],
  ])("a read-back answered '%s' keeps the operation open and the input: nothing is adopted, resent or called saved", async (_name, answer) => {
    await reachDuplicate();
    list.mockResolvedValueOnce(answer as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/Chưa kiểm tra được/);
    expect(screen.getByTestId("check-server")).toBeInTheDocument();
    expect(btn("category-save")).toBeDisabled();
    expect(name()).toHaveValue("Mới");
    expect(screen.getByTestId("category-dialog")).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("a read-back that fails leaves the operation unconfirmed and the action in place; a later read that works completes it", async () => {
    const id = await reachDuplicate();
    list.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("categories-note")).toHaveTextContent(/Chưa kiểm tra được/);
    expect(screen.getByTestId("check-server")).toBeInTheDocument();
    expect(btn("category-save")).toBeDisabled();
    server = [cat(id, { version: 1, sortOrder: 10, translations: { vi: text("Mới", "moi") } })];
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("an id that is still not visible keeps the action instead of offering yet another create", async () => {
    await reachDuplicate();
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("categories-note")).toBeInTheDocument();
    expect(screen.getByTestId("check-server")).toBeInTheDocument();
    expect(btn("category-save")).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
