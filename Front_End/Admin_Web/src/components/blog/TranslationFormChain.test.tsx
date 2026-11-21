/**
 * BHA-ADMIN-BADGE-001-PR07 (ADR 0011 §D): the correlation id of "Lưu và xuất bản". One new UUID per valid click, on the save (or create) and on the publish of THAT chain and on nothing
 * else; the publish carries the version the save answered; a save that did not succeed is never followed by a publish; a publish that fails leaves the saved draft; and a chain started by one
 * Staff member is not continued with another's request. Everything else the form sends is exactly what it always sent (no extra argument, so no header).
 */
import React, { useSyncExternalStore } from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    identity: "11111111-1111-1111-1111-111111111111",
    set(next: string) {
      scope.identity = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  createPost: vi.fn(), saveDraft: vi.fn(), transitionPost: vi.fn(), getPost: vi.fn(), restoreRevision: vi.fn(),
  listRevisions: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));
vi.mock("@/components/website/NewsletterBadgeProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/website/NewsletterBadgeProvider")>()),
  useUnseenScope: () => ({ identity: useSyncExternalStore(scope.subscribe, () => scope.identity), ready: true, propertyNames: {}, reportAuth: () => undefined }),
}));
vi.mock("./PostPreviewDialog", () => ({ default: ({ onClose }: { onClose: () => void }) => <button type="button" data-testid="preview-stub" onClick={onClose}>đóng xem trước</button> }));
vi.mock("./RichBodyEditor", () => ({
  default: function Stub({ onChange }: { onChange: (s: { body: unknown; problems: unknown[] }) => void }) {
    React.useEffect(() => onChange({ body: { schemaVersion: 1, blocks: [] }, problems: [] }), [onChange]);
    return <button type="button" data-testid="body-stub" onClick={() => onChange({ body: { schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "mới" }] }] }, problems: [] })}>sửa nội dung</button>;
  },
}));

import TranslationForm from "./TranslationForm";
import { BOTH, POST_ID, deferred, ok, post, renderInBlogGate, revision, translation } from "./blogTestUtils";
import { createPost, saveDraft, transitionPost } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const save = vi.mocked(saveDraft);
const create = vi.mocked(createPost);
const transition = vi.mocked(transitionPost);
const CLIENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STAFF_A = "11111111-1111-1111-1111-111111111111";
const STAFF_B = "22222222-2222-2222-2222-222222222222";
const refused = { kind: "refused", status: 409, code: "blog.stale-version", field: "expectedVersion", detail: "It was changed by someone else." } as const;

const saved = (version: number, title = "Bản lưu") => ok(post(translation({ version, draft: revision({ title }) })));
const publishedPost = (version: number) => ok(post(translation({ version, status: "Published", hasDraft: false, draft: null, published: revision({ state: "Frozen" }) })));

function mount(props: Partial<React.ComponentProps<typeof TranslationForm>> = {}) {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  return renderInBlogGate(
    <TranslationForm postId={POST_ID} clientId={CLIENT_ID} locale="vi" initial={translation()} categories={[]} properties={[]} pickMedia={vi.fn()} onPost={vi.fn()} onCreated={vi.fn()} onStatus={vi.fn()} {...props} />,
  );
}
const title = () => screen.findByTestId("post-title") as Promise<HTMLInputElement>;
const button = (id: string) => within(screen.getByTestId(id)).getByRole("button");
const typeTitle = async (text: string) => {
  const input = await title();
  await userEvent.clear(input);
  await userEvent.type(input, text);
};
/** The id a call carried: the argument after the ones a request always has, or `undefined` when the call had no such argument. */
const idOf = (call: unknown[], fixed: number) => call[fixed] as string | undefined;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  for (const mock of [save, create, transition]) mock.mockReset();
  scope.identity = STAFF_A;
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("one click of 'Lưu và xuất bản'", () => {
  it("DraftSave → Publish: the save and the publish carry the SAME new UUID, and the publish the version the save answered", async () => {
    mount();
    save.mockResolvedValue(saved(2) as never);
    transition.mockResolvedValue(publishedPost(3) as never);
    await typeTitle("Sắp đăng");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));

    const chain = idOf(save.mock.calls[0], 4);
    expect(chain).toMatch(GUID);
    expect(idOf(transition.mock.calls[0], 4)).toBe(chain);
    expect(transition.mock.calls[0].slice(0, 4)).toEqual([POST_ID, "vi", "publish", 2]);
  });

  it("Create → Publish of a new post: the create and the publish carry the same UUID", async () => {
    mount({ postId: null, initial: undefined });
    create.mockResolvedValue(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới" }) }), CLIENT_ID)) as never);
    transition.mockResolvedValue(publishedPost(2) as never);
    await typeTitle("Bài mới");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));

    const chain = idOf(create.mock.calls[0], 3);
    expect(chain).toMatch(GUID);
    expect(idOf(transition.mock.calls[0], 4)).toBe(chain);
    expect(create.mock.calls[0].slice(0, 2)).toEqual([CLIENT_ID, "vi"]);
  });

  it("the next click is a new chain with a different UUID (an id is never kept for reuse)", async () => {
    mount();
    save.mockResolvedValueOnce(saved(2, "Một") as never).mockResolvedValueOnce(saved(3, "Hai") as never);
    transition.mockResolvedValueOnce(refused as never).mockResolvedValueOnce(publishedPost(4) as never);
    await typeTitle("Một");
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-refused");
    await typeTitle("Hai");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(2));

    const first = idOf(save.mock.calls[0], 4);
    const second = idOf(save.mock.calls[1], 4);
    expect(first).toMatch(GUID);
    expect(second).toMatch(GUID);
    expect(second).not.toBe(first);
    expect(idOf(transition.mock.calls[0], 4)).toBe(first);
    expect(idOf(transition.mock.calls[1], 4)).toBe(second);
  });
});

