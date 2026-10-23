"use client";

/**
 * BHA-BLOG-001-CP03: categories — create, rename per language, change the order, delete — and the pinned posts of each. Structure is BlogPublish; everyone with
 * Blog access can read. A category's languages are never synchronised behind the person's back: each language is its own text, and a language left blank is
 * simply not sent. A category still referenced (by any revision, a pin or the home section) cannot be deleted, and the screen says what refers to it.
 *
 * Writes (C2): what is sent is an immutable SNAPSHOT taken when Save is pressed, so a later edit, another dialog or a late answer cannot change what a check
 * judges. A lost answer is read back and judged against that snapshot - an update is never "saved" merely because the id exists - and only a verified outcome
 * closes the dialog. A stale version keeps the server's copy apart from the local form and shows both; the version moves on only when the person chooses.
 */

import React, { useEffect, useRef, useState } from "react";
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

/** What one Save sent. Never changes after it is taken. */
interface Snapshot {
  seq: number;
  id: string;
  isNew: boolean;
  expectedVersion: number;
  sortOrder: number;
  texts: CategoryTexts;
}

/**
 * The server's copy beside the local one, kept apart from the form until the person chooses. The local side is NOT stored here: it is the form as it is on screen
 * now (the comparison is rendered from the live draft), so what is compared, what is shown and what "keep mine" writes cannot differ.
 */
interface Conflict {
  kind: "update" | "create";
  fresh: BlogCategory;
  askUseServer: boolean;
}

const same = (a: { name: string; slug: string; description: string | null }, b: { name: string; slug: string; description: string | null } | undefined) =>
  !!b && a.name.trim() === b.name.trim() && a.slug.trim() === b.slug.trim() && (a.description ?? "").trim() === (b.description ?? "").trim();

