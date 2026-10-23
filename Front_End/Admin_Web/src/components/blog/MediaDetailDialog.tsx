"use client";

/**
 * BHA-BLOG-001-CP03: one picture of the library — its descriptive fields and focal point (BlogEdit, against the picture's version), where it is used
 * (the usage panel, `total` and `truncated` as the server says), and deleting an unused one (BlogPublish). Editing a picture changes no article; deleting
 * is decided by the server, which refuses a picture any revision still uses.
 *
 * Writes (C4): a save takes an immutable SNAPSHOT of what it sends. Its answer acknowledges only that - whatever was typed (or moved on the focal picker)
 * after the click stays, unsaved, on top of the confirmed version. A lost answer is read back and judged against the snapshot, never against the form as it
 * is now. A stale version keeps the local input, shows the server's complete state beside it with both versions, and locks Save until the person chooses:
 * "keep mine" (the only thing that moves the version the next Save carries; it sends nothing itself) or "use the server's copy" (confirmed first).
 */

import React, { useEffect, useRef, useState } from "react";
import { deleteMedia, getMedia, getMediaUsage, mediaPreviewPath, saveMedia, type BlogMedia, type BlogMediaUsage } from "@/lib/api/blog";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel, TextAreaField, TextField } from "@/components/website/WebsiteUi";
import { describeBlogFailure } from "@/lib/blog/blogModel";
import { serverTrim } from "@/lib/blog/bodyModel";
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

/** What one Save sent. Never changes after it is taken. */
interface Snapshot {
  expectedVersion: number;
  fields: Fields;
}

/** The server's picture beside the local input, kept apart from the dialog's base version until the person chooses. */
interface Conflict {
  fresh: BlogMedia;
  askUseServer: boolean;
}

