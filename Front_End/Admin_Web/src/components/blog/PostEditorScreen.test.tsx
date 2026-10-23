/**
 * BHA-BLOG-001-CP03-C3 (F1) with the REAL parent: on /posts/new the screen is replaced by the post's own route (a different Next page), so everything
 * under it is unmounted by `router.replace`. "Lưu và xuất bản" must have sent both writes before that happens, and the publish must go to the created post.
 */
import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
/** The page's query string (`?locale=…`): a test sets it before it renders the screen. */
const url = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(url.query) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchActiveProperties: vi.fn(() => Promise.resolve({ ok: true, data: [] })) }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  createPost: vi.fn(), saveDraft: vi.fn(), transitionPost: vi.fn(), getPost: vi.fn(), listCategories: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  listRevisions: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  fetchActiveLanguages: vi.fn(() => Promise.resolve({ kind: "ok", data: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true }, { code: "en", displayName: "English", nativeName: "English", isDefault: false }] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));
vi.mock("./PostPreviewDialog", () => ({ default: () => <div data-testid="preview-stub" /> }));
vi.mock("./MediaPickerDialog", () => ({ default: () => null }));
vi.mock("./RichBodyEditor", () => ({
  default: function Stub({ onChange, services }: { onChange: (s: { body: unknown; problems: unknown[] }) => void; services: { properties: unknown[] } }) {
    React.useEffect(() => onChange({ body: { schemaVersion: 1, blocks: [] }, problems: [] }), [onChange]);
    return <span data-testid="props-count">{services.properties.length}</span>; // what the property-intro block would offer
  },
}));

import PostEditorScreen from "./PostEditorScreen";
import { BOTH, deferred, ok, post, renderInBlogGate, revision, translation } from "./blogTestUtils";
import { createPost, fetchActiveLanguages, getPost, saveDraft, transitionPost } from "@/lib/api/blog";
import { fetchActiveProperties } from "@/lib/api/client";
import { fetchStaffSession } from "@/lib/api/staff";

const create = vi.mocked(createPost);
const transition = vi.mocked(transitionPost);
const save = vi.mocked(saveDraft);
const readPost = vi.mocked(getPost);
const properties = vi.mocked(fetchActiveProperties);