/** Only the locales that were sent are compared (the server never removes the others), with the trims the server applies. */
const sentValuesMatch = (snap: Snapshot, fresh: BlogCategory) => fresh.sortOrder === snap.sortOrder && Object.entries(snap.texts).every(([code, text]) => same(text, fresh.translations[code]));

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
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const seqRef = useRef(0);
  /** Bumped by every operation that makes an older "load latest" answer stale (a newer one, a Save, opening or closing a dialog). */
  const opRef = useRef(0);
  /**
   * What each create of the open dialog sent whose answer never came (a lost answer may still have committed, and a read-back that finds nothing is not proof it
   * will not). A read-back that shows one of them is the create's result; a create the server refused is not in here. Emptied with the dialog.
   */
  const lostCreates = useRef<Snapshot[]>([]);
  /** The server answered a create of this dialog's id with 409 duplicate-id: the id exists, so "not found" can only mean "not readable yet". */
  const duplicateRef = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  });

  if (list.state.status === "loading" || languages.status === "loading") return <LoadingPanel what="chuyên mục" />;
  if (list.state.status === "error") return <ErrorPanel message={list.state.message} onRetry={() => void list.reload()} />;
  if (languages.status === "error") return <ErrorPanel message={languages.message} onRetry={() => window.location.reload()} />;
  const codes = languages.data.map((l) => l.code);
  const categories = list.state.data;
  const working = save.status.phase === "pending" || remove.status.phase === "pending";
  const nameIn = (c: BlogCategory, code: string) => c.translations[code]?.name;

  const open = (category?: BlogCategory) => {
    opRef.current++;
    save.reset();
    setNote(null);
    setConflict(null);
    snapshotRef.current = null;
    lostCreates.current = [];
    duplicateRef.current = false;
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

  const textsKey = (d: Draft) => JSON.stringify([Number(d.sortOrder), textsToSend(d)]);
  /** The dialog is still the one this request was made for (not closed, not another category, not another Save since). */
  const current = (snap: Snapshot) => draftRef.current?.id === snap.id && snapshotRef.current?.seq === snap.seq;

  const closeDialog = () => {
    opRef.current++;
    setDraft(null);
    setConflict(null);
    snapshotRef.current = null;
    lostCreates.current = [];
    duplicateRef.current = false;
  };

  const doSave = async () => {
    if (!draft || conflict || problems(draft).length) return;
    opRef.current++;
    const snap: Snapshot = { seq: ++seqRef.current, id: draft.id!, isNew: draft.isNew, expectedVersion: draft.version, sortOrder: Number(draft.sortOrder), texts: JSON.parse(JSON.stringify(textsToSend(draft))) };
    snapshotRef.current = snap;
    setNote(null);
    const result = await save.run(() => (snap.isNew ? createCategory(snap.id, snap.sortOrder, snap.texts) : saveCategory(snap.id, snap.expectedVersion, snap.sortOrder, snap.texts)));
    if (snap.isNew && current(snap)) {
      if (result?.kind === "unverified") lostCreates.current.push(snap);
      // 409 duplicate-id on a create: the id exists. That is not "refused, try again" (it would be refused for ever); the server is read, and what it shows decides.
      if (result?.kind === "refused" && result.code === "blog.duplicate-id") {
        duplicateRef.current = true;
        save.setStatus({ phase: "unverified", message: "Mã chuyên mục này đã có trên máy chủ: lần tạo trước có thể đã được ghi nhận. Chưa có gì được gửi thêm." });
      }
    }
    if (result?.kind === "ok") {
      void list.reload();
      if (!current(snap)) return;
      // The answer acknowledges what was SENT. Whatever was typed after the click is newer than the request: it stays (the dialog does not close), it is
      // written on the version this answer returned, and a category that was just created is from now on an update of itself (never a second create).
      const here = draftRef.current!;
      if (textsKey(here) === JSON.stringify([snap.sortOrder, snap.texts])) closeDialog();
      else {
        snapshotRef.current = null;
        setDraft({ ...here, isNew: false, version: result.data.version });
        setNote(`Đã lưu các giá trị đã gửi (phiên bản ${result.data.version}). Những chỉnh sửa bạn nhập sau khi bấm Lưu vẫn còn và chưa được lưu.`);
      }
    }
  };

  /**
   * The answer to a save was lost. Read the categories and judge what the server shows against the snapshot that was SENT: the id existing proves nothing for an
   * update. Nothing is sent from here and the version is never moved by guessing.
   */
  const checkSave = async () => {
    const snap = snapshotRef.current;
    if (!snap) return;
    const result = await listCategories();
    if (!current(snap)) return; // the dialog moved on while the server was being asked: this answer is not about what is on screen now
    if (result.kind !== "ok") {
      setNote("Chưa kiểm tra được máy chủ. Dữ liệu của bạn vẫn còn và thao tác vẫn là chưa xác nhận; hãy thử kiểm tra lại.");
      return;
    }

    void list.reload();
    const fresh = result.data.find((c) => c.id === snap.id);
    // An update is judged against what it sent. A create against what ANY of its unanswered sends carried (not a refused retry's, which was not applied).
    const confirmed = !fresh ? undefined : snap.isNew ? lostCreates.current.find((sent) => sentValuesMatch(sent, fresh)) : sentValuesMatch(snap, fresh) ? snap : undefined;
    const matches = !!confirmed;
    const here = draftRef.current!;
    if (!fresh) {
      if (snap.isNew && duplicateRef.current) {
        // The id was reported as taken, yet it is not in the list: keep the operation open instead of offering another create.
        setNote("Máy chủ báo mã này đã có nhưng chưa đọc thấy chuyên mục. Hãy kiểm tra lại sau; chưa có gì được gửi thêm.");
        return;
      }
      save.reset();
      setNote(snap.isNew ? "Máy chủ chưa có chuyên mục này (chưa chắc là sẽ không có: lần tạo trước vẫn có thể được ghi). Bấm Lưu để gửi lại với cùng mã — sẽ không tạo trùng; nếu máy chủ báo trùng mã, hãy kiểm tra máy chủ." : "Chuyên mục này không còn trên máy chủ. Dữ liệu của bạn vẫn còn trong biểu mẫu.");
      return;
    }

    if (confirmed && (snap.isNew || fresh.version > snap.expectedVersion)) {
      // Verified: the server holds exactly what was sent, at a version that moved on (a create has none to move from).
      save.reset();
      if (textsKey(here) === JSON.stringify([confirmed.sortOrder, confirmed.texts])) {
        closeDialog();
        setNote(`Đã xác nhận trên máy chủ: chuyên mục có đúng các giá trị đã gửi (phiên bản ${fresh.version}). Đây là kết quả đọc lại, không phải gửi lại.`);
      } else {
        // The person kept typing while the server was asked: what they sent is confirmed, and their newer edits are written on top of that version.
        setDraft({ ...here, isNew: false, version: fresh.version });
        setNote(`Máy chủ đã có đúng các giá trị đã gửi (phiên bản ${fresh.version}). Những chỉnh sửa mới hơn của bạn vẫn còn và chưa được lưu.`);
      }

      return;
    }

    if (matches) {
      save.reset();
      setNote(`Máy chủ đang có đúng các giá trị này nhưng phiên bản chưa đổi (${fresh.version}), nên chưa đủ bằng chứng rằng lần lưu này đã chạy; hệ thống không khẳng định gì thêm. Biểu mẫu vẫn còn nguyên.`);
      return;
    }

    if (!snap.isNew && fresh.version === snap.expectedVersion) {
      save.reset();
      setNote("Máy chủ chưa ghi nhận thay đổi này (chuyên mục vẫn như trước). Dữ liệu của bạn vẫn còn; bấm Lưu nếu muốn gửi lại.");
      return;
    }

    // The server holds something else (another editor, or a different category under this id): show both, decide nothing.
    save.reset();
    // After a duplicate-id the id is known to exist and is this dialog's own (a random id the dialog made), so the copy that differs is most likely this create
    // followed by someone else's edit: it is compared like any other update. Without that evidence (a lost answer, no duplicate) it may be another category.
    const asCreate = snap.isNew && !duplicateRef.current;
    setConflict({ kind: asCreate ? "create" : "update", fresh, askUseServer: false });
    setNote(asCreate ? "Mã này đã có một chuyên mục với giá trị khác. Dữ liệu của bạn được giữ; xem so sánh bên dưới." : `Chuyên mục đã đổi trên máy chủ (phiên bản ${fresh.version}). Dữ liệu của bạn được giữ; xem so sánh bên dưới.`);
  };

  /** After a stale version (409): read the server's copy and show it BESIDE the local one. The local version is not touched. */
  const reloadLatest = async () => {
    const start = draftRef.current;
    if (!start || !start.id) return;
    const token = ++opRef.current;
    const result = await listCategories();
    // Dropped when the dialog was closed or is another category now, or when a newer operation (another "load latest", a Save, a reopen) took over.
    if (draftRef.current?.id !== start.id || opRef.current !== token) return;
    if (result.kind !== "ok") {
      setNote("Chưa tải được bản mới nhất từ máy chủ. Dữ liệu của bạn vẫn còn; hãy thử lại.");
      return;
    }

    const fresh = result.data.find((c) => c.id === start.id);
    if (!fresh) {
      setNote("Chuyên mục này không còn trên máy chủ.");
      return;
    }

    void list.reload();
    save.reset();
    setConflict({ kind: "update", fresh, askUseServer: false });
    setNote(`Chuyên mục đã được thay đổi trên máy chủ (phiên bản ${fresh.version}). Xem so sánh bên dưới rồi chọn; chưa có gì được gửi.`);
  };

  const keepMine = () => {
    if (!conflict || !draftRef.current) return;
    // The ONLY place the version moves: the person has seen both copies and chose to write theirs on top of the server's version.
    // The category exists (that is what the conflict is about): from here Save updates it, never creates it again.
    setDraft({ ...draftRef.current, version: conflict.fresh.version, isNew: false });
    setConflict(null);
    setNote(`Giữ thay đổi của bạn trên phiên bản ${conflict.fresh.version}. Chưa có gì được gửi — bấm Lưu để ghi.`);
  };

  const useServerCopy = () => {
    if (!conflict) return;
    setDraft({ id: conflict.fresh.id, isNew: false, version: conflict.fresh.version, sortOrder: String(conflict.fresh.sortOrder), texts: blankTexts([...new Set([...codes, ...Object.keys(conflict.fresh.translations)])], conflict.fresh) });
    setConflict(null);
    setNote(`Đã thay biểu mẫu bằng bản trên máy chủ (phiên bản ${conflict.fresh.version}); thay đổi chưa lưu của bạn đã bị bỏ.`);
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
      {note && !draft && <Banner tone="info" testId="categories-note" onDismiss={() => setNote(null)}>{note}</Banner>}
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
        <DialogShell title={draft.isNew ? "Thêm chuyên mục" : "Sửa chuyên mục"} onClose={closeDialog} busy={working} testId="category-dialog" wide>
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
            {note && <Banner tone="info" testId="categories-note" onDismiss={() => setNote(null)}>{note}</Banner>}
            {conflict && <ConflictPanel conflict={conflict} local={draft} codes={codes} onKeep={keepMine} onAskUseServer={() => setConflict({ ...conflict, askUseServer: true })} onUseServer={useServerCopy} onCancelUseServer={() => setConflict({ ...conflict, askUseServer: false })} onClose={() => setConflict(null)} />}
            <BlogWriteFeedback status={save.status} working={working} onReloadLatest={() => void reloadLatest()} onCheckServer={() => void checkSave()} />
            <DialogActions>
              <ActionButton variant="outline" onClick={closeDialog} disabled={working} testId="category-cancel">Đóng</ActionButton>
              <ActionButton onClick={() => void doSave()} disabled={working || problems(draft).length > 0 || save.status.phase === "unverified" || conflict !== null} testId="category-save">Lưu chuyên mục</ActionButton>
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

/** The local form and the server's copy side by side. Nothing here sends anything. */
function ConflictPanel({ conflict, local, codes, onKeep, onAskUseServer, onUseServer, onCancelUseServer, onClose }: { conflict: Conflict; local: Draft; codes: string[]; onKeep: () => void; onAskUseServer: () => void; onUseServer: () => void; onCancelUseServer: () => void; onClose: () => void }) {
  const { fresh } = conflict;
  const locales = [...new Set([...codes, ...Object.keys(local.texts), ...Object.keys(fresh.translations)])].filter((code) => local.texts[code] && (local.texts[code].name || local.texts[code].slug || local.texts[code].description) || fresh.translations[code]);
  const cell = (value: string | null | undefined) => (value ? value : "—");
  const rows: [string, string, string][] = [["Thứ tự", local.sortOrder, String(fresh.sortOrder)]];
  for (const code of locales) {
    const mine = local.texts[code] ?? { name: "", slug: "", description: "" };
    const theirs = fresh.translations[code];
    rows.push([`[${code}] Tên`, mine.name, theirs?.name ?? ""], [`[${code}] Slug`, mine.slug, theirs?.slug ?? ""], [`[${code}] Mô tả`, mine.description, theirs?.description ?? ""]);
  }

  const differing = rows.filter(([, mine, theirs]) => mine.trim() !== theirs.trim()).length;
  return (
    <Banner tone="warning" testId="category-conflict">
      <p className="font-medium">Bản của bạn (dựa trên phiên bản {local.version}) khác bản trên máy chủ (phiên bản {fresh.version}).</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead><tr><th className="pr-3">Trường</th><th className="pr-3">Của bạn</th><th>Trên máy chủ</th></tr></thead>
        <tbody>{rows.map(([name, mine, theirs]) => <tr key={name} className={mine.trim() !== theirs.trim() ? "font-semibold" : ""}><td className="pr-3 align-top">{name}</td><td className="pr-3 align-top break-words">{cell(mine)}</td><td className="align-top break-words">{cell(theirs)}</td></tr>)}</tbody>
      </table>
      {conflict.kind === "create" ? (
        <p className="mt-2 text-xs">Mã này đã được một chuyên mục khác dùng. Hãy đóng và tạo lại để có mã mới; hệ thống không tự ghi đè.</p>
      ) : conflict.askUseServer ? (
        <div className="mt-3">
          <p className="text-xs">Bỏ {differing} khác biệt của bạn và dùng bản của máy chủ? Thay đổi chưa lưu của bạn sẽ mất.</p>
          <div className="mt-2 flex gap-2"><ActionButton onClick={onUseServer} testId="category-conflict-confirm">Đồng ý, dùng bản máy chủ</ActionButton><ActionButton variant="outline" onClick={onCancelUseServer}>Không</ActionButton></div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton variant="outline" onClick={onKeep} testId="category-conflict-keep">Giữ thay đổi của tôi trên phiên bản {fresh.version}</ActionButton>
          <ActionButton variant="outline" onClick={onAskUseServer} testId="category-conflict-use-server">Dùng bản của máy chủ…</ActionButton>
          <ActionButton variant="outline" onClick={onClose}>Đóng so sánh</ActionButton>
        </div>
      )}
      {conflict.kind === "update" && !conflict.askUseServer && <p className="mt-2 text-xs">“Giữ thay đổi của tôi” sẽ ghi đè mọi giá trị khác nhau ở trên bằng cột bên trái (một ngôn ngữ bạn để trống thì không bị gửi, nên không bị xoá). Không có lựa chọn nào tự gửi gì lên máy chủ.</p>}
    </Banner>
  );
}
