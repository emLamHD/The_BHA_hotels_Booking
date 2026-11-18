"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { inviteNewsletterSubscription, listNewsletterSubscriptions, type NewsletterListScope, type NewsletterSubscription } from "@/lib/api/website";
import { useWebsiteList, useWriteAction } from "./useWebsiteData";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, TABLE_CLASSES, TextField, formatWhen } from "./WebsiteUi";
import {
  AddSubscriptionDialog,
  ConfirmSubscriptionDialog,
  EditSubscriptionDialog,
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
 * BHA-NEWSLETTER-001/003: the Staff list of newsletter subscriptions and what Staff do to them. Newest first; the search, the status and scope filters and the paging are
 * the server's (the page never filters or sorts what it was given). Every change carries the version of the row it was opened on, is sent once, and is followed by a
 * read of the same query (the typed search and the page stay), so a row leaves or changes only because the server says so.
 */
export default function NewsletterSubscriptionsPanel() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<NewsletterListScope>("active");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const invite = useWriteAction();
  const list = useWebsiteList((signal) => listNewsletterSubscriptions({ search: applied, status, scope, page, pageSize: PAGE_SIZE }, signal), [applied, status, scope, page]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setApplied(search.trim());
  };
  const clear = () => {
    setSearch("");
    setPage(1);
    setApplied("");
  };
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
    void list.reload();
  };
  const openExisting = (email: string, archived: boolean) => {
    setDialog(null);
    setNotice(null);
    setSearch(email);
    setApplied(email);
    setStatus("");
    setScope(archived ? "all" : "active");
    setPage(1);
  };

  const sendInvite = async (row: NewsletterSubscription) => {
    setNotice(null);
    const result = await invite.run(() => inviteNewsletterSubscription(row.id));
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
  const filtered = applied !== "" || status !== "" || scope !== "active";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Đăng ký nhận tin">
        Email khách để lại ở khung &ldquo;Nhận ưu đãi từ The BHA&rdquo; trên trang chủ và email Staff thêm tay. Khi Gmail đã kết nối, khách nhận email xác nhận, dòng chuyển sang &ldquo;Đã xác minh&rdquo; sau khi họ bấm xác nhận và họ nhận thêm một email chào mừng có liên kết hủy nhận tin.{" "}
        <Link href="/website/newsletter/sender" className="text-brand-600 underline dark:text-brand-400">Cấu hình email gửi</Link>
      </PageHeader>
      {notice && <Banner tone="success" testId="newsletter-notice" onDismiss={() => setNotice(null)}>{notice}</Banner>}
      <WriteOutcome status={invite.status} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-sm">
            <TextField label="Tìm theo email" value={search} onChange={setSearch} maxLength={254} placeholder="ten@example.com" testId="newsletter-search" />
          </div>
          <ActionButton type="submit" testId="newsletter-search-submit">Tìm</ActionButton>
          {applied && <ActionButton variant="outline" onClick={clear}>Xoá tìm kiếm</ActionButton>}
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
            Trạng thái
            <select data-testid="newsletter-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={SELECT_CLASSES}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200">
            Hiển thị
            <select data-testid="newsletter-scope-filter" value={scope} onChange={(event) => { setScope(event.target.value as NewsletterListScope); setPage(1); }} className={SELECT_CLASSES}>
              {SCOPE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </form>
        <ActionButton size="md" onClick={() => { setNotice(null); setDialog({ kind: "add" }); }} testId="newsletter-add">Thêm đăng ký</ActionButton>
      </div>
      {list.state.status === "loading" && <LoadingPanel what="danh sách đăng ký nhận tin" />}
      {list.state.status === "error" && <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />}
      {settled && data.items.length === 0 && data.total > 0 && (
        <div data-testid="newsletter-out-of-range" className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
          <span>Trang này không còn đăng ký nào, trong khi danh sách có {data.total} đăng ký.</span>
          <ActionButton variant="outline" testId="newsletter-back-to-first" onClick={() => setPage(1)}>Về trang 1</ActionButton>
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
                        <ActionButton variant="outline" testId={`newsletter-edit-${item.email}`} onClick={() => { setNotice(null); setDialog({ kind: "edit", row: item }); }}>Sửa</ActionButton>
                        {canInvite(item) && (
                          <ActionButton variant="outline" testId={`newsletter-invite-${item.email}`} disabled={invite.status.phase === "pending"} onClick={() => void sendInvite(item)}>Gửi lời mời xác minh</ActionButton>
                        )}
                        {item.status !== "Unsubscribed" && (
                          <ActionButton variant="outline" testId={`newsletter-unsubscribe-${item.email}`} onClick={() => { setNotice(null); setDialog({ kind: "confirm", action: "unsubscribe", row: item }); }}>Ngừng nhận</ActionButton>
                        )}
                        <ActionButton variant="outline" testId={`newsletter-${item.archivedAtUtc ? "restore" : "archive"}-${item.email}`} onClick={() => { setNotice(null); setDialog({ kind: "confirm", action: item.archivedAtUtc ? "restore" : "archive", row: item }); }}>
                          {item.archivedAtUtc ? "Khôi phục" : "Lưu trữ"}
                        </ActionButton>
                        <ActionButton variant="outline" testId={`newsletter-delete-${item.email}`} onClick={() => { setNotice(null); setDialog({ kind: "confirm", action: "delete", row: item }); }}>Xóa</ActionButton>
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
              <ActionButton variant="outline" onClick={() => setPage(page - 1)} disabled={list.pending || page <= 1}>Trang trước</ActionButton>
              <ActionButton variant="outline" onClick={() => setPage(page + 1)} disabled={list.pending || page >= pages}>Trang sau</ActionButton>
            </span>
          </nav>
        </>
      )}
      {dialog?.kind === "add" && (
        <AddSubscriptionDialog onClose={() => setDialog(null)} onOpenExisting={openExisting} onDone={(row) => done(`Đã thêm ${row.email} ở trạng thái “Chờ xác minh”. Chưa có thư nào được gửi: dùng “Gửi lời mời xác minh” để mời họ xác nhận.`)} />
      )}
      {dialog?.kind === "edit" && (
        <EditSubscriptionDialog key={dialog.row.id} row={dialog.row} onClose={() => setDialog(null)} onReload={() => void list.reload()} onDone={(row) => done(`Đã lưu thay đổi cho ${row.email}.`)} />
      )}
      {dialog?.kind === "confirm" && (
        <ConfirmSubscriptionDialog
          key={`${dialog.action}-${dialog.row.id}`}
          action={dialog.action}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onReload={() => void list.reload()}
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
