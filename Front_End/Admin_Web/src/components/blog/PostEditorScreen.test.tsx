/**
 * BHA-BLOG-001-CP03-C3 (F1) with the REAL parent: on /posts/new the screen is replaced by the post's own route (a different Next page), so everything
 * under it is unmounted by `router.replace`. "Lưu và xuất bản" must have sent both writes before that happens, and the publish must go to the created post.
 */
import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchActiveProperties: vi.fn(() => Promise.resolve({ ok: true, data: [] })) }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  createPost: vi.fn(), saveDraft: vi.fn(), transitionPost: vi.fn(), getPost: vi.fn(), listCategories: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  listRevisions: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  fetchActiveLanguages: vi.fn(() => Promise.resolve({ kind: "ok", data: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true }] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));
vi.mock("./PostPreviewDialog", () => ({ default: () => <div data-testid="preview-stub" /> }));
vi.mock("./MediaPickerDialog", () => ({ default: () => null }));
vi.mock("./RichBodyEditor", () => ({
  default: function Stub({ onChange }: { onChange: (s: { body: unknown; problems: unknown[] }) => void }) {
    React.useEffect(() => onChange({ body: { schemaVersion: 1, blocks: [] }, problems: [] }), [onChange]);
    return null;
  },
}));

import PostEditorScreen from "./PostEditorScreen";
import { BOTH, ok, post, renderInBlogGate, revision, translation } from "./blogTestUtils";
import { createPost, transitionPost } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const create = vi.mocked(createPost);
const transition = vi.mocked(transitionPost);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  for (const m of [create, transition, router.replace]) m.mockReset();
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
    transition.mockImplementationOnce((async (id: string) => ok(post(translation({ version: 2, status: "Published", hasDraft: false, draft: null, published: revision({ state: "Frozen" }) }), id))) as never);
    await userEvent.click(within(screen.getByTestId("post-publish")).getByRole("button"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(transition.mock.calls[1]).toEqual([createdId, "vi", "publish", 1]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
