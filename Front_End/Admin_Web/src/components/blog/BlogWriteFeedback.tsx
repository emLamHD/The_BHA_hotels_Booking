"use client";

import React from "react";
import { Banner } from "@/components/website/WebsiteUi";
import type { WriteStatus } from "@/components/website/useWebsiteData";
import { describeBlogFailure } from "@/lib/blog/blogModel";

/**
 * What a Blog write that did not simply succeed means, and what to do next. A refusal (400/404/409) means the server did NOT apply it; a stale version
 * keeps the person's input and offers the latest values to compare; an unanswered write is `unverified` and is never sent again by itself — the server
 * is read first.
 */
export default function BlogWriteFeedback({
  status,
  onReloadLatest,
  onCheckServer,
  working,
  fieldShown,
}: {
  status: WriteStatus;
  onReloadLatest?: () => void;
  onCheckServer?: () => void;
  working: boolean;
  /** `true` when the form already shows this refusal beside its field, so it is not said twice. */
  fieldShown?: (field: string | null, code: string | null) => boolean;
}) {
  const refused = status.phase === "refused" ? status.failure : null;
  const stale = refused?.code === "blog.stale-version";
  const hidden = refused !== null && fieldShown?.(refused.field, refused.code) === true;
  return (
    <>
      {status.phase === "pending" && <Banner tone="info" testId="write-pending">Đang lưu… chờ máy chủ trả lời.</Banner>}
      {refused && !hidden && (
        <Banner tone="error" testId="write-refused">
          <p className="font-medium">{stale ? "Dữ liệu đã thay đổi trên máy chủ. Chưa có gì được lưu." : "Máy chủ chưa áp dụng thay đổi này."}</p>
          {!stale && <p className="mt-1">{describeBlogFailure(refused)}</p>}
          {stale && onReloadLatest && (
            <p className="mt-2">
              Những gì bạn đã nhập vẫn được giữ.{" "}
              <button type="button" onClick={onReloadLatest} disabled={working} className="font-medium underline disabled:opacity-50" data-testid="reload-latest">Tải bản mới nhất để so sánh</button>
              {" "}— hệ thống không tự ghi đè.
            </p>
          )}
        </Banner>
      )}
      {status.phase === "failed" && <Banner tone="error" testId="write-failed">{status.message} Chưa có gì được lưu.</Banner>}
      {status.phase === "unverified" && (
        <Banner tone="warning" testId="write-unverified">
          <p className="font-medium">Chưa xác nhận được kết quả.</p>
          <p className="mt-1">{status.message}</p>
          <p className="mt-2">
            Hệ thống không tự gửi lại. Hãy đọc lại dữ liệu từ máy chủ trước
            {onCheckServer && <>: <button type="button" onClick={onCheckServer} disabled={working} className="font-medium underline disabled:opacity-50" data-testid="check-server">Kiểm tra máy chủ</button></>}.
          </p>
        </Banner>
      )}
    </>
  );
}
