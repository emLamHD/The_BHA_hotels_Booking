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
vi.mock("./PostPreviewDialog", () => ({ default: ({ onClose }: { onClose: () => void }) => <button type="button" data-testid="preview-stub" onClick={onClose}>đóng xem trước</button> }));
// The rich editor has its own tests; here it is a button that reports one changed body.
vi.mock("./RichBodyEditor", () => ({
  default: function Stub({ onChange }: { onChange: (s: { body: unknown; problems: unknown[] }) => void }) {
    React.useEffect(() => onChange({ body: { schemaVersion: 1, blocks: [] }, problems: [] }), [onChange]);
    return <button type="button" data-testid="body-stub" onClick={() => onChange({ body: { schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "mới" }] }] }, problems: [] })}>sửa nội dung</button>;
  },
}));

import TranslationForm from "./TranslationForm";
import { BOTH, EDITOR, POST_ID, PUBLISHER, deferred, ok, post, renderInBlogGate, revision, translation } from "./blogTestUtils";
import { createPost, getPost, listRevisions, restoreRevision, saveDraft, transitionPost, type BlogRevisionSummary } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";
import type { StaffSession } from "@/lib/api/staff";

const mockedMe = vi.mocked(fetchStaffSession);
const save = vi.mocked(saveDraft);
const create = vi.mocked(createPost);
const transition = vi.mocked(transitionPost);
const read = vi.mocked(getPost);
const restore = vi.mocked(restoreRevision);
const history = vi.mocked(listRevisions);

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
  for (const mock of [save, create, transition, read, restore]) mock.mockReset();
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

// ---------------------------------------------------------------- C3 F1: "Lưu và xuất bản" on a post that does not exist yet