const same = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What `UpdateMediaAsync` stores for `fields`: the five text fields are each `BlogText.Normalize` (.NET `string.Trim()`, "" for none - `serverTrim`, not
 * JavaScript's `trim`: U+FEFF is kept, U+0085 is removed) and the focal point is `RoundFocal` (4 decimals, away from zero). Nothing else is rewritten. A lost save is
 * judged by comparing the server's copy with THIS form of what was sent; the raw form input is never changed to make a comparison match.
 */
export function canonicalMediaFields(f: Fields): Fields {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    displayName: serverTrim(f.displayName), description: serverTrim(f.description), credit: serverTrim(f.credit), sourceUrl: serverTrim(f.sourceUrl), licence: serverTrim(f.licence),
    focalX: round(f.focalX), focalY: round(f.focalY),
  };
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
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const editsRef = useRef<Fields | null>(null);
  const opRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const media = detail.state.status === "ready" ? detail.state.data : null;
  const baseline = saved?.fields ?? (media ? fieldsOf(media) : null);
  const version = saved?.version ?? media?.version ?? 0;
  const fields = edits ?? baseline;
  const dirty = edits !== null && JSON.stringify(edits) !== JSON.stringify(baseline);
  useEffect(() => {
    editsRef.current = edits; // what is typed right now, for answers that arrive later
  });
  useEffect(() => {
    host.setUnsaved(dirty);
    return () => host.setUnsaved(false);
  }, [dirty, host]);

  const working = save.status.phase === "pending" || remove.status.phase === "pending";
  const set = (patch: Partial<Fields>) => setEdits((current) => (baseline ? { ...(current ?? baseline), ...patch } : current));

  /** The server's copy becomes the base. Input newer than `sent` (typed after it was taken) is kept - it is not part of what the server acknowledged. */
  const apply = (updated: BlogMedia, sent: Fields) => {
    setSaved({ fields: fieldsOf(updated), version: updated.version });
    const live = editsRef.current;
    if (live === null || same(live, sent)) {
      setEdits(null);
      setNote(null);
    } else setNote("Đã lưu các giá trị đã gửi. Những chỉnh sửa bạn nhập sau khi bấm Lưu vẫn còn và chưa được lưu.");
    onChanged();
  };

  const doSave = async () => {
    if (!fields || conflict) return;
    const snap: Snapshot = { expectedVersion: version, fields: { ...fields } };
    snapshotRef.current = snap;
    const result = await save.run(() => saveMedia(mediaId, snap.expectedVersion, snap.fields));
    if (result?.kind === "ok") {
      snapshotRef.current = null;
      apply(result.data, snap.fields);
    }
  };

  /** The answer to a save was lost. Read, and judge what the server shows against what was SENT. Nothing is sent from here. */
  const checkServer = async () => {
    const snap = snapshotRef.current;
    if (!snap) return;
    const token = ++opRef.current;
    const result = await getMedia(mediaId);
    if (!mountedRef.current || opRef.current !== token || snapshotRef.current !== snap) return;
    if (result.kind !== "ok") {
      setNote(`${describeBlogFailure(result)} Chưa kiểm tra được máy chủ; thao tác vẫn là chưa xác nhận và dữ liệu của bạn vẫn còn.`);
      return;
    }

    const fresh = result.data;
    // The server stores the canonical form of what was sent; the raw snapshot stays what "newer input" is judged against.
    const matches = same(fieldsOf(fresh), canonicalMediaFields(snap.fields));
    snapshotRef.current = null;
    save.reset();
    if (matches && fresh.version > snap.expectedVersion) {
      apply(fresh, snap.fields);
      const newer = editsRef.current !== null && !same(editsRef.current, snap.fields);
      setNote(`Máy chủ đã có đúng các giá trị đã gửi (phiên bản ${fresh.version}). Đây là kết quả đọc lại, không phải gửi lại.${newer ? " Những chỉnh sửa mới hơn của bạn vẫn còn và chưa được lưu." : ""}`);
    } else if (matches) {
      setNote(`Máy chủ đang có đúng các giá trị này nhưng phiên bản chưa đổi (${fresh.version}), nên chưa đủ bằng chứng rằng lần lưu này đã chạy. Bạn có thể lưu lại.`);
    } else if (fresh.version === snap.expectedVersion) {
      setNote("Máy chủ chưa ghi nhận thay đổi này (ảnh vẫn như trước). Dữ liệu của bạn vẫn còn; bạn có thể lưu lại.");
    } else {
      setConflict({ fresh, askUseServer: false });
      setNote(`Ảnh đã thay đổi trên máy chủ (phiên bản ${fresh.version}) thành giá trị khác. Xem so sánh bên dưới; chưa có gì được gửi.`);
    }
  };

  /** After a stale version (409): read the server's copy and show it BESIDE the local input. The input and the base version are not touched. */
  const reloadLatest = async () => {
    const token = ++opRef.current;
    const result = await getMedia(mediaId);
    if (!mountedRef.current || opRef.current !== token) return;
    if (result.kind !== "ok") {
      setNote(`${describeBlogFailure(result)} Chưa tải được giá trị mới nhất; dữ liệu của bạn vẫn còn, hãy thử lại.`);
      return;
    }

    save.reset();
    setConflict({ fresh: result.data, askUseServer: false });
    setNote(`Ảnh đã được thay đổi trên máy chủ (phiên bản ${result.data.version}). Xem so sánh bên dưới rồi chọn; chưa có gì được gửi.`);
  };

  const keepMine = () => {
    if (!conflict) return;
    // The ONLY place the version moves: the person has seen both and writes theirs on top of the server's version at the next Save.
    setSaved({ fields: fieldsOf(conflict.fresh), version: conflict.fresh.version });
    setConflict(null);
    setNote(`Giữ thay đổi của bạn trên phiên bản ${conflict.fresh.version}. Chưa có gì được gửi — bấm Lưu để ghi.`);
  };

  const useServerCopy = () => {
    if (!conflict) return;
    setSaved({ fields: fieldsOf(conflict.fresh), version: conflict.fresh.version });
    setEdits(null);
    setConflict(null);
    setNote(`Đã dùng giá trị trên máy chủ (phiên bản ${conflict.fresh.version}); thay đổi chưa lưu của bạn đã bị bỏ.`);
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
          {!rights.edit && <Banner tone="info">Tài khoản này chỉ xem được ảnh; sửa thông tin cần quyền chỉnh sửa Blog.</Banner>}
          {note && <Banner tone="info" testId="media-note">{note}</Banner>}
          {conflict && <ConflictPanel mine={fields} mineVersion={version} fresh={conflict.fresh} askUseServer={conflict.askUseServer} onKeep={keepMine} onAskUseServer={() => setConflict({ ...conflict, askUseServer: true })} onUseServer={useServerCopy} onCancelUseServer={() => setConflict({ ...conflict, askUseServer: false })} />}
          <BlogWriteFeedback status={save.status} working={working} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkServer()} />
          <BlogWriteFeedback status={remove.status} working={working} />
          {confirmDelete && (
            <Banner tone="warning" testId="media-delete-confirm">
              <p className="font-medium">Xoá ảnh này khỏi thư viện?</p>
              <p className="mt-1">Ảnh và các kích thước của nó bị xoá hẳn. Máy chủ từ chối nếu một bản nào của bài (nháp, đang đăng hay lịch sử) còn dùng ảnh. Nếu bạn đang sửa một bài chưa lưu có dùng ảnh này, bản chưa lưu đó không được tính là đang dùng — khi lưu, máy chủ sẽ báo ảnh không còn.</p>
              <div className="mt-2 flex gap-2"><ActionButton onClick={() => void doDelete()} disabled={working} testId="media-delete-yes">Xoá ảnh</ActionButton><ActionButton variant="outline" onClick={() => setConfirmDelete(false)} disabled={working}>Không xoá</ActionButton></div>
            </Banner>
          )}
          {/* After the banners: a long usage list must not push a conflict comparison out of sight. */}
          <UsagePanel state={usage.state} onRetry={() => void usage.reload()} />
          <DialogActions>
            {rights.publish && <ActionButton variant="outline" onClick={() => setConfirmDelete(true)} disabled={working || confirmDelete || media.usage.revisions > 0} testId="media-delete">Xoá ảnh…</ActionButton>}
            <ActionButton variant="outline" onClick={close} disabled={working} testId="media-close">Đóng</ActionButton>
            {rights.edit && <ActionButton onClick={() => void doSave()} disabled={working || !dirty || save.status.phase === "unverified" || conflict !== null} testId="media-save">Lưu thông tin</ActionButton>}
          </DialogActions>
        </div>
      )}
    </DialogShell>
  );
}

