"use client";

/**
 * BHA-BLOG-001-CP03: categories — create, rename per language, change the order, delete — and the pinned posts of each. Structure is BlogPublish; everyone with
 * Blog access can read. A category's languages are never synchronised behind the person's back: each language is its own text, and a language left blank is
 * simply not sent. A category still referenced (by any revision, a pin or the home section) cannot be deleted, and the screen says what refers to it.
 */

import React, { useState } from "react";
import { createCategory, deleteCategory, listCategories, saveCategory, type BlogCategory, type CategoryTexts } from "@/lib/api/blog";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { ActionButton, DialogActions, DialogShell, ErrorPanel, LoadingPanel, PageHeader, TABLE_CLASSES, TextAreaField, TextField, Banner } from "@/components/website/WebsiteUi";
import { checkSlugShape, describeBlogFailure } from "@/lib/blog/blogModel";
import BlogWriteFeedback from "./BlogWriteFeedback";
import { useBlogRights } from "./BlogAccessGate";
import { useActiveLanguages } from "./useBlogReference";
import PinsDialog from "./PinsDialog";

interface Draft {
  id: string | null;
  isNew: boolean;
  version: number;
  sortOrder: string;
  texts: Record<string, { name: string; slug: string; description: string }>;
}

const blankTexts = (codes: string[], from?: BlogCategory) =>
  Object.fromEntries(codes.map((code) => [code, { name: from?.translations[code]?.name ?? "", slug: from?.translations[code]?.slug ?? "", description: from?.translations[code]?.description ?? "" }]));

