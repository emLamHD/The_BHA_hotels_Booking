"use client";

/**
 * BHA-BLOG-001-CP03: the private preview of ONE translation, read from `GET …/preview`: its saved draft, or — with none — its published revision. It never
 * shows what is only typed on the form, and it is not the public page (the Customer site is not connected to the Blog in this step). An answer for another
 * post or language than the one asked is dropped.
 */

import React from "react";
import { getPreview } from "@/lib/api/blog";
import { useWebsiteList } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel, formatWhen } from "@/components/website/WebsiteUi";
import BodyRenderer from "./BodyRenderer";
import { StaffImage } from "./useStaffImage";
import { STATUS_LABEL } from "@/lib/blog/blogModel";

export default function PostPreviewDialog({ postId, locale, dirtyNote, onClose }: { postId: string; locale: string; dirtyNote?: string | null; onClose: () => void }) {
  const preview = useWebsiteList((signal) => getPreview(postId, locale, signal), [postId, locale]);
  const data = preview.state.status === "ready" && preview.state.data.id === postId && preview.state.data.locale === locale ? preview.state.data : null;
  return (
    <DialogShell title="Xem trước (riêng tư)" onClose={onClose} busy={false} testId="post-preview-dialog" wide>
      {preview.state.status === "loading" && <LoadingPanel what="bản xem trước" />}
      {preview.state.status === "error" && <ErrorPanel message={preview.state.message} onRetry={() => void preview.reload()} />}
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
