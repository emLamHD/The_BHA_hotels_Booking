/**
 * BHA-ADMIN-BADGE-001-PR07-C1: a "Lưu và xuất bản" that Staff A started is never continued after A's form is gone. The Blog gate keys what it shows by `staffAccountId`, so when the signed-in
 * Staff member changes (or the session ends) the OLD form instance is unmounted and a NEW one is mounted for the next identity; nothing the old instance holds ever hears about the change.
 * These tests run the REAL session provider, shell provider and Blog gate and replace only the API at the boundary: A's save is a deferred response, the session is switched to B while it is
 * out, B's form is mounted, and only then does A's successful save answer arrive. It must not publish, adopt the saved post, or navigate anything.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/website/newsletterLive", () => ({ startNewsletterLive: vi.fn(() => ({ retryNow: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(() => Promise.resolve({ kind: "ok", data: {} })), markMenuSeen: vi.fn(), markNewsletterSeen: vi.fn(),
}));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  createPost: vi.fn(), saveDraft: vi.fn(), transitionPost: vi.fn(), getPost: vi.fn(), restoreRevision: vi.fn(),
  listRevisions: vi.fn(() => Promise.resolve({ kind: "ok", data: [] })),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));
vi.mock("./PostPreviewDialog", () => ({ default: () => null }));
vi.mock("./RichBodyEditor", () => ({
  default: function Stub({ onChange }: { onChange: (s: { body: unknown; problems: unknown[] }) => void }) {
    React.useEffect(() => onChange({ body: { schemaVersion: 1, blocks: [] }, problems: [] }), [onChange]);
    return null;
  },
}));

import TranslationForm from "./TranslationForm";
import BlogAccessGate from "./BlogAccessGate";
import { BOTH, POST_ID, deferred, ok, post, revision, translation } from "./blogTestUtils";
import { MenuUnseenProvider } from "@/components/website/NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { createPost, getPost, saveDraft, transitionPost } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const save = vi.mocked(saveDraft);
const create = vi.mocked(createPost);
const transition = vi.mocked(transitionPost);
const CLIENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STAFF_A = BOTH;
const STAFF_B = { ...BOTH, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };

let session: ReturnType<typeof useStaffSession> | null = null;
function Probe() {
  const value = useStaffSession();
  React.useEffect(() => {
    session = value;
  });
  return null;
}

const onPost = vi.fn();
const onCreated = vi.fn();
const onStatus = vi.fn();
function mount(props: Partial<React.ComponentProps<typeof TranslationForm>> = {}) {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
  return render(
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Probe />
        <BlogAccessGate returnTo="/website/blog/posts">
          <TranslationForm postId={POST_ID} clientId={CLIENT_ID} locale="vi" initial={translation()} categories={[]} properties={[]} pickMedia={vi.fn()} onPost={onPost} onCreated={onCreated} onStatus={onStatus} {...props} />
        </BlogAccessGate>
      </MenuUnseenProvider>
    </StaffSessionProvider>,
  );
}
const saved = (version: number, title = "Bản lưu của A") => ok(post(translation({ version, draft: revision({ title }) })));
const publishedPost = (version: number) => ok(post(translation({ version, status: "Published", hasDraft: false, draft: null, published: revision({ state: "Frozen" }) })));
const button = (id: string) => within(screen.getByTestId(id)).getByRole("button");

/** Starts a dirty "Lưu và xuất bản" under A with its save still out; returns A's title input and the way to answer the save. */
async function startChainUnderA(answer: ReturnType<typeof deferred<ReturnType<typeof ok>>>) {
  save.mockImplementation((async () => answer.promise) as never);
  const input = (await screen.findByTestId("post-title")) as HTMLInputElement;
  await userEvent.clear(input);
  await userEvent.type(input, "Chuỗi của A");
  await userEvent.click(button("post-publish"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  return input;
}

/** The session becomes B's: the gate unmounts A's form and mounts B's. Resolves once B's form is on screen and A's is gone. */
async function switchToB(oldInput: HTMLElement) {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
  await act(async () => { await session!.refresh(); });
  await waitFor(() => expect(oldInput.isConnected).toBe(false));
  const fresh = (await screen.findByTestId("post-title")) as HTMLInputElement;
  expect(fresh).not.toBe(oldInput);
  expect(fresh.isConnected).toBe(true);
  return fresh;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  for (const mock of [save, create, transition, vi.mocked(getPost), onPost, onCreated, onStatus]) mock.mockReset();
  session = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("a Save-then-Publish chain of Staff A when the gate replaces A's form with B's", () => {
  it("dirty save-and-publish: B's form is mounted, then A's successful save arrives late: save was called, publish never, and the late answer touches nothing", async () => {
    mount();
    const answer = deferred<ReturnType<typeof ok>>();
    const aInput = await startChainUnderA(answer);

    const bInput = await switchToB(aInput);
    await act(async () => { answer.resolve(saved(2)); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(save).toHaveBeenCalledTimes(1);
    expect(transition).not.toHaveBeenCalled();                          // the publish of A's chain is never sent, for A or for B
    expect(onPost).not.toHaveBeenCalled();                               // the late answer is not adopted by the screen B now sees
    expect(onCreated).not.toHaveBeenCalled();                            // and nothing navigates
    expect(bInput.value).toBe("Bãi biển Mỹ Khê");                        // B's form is B's own, untouched by A's typing
  });

  it("a new post: A's late successful create does not publish either, and does not hand the new post to the screen", async () => {
    mount({ postId: null, initial: undefined });
    const answer = deferred<ReturnType<typeof ok>>();
    create.mockImplementation((async () => answer.promise) as never);
    const aInput = (await screen.findByTestId("post-title")) as HTMLInputElement;
    await userEvent.type(aInput, "Bài mới của A");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    await switchToB(aInput);
    await act(async () => { answer.resolve(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới của A" }) }), CLIENT_ID))); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(transition).not.toHaveBeenCalled();
    expect(onPost).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("a chain whose PUBLISH is still out when the gate replaces the form: the late publish answer is not adopted and does not move the screen", async () => {
    mount({ postId: null, initial: undefined });
    create.mockResolvedValue(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi" }) }), CLIENT_ID)) as never);
    const publishAnswer = deferred<ReturnType<typeof ok>>();
    transition.mockImplementation((async () => publishAnswer.promise) as never);
    const aInput = (await screen.findByTestId("post-title")) as HTMLInputElement;
    await userEvent.type(aInput, "Bài mới");
    await userEvent.click(button("post-publish"));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));      // A's create went through (same session) and its publish is on the wire
    expect(onPost).toHaveBeenCalledTimes(1);                              // the create was adopted while A's form was still there

    await switchToB(aInput);
    await act(async () => { publishAnswer.resolve(publishedPost(2)); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onPost).toHaveBeenCalledTimes(1);                              // the publish answer arrived for a form that is gone: not handed to the screen
    expect(onCreated).not.toHaveBeenCalled();                              // and the screen is not moved to A's post
  });

  it("a read-back that A asked for after a lost create answers late: it does not move B's screen to A's post", async () => {
    mount({ postId: null, initial: undefined });
    create.mockResolvedValueOnce({ kind: "unverified", message: "Mất kết nối." } as never);
    const aInput = (await screen.findByTestId("post-title")) as HTMLInputElement;
    await userEvent.type(aInput, "Bài mới");
    await userEvent.click(button("post-save"));
    await screen.findByTestId("write-unverified");
    const readBack = deferred<ReturnType<typeof ok>>();
    vi.mocked(getPost).mockImplementation((async () => readBack.promise) as never);
    await userEvent.click(screen.getByTestId("check-server"));
    await waitFor(() => expect(getPost).toHaveBeenCalledTimes(1));

    await switchToB(aInput);
    await act(async () => { readBack.resolve(ok(post(translation({ version: 1, draft: revision({ title: "Bài mới", slug: "bai-moi", summary: "", authorName: "", coverAlt: "", metaTitle: "", metaDescription: "" }) }), CLIENT_ID))); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onCreated).not.toHaveBeenCalled();
  });

  it("the same click in the same session still goes through: one UUID on the save and on the publish, the publish at the version the save answered", async () => {
    mount();
    const answer = deferred<ReturnType<typeof ok>>();
    transition.mockResolvedValue(publishedPost(3) as never);
    await startChainUnderA(answer);
    await act(async () => { answer.resolve(saved(2)); await Promise.resolve(); });
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));

    const chain = save.mock.calls[0][4];
    expect(chain).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(transition.mock.calls[0]).toEqual([POST_ID, "vi", "publish", 2, chain]);
  });

  it("a standalone 'Lưu bản nháp' whose answer arrives after the form is gone does not adopt, navigate or publish", async () => {
    mount();
    const answer = deferred<ReturnType<typeof ok>>();
    save.mockImplementation((async () => answer.promise) as never);
    const aInput = (await screen.findByTestId("post-title")) as HTMLInputElement;
    await userEvent.clear(aInput);
    await userEvent.type(aInput, "Chỉ lưu");
    await userEvent.click(button("post-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]).toHaveLength(4);                           // a standalone save sends no id

    await switchToB(aInput);
    await act(async () => { answer.resolve(saved(2, "Chỉ lưu")); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onPost).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it("when the session ends (sign-out) the form is gone too, and a late successful save does not publish", async () => {
    mount();
    const answer = deferred<ReturnType<typeof ok>>();
    const aInput = await startChainUnderA(answer);

    await act(async () => { session!.expire(); });                      // the session ends: the gate shows its sign-in prompt instead of the form
    await waitFor(() => expect(aInput.isConnected).toBe(false));
    await act(async () => { answer.resolve(saved(2)); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(transition).not.toHaveBeenCalled();
    expect(onPost).not.toHaveBeenCalled();
  });
});
