"use client";

/**
 * BHA-BLOG-001-CP03: the private preview of ONE translation, read from `GET …/preview`: its saved draft, or — with none — its published revision. It never
 * shows what is only typed on the form, and it is not the public page (the Customer site is not connected to the Blog in this step). An answer for another
 * post or language than the one asked is dropped.
 */

import React from "react";
import { getPreview, type BlogPreview } from "@/lib/api/blog";
import type { WebsiteResult } from "@/lib/api/website";
import { useWebsiteList } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel, formatWhen } from "@/components/website/WebsiteUi";
import BodyRenderer from "./BodyRenderer";
import { StaffImage } from "./useStaffImage";
import { STATUS_LABEL } from "@/lib/blog/blogModel";

const NO_REVISION = "no-revision" as const;

export default function PostPreviewDialog({ postId, locale, dirtyNote, onClose }: { postId: string; locale: string; dirtyNote?: string | null; onClose: () => void }) {
  // A 404 that names itself (`blog.not-found` on `revision`) means the translation exists but has nothing to show; every other failure keeps its usual path
  // (a missing post / translation is the generic not-found text, a read error offers Retry).
  const preview = useWebsiteList<BlogPreview | typeof NO_REVISION>(
    async (signal): Promise<WebsiteResult<BlogPreview | typeof NO_REVISION>> => {
      const result = await getPreview(postId, locale, signal);
      return result.kind === "refused" && result.status === 404 && result.code === "blog.not-found" && result.field === "revision" ? { kind: "ok", data: NO_REVISION } : result;
    },
    [postId, locale]
  );
  const ready = preview.state.status === "ready" ? preview.state.data : null;
  const data = ready !== null && ready !== NO_REVISION && ready.id === postId && ready.locale === locale ? ready : null;
  return (
    <DialogShell title="Xem trước (riêng tư)" onClose={onClose} busy={false} testId="post-preview-dialog" wide>
      {preview.state.status === "loading" && <LoadingPanel what="bản xem trước" />}
      {preview.state.status === "error" && <ErrorPanel message={preview.state.message} onRetry={() => void preview.reload()} />}
      {ready === NO_REVISION && (
        <Banner tone="info" testId="preview-no-revision">
          <p className="font-medium">Bản dịch chưa có nội dung để xem trước.</p>
          <p className="mt-1">Bản dịch này không có bản nháp lẫn bản đã xuất bản. Hãy đóng hộp thoại để quay lại trang bài; không có gì được lưu hay khôi phục.</p>
        </Banner>
      )}
      {data && (
        <article className="flex flex-col gap-4">
          <Banner tone="info" testId="preview-source">
            {data.source === "draft" ? `Bản nháp đã lưu (bản ${data.revisionNumber}).` : `Bản đã xuất bản (bản ${data.revisionNumber}); bài chưa có bản nháp.`} Trạng thái: {STATUS_LABEL[data.status]}.
            {dirtyNote ? ` ${dirtyNote}` : ""} Chỉ Staff có quyền Blog xem được trang này; website công khai chưa nối với Blog.
          </Banner>
          {data.cover && <StaffImage path={data.cover.url} alt={data.cover.alt} className="max-h-96 w-full rounded-2xl object-cover" testId="preview-cover" />}
          <header>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white" data-testid="preview-title">{data.title || "(chưa có tiêu đề)"}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {data.author ? `${data.author} · ` : ""}Sửa lần cuối {formatWhen(data.modifiedAt)}
              {data.categories.length > 0 && <> · {data.categories.map((c) => c.name + (c.isPrimary ? " (chính)" : "")).join(", ")}</>}
            </p>
            <p className="mt-1 text-xs text-gray-500">Địa chỉ dự kiến: /blog/{data.slug || "…"}</p>
            {data.summary && <p className="mt-3 text-lg text-gray-700 dark:text-gray-300">{data.summary}</p>}
          </header>
          <BodyRenderer body={data.body} context={{ media: data.media, properties: data.properties }} />
        </article>
      )}
      <DialogActions><ActionButton variant="outline" onClick={onClose} testId="preview-close">Đóng</ActionButton></DialogActions>
    </DialogShell>
  );
}