const lang = (code: string, isDefault: boolean) => ({ code, displayName: code, nativeName: code, isDefault });
const VI_DEFAULT = [lang("vi", true), lang("en", false)];
const EN_DEFAULT = [lang("vi", false), lang("en", true)];
const languages = vi.mocked(fetchActiveLanguages);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  url.query = "";
  languages.mockResolvedValue({ kind: "ok", data: VI_DEFAULT } as never);
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  for (const m of [create, transition, save, readPost, router.replace]) m.mockReset();
  properties.mockReset();
  properties.mockResolvedValue({ ok: true, data: [] } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("C3 F1 — /posts/new, 'Lưu và xuất bản', through the screen", () => {
  it("creates, publishes the created post, and only then asks the router to leave (which unmounts the screen)", async () => {
    const order: string[] = [];
    let unmount: () => void = () => {};
    create.mockImplementation((async (id: string) => { order.push("create"); return ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi" }) }), id)); }) as never);
    transition.mockImplementation((async (id: string) => {
      order.push("publish");
      return ok(post(translation({ version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Bài mới", slug: "bai-moi", state: "Frozen" }) }), id));
    }) as never);
    router.replace.mockImplementation((() => { order.push("leave"); unmount(); }) as never); // a different Next page: the whole screen goes away
    unmount = renderInBlogGate(<PostEditorScreen postId={null} />).unmount;

    await userEvent.type(await screen.findByTestId("post-title"), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));

    expect(order).toEqual(["create", "publish", "leave"]);
    const createdId = create.mock.calls[0][0];
    expect(transition.mock.calls[0]).toEqual([createdId, "vi", "publish", 1]);
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=vi`);
    expect(create).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it("when the publish is refused the screen stays on /posts/new with the refusal, and the created post is what the next attempt publishes", async () => {
    create.mockImplementation((async (id: string) => ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "" }) }), id))) as never);
    transition.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.summary-required", field: "summary", detail: "Enter a summary." } as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await screen.findByTestId("post-title"), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    expect(await screen.findByText(/Cần nhập tóm tắt để xuất bản/)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("post-status")).toHaveTextContent("Bản nháp");

    const createdId = create.mock.calls[0][0];
    transition.mockImplementationOnce((async (id: string) => ok(post(translation({ version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Bài mới", slug: "bai-moi", summary: "", state: "Frozen" }) }), id))) as never);
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(transition.mock.calls[1]).toEqual([createdId, "vi", "publish", 1]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a language tab opened on /posts/new after the post was created writes to THAT post, never a second create under the same id", async () => {
    create.mockImplementation((async (id: string) => ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "" }) }), id))) as never);
    transition.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.summary-required", field: "summary", detail: "Enter a summary." } as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await screen.findByTestId("post-title"), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await screen.findByText(/Cần nhập tóm tắt để xuất bản/);
    const createdId = create.mock.calls[0][0];
    expect(router.replace).not.toHaveBeenCalled(); // still on /posts/new, the post exists

    await userEvent.click(screen.getByTestId("locale-tab-en"));
    save.mockImplementation((async (id: string) => ok(post(translation({ version: 1, locale: "en", draft: revision({ title: "New post" }) }), id))) as never);
    await userEvent.type(await screen.findByTestId("post-title"), "New post");
    await userEvent.click(within(screen.getByTestId("post-save")).getByRole("button"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([createdId, "en", 0]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a form remounted for another language of the created post still moves the screen to the post's page when it finishes", async () => {
    create.mockImplementation((async (id: string) => ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "" }) }), id))) as never);
    transition.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.summary-required", field: "summary", detail: "Enter a summary." } as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await screen.findByTestId("post-title"), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await screen.findByText(/Cần nhập tóm tắt để xuất bản/);
    const createdId = create.mock.calls[0][0];

    // away to English and back: the Vietnamese form is a new instance, handed the created id
    await userEvent.click(screen.getByTestId("locale-tab-en"));
    await screen.findByTestId("post-new-translation");
    await userEvent.click(screen.getByTestId("locale-tab-vi"));
    await userEvent.type(await screen.findByTestId("post-summary"), "Đã có tóm tắt");
    transition.mockImplementationOnce((async (id: string) => ok(post(translation({ version: 3, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Bài mới", slug: "bai-moi", summary: "Đã có tóm tắt", state: "Frozen" }) }), id))) as never);
    save.mockImplementation((async (id: string) => ok(post(translation({ version: 2, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "Đã có tóm tắt" }) }), id))) as never);
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=vi`);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a plain save in a language opened on /posts/new also moves the screen to the post's page", async () => {
    create.mockImplementation((async (id: string) => ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "" }) }), id))) as never);
    transition.mockResolvedValueOnce({ kind: "refused", status: 400, code: "blog.summary-required", field: "summary", detail: "Enter a summary." } as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await screen.findByTestId("post-title"), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await screen.findByText(/Cần nhập tóm tắt để xuất bản/);
    const createdId = create.mock.calls[0][0];
    await userEvent.click(screen.getByTestId("locale-tab-en"));
    save.mockImplementation((async (id: string) => ok(post(translation({ version: 1, locale: "en", draft: revision({ title: "New post" }) }), id))) as never);
    await userEvent.type(await screen.findByTestId("post-title"), "New post");
    await userEvent.click(within(screen.getByTestId("post-save")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en`);
  });
});

// ---------------------------------------------------------------- C4 F1: edits typed while the first create is on its way

describe("C4 F1 — edits made while a new post is being created are never navigated away from", () => {
  const draftOf = (title: string, version = 1, extra: Partial<ReturnType<typeof revision>> = {}) => translation({ version, draft: revision({ title, slug: "bai-moi", summary: "", ...extra }) });
  const input = () => screen.findByTestId("post-title") as Promise<HTMLInputElement>;
  const action = (id: string) => within(screen.getByTestId(id)).getByRole("button");

  async function startCreate(testId: "post-save" | "post-publish") {
    const gate = deferred<ReturnType<typeof ok>>();
    create.mockReturnValueOnce(gate.promise as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await input(), "Bài mới");
    await userEvent.click(action(testId));
    await screen.findByTestId("write-pending");
    return gate;
  }

  it("save only: the answer confirms the post but does not leave; the newer text is still there, unsaved, and the next Save writes it to the created post and then leaves", async () => {
    const gate = await startCreate("post-save");
    const createdId = create.mock.calls[0][0];
    expect(screen.getByTestId("locale-tab-en")).toBeDisabled(); // another language cannot be opened mid-write

    await userEvent.type(await input(), " thêm");
    await userEvent.type(screen.getByTestId("post-summary").querySelector("textarea") ?? (screen.getByTestId("post-summary") as HTMLElement), "Tóm tắt mới");
    gate.resolve(ok(post(draftOf("Bài mới"), createdId)) as never);
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());

    expect(router.replace).not.toHaveBeenCalled();
    expect((await input()).value).toBe("Bài mới thêm");
    expect(screen.getByTestId("post-dirty")).toBeInTheDocument(); // not represented as saved
    expect(screen.getByTestId("post-status")).toHaveTextContent("Bản nháp"); // but the post is confirmed

    save.mockImplementation((async (id: string) => ok(post(draftOf("Bài mới thêm", 2, { summary: "Tóm tắt mới" }), id))) as never);
    await userEvent.click(action("post-save"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 3)).toEqual([createdId, "vi", 1]);
    expect(save.mock.calls[0][3]).toMatchObject({ title: "Bài mới thêm", summary: "Tóm tắt mới" });
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=vi`);
  });

  it("the server's re-written copy does not replace the newer text either", async () => {
    const gate = await startCreate("post-save");
    const createdId = create.mock.calls[0][0];
    await userEvent.type(await input(), " thêm");
    gate.resolve(ok(post(draftOf("Bài mới (chuẩn hoá)"), createdId)) as never); // the server wrote something other than what was typed
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());
    expect((await input()).value).toBe("Bài mới thêm");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("save and publish: the publish carries the SENT values to the created post; the newer text stays unsaved and unpublished and the screen does not leave", async () => {
    const gate = await startCreate("post-publish");
    const createdId = create.mock.calls[0][0];
    await userEvent.type(await input(), " thêm");
    transition.mockImplementation((async (id: string) => ok(post(translation({ version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Bài mới", slug: "bai-moi", state: "Frozen" }) }), id))) as never);
    gate.resolve(ok(post(draftOf("Bài mới"), createdId)) as never);
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    expect(transition.mock.calls[0]).toEqual([createdId, "vi", "publish", 1]);
    await waitFor(() => expect(screen.getByTestId("post-status")).toHaveTextContent("Đã xuất bản"));
    expect((await input()).value).toBe("Bài mới thêm");
    expect(screen.getByTestId("post-dirty")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("an edit that goes back to what was sent is not newer: the screen leaves as usual", async () => {
    const gate = await startCreate("post-save");
    const createdId = create.mock.calls[0][0];
    await userEvent.type(await input(), "!");
    await userEvent.type(await input(), "{Backspace}");
    gate.resolve(ok(post(draftOf("Bài mới"), createdId)) as never);
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
  });

  it("with nothing typed the screen leaves as before", async () => {
    const gate = await startCreate("post-save");
    gate.resolve(ok(post(draftOf("Bài mới"), create.mock.calls[0][0])) as never);
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------- C5 F3: the properties lookup is a required input of the editor

describe("C5 F3 — a failed properties lookup is shown, not turned into an editor with no properties", () => {
  const failure = { ok: false, error: { kind: "network", message: "Không gọi được máy chủ." } } as never;
  const found = { ok: true, data: [{ id: "10000000-0000-4000-8000-000000000001", name: "The BHA Riverside" }, { id: "10000000-0000-4000-8000-000000000002", name: "The BHA Beach" }] } as never;
  const retry = () => userEvent.click(within(screen.getByTestId("website-load-error")).getByRole("button", { name: "Thử lại" }));

  it("new post: the editor does not open, the error says what failed and offers a retry that reads that lookup again and restores the options", async () => {
    properties.mockResolvedValueOnce(failure);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    expect(await screen.findByTestId("website-load-error")).toHaveTextContent(/cơ sở lưu trú/);
    expect(screen.queryByTestId("translation-form")).toBeNull();
    expect(properties).toHaveBeenCalledTimes(1); // no retry loop
    properties.mockResolvedValueOnce(found);
    await retry();
    expect(await screen.findByTestId("translation-form")).toBeInTheDocument();
    expect(screen.getByTestId("props-count")).toHaveTextContent("2");
    expect(properties).toHaveBeenCalledTimes(2);
  });

  it("existing post: the same, and the post is not read again by the retry", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    readPost.mockResolvedValue(ok(post(translation({ version: 3, draft: revision({ title: "Bài đã có" }) }), id)) as never);
    properties.mockResolvedValueOnce(failure);
    renderInBlogGate(<PostEditorScreen postId={id} />);
    await screen.findByTestId("website-load-error");
    expect(screen.queryByTestId("translation-form")).toBeNull();
    properties.mockResolvedValueOnce(found);
    await retry();
    expect(await screen.findByTestId("translation-form")).toBeInTheDocument();
    expect((screen.getByTestId("post-title") as HTMLInputElement).value).toBe("Bài đã có");
    expect(screen.getByTestId("props-count")).toHaveTextContent("2");
    expect(readPost).toHaveBeenCalledTimes(1);
  });

  it("a retry that fails again stays on the error (one more request per click, nothing in between)", async () => {
    properties.mockResolvedValue(failure);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await screen.findByTestId("website-load-error");
    await retry();
    await screen.findByTestId("website-load-error");
    await retry();
    await screen.findByTestId("website-load-error");
    expect(properties).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("translation-form")).toBeNull();
  });

  it("an authoritative EMPTY list is not an error: the editor opens with no property options", async () => {
    properties.mockResolvedValueOnce({ ok: true, data: [] } as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    expect(await screen.findByTestId("translation-form")).toBeInTheDocument();
    expect(screen.queryByTestId("website-load-error")).toBeNull();
    expect(screen.getByTestId("props-count")).toHaveTextContent("0");
  });
});


// ---------------------------------------------------------------- C6 F4: leave for the language that was created, not for "vi"

describe("C6 F4 — after a create the screen opens the translation that was just created", () => {
  const draft = (locale: string, title: string, version = 1) => translation({ locale, version, draft: revision({ title, slug: "bai-moi", summary: "" }) });
  const titleBox = () => screen.findByTestId("post-title") as Promise<HTMLInputElement>;
  const saveButton = () => within(screen.getByTestId("post-save")).getByRole("button");

  async function createAndLeave(query: string, activeLanguages: ReturnType<typeof lang>[], typed = "Bài mới") {
    url.query = query;
    languages.mockResolvedValue({ kind: "ok", data: activeLanguages } as never);
    create.mockImplementation((async (id: string, locale: string) => ok(post(draft(locale, typed), id))) as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await titleBox(), typed);
    await userEvent.click(saveButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    return { createdId: create.mock.calls[0][0] as string, createdLocale: create.mock.calls[0][1] as string };
  }

  it("English is the default, Vietnamese is also active, no query: creates English and leaves for English (exactly one create, nothing in Vietnamese)", async () => {
    const { createdId, createdLocale } = await createAndLeave("", EN_DEFAULT);
    expect(screen.getByTestId("translation-form")).toHaveAttribute("data-locale", "en");
    expect(createdLocale).toBe("en");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en`);
    expect(create).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("Vietnamese is the default, no query: unchanged, leaves for Vietnamese", async () => {
    const { createdId } = await createAndLeave("", VI_DEFAULT);
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=vi`);
  });

  it("an explicit ?locale=en wins over a Vietnamese default", async () => {
    const { createdId, createdLocale } = await createAndLeave("locale=en", VI_DEFAULT);
    expect(createdLocale).toBe("en");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en`);
  });

  it("an explicit ?locale=vi wins over an English default", async () => {
    const { createdId, createdLocale } = await createAndLeave("locale=vi", EN_DEFAULT);
    expect(createdLocale).toBe("vi");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=vi`);
  });

  it("a ?locale that is not an active language falls back to the default - and the default is what is created and opened", async () => {
    const { createdId, createdLocale } = await createAndLeave("locale=fr", EN_DEFAULT);
    expect(createdLocale).toBe("en");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en`);
  });

  it("another default (a third language) is the language created and opened", async () => {
    const { createdId, createdLocale } = await createAndLeave("", [lang("vi", false), lang("en", false), lang("ja", true)]);
    expect(createdLocale).toBe("ja");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=ja`);
  });

  it("a script-language key is routed as it is (the screen is handed the Blog's key, `zh-hant`; the boundary that makes it is tested in blogLanguages.test.ts)", async () => {
    const { createdId } = await createAndLeave("", [lang("vi", false), lang("zh-hant", true)]);
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=zh-hant`);
  });

  it("a language tab chosen by the person before the create is the one created and opened", async () => {
    url.query = "";
    languages.mockResolvedValue({ kind: "ok", data: EN_DEFAULT } as never);
    create.mockImplementation((async (id: string, locale: string) => ok(post(draft(locale, "Bài mới"), id))) as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.click(await screen.findByTestId("locale-tab-vi"));
    await userEvent.type(await titleBox(), "Bài mới");
    await userEvent.click(saveButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1]).toBe("vi");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${create.mock.calls[0][0]}?locale=vi`);
  });

  it("save and publish on an English default: the publish goes to the English translation and the screen leaves for English", async () => {
    url.query = "";
    languages.mockResolvedValue({ kind: "ok", data: EN_DEFAULT } as never);
    create.mockImplementation((async (id: string, locale: string) => ok(post(draft(locale, "Bài mới"), id))) as never);
    transition.mockImplementation((async (id: string, locale: string) => ok(post(translation({ locale, version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ title: "Bài mới", slug: "bai-moi", summary: "", state: "Frozen" }) }), id))) as never); // what was sent is what is published
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await titleBox(), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    const createdId = create.mock.calls[0][0];
    expect(transition.mock.calls[0]).toEqual([createdId, "en", "publish", 1]);
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en`);
  });

  it("newer unsaved edits: still no navigation; the next save writes English to the created post and then leaves for English", async () => {
    url.query = "";
    languages.mockResolvedValue({ kind: "ok", data: EN_DEFAULT } as never);
    const gate = deferred<ReturnType<typeof ok>>();
    create.mockReturnValueOnce(gate.promise as never);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    await userEvent.type(await titleBox(), "Bài mới");
    await userEvent.click(saveButton());
    await screen.findByTestId("write-pending");
    const createdId = create.mock.calls[0][0] as string;
    expect(create.mock.calls[0][1]).toBe("en");
    await userEvent.type(await titleBox(), " thêm");
    gate.resolve(ok(post(draft("en", "Bài mới"), createdId)) as never);
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());
    expect(router.replace).not.toHaveBeenCalled();
    expect((await titleBox()).value).toBe("Bài mới thêm");

    save.mockImplementation((async (id: string, locale: string) => ok(post(draft(locale, "Bài mới thêm", 2), id))) as never);
    await userEvent.click(saveButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0].slice(0, 3)).toEqual([createdId, "en", 1]);
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en`);
    expect(create).toHaveBeenCalledTimes(1);
  });
});


// ---------------------------------------------------------------- C7 F2: the languages are the Blog's keys all the way through

describe("C7 F2 — a regional language configured as en-US is `en-us` to the Blog", () => {
  // The REAL boundary (`fetchActiveLanguages` reading the public configuration), not a mock of it: the configuration says `en-US`, the Blog answers `en-us`.
  const configOf = (locales: ReturnType<typeof lang>[]) => ({ defaultLocale: "vi", locales: locales.map((l) => ({ ...l, formatLocale: l.code, direction: "ltr", defaultCurrency: "VND" })), baseCurrency: "VND", defaultCurrency: "VND", currencies: [], revision: "x" });
  const CONFIG_EN_US_DEFAULT = [lang("vi", false), lang("en-US", true)];
  const CONFIG_VI_DEFAULT = [lang("vi", true), lang("en-US", false)];
  const draft = (locale: string, title: string, version = 1) => translation({ locale, version, draft: revision({ title, slug: "bai-moi", summary: "" }) });
  const withTranslations = (translations: ReturnType<typeof translation>[], id: string) => ({ ...post(translations[0], id), translations });
  const titleBox = () => screen.findByTestId("post-title") as Promise<HTMLInputElement>;
  const tabs = () => screen.getAllByRole("tab").map((tab) => tab.getAttribute("data-testid"));

  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
    const actual = await vi.importActual<typeof import("@/lib/api/blog")>("@/lib/api/blog");
    languages.mockImplementation(actual.fetchActiveLanguages as never);
  });
  afterEach(() => vi.unstubAllGlobals());
  const serve = (locales: ReturnType<typeof lang>[]) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(configOf(locales)), { status: 200 })));

  it("create: the request names `en-us`, the answer under `en-us` is found, the typed content stays, there is one tab per language, and the screen leaves for ?locale=en-us", async () => {
    serve(CONFIG_EN_US_DEFAULT);
    create.mockImplementation((async (id: string, locale: string) => ok(post(draft(locale, "Bài mới"), id))) as never);
    // the router keeps the screen where it is, so what the screen shows after the create can be read
    renderInBlogGate(<PostEditorScreen postId={null} />);
    expect(await screen.findByTestId("locale-tab-en-us")).toHaveAttribute("aria-selected", "true");
    await userEvent.type(await titleBox(), "Bài mới");
    await userEvent.click(within(screen.getByTestId("post-save")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    const createdId = create.mock.calls[0][0];
    expect(create.mock.calls[0][1]).toBe("en-us");
    expect(router.replace).toHaveBeenCalledWith(`/website/blog/posts/${createdId}?locale=en-us`);
    expect((await titleBox()).value).toBe("Bài mới"); // not replaced by an empty form
    expect(screen.getByTestId("translation-form")).toHaveAttribute("data-locale", "en-us");
    expect(tabs()).toEqual(["locale-tab-vi", "locale-tab-en-us"]);
  });

  it("save of an existing post: the answer is matched, the form keeps the saved content and no second tab appears", async () => {
    serve(CONFIG_VI_DEFAULT);
    const id = "99999999-9999-4999-8999-999999999999";
    readPost.mockResolvedValue(ok(withTranslations([translation({ locale: "vi", draft: revision({ title: "Tiếng Việt", slug: "viet" }) }), translation({ locale: "en-us", draft: revision({ title: "English", slug: "english", summary: "" }) })], id)) as never);
    save.mockImplementation((async (postId: string, locale: string, version: number) => ok(withTranslations([translation({ locale: "vi", draft: revision({ title: "Tiếng Việt", slug: "viet" }) }), translation({ locale, version: version + 1, draft: revision({ title: "English 2", slug: "english", summary: "" }) })], postId))) as never);
    url.query = "locale=en-US"; // mixed case in the address
    renderInBlogGate(<PostEditorScreen postId={id} />);
    expect(((await titleBox()).value)).toBe("English"); // the query found the translation
    expect(screen.getByTestId("locale-tab-en-us")).toHaveAttribute("aria-selected", "true");
    await userEvent.clear(await titleBox());
    await userEvent.type(await titleBox(), "English 2");
    await userEvent.click(within(screen.getByTestId("post-save")).getByRole("button"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe("en-us");
    await waitFor(() => expect(screen.queryByTestId("write-pending")).toBeNull());
    expect((await titleBox()).value).toBe("English 2");
    expect(tabs()).toEqual(["locale-tab-vi", "locale-tab-en-us"]);
  });

  it("the default language is matched by its key: en-US as the default with no query opens the en-us tab, vi default opens vi", async () => {
    serve(CONFIG_EN_US_DEFAULT);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    expect(await screen.findByTestId("locale-tab-en-us")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("translation-form")).toHaveAttribute("data-locale", "en-us");
    cleanup();
    serve(CONFIG_VI_DEFAULT);
    renderInBlogGate(<PostEditorScreen postId={null} />);
    expect(await screen.findByTestId("locale-tab-vi")).toHaveAttribute("aria-selected", "true");
  });

  it.each(["en-US", "EN-US", "en-us", "En-uS"])("a ?locale=%s on /posts/new opens the en-us tab", async (query) => {
    serve(CONFIG_VI_DEFAULT);
    url.query = `locale=${query}`;
    renderInBlogGate(<PostEditorScreen postId={null} />);
    expect(await screen.findByTestId("locale-tab-en-us")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("translation-form")).toHaveAttribute("data-locale", "en-us");
  });
});
