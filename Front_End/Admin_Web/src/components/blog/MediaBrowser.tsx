"use client";

/**
 * BHA-BLOG-001-CP03: the picture library as a grid — search, used / unused, pages, and the upload panel — shared by the library screen (click opens the
 * picture) and the picker (click selects). Thumbnails are read through the Staff session. A response for an older query or page is dropped.
 */

import React, { useCallback, useState } from "react";
import { listMedia, mediaPreviewPath, type BlogMedia } from "@/lib/api/blog";
import { useWebsiteList } from "@/components/website/useWebsiteData";
import { ErrorPanel, LoadingPanel } from "@/components/website/WebsiteUi";
import { StaffImage } from "./useStaffImage";
import UploadPanel from "./UploadPanel";
import { useUploadQueue } from "./useUploadQueue";

const PAGE_SIZE = 24;
const BTN = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5";

export default function MediaBrowser({
  selectedIds,
  onActivate,
  canUpload,
  reloadToken,
  onBusyChange,
}: {
  selectedIds?: ReadonlySet<string>;
  onActivate: (media: BlogMedia) => void;
  canUpload: boolean;
  /** Changes when something outside (a deleted picture, an edit) means the list should be read again. */
  reloadToken?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [usage, setUsage] = useState<"" | "used" | "unused">("");
  const [page, setPage] = useState(1);

  const { state, reload } = useWebsiteList((signal) => listMedia({ q: q || undefined, usage: usage || undefined, page, pageSize: PAGE_SIZE }, signal), [q, usage, page, reloadToken]);
  const queue = useUploadQueue({ onUploaded: useCallback(() => void reload(), [reload]) });
  React.useEffect(() => onBusyChange?.(queue.busy), [queue.busy, onBusyChange]);

  const pages = state.status === "ready" ? Math.max(1, Math.ceil(state.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <UploadPanel queue={queue} disabled={!canUpload} disabledReason="Tài khoản này không có quyền tải ảnh lên." />
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(typed.trim()); }} role="search">
        <label className="text-sm text-gray-700 dark:text-gray-200">Tìm ảnh
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Tên, tệp, nguồn, mô tả…" aria-label="Tìm ảnh" className="ml-2 h-10 w-64 max-w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90" />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-200">Sử dụng
          <select value={usage} onChange={(e) => { setPage(1); setUsage(e.target.value as "" | "used" | "unused"); }} aria-label="Lọc theo sử dụng" className="ml-2 h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90">
            <option value="">Tất cả</option>
            <option value="used">Đang được dùng</option>
            <option value="unused">Chưa dùng</option>
          </select>
        </label>
        <button type="submit" className={BTN}>Tìm</button>
      </form>

      {state.status === "loading" && <LoadingPanel what="thư viện ảnh" />}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => void reload()} />}
      {state.status === "ready" && (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="media-total">{state.data.total} ảnh{q ? ` khớp “${q}”` : ""}.</p>
          {state.data.items.length === 0 ? (
            <p className="rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800">Chưa có ảnh nào ở đây.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="media-grid">
              {state.data.items.map((media) => {
                const selected = selectedIds?.has(media.id) ?? false;
                return (
                  <li key={media.id}>
                    <button type="button" onClick={() => onActivate(media)} aria-pressed={selectedIds ? selected : undefined} data-testid="media-card" data-media-id={media.id}
                      className={`group flex w-full flex-col overflow-hidden rounded-xl border text-left ${selected ? "border-brand-500 ring-2 ring-brand-300" : "border-gray-200 hover:border-gray-300 dark:border-gray-700"}`}>
                      <StaffImage path={mediaPreviewPath(media.id, "thumb")} alt={media.displayName} className="aspect-[4/3] w-full object-cover" />
                      <span className="flex flex-col gap-0.5 p-2">
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90" title={media.displayName}>{media.displayName}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{media.width}×{media.height} · {media.usage.revisions > 0 ? `dùng ${media.usage.revisions} bản` : "chưa dùng"}{media.pipeline === "legacy" ? " · cũ" : ""}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label="Phân trang thư viện ảnh">
              <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button>
              <span className="text-sm text-gray-600 dark:text-gray-300">Trang {page} / {pages}</span>
              <button type="button" className={BTN} disabled={page >= pages} onClick={() => setPage(page + 1)}>Trang sau</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
