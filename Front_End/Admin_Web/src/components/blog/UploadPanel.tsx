"use client";

/** BHA-BLOG-001-CP03: the drop zone and the per-file list of an upload queue (state of each file, real progress, what to do when an answer was lost). */

import React, { useId, useRef, useState } from "react";
import { useUploadQueue, UPLOAD_LIMITS, type UploadItem, type UploadStatus } from "./useUploadQueue";
import type { BlogMedia } from "@/lib/api/blog";

const LABEL: Record<UploadStatus, string> = {
  waiting: "Chờ gửi", sending: "Đang gửi", processing: "Máy chủ đang xử lý", done: "Đã lưu", failed: "Lỗi", unconfirmed: "Chưa xác nhận", cancelled: "Chưa gửi",
};
const TONE: Record<UploadStatus, string> = {
  waiting: "text-gray-500", sending: "text-brand-600", processing: "text-brand-600", done: "text-success-600", failed: "text-error-600", unconfirmed: "text-warning-600", cancelled: "text-gray-500",
};
const BTN = "rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5";

function Row({ item, queue }: { item: UploadItem; queue: ReturnType<typeof useUploadQueue> }) {
  const percent = item.total > 0 ? Math.min(100, Math.round((item.sent / item.total) * 100)) : 0;
  return (
    <li className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700" data-testid="upload-item" data-status={item.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-gray-800 dark:text-white/90" title={item.file.name}>{item.file.name}</span>
        <span className={`text-xs font-medium ${TONE[item.status]}`} data-testid="upload-status">{LABEL[item.status]}</span>
      </div>
      {(item.status === "sending" || item.status === "processing") && (
        <div className="mt-2">
          <progress className="h-2 w-full" max={100} value={percent} aria-label={`Đã gửi ${percent}% của ${item.file.name}`} />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {item.status === "processing" ? "Đã gửi hết dữ liệu; chờ máy chủ xử lý và trả lời (chưa phải đã lưu)." : `${percent}% dữ liệu đã gửi (${Math.round(item.sent / 1024)} / ${Math.round(item.total / 1024)} KB).`}
          </p>
        </div>
      )}
      {item.message && <p className={`mt-1 text-xs ${item.status === "failed" ? "text-error-500" : "text-gray-600 dark:text-gray-300"}`} role={item.status === "failed" ? "alert" : undefined}>{item.message}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {item.status === "unconfirmed" && <button type="button" className={BTN} onClick={() => void queue.reconcile(item.key)}>Kiểm tra máy chủ</button>}
        {(item.status === "cancelled" || (item.status === "unconfirmed" && item.absentOnServer)) && <button type="button" className={BTN} onClick={() => queue.resend(item.key)}>Gửi lại (cùng mã)</button>}
        {item.status !== "sending" && item.status !== "processing" && <button type="button" className={BTN} onClick={() => queue.dismiss(item.key)}>Ẩn</button>}
      </div>
    </li>
  );
}

export default function UploadPanel({ queue, disabled, disabledReason }: { queue: ReturnType<typeof useUploadQueue>; disabled?: boolean; disabledReason?: string }) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setNote(queue.add([...list]));
    if (input.current) input.current.value = "";
  };
  return (
    <section aria-label="Tải ảnh lên" className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
        className={`rounded-xl border border-dashed p-4 text-center text-sm ${over ? "border-brand-400 bg-brand-50 dark:bg-brand-500/10" : "border-gray-300 dark:border-gray-700"}`}
      >
        <label htmlFor={inputId} className={`font-medium ${disabled ? "text-gray-400" : "cursor-pointer text-brand-600 hover:underline"}`}>Chọn ảnh để tải lên</label>
        <input ref={input} id={inputId} data-testid="upload-input" type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={disabled} className="sr-only" onChange={(e) => take(e.target.files)} />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {disabled ? disabledReason : `PNG, JPEG hoặc WebP, tối đa 10 MB mỗi ảnh, tối thiểu 600×400. Tối đa ${UPLOAD_LIMITS.files} ảnh một lượt; ảnh được gửi lần lượt.`}
        </p>
      </div>
      {note && <p role="status" className="text-xs text-warning-700 dark:text-warning-300">{note}</p>}
      {queue.items.length > 0 && (
        <>
          <ul className="flex flex-col gap-2" data-testid="upload-list">{queue.items.map((item) => <Row key={item.key} item={item} queue={queue} />)}</ul>
          {queue.busy && <div><button type="button" className={BTN} onClick={queue.cancel} data-testid="upload-cancel">Huỷ các ảnh chưa xong</button></div>}
        </>
      )}
    </section>
  );
}

export type { BlogMedia };
