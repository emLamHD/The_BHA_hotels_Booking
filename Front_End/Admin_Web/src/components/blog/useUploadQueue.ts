"use client";

/**
 * BHA-BLOG-001-CP03: the upload queue of the picture library and picker (design §9.6).
 *
 * One picture at a time (the single-upload route, `XMLHttpRequest` for real byte progress), each with a client id of its own that never changes — so a
 * picture whose answer was lost can be looked for by that id instead of being sent twice. What it promises, and what it does not:
 *
 * - "Sent" is not "stored". Bytes reach 100 % long before the server has decoded the picture; only the answer says it is done.
 * - Nothing is retried by itself. After a lost answer, a timeout, a 5xx or a cancel the picture is `unconfirmed`: the server may have it. It is looked
 *   for (`GET media/{id}/detail`): found and the hash matches → done; found with another hash → the id belongs to something else; not found → still
 *   unconfirmed (a request in flight on the server can still finish), and only then may the person send it again — with the same id.
 * - `409 duplicate-id` is not success: the existing picture is read back and compared by SHA-256 before it is believed to be this file.
 * - A failure of one picture leaves the others alone. Cancel stops what is waiting and aborts the one on the wire (which proves nothing about it).
 * - Every send holds the host's single write slot, so sign-out and a revoked permission cannot race it.
 * - The queue belongs to the component that made it. When that goes away (the person leaves the page) nothing waiting is sent any more and the one on the
 *   wire is aborted - which, again, proves nothing about the server: the picture may be stored. Its client id and the question "is it there?" die with
 *   the page (they are not kept anywhere), so a picture that was in flight shows up in the library later, or not at all. The host's write slot is still
 *   given back when that request ends, and nothing it answers is announced to a page that is gone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getMedia, uploadMedia, type BlogMedia, type UploadHandle } from "@/lib/api/blog";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";

export const UPLOAD_LIMITS = { fileBytes: 10 * 1024 * 1024, files: 10, totalBytes: 50 * 1024 * 1024 } as const;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

export type UploadStatus = "waiting" | "sending" | "processing" | "done" | "failed" | "unconfirmed" | "cancelled";

export interface UploadItem {
  key: string;
  /** The picture's id on the server: chosen here, kept through every reconciliation and re-send. */
  id: string;
  file: File;
  status: UploadStatus;
  sent: number;
  total: number;
  message: string | null;
  media: BlogMedia | null;
  /** The server was asked and does not have this id (yet): only then is "send again" offered. */
  absentOnServer: boolean;
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function checkLocalFile(file: File): string | null {
  if (!ACCEPTED.has(file.type)) return "Chỉ nhận ảnh PNG, JPEG hoặc WebP.";
  if (file.size === 0) return "Tệp rỗng.";
  if (file.size > UPLOAD_LIMITS.fileBytes) return "Ảnh lớn hơn 10 MB.";
  return null;
}

