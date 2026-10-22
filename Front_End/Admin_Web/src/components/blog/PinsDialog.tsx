"use client";

/**
 * BHA-BLOG-001-CP03: the pinned posts of one category. The whole list is saved at once against the category's version. A pin is only effective while the
 * post has a published revision in that category (the server reports `effective`); a new pin must be such a post. Order by drag and drop or by the up/down
 * buttons (the buttons are the keyboard way). It does not add a site-wide "featured" or a separate home list.
 */

import React, { useMemo, useState } from "react";
import { getPins, listPosts, savePins, type BlogCategory } from "@/lib/api/blog";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel } from "@/components/website/WebsiteUi";
import BlogWriteFeedback from "./BlogWriteFeedback";

export default function PinsDialog({ category, canEdit, languages, onClose }: { category: BlogCategory; canEdit: boolean; languages: string[]; onClose: () => void }) {
  const pins = useWebsiteList((signal) => getPins(category.id, signal), [category.id]);
  const posts = useWebsiteList((signal) => listPosts({ categoryId: category.id, status: "Published", page: 1, pageSize: 100 }, signal), [category.id]);
  const write = useWriteAction();
  const [edited, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const server = pins.state.status === "ready" ? pins.state.data : null;
  // The list on screen is what the person arranged, or — until they touch it — the server's.
  const serverOrder = server ? server.pins.map((p) => p.postId) : null;
  const order = edited ?? serverOrder;

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const pin of server?.pins ?? []) map.set(pin.postId, languages.map((l) => pin.titles[l]).find(Boolean) ?? Object.values(pin.titles)[0] ?? pin.postId);
    if (posts.state.status === "ready") for (const row of posts.state.data.items) if (!map.has(row.id)) map.set(row.id, languages.map((l) => row.translations.find((t) => t.locale === l)?.title).find(Boolean) ?? row.translations[0]?.title ?? row.id);
    return map;
  }, [server, posts.state, languages]);

  const effective = new Map((server?.pins ?? []).map((p) => [p.postId, p.effective]));
  const working = write.status.phase === "pending";
  const dirty = edited !== null && JSON.stringify(edited) !== JSON.stringify(serverOrder);
  const candidates = posts.state.status === "ready" ? posts.state.data.items.filter((row) => !order?.includes(row.id)) : [];

  const move = (from: number, to: number) => {
    if (!order || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
  };

  const doSave = async () => {
    if (!server || !order) return;
    const result = await write.run(() => savePins(category.id, server.version, order));
    if (result?.kind === "ok") {
      setOrder(null);
      void pins.reload();
      setNote("Đã lưu. Thứ tự ghim có hiệu lực ngay trong chuyên mục này.");
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Danh sách ghim có thay đổi chưa lưu. Đóng sẽ bỏ chúng. Vẫn đóng?")) return;
    onClose();
  };

  const name = languages.map((code) => category.translations[code]?.name).find(Boolean) ?? Object.values(category.translations)[0]?.name ?? "chuyên mục";
  return (
    <DialogShell title={`Ghim bài — ${name}`} onClose={close} busy={working} testId="pins-dialog" wide>
      {(pins.state.status === "loading" || order === null) && pins.state.status !== "error" && <LoadingPanel what="danh sách ghim" />}
      {pins.state.status === "error" && <ErrorPanel message={pins.state.message} onRetry={() => void pins.reload()} />}
      {server && order && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Bài được ghim hiện lên đầu chuyên mục theo thứ tự dưới đây; còn lại xếp theo ngày đăng đầu tiên. Chỉ tính khi bài đã xuất bản trong chuyên mục này.</p>
          {order.length === 0 ? <p className="rounded-xl border border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-gray-700">Chưa ghim bài nào.</p> : (
            <ol className="flex flex-col gap-2" data-testid="pins-list">
              {order.map((postId, index) => (
                <li key={postId} draggable={canEdit && !working} onDragStart={() => setDragging(index)} onDragOver={(e) => { if (dragging !== null) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (dragging !== null) move(dragging, index); setDragging(null); }} onDragEnd={() => setDragging(null)}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-white/[0.03]" data-testid="pin-item">
                  <span className="w-6 text-center text-gray-400" aria-hidden>{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-800 dark:text-white/90">{titles.get(postId) ?? postId}</span>
                  {effective.get(postId) === false && <span className="rounded bg-warning-50 px-1.5 py-0.5 text-xs text-warning-700 dark:bg-warning-500/15">chưa có hiệu lực</span>}
                  {canEdit && (
                    <span className="flex gap-1">
                      <button type="button" aria-label={`Đưa “${titles.get(postId)}” lên`} disabled={working || index === 0} onClick={() => move(index, index - 1)} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-gray-700">↑</button>
                      <button type="button" aria-label={`Đưa “${titles.get(postId)}” xuống`} disabled={working || index === order.length - 1} onClick={() => move(index, index + 1)} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-gray-700">↓</button>
                      <button type="button" aria-label={`Bỏ ghim “${titles.get(postId)}”`} disabled={working} onClick={() => setOrder(order.filter((id) => id !== postId))} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-gray-700">Bỏ ghim</button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {canEdit && (
            <div>
              <h3 className="mb-1 text-sm font-medium text-gray-800 dark:text-white/90">Bài đã xuất bản trong chuyên mục (chọn để ghim)</h3>
              {posts.state.status === "loading" && <p className="text-sm text-gray-500">Đang tải…</p>}
              {posts.state.status === "error" && <ErrorPanel message={posts.state.message} onRetry={() => void posts.reload()} />}
              {posts.state.status === "ready" && (candidates.length === 0 ? <p className="text-sm text-gray-500">Không còn bài nào để ghim.</p> : (
                <ul className="flex flex-wrap gap-2">{candidates.map((row) => <li key={row.id}><button type="button" disabled={working || order.length >= 50} onClick={() => setOrder([...order, row.id])} className="rounded-lg border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-white/5">+ {titles.get(row.id)}</button></li>)}</ul>
              ))}
            </div>
          )}
          {!canEdit && <Banner tone="info">Chỉ tài khoản có quyền xuất bản Blog mới đổi được ghim.</Banner>}
          {note && <Banner tone="success" testId="pins-note" onDismiss={() => setNote(null)}>{note}</Banner>}
          <BlogWriteFeedback status={write.status} working={working} onCheckServer={() => void pins.reload().then((latest) => { if (latest) { write.reset(); setNote(JSON.stringify(latest.pins.map((p) => p.postId)) === JSON.stringify(order) ? "Máy chủ đã có đúng danh sách ghim của bạn." : "Máy chủ chưa có danh sách của bạn; có thể lưu lại."); } })}
            onReloadLatest={() => void pins.reload().then((latest) => { if (latest) { write.reset(); setNote(`Danh sách ghim đã đổi trên máy chủ (phiên bản ${latest.version}). Danh sách bạn sắp xếp vẫn còn; bấm Lưu nếu vẫn muốn dùng nó.`); } })} />
          <DialogActions>
            <ActionButton variant="outline" onClick={close} disabled={working} testId="pins-close">Đóng</ActionButton>
            {canEdit && <ActionButton onClick={() => void doSave()} disabled={working || !dirty || write.status.phase === "unverified"} testId="pins-save">Lưu danh sách ghim</ActionButton>}
          </DialogActions>
        </div>
      )}
    </DialogShell>
  );
}
