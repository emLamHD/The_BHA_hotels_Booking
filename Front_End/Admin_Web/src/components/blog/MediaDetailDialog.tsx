"use client";

/**
 * BHA-BLOG-001-CP03: one picture of the library — its descriptive fields and focal point (BlogEdit, against the picture's version), where it is used
 * (the usage panel, `total` and `truncated` as the server says), and deleting an unused one (BlogPublish). Editing a picture changes no article; deleting
 * is decided by the server, which refuses a picture any revision still uses.
 */

import React, { useEffect, useState } from "react";
import { deleteMedia, getMedia, getMediaUsage, mediaPreviewPath, saveMedia, type BlogMedia, type BlogMediaUsage } from "@/lib/api/blog";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel, TextAreaField, TextField } from "@/components/website/WebsiteUi";
import { describeBlogFailure } from "@/lib/blog/blogModel";
import { StaffImage } from "./useStaffImage";
import FocalPicker from "./FocalPicker";
import BlogWriteFeedback from "./BlogWriteFeedback";
import { useBlogRights } from "./BlogAccessGate";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";

interface Fields {
  displayName: string;
  description: string;
  credit: string;
  sourceUrl: string;
  licence: string;
  focalX: number;
  focalY: number;
}

const fieldsOf = (m: BlogMedia): Fields => ({ displayName: m.displayName, description: m.description, credit: m.credit, sourceUrl: m.sourceUrl, licence: m.licence, focalX: m.focalX, focalY: m.focalY });

