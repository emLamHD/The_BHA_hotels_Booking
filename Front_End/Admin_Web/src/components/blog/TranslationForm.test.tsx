/**
 * BHA-BLOG-001-CP03: the writes of a post's translation — one at a time, with the version they were made from; a 409 keeps what was typed and sends
 * nothing by itself; a lost answer is read from the server, never repeated; a new post keeps the id it was created under.
 */
import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  createPost: vi.fn(), saveDraft: vi.fn(), transitionPost: vi.fn(), getPost: vi.fn(), restoreRevision: vi.fn(),
  listRevisions: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));
vi.mock("./PostPreviewDialog", () => ({ default: () => <div data-testid="preview-stub" /> }));
// The rich editor has its own tests; here it is a button that reports one changed body.
vi.mock("./RichBodyEditor", () => ({
  default: function Stub({ onChange }: { onChange: (s: { body: unknown; problems: unknown[] }) => void }) {
    React.useEffect(() => onChange({ body: { schemaVersion: 1, blocks: [] }, problems: [] }), [onChange]);
    return <button type="button" data-testid="body-stub" onClick={() => onChange({ body: { schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "mới" }] }] }, problems: [] })}>sửa nội dung</button>;
  },
}));

import TranslationForm from "./TranslationForm";
import { BOTH, EDITOR, POST_ID, PUBLISHER, deferred, ok, post, renderInBlogGate, revision, translation } from "./blogTestUtils";
import { createPost, getPost, saveDraft, transitionPost } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";
import type { StaffSession } from "@/lib/api/staff";

const mockedMe = vi.mocked(fetchStaffSession);
const save = vi.mocked(saveDraft);
const create = vi.mocked(createPost);
const transition = vi.mocked(transitionPost);
const read = vi.mocked(getPost);

const CLIENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const stale = { kind: "refused", status: 409, code: "blog.stale-version", field: "expectedVersion", detail: "It was changed by someone else." } as const;

function mount(as: StaffSession, props: Partial<React.ComponentProps<typeof TranslationForm>> = {}) {
  mockedMe.mockResolvedValue({ kind: "authenticated", session: as });
  const onPost = vi.fn();
  const onCreated = vi.fn();
  const onStatus = vi.fn();
  const view = renderInBlogGate(
    <TranslationForm postId={POST_ID} clientId={CLIENT_ID} locale="vi" initial={translation()} categories={[]} properties={[]} pickMedia={vi.fn()} onPost={onPost} onCreated={onCreated} onStatus={onStatus} {...props} />
  );
  return { ...view, onPost, onCreated, onStatus };
}

const title = () => screen.findByTestId("post-title") as Promise<HTMLInputElement>;
const button = (id: string) => within(screen.getByTestId(id)).getByRole("button");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  for (const mock of [save, create, transition, read]) mock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("saving", () => {
  it("sends one save for a double click, with the version it was read at", async () => {
    mount(EDITOR);
    const gate = deferred<ReturnType<typeof ok>>();
    save.mockReturnValue(gate.promise as never);
    const input = await title();
    await userEvent.clear(input);
    await userEvent.type(input, "Tiêu đề mới");
    const saveButton = button("post-save");
    await userEvent.dblClick(saveButton);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 3)).toEqual([POST_ID, "vi", 1]);
    expect(save.mock.calls[0][3]).toMatchObject({ title: "Tiêu đề mới", slug: "bai-bien-my-khe" });
    gate.resolve(ok(post(translation({ version: 2, draft: revision({ title: "Tiêu đề mới" }) }))));
    await waitFor(() => expect(screen.queryByTestId("post-dirty")).toBeNull());
  });

  it("is not dirty until something differs from the server, and the save button knows it", async () => {
    mount(EDITOR);
    await title();
    expect(screen.queryByTestId("post-dirty")).toBeNull();
    expect(within(screen.getByTestId("post-save")).getByRole("button")).toBeDisabled();
    await userEvent.type(screen.getByTestId("post-summary").querySelector("textarea") ?? (screen.getByTestId("post-summary") as HTMLElement), " thêm");
    expect(await screen.findByTestId("post-dirty")).toBeInTheDocument();
  });
});