describe("every other request is what it always was", () => {
  it("'Lưu bản nháp' and 'Lưu và xem trước' send a save with no id", async () => {
    mount();
    save.mockResolvedValue(saved(2) as never);
    await typeTitle("Chỉ lưu");
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]).toHaveLength(4);

    await typeTitle("Lưu rồi xem");
    await userEvent.click(button("post-preview"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toHaveLength(4);
    expect(transition).not.toHaveBeenCalled();
  });

  it("publishing a draft that is already saved (no save in the click), republishing and the other transitions send no id", async () => {
    mount({ initial: translation({ status: "Draft", version: 5 }) });
    transition.mockResolvedValue(publishedPost(6) as never);
    await screen.findByTestId("post-publish");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    expect(transition.mock.calls[0]).toEqual([POST_ID, "vi", "publish", 5]);
    expect(save).not.toHaveBeenCalled();
  });

  it("unpublish sends no id", async () => {
    mount({ initial: translation({ status: "Published", version: 7, hasDraft: false, draft: null, published: revision({ state: "Frozen" }) }) });
    transition.mockResolvedValue(ok(post(translation({ status: "Unpublished", version: 8, hasDraft: false, draft: null }))) as never);
    await screen.findByTestId("post-unpublish");
    await userEvent.click(button("post-unpublish"));
    await userEvent.click(button("post-confirm-yes"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    expect(transition.mock.calls[0]).toEqual([POST_ID, "vi", "unpublish", 7]);
  });
});

describe("a chain that does not go through", () => {
  it("a save the server refuses is never followed by a publish", async () => {
    mount();
    save.mockResolvedValue(refused as never);
    await typeTitle("Sẽ bị từ chối");
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-refused");
    expect(save).toHaveBeenCalledTimes(1);
    expect(transition).not.toHaveBeenCalled();
  });

  it("a save whose answer is lost is never followed by a publish or a retry: the server is read instead", async () => {
    mount();
    save.mockResolvedValue({ kind: "unverified", message: "Mất kết nối." } as never);
    await typeTitle("Mất kết nối");
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-unverified");
    expect(save).toHaveBeenCalledTimes(1);
    expect(transition).not.toHaveBeenCalled();
  });

  it("a publish that fails leaves the saved draft: the form shows it saved and nothing is sent again", async () => {
    mount();
    save.mockResolvedValue(saved(2, "Đã lưu rồi") as never);
    transition.mockResolvedValue(refused as never);       // the publish is refused (someone else moved the post): the save before it stands
    await typeTitle("Đã lưu rồi");
    await userEvent.click(button("post-publish"));
    await screen.findByTestId("write-refused");
    expect(save).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("post-status")).toHaveTextContent("Bản nháp");
    expect((await title()).value).toBe("Đã lưu rồi");
  });

  it("when the signed-in Staff member changes between the save and the publish, the saved draft stays and the publish is not sent for the new one", async () => {
    mount();
    const answer = deferred<ReturnType<typeof ok>>();
    save.mockImplementation((async () => answer.promise) as never);
    await typeTitle("Đổi người");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => { scope.set(STAFF_B); });             // another Staff identity takes over while the save is out
    await act(async () => { answer.resolve(saved(2, "Đổi người")); await Promise.resolve(); });

    await waitFor(() => expect(screen.getByTestId("post-status")).toHaveTextContent("Bản nháp"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(transition).not.toHaveBeenCalled();
  });
});
