/**
 * BHA-BLOG-001-CP03-C1: the private preview when the server answers 404 ("this translation has no revision to preview"), and when the answer is for
 * another post or language than the one asked. Nothing of an earlier preview may stay on screen, and the words must be ones an editor can act on.
 */
import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  getPreview: vi.fn(),
  fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })),
}));

import PostPreviewDialog from "./PostPreviewDialog";
import { BOTH, POST_ID, ok, renderInBlogGate } from "./blogTestUtils";
import BlogAccessGate from "./BlogAccessGate";
import { getPreview, type BlogPreview } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const preview = vi.mocked(getPreview);

const noRevision = { kind: "refused", status: 404, code: null, field: null, detail: "The translation has no revision to preview." } as const;

const sample = (over: Partial<BlogPreview> = {}): BlogPreview => ({
  source: "draft", revisionNumber: 1, status: "Archived", version: 3, id: POST_ID, locale: "vi", slug: "s", title: "Bản xem trước cũ", summary: "", body: { schemaVersion: 1, blocks: [] },
  cover: null, author: "", firstPublishedAt: "2026-10-21T08:00:00Z", modifiedAt: "2026-10-21T08:00:00Z", primaryCategory: null, categories: [], media: {}, properties: {},
  seo: { metaTitle: null, metaDescription: null, ogImageUrl: null }, alternates: [], ...over,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: BOTH });
  preview.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const noRevisionField = { kind: "refused", status: 404, code: "blog.not-found", field: "revision", detail: "The translation has no revision to preview." } as const;

describe("C2 O2 — the 404 of a translation that has no revision says so", () => {
  it("shows 'the translation has no content to preview', with Close and without Retry or the 'deleted' wording", async () => {
    preview.mockResolvedValue(noRevisionField as never);
    renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    const note = await screen.findByTestId("preview-no-revision");
    expect(note).toHaveTextContent("Bản dịch chưa có nội dung để xem trước.");
    expect(document.body.textContent).not.toMatch(/không còn tồn tại|đã bị xoá/);
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.queryByTestId("website-load-error")).toBeNull();
    expect(screen.queryByTestId("preview-title")).toBeNull();
    expect(screen.getByTestId("preview-close")).toBeInTheDocument();
  });

  it("closing it calls onClose and nothing else (no save, no restore)", async () => {
    preview.mockResolvedValue(noRevisionField as never);
    const onClose = vi.fn();
    renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={onClose} />);
    await screen.findByTestId("preview-no-revision");
    screen.getByTestId("preview-close").querySelector("button")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("a 404 without that field (a missing post or translation) keeps the generic message and Retry", async () => {
    preview.mockResolvedValue({ kind: "refused", status: 404, code: null, field: null, detail: "The article has no such translation." } as never);
    renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    expect(await screen.findByTestId("website-load-error")).toHaveTextContent("Mục này không còn tồn tại trên máy chủ.");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.queryByTestId("preview-no-revision")).toBeNull();
  });

  it("a transient read error keeps Retry, and Retry reads again", async () => {
    preview.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được tới máy chủ Admin." } as never);
    renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    expect(await screen.findByTestId("website-load-error")).toHaveTextContent("Không kết nối được");
    preview.mockResolvedValueOnce(ok(sample({ status: "Draft" })) as never);
    screen.getByRole("button", { name: "Thử lại" }).click();
    expect(await screen.findByTestId("preview-title")).toBeInTheDocument();
  });

  it("an earlier preview does not stay on screen when the next read is this 404", async () => {
    preview.mockResolvedValueOnce(ok(sample()) as never);
    const view = renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    expect(await screen.findByTestId("preview-title")).toBeInTheDocument();
    preview.mockResolvedValue(noRevisionField as never);
    view.rerender(<BlogAccessGate returnTo="/website/blog/posts"><PostPreviewDialog postId={POST_ID} locale="en" onClose={() => {}} /></BlogAccessGate>);
    await screen.findByTestId("preview-no-revision");
    expect(screen.queryByTestId("preview-title")).toBeNull();
  });
});

describe("the preview dialog", () => {
  it("shows the shared not-found message (Vietnamese) and no article when there is no revision to preview (404); the dialog stays closable", async () => {
    preview.mockResolvedValue(noRevision as never);
    renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    const panel = await screen.findByTestId("website-load-error");
    // Observed, not designed: every 404 of the Website screens reads like this (it is generic, and says "no longer exists" about a translation that does).
    expect(panel).toHaveTextContent("Mục này không còn tồn tại trên máy chủ.");
    expect(panel.textContent).not.toMatch(/The translation has no revision/);
    expect(screen.queryByTestId("preview-title")).toBeNull();
    expect(screen.queryByTestId("preview-body")).toBeNull();
    expect(screen.getByTestId("preview-close")).toBeInTheDocument();
  });

  it("does not keep an earlier preview on screen when the next read is the 404", async () => {
    preview.mockResolvedValueOnce(ok(sample()) as never);
    const view = renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    expect(await screen.findByTestId("preview-title")).toHaveTextContent("Bản xem trước cũ");
    preview.mockResolvedValue(noRevision as never);
    view.rerender(<BlogAccessGate returnTo="/website/blog/posts"><PostPreviewDialog postId={POST_ID} locale="en" onClose={() => {}} /></BlogAccessGate>);
    await waitFor(() => expect(screen.queryByTestId("preview-title")).toBeNull());
    expect(await screen.findByTestId("website-load-error")).toBeInTheDocument();
  });

  it("does not draw an answer that belongs to another post or language", async () => {
    preview.mockResolvedValue(ok(sample({ locale: "en" })) as never);
    renderInBlogGate(<PostPreviewDialog postId={POST_ID} locale="vi" onClose={() => {}} />);
    await waitFor(() => expect(preview).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("preview-title")).toBeNull();
  });
});