export default function MediaDetailDialog({ mediaId, onClose, onChanged }: { mediaId: string; onClose: () => void; onChanged: () => void }) {
  const rights = useBlogRights();
  const host = useWebsiteHost();
  const detail = useWebsiteList((signal) => getMedia(mediaId, signal), [mediaId]);
  const usage = useWebsiteList((signal) => getMediaUsage(mediaId, signal), [mediaId]);
  const save = useWriteAction();
  const remove = useWriteAction();
  const [edits, setEdits] = useState<Fields | null>(null);
  // After a save (or "load the latest") the server's copy replaces the one first read.
  const [saved, setSaved] = useState<{ fields: Fields; version: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const media = detail.state.status === "ready" ? detail.state.data : null;
  const baseline = saved?.fields ?? (media ? fieldsOf(media) : null);
  const version = saved?.version ?? media?.version ?? 0;
  const fields = edits ?? baseline;
  const dirty = edits !== null && JSON.stringify(edits) !== JSON.stringify(baseline);
  useEffect(() => {
    host.setUnsaved(dirty);
    return () => host.setUnsaved(false);
  }, [dirty, host]);

  const working = save.status.phase === "pending" || remove.status.phase === "pending";
  const set = (patch: Partial<Fields>) => setEdits((current) => (baseline ? { ...(current ?? baseline), ...patch } : current));

  const apply = (updated: BlogMedia) => {
    setSaved({ fields: fieldsOf(updated), version: updated.version });
    setEdits(null);
    setNote(null);
    onChanged();
  };

  const doSave = async () => {
    if (!fields) return;
    const result = await save.run(() => saveMedia(mediaId, version, fields));
    if (result?.kind === "ok") apply(result.data);
  };

  const checkServer = async () => {
    const result = await getMedia(mediaId);
    if (result.kind !== "ok" || !fields) return setNote(result.kind === "ok" ? null : describeBlogFailure(result));
    if (JSON.stringify(fieldsOf(result.data)) === JSON.stringify(fields)) {
      apply(result.data);
      save.reset();
      setNote("Máy chủ đã có đúng các giá trị bạn nhập; thay đổi đã được lưu.");
    } else {
      setNote(`Máy chủ đang ở phiên bản ${result.data.version}; chưa thấy đúng các giá trị bạn nhập nên chưa coi là đã lưu. Bạn có thể lưu lại.`);
      if (result.data.version !== version) setNote("Ảnh đã được người khác thay đổi trên máy chủ. Hãy tải giá trị mới nhất để so sánh.");
    }
  };

  const reloadLatest = async () => {
    const result = await getMedia(mediaId);
    if (result.kind === "ok") {
      setSaved({ fields: fieldsOf(result.data), version: result.data.version });
      setEdits(null);
      save.reset();
      setNote("Đã tải giá trị mới nhất từ máy chủ; thay đổi chưa lưu của bạn đã được thay thế.");
    } else setNote(describeBlogFailure(result));
  };

  const doDelete = async () => {
    const result = await remove.run(() => deleteMedia(mediaId, version));
    if (result?.kind === "ok") {
      onChanged();
      onClose();
    } else {
      setConfirmDelete(false);
      void usage.reload();
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Bạn có thay đổi chưa lưu cho ảnh này. Đóng sẽ bỏ chúng. Vẫn đóng?")) return;
    onClose();
  };

  return (
    <DialogShell title="Chi tiết ảnh" onClose={close} busy={working} testId="media-detail" wide>
      {detail.state.status === "loading" && <LoadingPanel what="ảnh" />}
      {detail.state.status === "error" && <ErrorPanel message={detail.state.message} onRetry={() => void detail.reload()} />}
      {media && fields && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2 text-sm text-gray-600 dark:text-gray-300">
              <StaffImage path={mediaPreviewPath(media.id, "card")} alt={media.displayName} className="max-h-56 w-full rounded-lg object-contain" />
              <p>{media.width}×{media.height}px · {(media.byteSize / 1024).toFixed(0)} KB · {media.contentType}</p>
              <p>Tệp gốc: {media.originalFileName || "—"}</p>
              <p>Xử lý: {media.pipeline === "current" ? `${media.variants.length} kích thước/định dạng` : "ảnh cũ — chưa tạo các kích thước (chạy lệnh bảo trì ảnh)"}</p>
              <p>Dùng trong {media.usage.revisions} bản (đang đăng {media.usage.inPublished}, nháp {media.usage.inDrafts}).</p>
            </div>
            <div className="flex flex-col gap-3">
              <TextField label="Tên hiển thị" value={fields.displayName} onChange={(v) => set({ displayName: v })} disabled={!rights.edit} maxLength={150} testId="media-name" />
              <TextAreaField label="Mô tả (gợi ý chú thích khi chèn ảnh)" value={fields.description} onChange={(v) => set({ description: v })} disabled={!rights.edit} maxLength={300} rows={2} />
              <TextField label="Tác giả / ghi công" value={fields.credit} onChange={(v) => set({ credit: v })} disabled={!rights.edit} maxLength={150} testId="media-credit" />
              <TextField label="Nguồn (địa chỉ https://)" value={fields.sourceUrl} onChange={(v) => set({ sourceUrl: v })} disabled={!rights.edit} maxLength={500} />
              <TextField label="Giấy phép" value={fields.licence} onChange={(v) => set({ licence: v })} disabled={!rights.edit} maxLength={150} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Điểm lấy nét</h3>
            <FocalPicker mediaId={media.id} x={fields.focalX} y={fields.focalY} onChange={(focalX, focalY) => set({ focalX, focalY })} disabled={!rights.edit} />
          </div>
          <UsagePanel state={usage.state} onRetry={() => void usage.reload()} />
          {!rights.edit && <Banner tone="info">Tài khoản này chỉ xem được ảnh; sửa thông tin cần quyền chỉnh sửa Blog.</Banner>}
          {note && <Banner tone="info" testId="media-note">{note}</Banner>}
          <BlogWriteFeedback status={save.status} working={working} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkServer()} />
          <BlogWriteFeedback status={remove.status} working={working} />
          {confirmDelete && (
            <Banner tone="warning" testId="media-delete-confirm">
              <p className="font-medium">Xoá ảnh này khỏi thư viện?</p>
              <p className="mt-1">Ảnh và các kích thước của nó bị xoá hẳn. Máy chủ từ chối nếu một bản nào của bài (nháp, đang đăng hay lịch sử) còn dùng ảnh. Nếu bạn đang sửa một bài chưa lưu có dùng ảnh này, bản chưa lưu đó không được tính là đang dùng — khi lưu, máy chủ sẽ báo ảnh không còn.</p>
              <div className="mt-2 flex gap-2"><ActionButton onClick={() => void doDelete()} disabled={working} testId="media-delete-yes">Xoá ảnh</ActionButton><ActionButton variant="outline" onClick={() => setConfirmDelete(false)} disabled={working}>Không xoá</ActionButton></div>
            </Banner>
          )}
          <DialogActions>
            {rights.publish && <ActionButton variant="outline" onClick={() => setConfirmDelete(true)} disabled={working || confirmDelete || media.usage.revisions > 0} testId="media-delete">Xoá ảnh…</ActionButton>}
            <ActionButton variant="outline" onClick={close} disabled={working} testId="media-close">Đóng</ActionButton>
            {rights.edit && <ActionButton onClick={() => void doSave()} disabled={working || !dirty || save.status.phase === "unverified"} testId="media-save">Lưu thông tin</ActionButton>}
          </DialogActions>
        </div>
      )}
    </DialogShell>
  );
}

function UsagePanel({ state, onRetry }: { state: ReturnType<typeof useWebsiteList<BlogMediaUsage>>["state"]; onRetry: () => void }) {
  if (state.status === "loading") return <LoadingPanel what="nơi dùng ảnh" />;
  if (state.status === "error") return <ErrorPanel message={state.message} onRetry={onRetry} />;
  const { items, total, truncated } = state.data;
  return (
    <section aria-label="Nơi dùng ảnh" data-testid="media-usage">
      <h3 className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">Nơi ảnh đang được dùng ({total})</h3>
      {items.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">Chưa bài nào dùng ảnh này.</p> : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-700">
          {items.map((use) => (
            <li key={`${use.revisionId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-medium text-gray-800 dark:text-white/90">{use.title || "(chưa có tiêu đề)"}</span>
              <span className="text-gray-500">{use.locale} · bản {use.revisionNumber}</span>
              <span className="rounded bg-gray-100 px-1.5 text-xs dark:bg-white/10">{use.revisionState === "Draft" ? "nháp" : use.isPublished ? "đang đăng" : "lịch sử"}</span>
              <span className="text-xs text-gray-500">{use.kinds.map((k) => (k === "cover" ? "ảnh bìa" : k === "og" ? "ảnh OG" : "trong bài")).join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      {truncated && <p className="mt-1 text-xs text-warning-700 dark:text-warning-300">Chỉ hiện {items.length} trong {total} lượt dùng.</p>}
    </section>
  );
}
