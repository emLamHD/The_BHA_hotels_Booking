"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { inviteNewsletterSubscription, listNewsletterSubscriptions, type NewsletterListScope, type NewsletterSubscription, type WebsiteResult } from "@/lib/api/website";
import { useStaffSession } from "@/components/auth/StaffSession";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import { useNewsletterLive } from "./useNewsletterLive";
import { LiveBanner, LiveStatusLine, LiveToast, type LiveBannerKind } from "./NewsletterLiveNotice";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TABLE_CLASSES, TextField, formatWhen } from "./WebsiteUi";
import {
  AddSubscriptionDialog,
  ConfirmSubscriptionDialog,
  EditSubscriptionDialog,
  VERSION_CONFLICT,
  WriteOutcome,
  type ConfirmAction,
} from "./NewsletterSubscriptionDialogs";
import { LANGUAGE_LABEL, MAIL_LABEL, SCOPE_FILTERS, SOURCE_LABEL, STATUS_FILTERS, STATUS_LABEL, canInvite } from "./newsletterSubscriptionWording";

const PAGE_SIZE = 20;

const STATUS_TONE: Record<string, string> = {
  PendingVerification: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  Verified: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500",
  Unsubscribed: "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300",
};

const SELECT_CLASSES =
  "h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; row: NewsletterSubscription }
  | { kind: "confirm"; action: ConfirmAction; row: NewsletterSubscription };

/**
 * BHA-NEWSLETTER-001/003: the Staff list of newsletter subscriptions and what Staff do to them. Newest sign-up or verification first (`sort=recent-activity`); the search, the
 * status and scope filters and the paging are the server's (the page never filters or sorts what it was given). Every change carries the version of the row it was opened on, is sent once, and is followed by a
 * read of the same query (the typed search and the page stay), so a row leaves or changes only because the server says so.
 *
 * BHA-NEWSLETTER-LIVE-001: a signal that someone just verified is only a prompt to read again; it never edits the list. It is applied only when the screen is quiet (no dialog,
 * no write, no recovery read, no hold, no stale row), on page 1, with the typed search and the filters unchanged and the server deciding which rows match. On page 2 or later,
 * or while something is in progress, nothing under Staff's hands moves: they are told, and the way to the new rows stays on screen. It never releases a hold, clears a stale
 * row, closes a dialog or sends a change.
 */
