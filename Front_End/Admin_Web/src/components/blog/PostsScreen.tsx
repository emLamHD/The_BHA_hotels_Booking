"use client";

/**
 * BHA-BLOG-001-CP03: the list of posts — search, filter by category / status / language, server pages, a thumbnail, and the state of each language. A change of
 * filter goes back to page 1; an answer for an older filter or page is dropped (`useWebsiteList` generation). The total can shrink under the person (another editor
 * unpublishes, archives): the server then answers the page they are on - past the last one - with no items and the real total. That is not "no matching posts": the last
 * page that exists is read instead (the same recovery as `MediaBrowser`), with the filter, the search and the language kept.
 */

import React, { useState } from "react";
import Link from "next/link";
import { listCategories, listPosts, mediaPreviewPath, type BlogPostRow } from "@/lib/api/blog";
import { useWebsiteList } from "@/components/website/useWebsiteData";
import { ErrorPanel, LoadingPanel, PageHeader, TABLE_CLASSES, formatWhen } from "@/components/website/WebsiteUi";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/blog/blogModel";
import { StaffImage } from "./useStaffImage";
import { useBlogRights } from "./BlogAccessGate";
import { useActiveLanguages } from "./useBlogReference";

const PAGE_SIZE = 20;
const TONE: Record<string, string> = {
  success: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300", warning: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
  error: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-300", info: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
};
const SELECT = "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function PostsScreen() {
  const rights = useBlogRights();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [locale, setLocale] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const languages = useActiveLanguages();
  const categories = useWebsiteList((signal) => listCategories(signal), []);
  const list = useWebsiteList((signal) => listPosts({ q: q || undefined, status: status || undefined, locale: locale || undefined, categoryId: categoryId || undefined, page, pageSize: PAGE_SIZE }, signal), [q, status, locale, categoryId, page]);

  const filter = (change: () => void) => { change(); setPage(1); };
  const pages = list.state.status === "ready" ? Math.max(1, Math.ceil(list.state.data.total / PAGE_SIZE)) : 1;
  // Only an answer FOR the page that is shown is obeyed (while another page loads, the previous answer is still in `state`), and the corrected page is within range, so
  // this cannot repeat; a second shrink answers the corrected page the same way and goes one step further down.
  const outOfRange = list.state.status === "ready" && list.state.data.page > pages;
  if (list.state.status === "ready" && list.state.data.page === page && page > pages) setPage(pages); // adjusted while rendering (React's pattern for state derived from a response)
  const codes = languages.status === "ready" ? languages.data.map((l) => l.code) : [];

  const shownTranslation = (row: BlogPostRow) => row.translations.find((t) => t.locale === (locale || codes[0])) ?? row.translations[0];
  // A translation with no draft and no published revision has no text at all (the server lists it that way); a real draft or published one always has a title.
  const hasNoContent = (row: BlogPostRow) => { const t = shownTranslation(row); return !!t && t.title === "" && !t.hasDraft; };
  const titleOf = (row: BlogPostRow) => (hasNoContent(row) ? "Chưa có nội dung" : row.translations.find((t) => t.locale === (locale || codes[0]))?.title || row.translations[0]?.title || "(chưa có tiêu đề)");
  const coverOf = (row: BlogPostRow) => (row.translations.find((t) => t.locale === (locale || codes[0])) ?? row.translations[0])?.coverMediaId ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Bài viết Blog">Mỗi bài có thể có nhiều bản dịch; trạng thái xuất bản tính riêng cho từng ngôn ngữ.</PageHeader>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-3" role="search" onSubmit={(e) => { e.preventDefault(); filter(() => setQ(typed.trim())); }}>
          <label className="text-sm text-gray-700 dark:text-gray-200">Tìm bài
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Tiêu đề hoặc slug" aria-label="Tìm bài" data-testid="posts-search" className="ml-2 h-10 w-56 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90" />
          </label>
          <select aria-label="Lọc theo trạng thái" value={status} onChange={(e) => filter(() => setStatus(e.target.value))} className={SELECT} data-testid="posts-status">
            <option value="">Mọi trạng thái</option>
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select aria-label="Lọc theo ngôn ngữ" value={locale} onChange={(e) => filter(() => setLocale(e.target.value))} className={SELECT} data-testid="posts-locale">
            <option value="">Mọi ngôn ngữ</option>
            {codes.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <select aria-label="Lọc theo chuyên mục" value={categoryId} onChange={(e) => filter(() => setCategoryId(e.target.value))} className={SELECT} data-testid="posts-category">
            <option value="">Mọi chuyên mục</option>
            {categories.state.status === "ready" && categories.state.data.map((c) => <option key={c.id} value={c.id}>{c.translations.vi?.name ?? Object.values(c.translations)[0]?.name ?? c.id}</option>)}
          </select>
          <button type="submit" className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">Tìm</button>
        </form>
        {rights.edit && <Link href="/website/blog/posts/new" className="inline-flex h-10 items-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600" data-testid="post-new">Viết bài mới</Link>}
      </div>

      {(list.state.status === "loading" || outOfRange) && <LoadingPanel what="bài viết" />}
      {list.state.status === "error" && <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />}
      {list.state.status === "ready" && !outOfRange && (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="posts-total">{list.state.data.total} bài.</p>
          {list.state.data.items.length === 0 ? <p className="rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800" data-testid="posts-empty">Chưa có bài nào khớp.</p> : (
            <div className={TABLE_CLASSES.wrap}>
              <table className={TABLE_CLASSES.table} data-testid="posts-table">
                <thead className={TABLE_CLASSES.head}><tr><th className={TABLE_CLASSES.headCell}>Bài</th><th className={TABLE_CLASSES.headCell}>Ngôn ngữ</th><th className={TABLE_CLASSES.headCell}>Cập nhật</th></tr></thead>
                <tbody>
                  {list.state.data.items.map((row) => (
                    <tr key={row.id} className={TABLE_CLASSES.row} data-testid="post-row">
                      <td className={TABLE_CLASSES.cell}>
                        <Link href={`/website/blog/posts/${row.id}`} className="flex items-center gap-3 hover:underline">
                          <StaffImage path={coverOf(row) ? mediaPreviewPath(coverOf(row)!, "thumb") : null} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" testId="post-thumb" />
                          <span className="font-medium text-gray-800 dark:text-white/90">{titleOf(row)}</span>
                        </Link>
                      </td>
                      <td className={TABLE_CLASSES.cell}>
                        <div className="flex flex-wrap gap-1.5">
                          {row.translations.map((t) => (
                            <Link key={t.locale} href={`/website/blog/posts/${row.id}?locale=${encodeURIComponent(t.locale)}`} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[STATUS_TONE[t.status]]}`} title={`${t.title} — /${t.slug}`} data-testid="post-lang">
                              {t.locale.toUpperCase()}: {STATUS_LABEL[t.status]}{t.hasDraft && t.status === "Published" ? " · có thay đổi chưa đăng" : ""}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td className={`${TABLE_CLASSES.cell} whitespace-nowrap`}>{formatWhen(row.updatedAtUtc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-between" aria-label="Phân trang bài viết">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">Trang trước</button>
              <span className="text-sm text-gray-600 dark:text-gray-300">Trang {page} / {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">Trang sau</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