/** The local input (as it is now) and the server's complete state side by side. Nothing here sends anything. */
function ConflictPanel({ mine, mineVersion, fresh, askUseServer, onKeep, onAskUseServer, onUseServer, onCancelUseServer }: { mine: Fields; mineVersion: number; fresh: BlogMedia; askUseServer: boolean; onKeep: () => void; onAskUseServer: () => void; onUseServer: () => void; onCancelUseServer: () => void }) {
  const theirs = fieldsOf(fresh);
  const rows: [string, string, string][] = [
    ["Tên hiển thị", mine.displayName, theirs.displayName], ["Mô tả", mine.description, theirs.description], ["Tác giả / ghi công", mine.credit, theirs.credit],
    ["Nguồn", mine.sourceUrl, theirs.sourceUrl], ["Giấy phép", mine.licence, theirs.licence], ["Điểm lấy nét ngang", String(mine.focalX), String(theirs.focalX)], ["Điểm lấy nét dọc", String(mine.focalY), String(theirs.focalY)],
  ];
  const differing = rows.filter(([, a, b]) => a !== b).length;
  return (
    <Banner tone="warning" testId="media-conflict">
      <p className="font-medium">Bản của bạn (dựa trên phiên bản {mineVersion}) khác bản trên máy chủ (phiên bản {fresh.version}).</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead><tr><th className="pr-3">Trường</th><th className="pr-3">Của bạn</th><th>Trên máy chủ</th></tr></thead>
        <tbody>{rows.map(([label, a, b]) => <tr key={label} className={a !== b ? "font-semibold" : ""}><td className="pr-3 align-top">{label}</td><td className="pr-3 align-top break-words">{a || "—"}</td><td className="align-top break-words">{b || "—"}</td></tr>)}</tbody>
      </table>
      {askUseServer ? (
        <div className="mt-3">
          <p className="text-xs">Bỏ {differing} khác biệt của bạn và dùng bản của máy chủ? Thay đổi chưa lưu của bạn sẽ mất.</p>
          <div className="mt-2 flex gap-2"><ActionButton onClick={onUseServer} testId="media-conflict-confirm">Đồng ý, dùng bản máy chủ</ActionButton><ActionButton variant="outline" onClick={onCancelUseServer}>Không</ActionButton></div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton variant="outline" onClick={onKeep} testId="media-conflict-keep">Giữ thay đổi của tôi trên phiên bản {fresh.version}</ActionButton>
          <ActionButton variant="outline" onClick={onAskUseServer} testId="media-conflict-use-server">Dùng bản của máy chủ…</ActionButton>
        </div>
      )}
      <p className="mt-2 text-xs">Không có lựa chọn nào tự gửi gì lên máy chủ. “Giữ thay đổi của tôi” nghĩa là lần bấm Lưu tiếp theo sẽ ghi đè mọi giá trị khác nhau ở trên bằng cột bên trái, trên phiên bản {fresh.version}.</p>
    </Banner>
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