describe("a stale version (409)", () => {
  it("keeps what was typed, sends nothing by itself, and only moves on when the person says so", async () => {
    mount(EDITOR);
    save.mockResolvedValueOnce(stale as never);
    const input = await title();
    await userEvent.clear(input);
    await userEvent.type(input, "Bản của tôi");
    await userEvent.click(button("post-save"));
    expect(await screen.findByTestId("write-refused")).toHaveTextContent(/đã thay đổi trên máy chủ/);
    expect(input).toHaveValue("Bản của tôi");
    expect(save).toHaveBeenCalledTimes(1);

    read.mockResolvedValue(ok(post(translation({ version: 5, draft: revision({ title: "Bản của người khác" }) }))) as never);
    await userEvent.click(screen.getByTestId("reload-latest"));
    const panel = await screen.findByTestId("conflict-panel");
    expect(panel).toHaveTextContent("Bản của người khác");
    expect(panel).toHaveTextContent("Bản của tôi");
    expect(input).toHaveValue("Bản của tôi");
    expect(save).toHaveBeenCalledTimes(1); // reading is not writing

    await userEvent.click(within(screen.getByTestId("conflict-keep")).getByRole("button"));
    expect(save).toHaveBeenCalledTimes(1); // "keep mine" still sends nothing
    expect(input).toHaveValue("Bản của tôi");

    save.mockResolvedValueOnce(ok(post(translation({ version: 6, draft: revision({ title: "Bản của tôi" }) }))) as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2]).toBe(5); // the version moved on only because they chose to keep their changes on top of the new one
  });

  it("can drop the local changes for the server's copy when asked", async () => {
    mount(EDITOR);
    save.mockResolvedValueOnce(stale as never);
    const input = await title();
    await userEvent.type(input, "!");
    await userEvent.click(button("post-save"));
    read.mockResolvedValue(ok(post(translation({ version: 3, draft: revision({ title: "Máy chủ" }) }))) as never);
    await userEvent.click(await screen.findByTestId("reload-latest"));
    await userEvent.click(within(await screen.findByTestId("conflict-use-server")).getByRole("button"));
    await waitFor(() => expect((screen.getByTestId("post-title") as HTMLInputElement).value).toBe("Máy chủ"));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("an answer that never came", () => {
  it("is not resent: the server is read, and only what it shows decides", async () => {
    mount(EDITOR);
    save.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ Admin không trả lời." } as never);
    const input = await title();
    await userEvent.clear(input);
    await userEvent.type(input, "Có thể đã lưu");
    await userEvent.click(button("post-save"));
    expect(await screen.findByTestId("write-unverified")).toBeInTheDocument();
    expect(within(screen.getByTestId("post-save")).getByRole("button")).toBeDisabled(); // no blind retry

    read.mockResolvedValue(ok(post(translation({ version: 2, draft: revision({ title: "Có thể đã lưu" }) }))) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận.*không phải gửi lại/);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("post-dirty")).toBeNull();
  });

  it("is a conflict when the server moved on to something else", async () => {
    mount(EDITOR);
    save.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    const input = await title();
    await userEvent.type(input, " X");
    await userEvent.click(button("post-save"));
    await screen.findByTestId("write-unverified");
    read.mockResolvedValue(ok(post(translation({ version: 4, draft: revision({ title: "Người khác sửa" }) }))) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("Người khác sửa");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the id of a new post when the create is lost, and sends it again only on the person's word", async () => {
    const { onCreated } = mount(EDITOR, { postId: null, initial: undefined });
    create.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await userEvent.type(await title(), "Bài mới");
    await userEvent.click(button("post-save"));
    await screen.findByTestId("write-unverified");
    expect(create.mock.calls[0][0]).toBe(CLIENT_ID);

    read.mockResolvedValue({ kind: "refused", status: 404, code: "blog.not-found", field: "id", detail: "" } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(read).toHaveBeenCalledWith(CLIENT_ID);
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/cùng mã/);
    expect(create).toHaveBeenCalledTimes(1);

    create.mockResolvedValueOnce(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi" }) }), CLIENT_ID)) as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toBe(CLIENT_ID); // the same id: it cannot become two posts
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("finds a created post under the same id and does not create it again", async () => {
    const { onCreated } = mount(EDITOR, { postId: null, initial: undefined });
    create.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await userEvent.type(await title(), "Bài mới");
    await userEvent.click(button("post-save"));
    await screen.findByTestId("write-unverified");
    read.mockResolvedValue(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "", authorName: "" }) }), CLIENT_ID)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("publishing", () => {
  it("saves what is typed first, then publishes the saved version", async () => {
    mount(BOTH);
    const calls: string[] = [];
    save.mockImplementation((async () => { calls.push("save"); return ok(post(translation({ version: 2, draft: revision({ title: "Sắp đăng" }) }))); }) as never);
    transition.mockImplementation((async () => { calls.push("publish"); return ok(post(translation({ version: 3, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Sắp đăng", state: "Frozen" }) }))); }) as never);
    const input = await title();
    await userEvent.clear(input);
    await userEvent.type(input, "Sắp đăng");
    expect(within(screen.getByTestId("post-publish")).getByRole("button")).toHaveTextContent("Lưu và xuất bản");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["save", "publish"]);
    expect(transition.mock.calls[0]).toEqual([POST_ID, "vi", "publish", 2]); // the version the save returned
    await waitFor(() => expect(screen.getByTestId("post-status")).toHaveTextContent("Đã xuất bản"));
  });

  describe("a publish whose answer is lost after 'save and publish'", () => {
    const published = (title: string) => revision({ title, state: "Frozen", publishedAtUtc: "2026-10-21T09:00:00Z" });
    const live = translation({ status: "Published", version: 7, hasDraft: true, draft: revision({ title: "Bản nháp cũ" }), published: published("Đang đăng") });

    async function loseThePublish() {
      mount(BOTH, { initial: live });
      save.mockResolvedValueOnce(ok(post(translation({ status: "Published", version: 8, hasDraft: true, draft: revision({ title: "Bản mới" }), published: published("Đang đăng") }))) as never);
      transition.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
      const input = await title();
      await userEvent.clear(input);
      await userEvent.type(input, "Bản mới");
      await userEvent.click(button("post-publish"));
      await screen.findByTestId("write-unverified");
      expect(save).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledTimes(1);
      expect(transition.mock.calls[0]).toEqual([POST_ID, "vi", "publish", 8]); // the version the save returned
    }

    it("is NOT reported as done when the server shows the save but not the publish", async () => {
      await loseThePublish();
      read.mockResolvedValue(ok(post(translation({ status: "Published", version: 8, hasDraft: true, draft: revision({ title: "Bản mới" }), published: published("Đang đăng") }))) as never);
      await userEvent.click(screen.getByTestId("check-server"));
      expect(await screen.findByTestId("post-note")).toHaveTextContent(/chưa ghi nhận/);
      expect(screen.queryByText(/đã ghi nhận thao tác/)).toBeNull();
      expect(transition).toHaveBeenCalledTimes(1);
    });

    it("is a conflict, not a success, when someone else moved the post on", async () => {
      await loseThePublish();
      read.mockResolvedValue(ok(post(translation({ status: "Published", version: 10, hasDraft: false, draft: null, published: published("Người khác đã đăng") }))) as never);
      await userEvent.click(screen.getByTestId("check-server"));
      expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("Người khác đã đăng");
      expect(screen.queryByText(/đã ghi nhận thao tác/)).toBeNull();
      expect(transition).toHaveBeenCalledTimes(1);
    });

    it("is recognised as done only when the published copy is the one that was sent", async () => {
      await loseThePublish();
      read.mockResolvedValue(ok(post(translation({ status: "Published", version: 9, hasDraft: false, draft: null, published: published("Bản mới") }))) as never);
      await userEvent.click(screen.getByTestId("check-server"));
      expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận thao tác \(phiên bản 9\)/);
      expect(screen.queryByTestId("post-has-unpublished")).toBeNull();
      expect(transition).toHaveBeenCalledTimes(1);
    });
  });

  it("does not publish when the save was refused, and keeps what was typed", async () => {
    mount(BOTH);
    save.mockResolvedValueOnce(stale as never);
    const input = await title();
    await userEvent.type(input, "!");
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-refused");
    expect(transition).not.toHaveBeenCalled();
    expect(input).toHaveValue("Bãi biển Mỹ Khê!");
  });

  it("shows the server's reason next to the field and keeps the input", async () => {
    mount(BOTH);
    transition.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.summary-required", field: "summary", detail: "Enter a summary." } as never);
    await title();
    await userEvent.click(button("post-publish"));
    expect(await screen.findByText(/Cần nhập tóm tắt để xuất bản/)).toBeInTheDocument();
    expect(screen.queryByTestId("write-refused")).toBeNull();
  });
});

describe("permissions in the form", () => {
  it("lets a publisher-only account read, preview and publish the saved draft but not edit it", async () => {
    mount(PUBLISHER);
    const input = await title();
    expect(input).toBeDisabled();
    expect(screen.queryByTestId("post-save")).toBeNull();
    expect(screen.getByTestId("post-readonly")).toBeInTheDocument();
    transition.mockResolvedValueOnce(ok(post(translation({ version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ state: "Frozen" }) }))) as never);
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledWith(POST_ID, "vi", "publish", 1));
    expect(save).not.toHaveBeenCalled();
  });

  it("gives an editor-only account no publishing, archiving or unpublishing", async () => {
    mount(EDITOR, { initial: translation({ status: "Published", hasDraft: false, draft: null, published: revision({ state: "Frozen" }) }) });
    await title();
    for (const id of ["post-publish", "post-unpublish", "post-archive", "post-unarchive"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId("post-save")).toBeInTheDocument();
  });
});

describe("unpublishing and archiving", () => {
  it("asks first, then sends one transition with the current version", async () => {
    mount(BOTH, { initial: translation({ status: "Published", version: 7, hasDraft: false, draft: null, published: revision({ state: "Frozen" }) }) });
    await title();
    await userEvent.click(button("post-unpublish"));
    expect(transition).not.toHaveBeenCalled();
    transition.mockResolvedValueOnce(ok(post(translation({ status: "Unpublished", version: 8, hasDraft: false, draft: null, published: revision({ state: "Frozen" }) }))) as never);
    await userEvent.click(button("post-confirm-yes"));
    await waitFor(() => expect(transition).toHaveBeenCalledWith(POST_ID, "vi", "unpublish", 7));
    await waitFor(() => expect(screen.getByTestId("post-status")).toHaveTextContent("Đã gỡ"));
  });
});