export default function NewsletterSubscriptionsPanel() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<NewsletterListScope>("active");
  const [page, setPageState] = useState(1);
  const [dialog, setDialogState] = useState<Dialog | null>(null);
  // The page and the dialog are also read from outside React (the live connection's callbacks, a timer): the mirrors change in the same breath as the state, before the next render.
  const pageRef = useRef(1);
  const dialogRef = useRef<Dialog | null>(null);
  const goToPage = (next: number) => {
    pageRef.current = next;
    setPageState(next);
  };
  const showDialog = (next: Dialog | null) => {
    dialogRef.current = next;
    setDialogState(next);
  };
  const [notice, setNotice] = useState<string | null>(null);
  // ONE write slot for the whole screen (every dialog and the invitation), with the hold: after a write whose outcome is unknown nothing more is sent until the list
  // has been read again successfully. It lives here, not in a dialog, so closing and reopening a dialog cannot lift it.
  const hookWrite = useWriteAction({ holdWhenUnverified: true });
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  // The rows a version conflict said are stale: each one's dialog (or, once that is closed, its buttons) stays locked until the list has been read again successfully.
  const [staleRowIds, setStaleRowIds] = useState<ReadonlySet<string>>(new Set());
  // Held and stale are read by recovery through refs, set where the state changes and again at render: a recovery run from an earlier render, or before React has rendered
  // the change, must still see them (a hold taken by a write that has just ended unknown, a row that has just conflicted).
  const heldRef = useRef(false);
  const staleRef = useRef<ReadonlySet<string>>(staleRowIds);
  const setStale = (next: ReadonlySet<string>) => {
    staleRef.current = next;
    setStaleRowIds(next);
  };
  const markStale = (id: string) => setStale(new Set(staleRef.current).add(id));
  // A recovery read and a write never overlap. The two refs are the guard (they change synchronously, before any await and before the next render, so a callback taken from
  // an earlier render, Enter, a direct submit or a second call in the same tick all meet them); the disabled buttons are only the picture of it. Every write of this screen goes
  // through `write.run` below. Held and stale are read through refs too, for the same reason: a callback from an earlier render must not clear what a later one set.
  const readingRef = useRef(false);
  const writingRef = useRef(false);
  const baseRun = hookWrite.run;
  const run = useCallback(
    async <T,>(send: () => Promise<WebsiteResult<T>>): Promise<WebsiteResult<T> | null> => {
      if (readingRef.current || writingRef.current) return null;
      writingRef.current = true;
      try {
        const result = await baseRun(send);
        if (result?.kind === "unverified") heldRef.current = true;                         // the hook took its hold already; this is the mirror, before any render
        return result;
      } finally {
        writingRef.current = false;                                                        // after the hook has taken a hold, never before
      }
    },
    [baseRun],
  );
  const write = { ...hookWrite, run };
  heldRef.current = hookWrite.held;
  staleRef.current = staleRowIds;
  pageRef.current = page;
  dialogRef.current = dialog;
  const list = useWebsiteList((signal) => listNewsletterSubscriptions({ search: applied, status, scope, page, pageSize: PAGE_SIZE, sort: "recent-activity" }, signal), [applied, status, scope, page]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    goToPage(1);
    setApplied(search.trim());
  };
  const clear = () => {
    setSearch("");
    goToPage(1);
    setApplied("");
  };
  const openDialog = (next: Dialog) => {
    if (readingRef.current || write.held || (next.kind !== "add" && staleRowIds.has(next.row.id))) return;
    write.reset();
    setNotice(null);
    showDialog(next);
  };
  const closeDialog = () => {
    write.reset();
    showDialog(null);
  };
  const done = (message: string) => {
    showDialog(null);
    setNotice(message);
    void list.reload();
  };
  /**
   * The only way out of a hold (a write whose outcome is unknown) and of a stale row (a version conflict): read the screen's own query again. A read that fails, or that a
   * newer read replaced, changes nothing. A success closes the dialog (it holds the row as it was when it opened: it is opened again from the fresh list, so it carries the
   * version the server has) and says what Staff should do, without concluding anything about a row that is no longer in this filter. Nothing is sent again by itself.
   * It does not start while a write is on the wire, and no write starts while it is out (C4): a hold taken by a write that began after the read did could not be told apart
   * from the one this read is about to clear. What the notice says follows the state the read clears, not the button pressed; and only the rows that were stale when the read started are freed (one that went stale
   * while it was in flight may have been served before that change).
   */
  const readAgain = async () => {
    if (readingRef.current || writingRef.current) return;
    const wasHeld = heldRef.current;
    const cleared = new Set(staleRef.current);
    readingRef.current = true;
    setReading(true);
    setReadFailed(false);
    let data: Awaited<ReturnType<typeof list.reload>> = null;
    try {
      data = await list.reload();
    } catch {
      data = null;                                                                          // a read that throws is a read that failed
    } finally {
      readingRef.current = false;                                                           // never left set: no lock for good
      setReading(false);
    }
    if (data === null) {
      setReadFailed(true);
      return;
    }
    write.release();
    heldRef.current = false;
    setStale(new Set([...staleRef.current].filter((id) => !cleared.has(id))));
    showDialog(null);
    const where = "Nếu dòng không còn hiện ở bộ lọc này, nó có thể đã đổi trạng thái hoặc bị xóa; chọn “Tất cả” ở bộ lọc Hiển thị để chắc chắn.";
    const unknown = "Thao tác trước đó chưa rõ kết quả: hãy kiểm tra dòng liên quan.";
    const conflict = "Có bản ghi vừa được người khác hoặc chính khách thay đổi: hãy mở lại bản ghi từ danh sách vừa cập nhật rồi thao tác tiếp; chưa có gì được gửi lại.";
    setNotice(`Đã đọc lại danh sách từ máy chủ với bộ lọc hiện tại. ${[wasHeld || cleared.size === 0 ? unknown : "", cleared.size > 0 ? conflict : ""].filter(Boolean).join(" ")} ${where}`);
  };
  const reconcileProps = { run: () => void readAgain(), reading, failed: readFailed };
  const openExisting = (email: string, archived: boolean) => {
    closeDialog();
    setNotice(null);
    setSearch(email);
    setApplied(email);
    setStatus("");
    setScope(archived ? "all" : "active");
    goToPage(1);
  };

  const sendInvite = async (row: NewsletterSubscription) => {
    if (staleRef.current.has(row.id)) return;                                              // a callback from before the conflict: this snapshot is known to be stale
    setNotice(null);
    // The invitation goes to the address THIS row shows: it carries this row's version. A conflict means the row (its address included) changed; nothing is retried and
    // nothing says Staff invited anyone, the row is stale like any other (read again, then invite from the fresh row).
    const result = await write.run(() => inviteNewsletterSubscription(row.id, row.version));
    if (result?.kind === "refused" && result.code === VERSION_CONFLICT) {
      markStale(row.id);
      return;
    }

    if (result?.kind !== "ok") return;
    const { status: outcome, retryAfterSeconds } = result.data;
    setNotice(
      outcome === "queued"
        ? `Đã xếp lời mời xác minh cho ${row.email}. Thư được gửi trong ít phút; cột “Thư xác nhận” sẽ đổi sang “Đã gửi”.`
        : outcome === "cooldown"
          ? `Vừa có thư gửi cho ${row.email}. Hãy thử lại sau khoảng ${retryAfterSeconds ?? 0} giây.`
          : `Chưa kết nối Gmail nên chưa gửi được thư cho ${row.email}. Địa chỉ vẫn ở “Chờ xác minh”.`,
    );
    void list.reload();
  };

  const data = list.state.status === "ready" ? list.state.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // While a query is on its way the hook still holds the previous answer: it stays on screen, but it says nothing about
  // the current query, so the paging is locked and no "no match" is claimed until the answer to this query has arrived.
  const settled = data !== null && !list.pending;
  const writePending = write.status.phase === "pending";
  const locked = write.held || writePending || reading;
  const filtered = applied !== "" || status !== "" || scope !== "active";

  // ---- BHA-NEWSLETTER-LIVE-001
  // `dirty` is what the server may know and this screen does not: verifications it was told about, and "the connection was (re)established, so something may have been missed".
  const liveDirtyRef = useRef({ news: 0, sync: false });
  const liveReadingRef = useRef(false);
  const [behind, setBehind] = useState<"new" | "gap" | null>(null);
  const [deferred, setDeferred] = useState(false);
  const [toast, setToast] = useState<{ count: number; token: number } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  // Quiet = nothing under Staff's hands. Read from the refs, never from state, so a callback from an earlier render or a timer sees the truth of this instant.
  const liveSafe = () => dialogRef.current === null && !writingRef.current && !readingRef.current && !heldRef.current && staleRef.current.size === 0;
  const applyLive = () => {
    const dirty = liveDirtyRef.current;
    if (dirty.news === 0 && !dirty.sync) return;
    if (!liveSafe()) {
      setDeferred(true);                                                                      // kept: it is applied the moment the screen is quiet again
      return;
    }
    if (pageRef.current !== 1) {
      // Page 2 or later: the rows being read stay exactly as they are; Staff chooses to look.
      liveDirtyRef.current = { news: 0, sync: false };
      setDeferred(false);
      setBehind((previous) => (dirty.news > 0 ? "new" : (previous ?? "gap")));
      return;
    }
    if (liveReadingRef.current) return;                                                       // one live read at a time; its end applies whatever came meanwhile
    liveDirtyRef.current = { news: 0, sync: false };
    setDeferred(false);
    liveReadingRef.current = true;
    // The same query as on screen (the hook reads the current search, filters and page). A failed or replaced read changes nothing else here.
    void list.reload().catch(() => null).finally(() => {
      liveReadingRef.current = false;
      applyLiveRef.current();
    });
  };
  const applyLiveRef = useRef(applyLive);
  applyLiveRef.current = applyLive;
  const staffSession = useStaffSession().state;
  const live = useNewsletterLive(staffSession.status === "authenticated" ? staffSession.session.staffAccountId : "", {
    onReady: () => {
      liveDirtyRef.current = { ...liveDirtyRef.current, sync: true };
      applyLiveRef.current();
    },
    onNew: (count) => {
      liveDirtyRef.current = { ...liveDirtyRef.current, news: liveDirtyRef.current.news + count };
      setToast((previous) => ({ count: (previous?.count ?? 0) + count, token: (previous?.token ?? 0) + 1 }));
      applyLiveRef.current();
    },
  });
  // The moment the screen is quiet again (dialog closed, write ended, recovery done, hold or stale row lifted by Staff), a waiting update is applied.
  useEffect(() => {
    applyLiveRef.current();
  }, [dialog, locked, staleRowIds]);
  // Staff reaching page 1 by themselves reads it fresh: nothing is behind any more.
  useEffect(() => {
    if (page === 1) setBehind(null);
  }, [page]);
  const viewNew = () => {
    setBehind(null);
    if (pageRef.current === 1) void list.reload();
    else goToPage(1);                                                                          // keeps the search, the status and the scope; only the page changes
  };
  const bannerKind: LiveBannerKind | null = behind ?? (deferred ? "deferred" : null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Đăng ký nhận tin">
        Email khách để lại ở khung &ldquo;Nhận ưu đãi từ The BHA&rdquo; trên trang chủ và email Staff thêm tay. Khi Gmail đã kết nối, khách nhận email xác nhận, dòng chuyển sang &ldquo;Đã xác minh&rdquo; sau khi họ bấm xác nhận và họ nhận thêm một email chào mừng có liên kết hủy nhận tin.{" "}
        <Link href="/website/newsletter/sender" className="text-brand-600 underline dark:text-brand-400">Cấu hình email gửi</Link>
      </PageHeader>
      <LiveStatusLine status={live.status} stoppedFor={live.stoppedFor} onRetry={live.retry} />
      {bannerKind && <LiveBanner kind={bannerKind} onView={viewNew} disabled={list.pending || reading || writePending} />}
      {toast && <LiveToast count={toast.count} token={toast.token} onDismiss={dismissToast} onView={behind ? viewNew : null} />}
      {notice && <Banner tone="success" testId="newsletter-notice" onDismiss={() => setNotice(null)}>{notice}</Banner>}
      {dialog === null && <WriteOutcome status={write.status} reconcile={reconcileProps} />}
      {dialog === null && staleRowIds.size > 0 && (
        <Banner tone="warning" testId="newsletter-stale">
          <p>Có bản ghi đã thay đổi trên máy chủ nên bản đang hiển thị không còn dùng để thao tác được: các nút của dòng đó bị khóa và chưa có gì được gửi.</p>
          <p className="mt-2">
            <button type="button" onClick={reconcileProps.run} disabled={reading || writePending} className="font-medium underline disabled:opacity-50" data-testid="newsletter-stale-reload">
              {reading ? "Đang đọc lại…" : "Tải lại danh sách"}
            </button>
          </p>
          {readFailed && !reading && <p className="mt-1 font-medium" data-testid="newsletter-stale-failed">Chưa đọc lại được từ máy chủ: hãy thử lại.</p>}
        </Banner>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-sm">
            <TextField label="Tìm theo email" value={search} onChange={setSearch} maxLength={254} placeholder="ten@example.com" testId="newsletter-search" />
          </div>
          <ActionButton type="submit" testId="newsletter-search-submit">Tìm</ActionButton>
          {applied && <ActionButton variant="outline" onClick={clear}>Xoá tìm kiếm</ActionButton>}
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
            Trạng thái
            <select data-testid="newsletter-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); goToPage(1); }} className={SELECT_CLASSES}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
            Hiển thị
            <select data-testid="newsletter-scope-filter" value={scope} onChange={(event) => { setScope(event.target.value as NewsletterListScope); goToPage(1); }} className={SELECT_CLASSES}>
              {SCOPE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </form>
        <ActionButton size="md" disabled={locked} onClick={() => openDialog({ kind: "add" })} testId="newsletter-add">Thêm đăng ký</ActionButton>
      </div>
      {list.state.status === "loading" && <LoadingPanel what="danh sách đăng ký nhận tin" />}
      {list.state.status === "error" && <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />}
      {settled && data.items.length === 0 && data.total > 0 && (
        <div data-testid="newsletter-out-of-range" className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
          <span>Trang này không còn đăng ký nào, trong khi danh sách có {data.total} đăng ký.</span>
          <ActionButton variant="outline" testId="newsletter-back-to-first" onClick={() => goToPage(1)}>Về trang 1</ActionButton>
        </div>
      )}
      {settled && data.items.length === 0 && data.total === 0 && (
        <div data-testid="newsletter-empty" className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
          {filtered ? "Không có đăng ký nào khớp với bộ lọc hoặc email đã tìm." : "Chưa có ai đăng ký nhận tin."}
        </div>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className={TABLE_CLASSES.wrap}>
            <table className={TABLE_CLASSES.table} data-testid="newsletter-table">
              <thead className={TABLE_CLASSES.head}>
                <tr>
                  <th className={TABLE_CLASSES.headCell}>Email</th>
                  <th className={TABLE_CLASSES.headCell}>Trạng thái</th>
                  <th className={TABLE_CLASSES.headCell}>Ngôn ngữ</th>
                  <th className={TABLE_CLASSES.headCell}>Nguồn</th>
                  <th className={TABLE_CLASSES.headCell}>Thư xác nhận</th>
                  <th className={TABLE_CLASSES.headCell}>Thời điểm tiếp nhận</th>
                  <th className={TABLE_CLASSES.headCell}>Xác minh lúc</th>
                  <th className={TABLE_CLASSES.headCell}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} data-testid={`newsletter-row-${item.email}`} className={TABLE_CLASSES.row}>
                    <td className={`${TABLE_CLASSES.cell} break-all`}>{item.email}</td>
                    <td className={TABLE_CLASSES.cell}>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[item.status] ?? STATUS_TONE.Unsubscribed}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
                      {item.archivedAtUtc && <span className="ml-1.5 inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/5 dark:text-gray-300">Đã lưu trữ</span>}
                    </td>
                    <td className={TABLE_CLASSES.cell}>{LANGUAGE_LABEL[item.language]}</td>
                    <td className={TABLE_CLASSES.cell}>{SOURCE_LABEL[item.source] ?? item.source}</td>
                    <td className={TABLE_CLASSES.cell}>{item.verificationMail ? MAIL_LABEL[item.verificationMail] : "—"}</td>
                    <td className={TABLE_CLASSES.cell}>{formatWhen(item.receivedAtUtc)}</td>
                    <td className={TABLE_CLASSES.cell}>{item.verifiedAtUtc ? formatWhen(item.verifiedAtUtc) : "—"}</td>
                    <td className={TABLE_CLASSES.cell}>
                      <div className="flex flex-wrap gap-1.5">
                        <ActionButton variant="outline" testId={`newsletter-edit-${item.email}`} disabled={locked || staleRowIds.has(item.id)} onClick={() => openDialog({ kind: "edit", row: item })}>Sửa</ActionButton>
                        {canInvite(item) && (
                          <ActionButton variant="outline" testId={`newsletter-invite-${item.email}`} disabled={locked || staleRowIds.has(item.id)} onClick={() => void sendInvite(item)}>Gửi lời mời xác minh</ActionButton>
                        )}
                        {item.status !== "Unsubscribed" && (
                          <ActionButton variant="outline" testId={`newsletter-unsubscribe-${item.email}`} disabled={locked || staleRowIds.has(item.id)} onClick={() => openDialog({ kind: "confirm", action: "unsubscribe", row: item })}>Ngừng nhận</ActionButton>
                        )}
                        <ActionButton variant="outline" testId={`newsletter-${item.archivedAtUtc ? "restore" : "archive"}-${item.email}`} disabled={locked || staleRowIds.has(item.id)} onClick={() => openDialog({ kind: "confirm", action: item.archivedAtUtc ? "restore" : "archive", row: item })}>
                          {item.archivedAtUtc ? "Khôi phục" : "Lưu trữ"}
                        </ActionButton>
                        <ActionButton variant="outline" testId={`newsletter-delete-${item.email}`} disabled={locked || staleRowIds.has(item.id)} onClick={() => openDialog({ kind: "confirm", action: "delete", row: item })}>Xóa</ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300">
            <span data-testid="newsletter-count">
              {data.total} đăng ký · trang {data.page}/{pages}
            </span>
            <span className="flex gap-2">
              <ActionButton variant="outline" onClick={() => goToPage(page - 1)} disabled={list.pending || page <= 1}>Trang trước</ActionButton>
              <ActionButton variant="outline" onClick={() => goToPage(page + 1)} disabled={list.pending || page >= pages}>Trang sau</ActionButton>
            </span>
          </nav>
        </>
      )}
      {dialog?.kind === "add" && (
        <AddSubscriptionDialog write={write} reconcile={reconcileProps} onClose={closeDialog} onOpenExisting={openExisting} onDone={(row) => done(`Đã thêm ${row.email} ở trạng thái “Chờ xác minh”. Chưa có thư nào được gửi: dùng “Gửi lời mời xác minh” để mời họ xác nhận.`)} />
      )}
      {dialog?.kind === "edit" && (
        <EditSubscriptionDialog key={dialog.row.id} row={dialog.row} write={write} reconcile={reconcileProps} reload={reconcileProps} stale={staleRowIds.has(dialog.row.id)} onStale={() => markStale(dialog.row.id)} onClose={closeDialog} onDone={(row) => done(`Đã lưu thay đổi cho ${row.email}.`)} />
      )}
      {dialog?.kind === "confirm" && (
        <ConfirmSubscriptionDialog
          key={`${dialog.action}-${dialog.row.id}`}
          action={dialog.action}
          row={dialog.row}
          write={write}
          reconcile={reconcileProps}
          reload={reconcileProps}
          stale={staleRowIds.has(dialog.row.id)}
          onStale={() => markStale(dialog.row.id)}
          onClose={closeDialog}
          onDone={() => done(CONFIRM_DONE[dialog.action](dialog.row.email))}
        />
      )}
    </div>
  );
}

const CONFIRM_DONE: Record<ConfirmAction, (email: string) => string> = {
  unsubscribe: (email) => `Đã ngừng gửi cho ${email}.`,
  archive: (email) => `Đã lưu trữ ${email}. Chọn “Đã lưu trữ” ở bộ lọc Hiển thị để xem lại.`,
  restore: (email) => `Đã khôi phục ${email}.`,
  delete: (email) => `Đã xóa vĩnh viễn ${email}.`,
};
