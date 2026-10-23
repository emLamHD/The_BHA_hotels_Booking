"use client";

/**
 * BHA-BLOG-001-CP03: the pinned posts of one category. The whole list is saved at once against the category's version. A pin is only effective while the
 * post has a published revision in that category (the server reports `effective`); a new pin must be such a post. Order by drag and drop or by the up/down
 * buttons (the buttons are the keyboard way). It does not add a site-wide "featured" or a separate home list.
 *
 * The posts offered for pinning are read from the server a page at a time, with a search (`q`): a category may hold far more than one page, and a post on any
 * page can be found and pinned. What has been arranged lives apart from the page being looked at, so paging, searching, a failed page or a late answer for an
 * earlier page cannot change it. The list `listPosts` returns matches a post when ANY of its translations (draft or published) is in the category, so a few
 * offered posts can still be refused by the server (`blog.pin-not-published`); that refusal is shown as it is.
 *
 * Saving: what is sent is an immutable snapshot (the version and the order). A lost answer is judged against it - verified only when the server shows that very
 * order AND a version that moved on. A stale version reads the server's list apart from the local order and shows both with their versions; Save stays off, and the
 * version moves only when the person chooses "keep mine" or confirms "use the server's order".
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getPins, listPosts, savePins, type BlogCategory, type BlogPins, type BlogPostRow } from "@/lib/api/blog";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { ActionButton, Banner, DialogActions, DialogShell, ErrorPanel, LoadingPanel } from "@/components/website/WebsiteUi";
import BlogWriteFeedback from "./BlogWriteFeedback";

const CANDIDATE_PAGE = 20;
const MAX_PINS = 50;

export default function PinsDialog({ category, canEdit, languages, onClose }: { category: BlogCategory; canEdit: boolean; languages: string[]; onClose: () => void }) {
  const pins = useWebsiteList((signal) => getPins(category.id, signal), [category.id]);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  /** Titles of posts picked from a page that is no longer on screen. */
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const posts = useWebsiteList((signal) => listPosts({ categoryId: category.id, status: "Published", q: q || undefined, page, pageSize: CANDIDATE_PAGE }, signal), [category.id, q, page]);
  const write = useWriteAction();
  const [conflict, setConflict] = useState<{ fresh: BlogPins; askUseServer: boolean } | null>(null);
  /** The version the person chose to write on after seeing the server's list (null: the version last read). */
  const [base, setBase] = useState<number | null>(null);
  const snapRef = useRef<{ seq: number; expectedVersion: number; postIds: string[] } | null>(null);
  const seqRef = useRef(0);
  const [edited, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * The list the server last ANSWERED to a write of ours (the save's own answer, or a read-back that proved it). It is the confirmed base from that moment: `useWebsiteList`
   * keeps showing the list from before the save while the refresh that follows loads, and unlocking the editor on that list would write the next save over what was just
   * saved. A read of an older version never moves the base backward; an equal or newer one replaces it.
   */
  const [confirmed, setConfirmed] = useState<BlogPins | null>(null);
  const read = pins.state.status === "ready" ? pins.state.data : null;
  const server = confirmed && (!read || read.version < confirmed.version) ? confirmed : read;
  // The list on screen is what the person arranged, or — until they touch it — the server's.
  const serverOrder = server ? server.pins.map((p) => p.postId) : null;
  const order = edited ?? serverOrder;
  // The arrangement on screen right now, for answers that arrive later: a callback's own `order` is the one it was made with.
  const orderRef = useRef<string[] | null>(null);
  useEffect(() => {
    orderRef.current = order;
  });

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const pin of server?.pins ?? []) map.set(pin.postId, languages.map((l) => pin.titles[l]).find(Boolean) ?? Object.values(pin.titles)[0] ?? pin.postId);
    if (posts.state.status === "ready") for (const row of posts.state.data.items) if (!map.has(row.id)) map.set(row.id, languages.map((l) => row.translations.find((t) => t.locale === l)?.title).find(Boolean) ?? row.translations[0]?.title ?? row.id);
    for (const [postId, title] of picked) if (!map.has(postId)) map.set(postId, title);
    return map;
  }, [server, posts.state, languages, picked]);

  const effective = new Map((server?.pins ?? []).map((p) => [p.postId, p.effective]));
  const working = write.status.phase === "pending";
  const dirty = edited !== null && JSON.stringify(edited) !== JSON.stringify(serverOrder);
  const candidates = posts.state.status === "ready" ? posts.state.data.items.filter((row) => !order?.includes(row.id)) : [];
  const total = posts.state.status === "ready" ? posts.state.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / CANDIDATE_PAGE));

  /** An arrangement is made ON the version on screen when it starts: a refresh that lands later with another version does not move what it is written on (a stale write is then a 409, not an overwrite). */
  const arrange = (next: string[]) => {
    if (edited === null && base === null && server) setBase(server.version);
    setOrder(next);
  };

  const add = (row: BlogPostRow) => {
    if (!order || order.includes(row.id) || order.length >= MAX_PINS) return;
    setPicked((current) => new Map(current).set(row.id, languages.map((l) => row.translations.find((t) => t.locale === l)?.title).find(Boolean) ?? row.translations[0]?.title ?? row.id));
    arrange([...order, row.id]);
  };

  const move = (from: number, to: number) => {
    if (!order || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    arrange(next);
  };

  const version = base ?? server?.version ?? 0;
  const titlesOf = (fresh: BlogPins) => setPicked((current) => { const next = new Map(current); for (const pin of fresh.pins) next.set(pin.postId, languages.map((l) => pin.titles[l]).find(Boolean) ?? Object.values(pin.titles)[0] ?? pin.postId); return next; });

  const doSave = async () => {
    if (!server || !order || conflict) return;
    const snap = { seq: ++seqRef.current, expectedVersion: version, postIds: [...order] };
    snapRef.current = snap;
    setNote(null);
    const result = await write.run(() => savePins(category.id, snap.expectedVersion, snap.postIds));
    if (result?.kind === "ok") {
      // The answer is the saved list and version: adopted before anything is editable again, not left for the refresh below to bring.
      titlesOf(result.data);
      setConfirmed(result.data);
      setOrder(null);
      setBase(null);
      snapRef.current = null;
      void pins.reload();
      setNote("Đã lưu. Thứ tự ghim có hiệu lực ngay trong chuyên mục này.");
    }
  };

  /** The answer to a save was lost: read the list and judge it against what was SENT. Nothing is sent from here and the version is never moved by guessing. */
  const checkSave = async () => {
    const snap = snapRef.current;
    if (!snap) return;
    const result = await getPins(category.id);
    if (snapRef.current?.seq !== snap.seq) return;
    if (result.kind !== "ok") {
      setNote("Chưa kiểm tra được máy chủ. Danh sách của bạn vẫn còn và thao tác vẫn là chưa xác nhận; hãy thử kiểm tra lại.");
      return;
    }

    const fresh = result.data;
    const sameOrder = JSON.stringify(fresh.pins.map((p) => p.postId)) === JSON.stringify(snap.postIds);
    const moved = fresh.version > snap.expectedVersion;
    write.reset();
    if (sameOrder && moved) {
      // Verified: the server holds exactly the order that was sent, at a version that moved on. What is on screen NOW decides whether anything is left to
      // save: an arrangement made while the server was being read is newer than the request, so it stays (unsaved) on top of the confirmed version.
      const newer = JSON.stringify(orderRef.current) !== JSON.stringify(snap.postIds);
      if (!newer) setOrder(null);
      setBase(newer ? fresh.version : null);
      setConfirmed(fresh);
      titlesOf(fresh);
      void pins.reload();
      setNote(`Đã xác nhận trên máy chủ: danh sách ghim có đúng thứ tự đã gửi (phiên bản ${fresh.version}). Đây là kết quả đọc lại, không phải gửi lại.${newer ? " Thứ tự bạn sắp xếp thêm sau đó vẫn còn và chưa được lưu." : ""}`);
    } else if (sameOrder) {
      setNote(`Máy chủ đang có đúng thứ tự này nhưng phiên bản chưa đổi (${fresh.version}), nên chưa đủ bằng chứng rằng lần lưu này đã chạy; hệ thống không khẳng định gì thêm. Danh sách của bạn vẫn còn.`);
    } else if (!moved) {
      setNote("Máy chủ chưa ghi nhận thay đổi này (danh sách ghim vẫn như trước). Danh sách của bạn vẫn còn; bấm Lưu nếu muốn gửi lại.");
    } else {
      titlesOf(fresh);
      setConflict({ fresh, askUseServer: false });
      setNote(`Danh sách ghim đã đổi trên máy chủ (phiên bản ${fresh.version}). Danh sách của bạn được giữ; xem so sánh bên dưới.`);
    }
  };

  /** After a stale version (409): read the server's list and show it BESIDE the local order. The version Save uses is not touched. */
  const reloadLatest = async () => {
    const result = await getPins(category.id);
    if (result.kind !== "ok") {
      setNote("Chưa tải được danh sách mới nhất từ máy chủ. Danh sách của bạn vẫn còn; hãy thử lại.");
      return;
    }

    write.reset();
    titlesOf(result.data);
    setConflict({ fresh: result.data, askUseServer: false });
    setNote(`Danh sách ghim đã được thay đổi trên máy chủ (phiên bản ${result.data.version}). Xem so sánh bên dưới rồi chọn; chưa có gì được gửi.`);
  };

  const keepMine = () => {
    if (!conflict) return;
    // The ONLY place the version moves: the person has seen both lists and chose to write theirs on top of the server's version.
    setBase(conflict.fresh.version);
    setConflict(null);
    setNote(`Giữ danh sách của bạn trên phiên bản ${conflict.fresh.version}. Chưa có gì được gửi — bấm Lưu để ghi.`);
  };

  const useServerOrder = () => {
    if (!conflict) return;
    const version = conflict.fresh.version;
    setConfirmed(conflict.fresh);
    setOrder(null);
    setBase(null);
    setConflict(null);
    void pins.reload();
    setNote(`Đã dùng danh sách trên máy chủ (phiên bản ${version}); thứ tự chưa lưu của bạn đã bị bỏ.`);
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
                      <button type="button" aria-label={`Bỏ ghim “${titles.get(postId)}”`} disabled={working} onClick={() => arrange(order.filter((id) => id !== postId))} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-gray-700">Bỏ ghim</button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {canEdit && (
            <section aria-label="Bài có thể ghim" data-testid="pin-candidates">
              <h3 className="mb-1 text-sm font-medium text-gray-800 dark:text-white/90">Bài đã xuất bản trong chuyên mục (chọn để ghim)</h3>
              <form className="mb-2 flex flex-wrap items-center gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(typed.trim()); }}>
                <input type="search" aria-label="Tìm bài để ghim" placeholder="Tiêu đề hoặc slug" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 w-56 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90" />
                <button type="submit" className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700">Tìm</button>
                {q && <button type="button" className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700" onClick={() => { setTyped(""); setQ(""); setPage(1); }}>Xoá tìm kiếm</button>}
              </form>
              {posts.state.status === "loading" && <p className="text-sm text-gray-500">Đang tải…</p>}
              {posts.state.status === "error" && <ErrorPanel message={posts.state.message} onRetry={() => void posts.reload()} />}
              {posts.state.status === "ready" && (
                <>
                  <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{total} bài{q ? ` khớp “${q}”` : " đã xuất bản trong chuyên mục"} · Trang {page} / {pages}</p>
                  {order.length >= MAX_PINS && <p className="mb-2 text-xs text-warning-700 dark:text-warning-300">Đã ghim tối đa {MAX_PINS} bài; bỏ ghim một bài để thêm bài khác.</p>}
                  {candidates.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      {total === 0 ? "Không có bài nào khớp." : posts.state.data.items.length === 0 ? `Trang này không có bài nào (tổng ${total} bài); dùng nút chuyển trang.` : "Mọi bài ở trang này đã được ghim; xem các trang khác."}
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">{candidates.map((row) => <li key={row.id}><button type="button" disabled={working || order.length >= MAX_PINS} onClick={() => add(row)} className="rounded-lg border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-white/5">+ {titles.get(row.id)}</button></li>)}</ul>
                  )}
                </>
              )}
              <nav className="mt-2 flex items-center gap-2" aria-label="Phân trang bài có thể ghim">
                <button type="button" className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-700" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button>
                <button type="button" className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-700" disabled={posts.state.status === "ready" ? page >= pages : false} onClick={() => setPage(page + 1)}>Trang sau</button>
              </nav>
            </section>
          )}
          {!canEdit && <Banner tone="info">Chỉ tài khoản có quyền xuất bản Blog mới đổi được ghim.</Banner>}
          {note && <Banner tone="success" testId="pins-note" onDismiss={() => setNote(null)}>{note}</Banner>}
          {conflict && (
            <Banner tone="warning" testId="pins-conflict">
              <p className="font-medium">Danh sách của bạn (dựa trên phiên bản {version}) khác danh sách trên máy chủ (phiên bản {conflict.fresh.version}).</p>
              <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
                <div><p className="font-semibold">Của bạn</p><ol className="list-decimal pl-5">{order.map((postId) => <li key={postId}>{titles.get(postId) ?? postId}</li>)}{order.length === 0 && <li className="list-none">— không ghim bài nào —</li>}</ol></div>
                <div><p className="font-semibold">Trên máy chủ</p><ol className="list-decimal pl-5">{conflict.fresh.pins.map((pin) => <li key={pin.postId}>{titles.get(pin.postId) ?? pin.postId}</li>)}{conflict.fresh.pins.length === 0 && <li className="list-none">— không ghim bài nào —</li>}</ol></div>
              </div>
              {conflict.askUseServer ? (
                <div className="mt-3">
                  <p className="text-xs">Bỏ thứ tự của bạn và dùng danh sách của máy chủ? Thay đổi chưa lưu của bạn sẽ mất.</p>
                  <div className="mt-2 flex gap-2"><ActionButton onClick={useServerOrder} testId="pins-conflict-confirm">Đồng ý, dùng danh sách máy chủ</ActionButton><ActionButton variant="outline" onClick={() => setConflict({ ...conflict, askUseServer: false })}>Không</ActionButton></div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton variant="outline" onClick={keepMine} testId="pins-conflict-keep">Giữ thứ tự của tôi trên phiên bản {conflict.fresh.version}</ActionButton>
                  <ActionButton variant="outline" onClick={() => setConflict({ ...conflict, askUseServer: true })} testId="pins-conflict-use-server">Dùng danh sách của máy chủ…</ActionButton>
                  <ActionButton variant="outline" onClick={() => setConflict(null)}>Đóng so sánh</ActionButton>
                </div>
              )}
              <p className="mt-2 text-xs">“Giữ thứ tự của tôi” thay toàn bộ danh sách ghim bằng cột bên trái. Không có lựa chọn nào tự gửi gì lên máy chủ.</p>
            </Banner>
          )}
          <BlogWriteFeedback status={write.status} working={working} onCheckServer={() => void checkSave()} onReloadLatest={() => void reloadLatest()} />
          <DialogActions>
            <ActionButton variant="outline" onClick={close} disabled={working} testId="pins-close">Đóng</ActionButton>
            {canEdit && <ActionButton onClick={() => void doSave()} disabled={working || !dirty || write.status.phase === "unverified" || conflict !== null} testId="pins-save">Lưu danh sách ghim</ActionButton>}
          </DialogActions>
        </div>
      )}
    </DialogShell>
  );
}