describe("C3 F1 — save and publish on a new post", () => {
  // The component is rendered with postId === null and it STAYS null (nothing re-renders it with the new id), like the first render of /posts/new:
  // the id the publish goes to must come from what the create returned, not from the prop.
  const created = (version = 1) => ok(post(translation({ version, draft: revision({ title: "Bài mới", slug: "bai-moi" }) }), CLIENT_ID));
  // a publish returns the saved draft, frozen: its title / slug / summary are what was saved (`summary` is what the refused-publish test types)
  const published = (summary: string) => ok(post(translation({ version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Bài mới", slug: "bai-moi", summary, state: "Frozen" }) }), CLIENT_ID));
  const live = published("Một bãi biển dài.");
  const fresh = () => mount(BOTH, { postId: null, initial: undefined });
  const typeNew = async () => {
    const input = await title();
    await userEvent.type(input, "Bài mới"); // the slug follows the title
  };

  it("sends one create and then one publish, to the created post, at the version the create returned", async () => {
    const calls: string[] = [];
    let onCreatedBefore = -1;
    const { onCreated } = fresh();
    create.mockImplementation((async () => { calls.push("create"); return created(); }) as never);
    transition.mockImplementation((async () => { calls.push("publish"); onCreatedBefore = onCreated.mock.calls.length; return live; }) as never);
    await typeNew();
    expect(within(screen.getByTestId("post-publish")).getByRole("button")).toHaveTextContent("Lưu và xuất bản");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["create", "publish"]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBe(CLIENT_ID);
    expect(transition.mock.calls[0]).toEqual([CLIENT_ID, "vi", "publish", 1]);
    await waitFor(() => expect(screen.getByTestId("post-status")).toHaveTextContent("Đã xuất bản"));
    // The screen is left for the post's own page only after the whole chain, never in the middle of it.
    expect(onCreatedBefore).toBe(0);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("is still one create and one publish for a double click", async () => {
    fresh();
    const gate = deferred<ReturnType<typeof created>>();
    create.mockReturnValue(gate.promise as never);
    transition.mockResolvedValue(live as never);
    await typeNew();
    await userEvent.dblClick(button("post-publish"));
    gate.resolve(created());
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByTestId("post-status")); // let anything else that was queued run
    expect(create).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it("does not publish when the create was refused, or when its answer is lost", async () => {
    const { onCreated } = fresh();
    create.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.slug-invalid", field: "slug", detail: "bad" } as never);
    await typeNew();
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await screen.findByText(/Slug không hợp lệ/);
    create.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-unverified");
    expect(create).toHaveBeenCalledTimes(2);
    expect(transition).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("a refused publish is shown as refused: the post exists as a draft, the form stays, and nothing says 'published'", async () => {
    const { onCreated } = fresh();
    create.mockResolvedValueOnce(created() as never);
    transition.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.summary-required", field: "summary", detail: "Enter a summary." } as never);
    await typeNew();
    await userEvent.click(button("post-publish"));
    expect(await screen.findByText(/Cần nhập tóm tắt để xuất bản/)).toBeInTheDocument();
    expect(screen.getByTestId("post-status")).toHaveTextContent("Bản nháp");
    expect(onCreated).not.toHaveBeenCalled(); // leaving the page would lose the refusal
    expect(create).toHaveBeenCalledTimes(1);

    // The person fixes it and publishes again: it goes to the post that was created (no second create), and only then is the page left.
    transition.mockResolvedValueOnce(published("Tóm tắt") as never);
    await userEvent.type(screen.getByTestId("post-summary").querySelector("textarea") ?? (screen.getByTestId("post-summary") as HTMLElement), "Tóm tắt");
    save.mockResolvedValueOnce(ok(post(translation({ version: 2, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "Tóm tắt" }) }), CLIENT_ID)) as never);
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 3)).toEqual([CLIENT_ID, "vi", 1]);
    expect(transition.mock.calls[1]).toEqual([CLIENT_ID, "vi", "publish", 2]);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("a publish whose answer is lost is read back by the created id, not resent, and not called done until the server shows it", async () => {
    const { onCreated } = fresh();
    create.mockResolvedValueOnce(created() as never);
    transition.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await typeNew();
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-unverified");
    expect(onCreated).not.toHaveBeenCalled();

    read.mockResolvedValueOnce(created() as never); // still a draft on the server
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/chưa ghi nhận/);
    expect(read).toHaveBeenCalledWith(CLIENT_ID);
    expect(screen.getByTestId("post-status")).toHaveTextContent("Bản nháp");
    expect(transition).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("a lost publish that the server did apply is recognised from the read-back, then the page is left", async () => {
    const { onCreated } = fresh();
    create.mockResolvedValueOnce(created() as never);
    transition.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await typeNew();
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-unverified");
    read.mockResolvedValueOnce(live as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận thao tác \(phiên bản 2\)/);
    expect(screen.getByTestId("post-status")).toHaveTextContent("Đã xuất bản");
    expect(transition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("save only still creates once and then leaves for the post's page; the form does not publish", async () => {
    const { onCreated } = fresh();
    create.mockResolvedValueOnce(created() as never);
    await typeNew();
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(transition).not.toHaveBeenCalled();
  });

  it("save and preview keeps the preview open and leaves for the post's page when it is closed", async () => {
    const { onCreated } = fresh();
    create.mockResolvedValueOnce(created() as never);
    await typeNew();
    await userEvent.click(button("post-preview"));
    await screen.findByTestId("preview-stub");
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("preview-stub"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("an account that can publish but not edit cannot start a new post from here", async () => {
    mount(PUBLISHER, { postId: null, initial: undefined });
    await title();
    expect(screen.queryByTestId("post-save")).toBeNull();
    expect(within(screen.getByTestId("post-publish")).getByRole("button")).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- C3 F2: a restore whose answer was lost

describe("C3 F2 — restoring a revision whose answer was lost", () => {
  const A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
  const B = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
  const summary = (id: string, number: number, over: Partial<BlogRevisionSummary> = {}): BlogRevisionSummary => ({
    id, number, state: "Frozen", origin: "Edit", title: `Bản cũ ${number}`, slug: `ban-cu-${number}`, createdAtUtc: "2026-10-20T08:00:00Z", createdBy: null, publishedAtUtc: null, publishedBy: null, isDraft: false, isPublished: false, ...over,
  });
  const current = revision({ id: "cccccccc-0000-4000-8000-000000000001", number: 4, title: "Bản đang sửa", slug: "ban-dang-sua" });
  const start = translation({ version: 6, draft: current });
  const restored = (version: number, from: string, over: Partial<ReturnType<typeof revision>> = {}) =>
    ok(post(translation({ version, draft: revision({ id: "dddddddd-0000-4000-8000-000000000009", number: 5, origin: "Restore", restoredFromRevisionId: from, title: "Bản cũ 2", slug: "ban-cu-2", ...over }) })));

  beforeEach(() => {
    history.mockResolvedValue(ok([summary(A, 2), summary(B, 3), summary(current.id, 4, { isDraft: true, state: "Draft" })]) as never);
  });
  afterEach(() => {
    history.mockImplementation((() => Promise.resolve({ kind: "ok", data: [] })) as never);
  });

  async function loseRestoreOf(which: 0 | 1 = 0) {
    mount(BOTH, { initial: start });
    restore.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    const rows = await screen.findAllByTestId("history-item");
    await userEvent.click(within(rows[which]).getByRole("button", { name: /Khôi phục thành nháp/ }));
    await userEvent.click(button("post-confirm-yes"));
    await screen.findByTestId("write-unverified");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]).toEqual([POST_ID, "vi", which === 0 ? A : B, 6]);
  }

  const notDone = () => {
    expect(screen.queryByText(/đã ghi nhận thao tác/)).toBeNull();
    expect(screen.queryByText(/Đã khôi phục/)).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1); // never sent again
    expect((screen.getByTestId("post-title") as HTMLInputElement).value).toBe("Bản đang sửa"); // the local form is untouched
  };

  it("that never reached the server while someone else saved: the version moved, but nothing says the restore happened", async () => {
    await loseRestoreOf();
    read.mockResolvedValue(ok(post(translation({ version: 7, draft: revision({ number: 4, origin: "Edit", title: "Người khác vừa lưu" }) }))) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("Người khác vừa lưu");
    notDone();
  });

  it("when someone else restored B while A was asked for, B is not taken for A", async () => {
    await loseRestoreOf(0);
    read.mockResolvedValue(restored(7, B, { title: "Bản cũ 3" }) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("Bản cũ 3");
    notDone();
  });

  it("when the server shows exactly A restored, one version on, it is recognised once, the form shows it, and nothing was resent", async () => {
    await loseRestoreOf();
    read.mockResolvedValue(restored(7, A) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận thao tác \(phiên bản 7\)/);
    expect((screen.getByTestId("post-title") as HTMLInputElement).value).toBe("Bản cũ 2");
    expect(screen.queryByTestId("conflict-panel")).toBeNull();
    expect(screen.queryByTestId("post-dirty")).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("when the restored draft was edited by someone else afterwards, 'restored from A' is not enough: it stays a comparison", async () => {
    await loseRestoreOf();
    read.mockResolvedValue(restored(8, A, { title: "Bản cũ 2 + sửa của người khác" }) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("sửa của người khác");
    notDone();
  });

  it("when the server did not move, it says so and keeps the form; when it cannot be read, it stays unverified", async () => {
    await loseRestoreOf();
    read.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/Không đọc được/);
    expect(screen.getByTestId("write-unverified")).toBeInTheDocument();
    notDone();

    read.mockResolvedValueOnce(ok(post(start)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/chưa ghi nhận/);
    notDone();
  });

  it("an ordinary answer replaces the draft with the restored one and leaves the published copy alone", async () => {
    mount(BOTH, { initial: translation({ version: 6, status: "Published", hasDraft: true, draft: current, published: revision({ id: "eeeeeeee-0000-4000-8000-000000000001", number: 3, state: "Frozen", title: "Đang đăng" }) }) });
    restore.mockResolvedValueOnce(ok(post(translation({
      version: 7, status: "Published", hasDraft: true,
      draft: revision({ id: "dddddddd-0000-4000-8000-000000000009", number: 5, origin: "Restore", restoredFromRevisionId: A, title: "Bản cũ 2", slug: "ban-cu-2" }),
      published: revision({ id: "eeeeeeee-0000-4000-8000-000000000001", number: 3, state: "Frozen", title: "Đang đăng" }),
    }))) as never);
    const rows = await screen.findAllByTestId("history-item");
    await userEvent.click(within(rows[0]).getByRole("button", { name: /Khôi phục thành nháp/ }));
    await userEvent.click(button("post-confirm-yes"));
    await waitFor(() => expect((screen.getByTestId("post-title") as HTMLInputElement).value).toBe("Bản cũ 2"));
    expect(screen.getByTestId("post-status")).toHaveTextContent("Đã xuất bản");
    expect(screen.getByTestId("post-has-unpublished")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
  });

  it("a restore on a post that is not created yet is not offered", async () => {
    mount(BOTH, { postId: null, initial: undefined });
    await title();
    expect(screen.queryByTestId("post-history")).toBeNull();
  });
});

// ---------------------------------------------------------------- C4 F1: input typed while a write is on its way

describe("C4 F1 — the editor body typed while the first create is on its way", () => {
  it("is kept and unsaved: the screen does not leave, and the next Save writes it to the created post at the version the create returned", async () => {
    const { onCreated } = mount(EDITOR, { postId: null, initial: undefined });
    const gate = deferred<ReturnType<typeof ok>>();
    create.mockReturnValueOnce(gate.promise as never);
    await userEvent.type(await title(), "Bài mới");
    await userEvent.click(button("post-save"));
    await screen.findByTestId("write-pending");
    await userEvent.click(screen.getByTestId("body-stub")); // the editor reports a changed body while the create is pending
    gate.resolve(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "", body: { schemaVersion: 1, blocks: [] } }) }), CLIENT_ID)) as never);
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId("post-dirty")).toBeInTheDocument();
    save.mockResolvedValueOnce(ok(post(translation({ version: 2, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "", body: { schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "mới" }] }] } }) }), CLIENT_ID)) as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([CLIENT_ID, "vi", 1]);
    expect(save.mock.calls[0][3]).toMatchObject({ body: { schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "mới" }] }] } });
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });
});

describe("C4 F1 (related) — a restore whose answer arrives after the person typed on", () => {
  const A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
  const current = revision({ id: "cccccccc-0000-4000-8000-000000000001", number: 4, title: "Bản đang sửa", slug: "ban-dang-sua" });
  beforeEach(() => {
    history.mockResolvedValue(ok([{ id: A, number: 2, state: "Frozen", origin: "Edit", title: "Bản cũ 2", slug: "ban-cu-2", createdAtUtc: "2026-10-20T08:00:00Z", createdBy: null, publishedAtUtc: null, publishedBy: null, isDraft: false, isPublished: false }]) as never);
  });
  afterEach(() => {
    history.mockImplementation((() => Promise.resolve({ kind: "ok", data: [] })) as never);
  });
  const restoredPost = () => ok(post(translation({ version: 7, draft: revision({ id: "dddddddd-0000-4000-8000-000000000009", number: 5, origin: "Restore", restoredFromRevisionId: A, title: "Bản cũ 2", slug: "ban-cu-2" }) })));
  async function startRestore() {
    mount(BOTH, { initial: translation({ version: 6, draft: current }) });
    const gate = deferred<ReturnType<typeof ok>>();
    restore.mockReturnValueOnce(gate.promise as never);
    const rows = await screen.findAllByTestId("history-item");
    await userEvent.click(within(rows[0]).getByRole("button", { name: /Khôi phục thành nháp/ }));
    await userEvent.click(button("post-confirm-yes"));
    await screen.findByTestId("write-pending");
    return gate;
  }

  it("does not replace what was typed after the confirmation: a comparison opens, the input stays, nothing is sent", async () => {
    const gate = await startRestore();
    await userEvent.type(await title(), " + gõ thêm");
    gate.resolve(restoredPost() as never);
    expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("Bản cũ 2");
    expect((await title()).value).toBe("Bản đang sửa + gõ thêm");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("a lost answer that the server did apply, with input typed since, is a comparison too (the right revision was restored, the form is not replaced)", async () => {
    mount(BOTH, { initial: translation({ version: 6, draft: current }) });
    restore.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    const rows = await screen.findAllByTestId("history-item");
    await userEvent.click(within(rows[0]).getByRole("button", { name: /Khôi phục thành nháp/ }));
    await userEvent.click(button("post-confirm-yes"));
    await screen.findByTestId("write-unverified");
    await userEvent.type(await title(), " + gõ thêm");
    read.mockResolvedValue(restoredPost() as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("conflict-panel")).toHaveTextContent("Bản cũ 2");
    expect(screen.getByTestId("post-note")).toHaveTextContent(/đã khôi phục đúng bản được yêu cầu/);
    expect((await title()).value).toBe("Bản đang sửa + gõ thêm");
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("with nothing typed after the confirmation it replaces the draft as before", async () => {
    const gate = await startRestore();
    gate.resolve(restoredPost() as never);
    await waitFor(() => expect((screen.getByTestId("post-title") as HTMLInputElement).value).toBe("Bản cũ 2"));
    expect(screen.queryByTestId("conflict-panel")).toBeNull();
  });
});

describe("C9 F1 — a create whose read-back said 'not there yet' and whose same-id retry is answered 409 blog.duplicate-id", () => {
  const duplicate = { kind: "refused", status: 409, code: "blog.duplicate-id", field: "id", detail: "An article with this id already exists." } as const;
  const notFound = { kind: "refused", status: 404, code: "blog.not-found", field: "id", detail: "" } as const;
  const created = (titleText: string, version = 1) => ok(post(translation({ version, draft: revision({ title: titleText, slug: "bai-moi", summary: "", authorName: "" }) }), CLIENT_ID)) as never;

  /** Create lost → read-back 404 → Save again → 409 duplicate-id: the state every test starts from. Resolves with the form's callbacks. */
  async function reachDuplicate(retryTitle?: string) {
    const view = mount(EDITOR, { postId: null, initial: undefined });
    create.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    const input = await title();
    await userEvent.type(input, "Bài mới");
    await userEvent.click(button("post-save"));
    await screen.findByTestId("write-unverified");
    read.mockResolvedValueOnce(notFound as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/cùng mã/);
    if (retryTitle) {
      await userEvent.clear(input);
      await userEvent.type(input, retryTitle);
    }
    create.mockResolvedValueOnce(duplicate as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toBe(CLIENT_ID); // the same id, never a replacement
    return { ...view, input };
  }

  it("keeps the read-back action: the duplicate is not an ordinary refusal, Save does not offer another create, and nothing is resent", async () => {
    await reachDuplicate();
    expect(await screen.findByTestId("check-server")).toBeInTheDocument();
    expect(within(screen.getByTestId("post-save")).getByRole("button")).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a read-back that shows the post as created from what was sent adopts its id and version, and the screen goes on to the post's page; one create row, no third send", async () => {
    const { onCreated, onPost } = await reachDuplicate();
    read.mockResolvedValueOnce(created("Bài mới") as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: CLIENT_ID });
    expect(onPost).toHaveBeenCalled();
    expect(screen.queryByTestId("write-unverified")).toBeNull();
    expect(screen.queryByTestId("conflict-panel")).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("judges the read-back against what the lost create SENT, not against what the refused retry carried: the retry's newer text stays unsaved and is saved as an update", async () => {
    const { onCreated, input } = await reachDuplicate("Bài mới, sửa lại");
    read.mockResolvedValueOnce(created("Bài mới") as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận/);
    expect(screen.queryByTestId("conflict-panel")).toBeNull();
    expect(input).toHaveValue("Bài mới, sửa lại");
    expect(await screen.findByTestId("post-dirty")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled(); // unsaved input is never thrown away by leaving

    save.mockResolvedValueOnce(ok(post(translation({ version: 2, draft: revision({ title: "Bài mới, sửa lại", slug: "bai-moi", summary: "", authorName: "" }) }), CLIENT_ID)) as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([CLIENT_ID, "vi", 1]); // the confirmed id and version
    expect(create).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("text typed while the read-back is on its way stays unsaved and is saved on the confirmed version", async () => {
    const { onCreated, input } = await reachDuplicate();
    const gate = deferred<ReturnType<typeof ok>>();
    read.mockReturnValueOnce(gate.promise as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await userEvent.type(input, " thêm");
    gate.resolve(created("Bài mới") as never);
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận/);
    expect(input).toHaveValue("Bài mới thêm");
    expect(screen.getByTestId("post-dirty")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    save.mockResolvedValueOnce(created("Bài mới thêm", 2));
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([CLIENT_ID, "vi", 1]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a post under that id with different content is a comparison, never a success; 'keep mine' then writes an UPDATE on the server's version, not a third create", async () => {
    const { onCreated, input } = await reachDuplicate();
    read.mockResolvedValueOnce(created("Của người khác", 3) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    const panel = await screen.findByTestId("conflict-panel");
    expect(panel).toHaveTextContent("Của người khác");
    expect(panel).toHaveTextContent("Bài mới");
    expect(screen.getByTestId("post-note")).not.toHaveTextContent(/đã ghi nhận/);
    expect(input).toHaveValue("Bài mới");
    expect(onCreated).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    await userEvent.click(within(screen.getByTestId("conflict-keep")).getByRole("button"));
    expect(save).not.toHaveBeenCalled(); // choosing sends nothing
    save.mockResolvedValueOnce(created("Bài mới", 4));
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([CLIENT_ID, "vi", 3]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a read-back that fails leaves the operation unconfirmed and the action in place; a later read that works completes it", async () => {
    const { onCreated } = await reachDuplicate();
    read.mockResolvedValueOnce({ kind: "network", message: "Không đọc được." } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/Không đọc được/);
    expect(screen.getByTestId("check-server")).toBeInTheDocument();
    expect(within(screen.getByTestId("post-save")).getByRole("button")).toBeDisabled();
    expect(onCreated).not.toHaveBeenCalled();
    read.mockResolvedValueOnce(created("Bài mới") as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("an id that is still not visible keeps the action (and says so) instead of offering yet another create", async () => {
    await reachDuplicate();
    read.mockResolvedValueOnce(notFound as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toBeInTheDocument();
    expect(screen.getByTestId("check-server")).toBeInTheDocument();
    expect(within(screen.getByTestId("post-save")).getByRole("button")).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a post under that id that has no translation in this language is NOT called created by this form: it is adopted as the post, and Save adds the language to it (expectedVersion 0)", async () => {
    const { onCreated, onPost } = await reachDuplicate();
    read.mockResolvedValueOnce(ok(post(translation({ locale: "en", version: 2 }), CLIENT_ID)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(/chưa có bản dịch vi.*lần tạo vừa rồi không ghi gì/);
    expect(screen.queryByTestId("conflict-panel")).toBeNull();
    expect(screen.queryByTestId("write-unverified")).toBeNull(); // not stuck in a read-back loop
    expect(onPost).not.toHaveBeenCalled(); // the screen would switch to the post's first language and drop this form
    expect(onCreated).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled(); // nothing is sent until the person presses Save
    save.mockResolvedValueOnce(ok(post(translation({ locale: "vi", version: 1 }), CLIENT_ID)) as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([CLIENT_ID, "vi", 0]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unauthenticated", { kind: "unauthenticated" }, /Phiên đăng nhập Staff/],
    ["denied (403)", { kind: "denied" }, /từ chối/],
  ])("a read-back answered '%s' keeps the operation open and the input: nothing is adopted, resent or called saved", async (_name, answer, text) => {
    const { onCreated, input } = await reachDuplicate();
    read.mockResolvedValueOnce(answer as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("post-note")).toHaveTextContent(text);
    expect(screen.getByTestId("check-server")).toBeInTheDocument();
    expect(within(screen.getByTestId("post-save")).getByRole("button")).toBeDisabled();
    expect(input).toHaveValue("Bài mới");
    expect(onCreated).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("'save and publish' that ends in a duplicate publishes nothing", async () => {
    mount(BOTH, { postId: null, initial: undefined });
    create.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await userEvent.type(await title(), "Bài mới");
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-unverified");
    read.mockResolvedValueOnce(notFound as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await screen.findByTestId("post-note");
    create.mockResolvedValueOnce(duplicate as never);
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("check-server")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- C10 F1: a transition read back after a lost answer is adopted only when nothing else changed

describe("C10 F1 — a transition whose answer was lost: the read-back is adopted only when the content is still what the form was based on", () => {
  const SHOWN = "Đang đăng";
  const frozen = (t: string) => revision({ title: t, state: "Frozen", publishedAtUtc: "2026-10-21T09:00:00Z" });
  const OTHER = "Người khác đã sửa tiêu đề";
  // `same`: exactly what the transition itself changes (status, one version on). `changed`: the status the transition gives, but another writer saved on top afterwards.
  const CASES = [
    {
      kind: "unpublish",
      initial: translation({ status: "Published", version: 7, hasDraft: false, draft: null, published: frozen(SHOWN) }),
      begin: async () => { await userEvent.click(button("post-unpublish")); await userEvent.click(button("post-confirm-yes")); },
      same: translation({ status: "Unpublished", version: 8, hasDraft: false, draft: null, published: frozen(SHOWN) }),
      changed: translation({ status: "Unpublished", version: 9, hasDraft: true, draft: revision({ title: OTHER }), published: frozen(SHOWN) }),
    },
    {
      kind: "archive",
      initial: translation({ status: "Draft", version: 4, hasDraft: true, draft: revision({ title: SHOWN }) }),
      begin: async () => { await userEvent.click(button("post-archive")); await userEvent.click(button("post-confirm-yes")); },
      same: translation({ status: "Archived", version: 5, hasDraft: true, draft: revision({ title: SHOWN }) }),
      changed: translation({ status: "Archived", version: 7, hasDraft: true, draft: revision({ title: OTHER }) }),
    },
    {
      kind: "unarchive",
      initial: translation({ status: "Archived", version: 4, hasDraft: true, draft: revision({ title: SHOWN }) }),
      begin: async () => { await userEvent.click(button("post-unarchive")); },
      same: translation({ status: "Draft", version: 5, hasDraft: true, draft: revision({ title: SHOWN }) }),
      changed: translation({ status: "Draft", version: 6, hasDraft: true, draft: revision({ title: OTHER }) }),
    },
  ] as const;

  async function lose(c: (typeof CASES)[number]) {
    const view = mount(BOTH, { initial: c.initial });
    await title();
    transition.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await c.begin();
    await screen.findByTestId("write-unverified");
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition.mock.calls[0]).toEqual([POST_ID, "vi", c.kind, c.initial.version]);
    return view;
  }

  describe.each(CASES)("$kind", (c) => {
    it("with another writer's content on the server it is a comparison: the version is not adopted, the note does not say 'recorded', nothing is sent", async () => {
      await lose(c);
      read.mockResolvedValue(ok(post(c.changed)) as never);
      await userEvent.click(screen.getByTestId("check-server"));
      expect(await screen.findByTestId("conflict-panel")).toHaveTextContent(OTHER);
      expect(screen.queryByText(/đã ghi nhận thao tác/)).toBeNull();
      expect(screen.getByText(new RegExp(`Phiên bản ${c.initial.version} `))).toBeInTheDocument(); // still the version the form was based on
      expect(transition).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
    });

    it("with the content unchanged it is recognised once: the version moves to the one the transition made, nothing was resent", async () => {
      await lose(c);
      read.mockResolvedValue(ok(post(c.same)) as never);
      await userEvent.click(screen.getByTestId("check-server"));
      expect(await screen.findByTestId("post-note")).toHaveTextContent(new RegExp(`đã ghi nhận thao tác \\(phiên bản ${c.same.version}\\)`));
      expect(screen.queryByTestId("conflict-panel")).toBeNull();
      expect(screen.getByText(new RegExp(`Phiên bản ${c.same.version} `))).toBeInTheDocument();
      expect(transition).toHaveBeenCalledTimes(1);
    });

    it("what was typed while the server was being read stays, unsaved, on the adopted version", async () => {
      if (c.kind === "unarchive") return; // an archived translation is not editable: there is nothing to type
      await lose(c);
      const gate = deferred<ReturnType<typeof ok>>();
      read.mockReturnValue(gate.promise as never);
      await userEvent.click(screen.getByTestId("check-server"));
      const input = await title();
      await userEvent.type(input, " gõ thêm");
      gate.resolve(ok(post(c.same)));
      expect(await screen.findByTestId("post-note")).toHaveTextContent(/đã ghi nhận thao tác/);
      expect(input).toHaveValue(`${SHOWN} gõ thêm`);
      expect(screen.getByTestId("post-dirty")).toBeInTheDocument();
    });

    it("a read that fails adopts nothing and keeps the operation unconfirmed", async () => {
      await lose(c);
      read.mockResolvedValue({ kind: "network", message: "Không đọc được." } as never);
      await userEvent.click(screen.getByTestId("check-server"));
      expect(await screen.findByTestId("post-note")).toHaveTextContent(/Không đọc được/);
      expect(screen.getByTestId("write-unverified")).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`Phiên bản ${c.initial.version} `))).toBeInTheDocument();
    });
  });

  it("the review's sequence: after a lost unpublish and another editor's draft save, the next Save carries the OLD version, never the other writer's, and 'keep mine' is the only way to move it", async () => {
    const c = CASES[0];
    await lose(c);
    read.mockResolvedValue(ok(post(c.changed)) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await screen.findByTestId("conflict-panel");
    const input = await title();
    await userEvent.clear(input);
    await userEvent.type(input, "Của tôi");
    save.mockResolvedValueOnce(stale as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][2]).toBe(7); // not 9: the version of a copy nobody compared
    expect(await screen.findByTestId("write-refused")).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId("conflict-keep")).getByRole("button")); // the person has seen the other writer's title and chooses
    save.mockResolvedValueOnce(ok(post(translation({ status: "Unpublished", version: 10, draft: revision({ title: "Của tôi" }) }))) as never);
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2]).toBe(9);
  });

  it("an unarchive is recognised only as the status it gives: with a published copy that is 'unpublished', and a post someone published meanwhile is a comparison", async () => {
    const initial = translation({ status: "Archived", version: 4, hasDraft: false, draft: null, published: frozen(SHOWN) });
    mount(BOTH, { initial });
    await title();
    transition.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    await userEvent.click(button("post-unarchive"));
    await screen.findByTestId("write-unverified");
    read.mockResolvedValue(ok(post(translation({ status: "Published", version: 5, hasDraft: false, draft: null, published: frozen(SHOWN) }))) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("conflict-panel")).toBeInTheDocument();
    expect(screen.queryByText(/đã ghi nhận thao tác/)).toBeNull();
  });
});