export function useUploadQueue({ onUploaded, hash = sha256Hex }: { onUploaded?: (media: BlogMedia) => void; hash?: (file: Blob) => Promise<string> }) {
  const host = useWebsiteHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const hashRef = useRef(hash);
  hashRef.current = hash;

  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());
  // A token belongs to one operation on one item, never to a different queue instance.
  const operations = useRef(new Map<string, symbol>());
  const running = useRef(false);
  /** A resend or an add that came while a drain was still unwinding: that drain looks again before it ends, so the request is never lost. */
  const kicked = useRef(false);
  /** False from the moment the owning component is torn down. Set again on setup, so React's setup-cleanup-setup check (which happens before anything is queued) leaves this queue live. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const owned = handles.current;
    const ownedOperations = operations.current;
    return () => {
      // First: nothing below may schedule or send once this is false. Then stop what waits (no state update - the component is gone) and ask the wire to stop.
      mounted.current = false;
      kicked.current = false;
      ownedOperations.clear();
      itemsRef.current = itemsRef.current.map((item) => (item.status === "waiting" ? { ...item, status: "cancelled", message: "Đã huỷ trước khi gửi." } : item));
      owned.forEach((handle) => handle.abort());
    };
  }, []);

  const patch = useCallback((key: string, change: Partial<UploadItem>) => {
    itemsRef.current = itemsRef.current.map((item) => (item.key === key ? { ...item, ...change } : item));
    if (mounted.current) setItems(itemsRef.current);
  }, []);

  const beginOperation = useCallback((key: string) => {
    const token = Symbol();
    operations.current.set(key, token);
    return () => mounted.current && operations.current.get(key) === token;
  }, []);

  /** Reads the server for this picture's id. A newer check or explicit resend supersedes every part of this answer. */
  const reconcile = useCallback(
    async (key: string) => {
      const item = itemsRef.current.find((x) => x.key === key);
      // A stale UI action must not supersede a live send (or a send waiting for the slot).
      if (!mounted.current || !item || item.status !== "unconfirmed") return;
      const current = beginOperation(key);
      patch(key, { message: "Đang hỏi máy chủ xem ảnh đã có chưa…" });
      try {
        const result = await getMedia(item.id);
        if (!current()) return;
        if (result.kind === "ok") {
          const local = await hashRef.current(item.file);
          if (!current()) return;
          if (result.data.originalSha256 === local) {
            patch(key, { status: "done", media: result.data, absentOnServer: false, message: "Ảnh đã có trên máy chủ (đối chiếu SHA-256 khớp)." });
            onUploadedRef.current?.(result.data);
          } else {
            patch(key, { status: "failed", message: "Mã ảnh này đang được dùng bởi một ảnh khác trên máy chủ, không phải tệp này. Hãy chọn lại tệp." });
          }
        } else if (result.kind === "refused" && result.status === 404) {
          patch(key, { status: "unconfirmed", absentOnServer: true, message: "Máy chủ chưa có ảnh này. Có thể yêu cầu cũ vẫn đang được xử lý; chờ một lúc rồi kiểm tra lại, hoặc gửi lại cùng mã." });
        } else if (result.kind === "unauthenticated") hostRef.current.onUnauthenticated();
        else if (result.kind === "denied") void hostRef.current.onDenied();
        else patch(key, { status: "unconfirmed", message: "Chưa kiểm tra được máy chủ. Hãy thử kiểm tra lại." });
      } catch {
        if (current()) patch(key, { status: "unconfirmed", message: "Chưa kiểm tra được máy chủ. Hãy thử kiểm tra lại." });
      } finally {
        if (current()) operations.current.delete(key);
      }
    },
    [beginOperation, patch]
  );

  const sendOne = useCallback(
    async (item: UploadItem) => {
      if (!mounted.current) return;
      const current = beginOperation(item.key);
      // The same host takes the slot and gives it back, whatever the context holds by then.
      const host = hostRef.current;
      if (!host.beginWrite()) {
        operations.current.delete(item.key);
        patch(item.key, { status: "cancelled", message: "Đang có thao tác khác hoặc đang đăng xuất; chưa gửi gì." });
        return;
      }
      let needsReconcile = false;
      try {
        patch(item.key, { status: "sending", sent: 0, message: null, absentOnServer: false });
        const handle = uploadMedia(item.file, item.id, (sent, total) => {
          if (current()) patch(item.key, { sent, total, status: sent >= total ? "processing" : "sending" });
        });
        handles.current.set(item.key, handle);
        const outcome = await handle.done;
        if (!current()) return;
        switch (outcome.kind) {
          case "ok":
            patch(item.key, { status: "done", media: outcome.media, message: null });
            if (mounted.current) onUploadedRef.current?.(outcome.media);
            break;
          case "refused":
            patch(item.key, { status: "failed", message: outcome.detail });
            break;
          case "duplicate":
            patch(item.key, { status: "unconfirmed", message: "Máy chủ báo mã này đã tồn tại; đang đối chiếu…" });
            break;
          case "unauthenticated":
            patch(item.key, { status: "failed", message: "Phiên đăng nhập đã kết thúc; ảnh chưa được lưu." });
            host.onUnauthenticated();
            break;
          case "denied":
            patch(item.key, { status: "failed", message: "Máy chủ từ chối: tài khoản có thể không còn quyền; ảnh chưa được lưu." });
            void host.onDenied();
            break;
          case "aborted":
            patch(item.key, { status: "unconfirmed", message: "Đã huỷ ở trình duyệt, nhưng máy chủ có thể vẫn đã nhận ảnh. Hãy kiểm tra máy chủ trước khi gửi lại." });
            break;
          case "unconfirmed":
            patch(item.key, { status: "unconfirmed", message: outcome.message });
            break;
        }
        needsReconcile = outcome.kind === "duplicate";
      } finally {
        if (current()) operations.current.delete(item.key);
        handles.current.delete(item.key);
        host.endWrite();
      }
      // A read, after the write slot is given back: it is not a write. Not for a page that is gone.
      if (needsReconcile && mounted.current) await reconcile(item.key);
    },
    [beginOperation, patch, reconcile]
  );

  const drain = useCallback(async () => {
    if (!mounted.current) return;
    if (running.current) {
      kicked.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        kicked.current = false;
        for (;;) {
          // One picture at a time. Only a picture that is `waiting` is sent: `cancel` turned every waiting one into `cancelled`, so what is left to send is
          // exactly what was added or explicitly resent since.
          const next = mounted.current ? itemsRef.current.find((item) => item.status === "waiting") : undefined;
          if (!next) break;
          await sendOne(next);
        }
        // Checked in the same step that gives the drain up: a resend cannot slip between "found nothing" and "not running".
      } while (kicked.current && mounted.current);
    } finally {
      running.current = false;
    }
  }, [sendOne]);

  /** Queues files. Those over the local limits are listed as failed and never sent; the rest are sent one after another. Returns a note when some were not taken. */
  const add = useCallback(
    (files: File[]): string | null => {
      let note: string | null = null;
      const taken = files.slice(0, UPLOAD_LIMITS.files);
      if (files.length > UPLOAD_LIMITS.files) note = `Mỗi lần chỉ nhận tối đa ${UPLOAD_LIMITS.files} ảnh; ${files.length - UPLOAD_LIMITS.files} ảnh sau chưa được thêm.`;
      let total = 0;
      const fresh: UploadItem[] = taken.map((file) => {
        const problem = checkLocalFile(file);
        total += file.size;
        const overBudget = !problem && total > UPLOAD_LIMITS.totalBytes;
        return {
          key: crypto.randomUUID(), id: crypto.randomUUID(), file, status: problem || overBudget ? "failed" : "waiting", sent: 0, total: file.size,
          message: problem ?? (overBudget ? "Vượt tổng 50 MB của một lượt tải." : null), media: null, absentOnServer: false,
        };
      });
      itemsRef.current = [...itemsRef.current, ...fresh];
      setItems(itemsRef.current);
      void drain();
      return note;
    },
    [drain]
  );

  /** Stops what has not been sent and aborts the one on the wire. The latter becomes `unconfirmed`, not failed: the server may already have it. */
  const cancel = useCallback(() => {
    // Cancel only invalidates items it actually stops. An unrelated read-back may finish.
    for (const item of itemsRef.current) {
      if (item.status === "waiting") operations.current.delete(item.key);
    }
    itemsRef.current = itemsRef.current.map((item) => (item.status === "waiting" ? { ...item, status: "cancelled", message: "Đã huỷ trước khi gửi." } : item));
    setItems(itemsRef.current);
    handles.current.forEach((handle) => handle.abort());
  }, []);

  /** Sends one picture again with its own id: only for one never sent, or one the server was asked about and does not have. */
  const resend = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((x) => x.key === key);
      if (!item || !(item.status === "cancelled" || (item.status === "unconfirmed" && item.absentOnServer))) return;
      operations.current.delete(key); // invalidate a pending read before this resend even waits for another item
      patch(key, { status: "waiting", message: null });
      void drain();
    },
    [drain, patch]
  );

  const dismiss = useCallback((key: string) => {
    const item = itemsRef.current.find((item) => item.key === key);
    if (item?.status === "sending" || item?.status === "processing") return;
    operations.current.delete(key);
    itemsRef.current = itemsRef.current.filter((item) => item.key !== key || item.status === "sending" || item.status === "processing");
    setItems(itemsRef.current);
  }, []);

  // Event handlers may run before React renders the state update from add/resend/progress.
  const isBusy = useCallback(() => handles.current.size > 0 || itemsRef.current.some((item) => item.status === "waiting" || item.status === "sending" || item.status === "processing"), []);
  const busy = isBusy();
  return { items, busy, isBusy, add, cancel, reconcile, resend, dismiss };
}
