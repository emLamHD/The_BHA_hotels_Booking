"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { listNewsletterSubscriptions } from "@/lib/api/website";
import { useWebsiteList } from "./useWebsiteData";
import { ActionButton, ErrorPanel, LoadingPanel, PageHeader, TABLE_CLASSES, TextField, formatWhen } from "./WebsiteUi";

const PAGE_SIZE = 20;

/** BHA-NEWSLETTER-001/002: `PendingVerification` until the visitor confirms the address from the e-mail, then `Verified`. */
const STATUS_LABEL: Record<string, string> = { PendingVerification: "Chưa xác minh email", Verified: "Đã xác minh" };
const SOURCE_LABEL: Record<string, string> = { homepage: "Trang chủ" };

/**
 * BHA-NEWSLETTER-001: the Staff list of "get offers" requests. Read only: newest first, a case-insensitive search by e-mail
 * and paging, both decided by the server (the page never filters or sorts what it was given).
 */
export default function NewsletterSubscriptionsPanel() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const list = useWebsiteList((signal) => listNewsletterSubscriptions({ search: applied, page, pageSize: PAGE_SIZE }, signal), [applied, page]);

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

  const data = list.state.status === "ready" ? list.state.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // While a query is on its way the hook still holds the previous answer: it stays on screen, but it says nothing about
  // the current query, so the paging is locked and no "no match" is claimed until the answer to this query has arrived.
  const settled = data !== null && !list.pending;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Đăng ký nhận tin">
        Email khách để lại ở khung &ldquo;Nhận ưu đãi từ The BHA&rdquo; trên trang chủ, mới nhất trước. Khi Gmail đã kết nối, khách nhận email xác nhận và dòng chuyển sang &ldquo;Đã xác minh&rdquo; sau khi họ bấm xác nhận; chưa kết nối thì chỉ ghi nhận và giữ &ldquo;Chưa xác minh email&rdquo;.{" "}
        <Link href="/website/newsletter/sender" className="text-brand-600 underline dark:text-brand-400">Cấu hình email gửi</Link>
      </PageHeader>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-2">
        <div className="w-full max-w-sm">
          <TextField label="Tìm theo email" value={search} onChange={setSearch} maxLength={254} placeholder="ten@example.com" testId="newsletter-search" />
        </div>
        <ActionButton type="submit" testId="newsletter-search-submit">Tìm</ActionButton>
        {applied && <ActionButton variant="outline" onClick={clear}>Xoá tìm kiếm</ActionButton>}
      </form>
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
          {applied ? "Không có đăng ký nào khớp với email đã tìm." : "Chưa có ai đăng ký nhận tin."}
        </div>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className={TABLE_CLASSES.wrap}>
            <table className={TABLE_CLASSES.table} data-testid="newsletter-table">
              <thead className={TABLE_CLASSES.head}>
                <tr>
                  <th className={TABLE_CLASSES.headCell}>Email</th>
                  <th className={TABLE_CLASSES.headCell}>Thời điểm tiếp nhận</th>
                  <th className={TABLE_CLASSES.headCell}>Nguồn</th>
                  <th className={TABLE_CLASSES.headCell}>Trạng thái</th>
                  <th className={TABLE_CLASSES.headCell}>Xác minh lúc</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} data-testid={`newsletter-row-${item.email}`} className={TABLE_CLASSES.row}>
                    <td className={`${TABLE_CLASSES.cell} break-all`}>{item.email}</td>
                    <td className={TABLE_CLASSES.cell}>{formatWhen(item.receivedAtUtc)}</td>
                    <td className={TABLE_CLASSES.cell}>{SOURCE_LABEL[item.source] ?? item.source}</td>
                    <td className={TABLE_CLASSES.cell}>{STATUS_LABEL[item.status] ?? item.status}</td>
                    <td className={TABLE_CLASSES.cell}>{item.verifiedAtUtc ? formatWhen(item.verifiedAtUtc) : "—"}</td>
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
    </div>
  );
}