export default function CategoriesScreen() {
  const rights = useBlogRights();
  const list = useWebsiteList((signal) => listCategories(signal), []);
  const languages = useActiveLanguages();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pinsFor, setPinsFor] = useState<BlogCategory | null>(null);
  const [deleting, setDeleting] = useState<BlogCategory | null>(null);
  const save = useWriteAction();
  const remove = useWriteAction();
  const [note, setNote] = useState<string | null>(null);

  if (list.state.status === "loading" || languages.status === "loading") return <LoadingPanel what="chuyên mục" />;
  if (list.state.status === "error") return <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />;
  if (languages.status === "error") return <ErrorPanel message={languages.message} onRetry={() => window.location.reload()} />;
  const codes = languages.data.map((l) => l.code);
  const categories = list.state.data;
  const working = save.status.phase === "pending" || remove.status.phase === "pending";
  const nameIn = (c: BlogCategory, code: string) => c.translations[code]?.name;

  const open = (category?: BlogCategory) => {
    save.reset();
    setNote(null);
    setDraft(category
      ? { id: category.id, isNew: false, version: category.version, sortOrder: String(category.sortOrder), texts: blankTexts([...new Set([...codes, ...Object.keys(category.translations)])], category) }
      : { id: crypto.randomUUID(), isNew: true, version: 0, sortOrder: String((categories.reduce((max, c) => Math.max(max, c.sortOrder), 0)) + 10), texts: blankTexts(codes) });
  };

  const textsToSend = (d: Draft): CategoryTexts => {
    const out: CategoryTexts = {};
    for (const [code, t] of Object.entries(d.texts)) {
      if (t.name.trim() === "" && t.slug.trim() === "" && t.description.trim() === "") continue;
      out[code] = { name: t.name, slug: t.slug, description: t.description.trim() === "" ? null : t.description };
    }
    return out;
  };

  const problems = (d: Draft): string[] => {
    const out: string[] = [];
    const sent = textsToSend(d);
    if (Object.keys(sent).length === 0) out.push("Cần nhập tên và slug cho ít nhất một ngôn ngữ.");
    for (const [code, t] of Object.entries(sent)) {
      if (t.name.trim() === "") out.push(`[${code}] Thiếu tên.`);
      if (t.slug.trim() === "") out.push(`[${code}] Thiếu slug.`);
      const shape = checkSlugShape(t.slug);
      if (shape) out.push(`[${code}] ${shape}`);
    }
    if (!/^-?\d{1,9}$/.test(d.sortOrder.trim())) out.push("Thứ tự là một số nguyên.");
    return out;
  };

  const doSave = async () => {
    if (!draft || problems(draft).length) return;
    const texts = textsToSend(draft);
    const order = Number(draft.sortOrder);
    const result = await save.run(() => (draft.isNew ? createCategory(draft.id!, order, texts) : saveCategory(draft.id!, draft.version, order, texts)));
    if (result?.kind === "ok") {
      setDraft(null);
      void list.reload();
    }
  };

  const checkCreate = async () => {
    // The answer to the create was lost: the category may exist under the id this form already chose. Read, do not send.
    const latest = await list.reload();
    const found = latest?.find((c) => c.id === draft?.id);
    if (found && draft) {
      save.reset();
      setDraft(null);
      setNote("Máy chủ đã có chuyên mục này (cùng mã); không tạo thêm bản nào.");
    } else {
      setNote("Máy chủ chưa có chuyên mục này. Bấm Lưu để gửi lại với cùng mã — sẽ không tạo trùng.");
      save.reset();
    }
  };

  const reloadLatest = async () => {
    const latest = await list.reload();
    const fresh = latest?.find((c) => c.id === draft?.id);
    if (fresh && draft) {
      // Keep what was typed; only the version moves on, and only because the person asked to compare and continue.
      save.reset();
      setNote(`Chuyên mục đã được thay đổi trên máy chủ (phiên bản ${fresh.version}). Dữ liệu bạn nhập vẫn còn; đối chiếu bên dưới rồi bấm Lưu nếu vẫn muốn ghi đè.`);
      setDraft({ ...draft, version: fresh.version });
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    const result = await remove.run(() => deleteCategory(deleting.id, deleting.version));
    if (result?.kind === "ok") {
      setDeleting(null);
      void list.reload();
    } else {
      void list.reload();
    }
  };

  const whyNotDeletable = (c: BlogCategory) =>
    [c.isHomeSection ? "đang là chuyên mục của mục trang chủ" : null, c.revisionCount > 0 ? `${c.revisionCount} bản bài viết (nháp, đang đăng hoặc lịch sử) đang dùng` : null, c.pinCount > 0 ? `${c.pinCount} bài đang được ghim` : null].filter(Boolean).join("; ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Chuyên mục Blog">Tên, slug và mô tả theo từng ngôn ngữ. Đổi slug giữ lại slug cũ để chuyển hướng. Ghim quyết định bài nào lên đầu trong một chuyên mục.</PageHeader>
      {!rights.publish && <Banner tone="info">Bạn chỉ xem được chuyên mục; thay đổi cần quyền xuất bản Blog.</Banner>}
      {note && <Banner tone="info" testId="categories-note" onDismiss={() => setNote(null)}>{note}</Banner>}
      <div className="flex justify-end">{rights.publish && <ActionButton onClick={() => open()} testId="category-new">Thêm chuyên mục</ActionButton>}</div>
      <div className={TABLE_CLASSES.wrap}>
        <table className={TABLE_CLASSES.table} data-testid="categories-table">
          <thead className={TABLE_CLASSES.head}><tr><th className={TABLE_CLASSES.headCell}>Chuyên mục</th><th className={TABLE_CLASSES.headCell}>Ngôn ngữ</th><th className={TABLE_CLASSES.headCell}>Đang dùng</th><th className={TABLE_CLASSES.headCell}><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className={TABLE_CLASSES.row} data-testid="category-row">
                <td className={TABLE_CLASSES.cell}>
                  <p className="font-medium text-gray-800 dark:text-white/90">{nameIn(c, "vi") ?? Object.values(c.translations)[0]?.name ?? "(chưa có tên)"}</p>
                  <p className="text-xs text-gray-500">thứ tự {c.sortOrder}{c.systemKey ? " · mặc định của hệ thống" : ""}{c.isHomeSection ? " · mục trang chủ" : ""}</p>
                </td>
                <td className={TABLE_CLASSES.cell}>{codes.map((code) => <span key={code} className={`mr-1 rounded px-1.5 py-0.5 text-xs ${c.translations[code] ? "bg-success-50 text-success-700 dark:bg-success-500/15" : "bg-gray-100 text-gray-500 dark:bg-white/10"}`} title={c.translations[code]?.name ?? "chưa có bản dịch"}>{code}{c.translations[code] ? "" : " —"}</span>)}</td>
                <td className={TABLE_CLASSES.cell}>{c.revisionCount} bản · {c.pinCount} ghim</td>
                <td className={`${TABLE_CLASSES.cell} whitespace-nowrap`}>
                  <div className="flex gap-2">
                    <ActionButton variant="outline" onClick={() => setPinsFor(c)} testId="category-pins">Ghim bài</ActionButton>
                    {rights.publish && <ActionButton variant="outline" onClick={() => open(c)} testId="category-edit">Sửa</ActionButton>}
                    {rights.publish && <span title={whyNotDeletable(c) ? `Chưa xoá được: ${whyNotDeletable(c)}.` : undefined}><ActionButton variant="outline" onClick={() => { remove.reset(); setDeleting(c); }} disabled={whyNotDeletable(c) !== ""} testId="category-delete">Xoá</ActionButton></span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <DialogShell title={draft.isNew ? "Thêm chuyên mục" : "Sửa chuyên mục"} onClose={() => setDraft(null)} busy={working} testId="category-dialog" wide>
          <div className="flex flex-col gap-4">
            <TextField label="Thứ tự hiển thị" value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: v })} inputMode="numeric" testId="category-order" />
            {Object.keys(draft.texts).map((code) => (
              <fieldset key={code} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-200">Ngôn ngữ {code}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label="Tên" value={draft.texts[code].name} maxLength={80} testId={`category-name-${code}`} onChange={(v) => setDraft({ ...draft, texts: { ...draft.texts, [code]: { ...draft.texts[code], name: v } } })} />
                  <TextField label="Slug" value={draft.texts[code].slug} maxLength={120} testId={`category-slug-${code}`} error={checkSlugShape(draft.texts[code].slug)} onChange={(v) => setDraft({ ...draft, texts: { ...draft.texts, [code]: { ...draft.texts[code], slug: v } } })} />
                </div>
                <div className="mt-3"><TextAreaField label="Mô tả" value={draft.texts[code].description} maxLength={300} rows={2} onChange={(v) => setDraft({ ...draft, texts: { ...draft.texts, [code]: { ...draft.texts[code], description: v } } })} /></div>
              </fieldset>
            ))}
            <p className="text-xs text-gray-500 dark:text-gray-400">Một ngôn ngữ để trống hoàn toàn thì không được gửi; ngôn ngữ đã có bản dịch không bị xoá khi sửa.</p>
            {problems(draft).length > 0 && <ul className="list-disc pl-5 text-xs text-error-500" role="alert">{problems(draft).map((p) => <li key={p}>{p}</li>)}</ul>}
            <BlogWriteFeedback status={save.status} working={working} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkCreate()} />
            <DialogActions>
              <ActionButton variant="outline" onClick={() => setDraft(null)} disabled={working} testId="category-cancel">Đóng</ActionButton>
              <ActionButton onClick={() => void doSave()} disabled={working || problems(draft).length > 0 || save.status.phase === "unverified"} testId="category-save">Lưu chuyên mục</ActionButton>
            </DialogActions>
          </div>
        </DialogShell>
      )}

      {deleting && (
        <DialogShell title="Xoá chuyên mục" onClose={() => setDeleting(null)} busy={working} testId="category-delete-dialog">
          <p className="text-sm text-gray-700 dark:text-gray-200">Xoá chuyên mục “{nameIn(deleting, "vi") ?? Object.values(deleting.translations)[0]?.name}”? Máy chủ chỉ xoá khi không bản bài viết, ghim hay mục trang chủ nào còn dùng nó.</p>
          {remove.status.phase === "refused" && <Banner tone="error" testId="category-delete-refused">{describeBlogFailure(remove.status.failure)}</Banner>}
          <BlogWriteFeedback status={remove.status.phase === "refused" ? { phase: "idle" } : remove.status} working={working} onCheckServer={() => void list.reload()} />
          <DialogActions>
            <ActionButton variant="outline" onClick={() => setDeleting(null)} disabled={working}>Không xoá</ActionButton>
            <ActionButton onClick={() => void doDelete()} disabled={working} testId="category-delete-confirm">Xoá chuyên mục</ActionButton>
          </DialogActions>
        </DialogShell>
      )}

      {pinsFor && <PinsDialog category={pinsFor} canEdit={rights.publish} languages={codes} onClose={() => { setPinsFor(null); void list.reload(); }} />}
    </div>
  );
}
