"use client";

/**
 * BHA-BLOG-001-CP03: the editor of ONE translation of a post (one language). It is keyed by post and language by its parent, so nothing of another post or
 * language can reach it, and an answer that arrives after the person moved on lands in a component that is gone.
 *
 * What it promises:
 * - Every write carries the version it was made from. A 409 keeps what was typed and offers the server's copy to compare; the version only moves on when
 *   the person says "keep my changes on top of the new version", and nothing is sent until they press Save again.
 * - One write at a time (the host's single slot, taken synchronously) — a double click cannot send twice, and Sign out waits for it.
 * - An unanswered write is never repeated by itself. The server is read; only what it shows decides what happened (`checkServer`).
 * - "Dirty" means different from the server's copy (fields trimmed as the server trims, body in its canonical form) — also after a save, whose answer
 *   becomes the new copy.
 * - Publishing publishes the saved draft: with unsaved edits it saves first (BlogEdit) and publishes what was saved.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPost, restoreRevision, createPost, saveDraft, transitionPost, listRevisions,
  type BlogCategory, type BlogPost, type BlogRevisionSummary, type BlogTransition, type BlogTranslation, type WebsiteResult,
} from "@/lib/api/blog";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import { useLeaveGuard } from "@/components/website/useLeaveGuard";
import { ActionButton, Banner, formatWhen } from "@/components/website/WebsiteUi";
import { canonicalBody, comparableBody } from "@/lib/blog/bodyModel";
import { STATUS_LABEL, describeBlogFailure, draftOf, formFieldOf, formFromRevision, snapshotOf, snapshotOfRevision, translationOf, workingRevision, type PostForm } from "@/lib/blog/blogModel";
import RichBodyEditor, { type BodyState } from "./RichBodyEditor";
import PostFormFields, { type FieldErrors } from "./PostFormFields";
import PostPreviewDialog from "./PostPreviewDialog";
import BlogWriteFeedback from "./BlogWriteFeedback";
import type { BodyEditorServices, PickedMedia, PropertyOption } from "./BodyEditorContext";
import { useBlogRights } from "./BlogAccessGate";

type Kind = "create" | "save" | "restore" | BlogTransition;
interface Pending {
  kind: Kind;
  expectedVersion: number;
  snapshot: string;
}

const FIELD_FOCUS: Record<string, string> = { title: "post-title", slug: "post-slug", summary: "post-summary", authorName: "post-author", coverAlt: "post-cover-alt", cover: "post-cover-pick", og: "post-og-pick", metaTitle: "post-meta-title", metaDescription: "post-meta-description", body: "body-editor" };

export interface PickMedia {
  (options: { multiple: boolean; min?: number; max?: number; title: string }): Promise<PickedMedia[] | null>;
}

export interface TranslationStatusReport {
  dirty: boolean;
  busy: boolean;
}

export default function TranslationForm({
  postId,
  clientId,
  locale,
  initial,
  categories,
  properties,
  pickMedia,
  onPost,
  onCreated,
  onStatus,
}: {
  /** `null` while the post is being created (the first save). */
  postId: string | null;
  /** The id the new post is created under: chosen once by the screen and kept through every re-send. */
  clientId: string;
  locale: string;
  initial: BlogTranslation | undefined;
  categories: BlogCategory[];
  properties: PropertyOption[];
  pickMedia: PickMedia;
  onPost: (post: BlogPost) => void;
  onCreated: (post: BlogPost) => void;
  onStatus: (report: TranslationStatusReport) => void;
}) {
  const rights = useBlogRights();
  const host = useWebsiteHost();
  const write = useWriteAction();
  const working = write.status.phase === "pending";

  const [tr, setTr] = useState<BlogTranslation | undefined>(initial);
  const [form, setForm] = useState<PostForm>(() => formFromRevision(workingRevision(initial)));
  const [bodyInit, setBodyInit] = useState<unknown>(() => workingRevision(initial)?.body ?? null);
  const [editorKey, setEditorKey] = useState(0);
  const [bodyState, setBodyState] = useState<BodyState | null>(null);
  const [baseline, setBaseline] = useState(() => snapshotOfRevision(workingRevision(initial)));
  const [slugTouched, setSlugTouched] = useState(() => !!workingRevision(initial)?.slug);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; yes: () => void } | null>(null);
  const [preview, setPreview] = useState<{ note: string | null } | null>(null);
  const [conflict, setConflict] = useState<{ latest: BlogTranslation; post: BlogPost } | null>(null);
  const [historyToken, setHistoryToken] = useState(0);
  const pending = useRef<Pending | null>(null);
  const exists = postId !== null || tr !== undefined;
  const id = postId ?? clientId;
  const version = tr?.version ?? 0;

  const editable = rights.edit && tr?.status !== "Archived";
  const bodyCanon = bodyState?.body ? comparableBody(bodyState.body) : canonicalBody(bodyInit);
  const snapshot = snapshotOf(form, bodyCanon);
  const dirty = snapshot !== baseline;
  const problems = useMemo(() => bodyState?.problems ?? [], [bodyState]);
  const sendBody = bodyState?.body ?? bodyInit;

  useEffect(() => {
    host.setUnsaved(dirty);
    return () => host.setUnsaved(false);
  }, [dirty, host]);
  useEffect(() => onStatus({ dirty, busy: working }), [dirty, working, onStatus]);
  useLeaveGuard(dirty, "Bạn có thay đổi chưa lưu trong bài này. Rời đi sẽ bỏ chúng. Vẫn rời đi?");

  const set = useCallback((patch: Partial<PostForm>) => setForm((current) => ({ ...current, ...patch })), []);

  /** The server's copy of this translation becomes what "unchanged" means, and (when told to) what the form shows. */
  const adopt = useCallback(
    (post: BlogPost, options: { replaceForm: boolean }) => {
      const next = translationOf(post, locale);
      setTr(next);
      const revision = workingRevision(next);
      setBaseline(snapshotOfRevision(revision));
      if (options.replaceForm) {
        setForm(formFromRevision(revision));
        setBodyInit(revision?.body ?? null);
        setBodyState(null);
        setEditorKey((k) => k + 1);
        setSlugTouched(!!revision?.slug);
      }
      setHistoryToken((n) => n + 1);
      return next;
    },
    [locale]
  );

  const errors = useMemo<FieldErrors>(() => {
    const out: FieldErrors = {};
    if (write.status.phase === "refused" && write.status.failure.code !== "blog.stale-version") {
      const key = formFieldOf(write.status.failure.field);
      if (key) out[key === "og" ? "og" : key] = describeBlogFailure(write.status.failure);
    }
    if (problems.length) out.body = problems.map((p) => `${p.where}: ${p.message}`).join(" ");
    return out;
  }, [write.status, problems]);

  useEffect(() => {
    if (write.status.phase !== "refused") return;
    const key = formFieldOf(write.status.failure.field);
    const target = key ? FIELD_FOCUS[key] : null;
    if (target) document.querySelector<HTMLElement>(`[data-testid="${target}"]`)?.focus();
  }, [write.status]);

  // ---------------------------------------------------------------- sending

  const send = useCallback(
    async (kind: Kind, expectedVersion: number, fn: () => Promise<WebsiteResult<BlogPost>>): Promise<BlogPost | null> => {
      // The version is the one this very request carries — not the one of the render that built the callback (a publish after a save carries the save's).
      pending.current = { kind, expectedVersion, snapshot };
      setNote(null);
      const result = await write.run(fn);
      return result?.kind === "ok" ? result.data : null;
    },
    [snapshot, write]
  );

  const doSave = useCallback(async (): Promise<BlogTranslation | null> => {
    if (!editable || problems.length > 0) return null;
    const draft = draftOf(form, sendBody);
    const next = await send(postId === null ? "create" : "save", version, () => (postId === null ? createPost(clientId, locale, draft) : saveDraft(postId, locale, version, draft)));
    if (!next) return null;
    const saved = translationOf(next, locale);
    // The server trims and normalises; its answer is the copy. If that differs from what was typed, show the server's copy rather than a phantom "unsaved".
    const typed = snapshot;
    const copy = snapshotOfRevision(workingRevision(saved));
    adopt(next, { replaceForm: copy !== typed });
    if (copy !== typed) setNote("Đã lưu. Máy chủ chuẩn hoá lại một số chữ (ví dụ cắt khoảng trắng đầu/cuối); biểu mẫu đang hiện đúng bản đã lưu.");
    onPost(next);
    if (postId === null) onCreated(next);
    return saved ?? null;
  }, [editable, problems.length, form, sendBody, send, postId, clientId, locale, version, snapshot, adopt, onPost, onCreated]);

  const doTransition = useCallback(
    async (action: BlogTransition, expected: number) => {
      if (postId === null) return false;
      const next = await send(action, expected, () => transitionPost(postId, locale, action, expected));
      if (!next) return false;
      adopt(next, { replaceForm: false });
      onPost(next);
      return true;
    },
    [postId, locale, send, adopt, onPost]
  );

  const publish = useCallback(async () => {
    let expected = version;
    if (dirty) {
      if (!rights.edit) return;
      const saved = await doSave();
      if (!saved) return;
      expected = saved.version;
    }
    await doTransition("publish", expected);
  }, [dirty, rights.edit, version, doSave, doTransition]);

  const saveAndPreview = useCallback(async () => {
    if (dirty && rights.edit) {
      const saved = await doSave();
      if (!saved) return;
      setPreview({ note: null });
    } else setPreview({ note: dirty ? "Bạn có chỉnh sửa chưa lưu; bản xem trước chỉ cho thấy bản đã lưu." : null });
  }, [dirty, rights.edit, doSave]);

  // ---------------------------------------------------------------- after a lost answer / a 409: read, never resend

  const checkServer = useCallback(async () => {
    const op = pending.current;
    const result = await getPost(id);
    if (result.kind === "refused" && result.status === 404) {
      setNote(op?.kind === "create" ? "Máy chủ chưa có bài này. Bấm Lưu để gửi lại với cùng mã — sẽ không tạo trùng." : "Máy chủ báo bài không tồn tại.");
      write.reset();
      return;
    }
    if (result.kind !== "ok") {
      setNote(describeBlogFailure(result));
      return;
    }
    const latest = translationOf(result.data, locale);
    const copy = snapshotOfRevision(workingRevision(latest));
    const applied = !!op && !!latest && (op.kind === "create" ? latest.version >= 1 : latest.version > op.expectedVersion);
    if (!applied || !latest) {
      write.reset();
      setNote("Máy chủ chưa ghi nhận thao tác vừa rồi. Dữ liệu của bạn vẫn còn; có thể thử lại.");
      return;
    }
    const matches =
      op.kind === "save" || op.kind === "create" ? copy === op.snapshot
      : op.kind === "publish" ? latest.status === "Published" && !latest.hasDraft && snapshotOfRevision(latest.published) === op.snapshot
      : op.kind === "unpublish" ? latest.status === "Unpublished"
      : op.kind === "archive" ? latest.status === "Archived"
      : op.kind === "unarchive" ? latest.status !== "Archived"
      : true;
    if (matches) {
      write.reset();
      adopt(result.data, { replaceForm: false });
      onPost(result.data);
      if (op.kind === "create") onCreated(result.data);
      setNote(`Máy chủ đã ghi nhận thao tác (phiên bản ${latest.version}); đây là kết quả đọc lại, không phải gửi lại.`);
    } else {
      setConflict({ latest, post: result.data });
      write.reset();
      setNote("Máy chủ đã thay đổi sau thao tác của bạn (có thể do người khác). Dữ liệu của bạn được giữ; hãy so sánh bên dưới.");
    }
  }, [id, locale, write, adopt, onPost, onCreated]);

  const loadLatest = useCallback(async () => {
    if (postId === null) return;
    const result = await getPost(postId);
    if (result.kind !== "ok") {
      setNote(describeBlogFailure(result));
      return;
    }
    const latest = translationOf(result.data, locale);
    if (latest) {
      write.reset();
      setConflict({ latest, post: result.data });
    }
  }, [postId, locale, write]);

  // ---------------------------------------------------------------- history

  const restore = useCallback(
    async (revision: BlogRevisionSummary) => {
      if (postId === null) return;
      const next = await send("restore", version, () => restoreRevision(postId, locale, revision.id, version));
      if (!next) return;
      adopt(next, { replaceForm: true });
      onPost(next);
      setNote(`Đã khôi phục bản ${revision.number} thành bản nháp. Chưa xuất bản.`);
    },
    [postId, locale, send, version, adopt, onPost]
  );

  const services = useMemo<BodyEditorServices>(() => ({ editable, properties, pickMedia }), [editable, properties, pickMedia]);
  const pickInto = async (target: "coverMediaId" | "ogImageMediaId") => {
    const picked = await pickMedia({ multiple: false, title: target === "coverMediaId" ? "Chọn ảnh bìa" : "Chọn ảnh chia sẻ (OG)" });
    if (picked?.[0]) set({ [target]: picked[0].id });
  };

  const status = tr?.status;
  const unverified = write.status.phase === "unverified";
  const blocked = working || unverified;

  return (
    <div className="flex flex-col gap-5" data-testid="translation-form" data-locale={locale}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {status ? <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700 dark:bg-white/10 dark:text-gray-200" data-testid="post-status">{STATUS_LABEL[status]}</span> : <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700 dark:bg-white/10 dark:text-gray-200" data-testid="post-status">Chưa lưu bản dịch này</span>}
        {tr?.hasDraft && status === "Published" && <span className="rounded-full bg-warning-50 px-3 py-1 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300" data-testid="post-has-unpublished">Có thay đổi chưa xuất bản</span>}
        {dirty && <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" data-testid="post-dirty">Có thay đổi chưa lưu</span>}
        {tr && <span className="text-xs text-gray-500">Phiên bản {tr.version} · cập nhật {formatWhen(tr.updatedAtUtc)}{tr.updatedBy?.email ? ` bởi ${tr.updatedBy.email}` : ""}{tr.firstPublishedAtUtc ? ` · đăng lần đầu ${formatWhen(tr.firstPublishedAtUtc)}` : ""}</span>}
      </div>

      {!exists || !tr ? <Banner tone="info" testId="post-new-translation">{postId === null ? "Bài mới: nhập nội dung rồi Lưu để tạo bài." : `Bài này chưa có bản dịch ${locale}. Nhập nội dung rồi Lưu để tạo bản dịch; hệ thống không tự dịch hay sao chép từ ngôn ngữ khác.`}</Banner> : null}
      {!rights.edit && <Banner tone="info" testId="post-readonly">Tài khoản này có thể xem, xem trước và xuất bản bản nháp đã lưu nhưng không sửa được nội dung (cần quyền chỉnh sửa Blog).</Banner>}
      {status === "Archived" && <Banner tone="warning">Bản dịch này đã lưu trữ. Bỏ lưu trữ để sửa tiếp.</Banner>}
      {note && <Banner tone="info" testId="post-note" onDismiss={() => setNote(null)}>{note}</Banner>}

      <PostFormFields form={form} set={set} errors={errors} disabled={!editable} categories={categories} locale={locale} slugTouched={slugTouched} onSlugTouched={() => setSlugTouched(true)}
        onPickCover={() => void pickInto("coverMediaId")} onPickOg={() => void pickInto("ogImageMediaId")} />

      <section aria-label="Nội dung bài viết">
        <h2 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-400">Nội dung</h2>
        <RichBodyEditor key={`${id}:${locale}:${editorKey}`} initialBody={bodyInit} services={services} onChange={setBodyState} />
        {errors.body && <p className="mt-1.5 text-xs text-error-500" role="alert" data-testid="body-error">{errors.body}</p>}
      </section>

      {conflict && <ConflictPanel local={{ form, body: bodyCanon }} latest={conflict.latest} onUseServer={() => { adopt(conflict.post, { replaceForm: true }); setConflict(null); write.reset(); setNote("Đã thay bằng bản trên máy chủ; thay đổi chưa lưu của bạn đã bị bỏ."); }}
        onKeepMine={() => { setTr(conflict.latest); setBaseline(snapshotOfRevision(workingRevision(conflict.latest))); setConflict(null); write.reset(); setNote(`Giữ thay đổi của bạn trên nền phiên bản ${conflict.latest.version}. Chưa có gì được gửi — bấm Lưu để ghi.`); onPost(conflict.post); }} onClose={() => setConflict(null)} />}

      <BlogWriteFeedback status={write.status} working={working} onReloadLatest={() => void loadLatest()} onCheckServer={() => void checkServer()}
        fieldShown={(field, code) => code !== "blog.stale-version" && formFieldOf(field) !== null} />

      {confirm && (
        <Banner tone="warning" testId="post-confirm">
          <p>{confirm.message}</p>
          <div className="mt-2 flex gap-2"><ActionButton onClick={() => { const yes = confirm.yes; setConfirm(null); yes(); }} testId="post-confirm-yes">Đồng ý</ActionButton><ActionButton variant="outline" onClick={() => setConfirm(null)} testId="post-confirm-no">Không</ActionButton></div>
        </Banner>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-gray-800" data-testid="post-actions">
        {rights.edit && <ActionButton onClick={() => void doSave()} disabled={blocked || !editable || !dirty || problems.length > 0} testId="post-save">Lưu bản nháp</ActionButton>}
        <ActionButton variant="outline" onClick={() => void saveAndPreview()} disabled={blocked || (!exists && !rights.edit) || (!tr && !rights.edit) || (dirty && rights.edit && problems.length > 0)} testId="post-preview">{dirty && rights.edit ? "Lưu và xem trước" : "Xem trước"}</ActionButton>
        {rights.publish && status !== "Archived" && (
          <ActionButton onClick={() => void publish()} disabled={blocked || (!tr && !(rights.edit && dirty)) || (dirty && !rights.edit) || (dirty && problems.length > 0)} testId="post-publish">{dirty && rights.edit ? "Lưu và xuất bản" : status === "Unpublished" && !tr?.hasDraft ? "Xuất bản lại" : "Xuất bản"}</ActionButton>
        )}
        {rights.publish && status === "Published" && <ActionButton variant="outline" onClick={() => setConfirm({ message: "Gỡ bài khỏi website? Bài vẫn được giữ cùng lịch sử và có thể xuất bản lại.", yes: () => void doTransition("unpublish", version) })} disabled={blocked} testId="post-unpublish">Gỡ xuất bản</ActionButton>}
        {rights.publish && tr && status !== "Archived" && <ActionButton variant="outline" onClick={() => setConfirm({ message: "Lưu trữ bản dịch này? Nó biến mất khỏi website; ảnh và lịch sử vẫn được giữ.", yes: () => void doTransition("archive", version) })} disabled={blocked} testId="post-archive">Lưu trữ</ActionButton>}
        {rights.publish && status === "Archived" && <ActionButton variant="outline" onClick={() => void doTransition("unarchive", version)} disabled={blocked} testId="post-unarchive">Bỏ lưu trữ</ActionButton>}
      </div>

      {tr && <History postId={id} locale={locale} token={historyToken} canRestore={rights.edit && status !== "Archived"} blocked={blocked} onRestore={(rev) => setConfirm({ message: `Khôi phục bản ${rev.number} thành bản nháp? Bản nháp hiện tại${dirty ? " và các thay đổi chưa lưu" : ""} sẽ được thay (bản nháp cũ vẫn nằm trong lịch sử). Bản đang đăng không đổi.`, yes: () => void restore(rev) })} />}

      {preview && <PostPreviewDialog postId={id} locale={locale} dirtyNote={preview.note} onClose={() => setPreview(null)} />}
    </div>
  );
}

function History({ postId, locale, token, canRestore, blocked, onRestore }: { postId: string; locale: string; token: number; canRestore: boolean; blocked: boolean; onRestore: (revision: BlogRevisionSummary) => void }) {
  const list = useWebsiteList((signal) => listRevisions(postId, locale, signal), [postId, locale, token]);
  if (list.state.status !== "ready") return list.state.status === "error" ? <p className="text-sm text-error-500" role="alert">{list.state.message}</p> : null;
  return (
    <section aria-label="Lịch sử bản" data-testid="post-history">
      <h2 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-400">Lịch sử</h2>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-700">
        {list.state.data.map((rev) => (
          <li key={rev.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="history-item">
            <span className="font-medium">Bản {rev.number}</span>
            {rev.isDraft && <span className="rounded bg-brand-50 px-1.5 text-xs text-brand-700 dark:bg-brand-500/15">nháp</span>}
            {rev.isPublished && <span className="rounded bg-success-50 px-1.5 text-xs text-success-700 dark:bg-success-500/15">đang đăng</span>}
            {!rev.isDraft && !rev.isPublished && <span className="rounded bg-gray-100 px-1.5 text-xs dark:bg-white/10">{rev.state === "Frozen" ? "đã đóng băng" : rev.state}</span>}
            <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300" title={rev.title}>{rev.title}</span>
            <span className="text-xs text-gray-500">{rev.publishedAtUtc ? `đăng ${formatWhen(rev.publishedAtUtc)}` : `tạo ${formatWhen(rev.createdAtUtc)}`}{rev.createdBy?.email ? ` · ${rev.createdBy.email}` : ""}</span>
            {canRestore && !rev.isDraft && <ActionButton variant="outline" onClick={() => onRestore(rev)} disabled={blocked} testId="history-restore">Khôi phục thành nháp</ActionButton>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConflictPanel({ local, latest, onUseServer, onKeepMine, onClose }: { local: { form: PostForm; body: string }; latest: BlogTranslation; onUseServer: () => void; onKeepMine: () => void; onClose: () => void }) {
  const server = workingRevision(latest);
  const serverForm = formFromRevision(server);
  const rows: [string, string, string][] = [
    ["Tiêu đề", local.form.title, serverForm.title], ["Slug", local.form.slug, serverForm.slug], ["Tóm tắt", local.form.summary, serverForm.summary], ["Tác giả", local.form.authorName, serverForm.authorName],
    ["Alt ảnh bìa", local.form.coverAlt, serverForm.coverAlt], ["SEO: tiêu đề", local.form.metaTitle, serverForm.metaTitle], ["SEO: mô tả", local.form.metaDescription, serverForm.metaDescription],
    ["Ảnh bìa", local.form.coverMediaId ?? "—", serverForm.coverMediaId ?? "—"], ["Chuyên mục", local.form.categoryIds.length + " chọn", serverForm.categoryIds.length + " chọn"],
    ["Nội dung", local.body === canonicalBody(server?.body ?? null) ? "giống nhau" : "khác nhau", ""],
  ];
  return (
    <Banner tone="warning" testId="conflict-panel">
      <p className="font-medium">Bản trên máy chủ (phiên bản {latest.version}, {STATUS_LABEL[latest.status]}, sửa {formatWhen(latest.updatedAtUtc)}{latest.updatedBy?.email ? ` bởi ${latest.updatedBy.email}` : ""}) khác bản bạn đang sửa.</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead><tr><th className="pr-3">Trường</th><th className="pr-3">Của bạn</th><th>Trên máy chủ</th></tr></thead>
        <tbody>{rows.map(([name, mine, theirs]) => <tr key={name} className={mine !== theirs && theirs !== "" ? "font-semibold" : ""}><td className="pr-3 align-top">{name}</td><td className="pr-3 align-top break-words">{mine || "—"}</td><td className="align-top break-words">{theirs || "—"}</td></tr>)}</tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton variant="outline" onClick={onKeepMine} testId="conflict-keep">Giữ thay đổi của tôi trên bản mới</ActionButton>
        <ActionButton variant="outline" onClick={onUseServer} testId="conflict-use-server">Bỏ thay đổi của tôi, dùng bản máy chủ</ActionButton>
        <ActionButton variant="outline" onClick={onClose}>Đóng</ActionButton>
      </div>
      <p className="mt-2 text-xs">Không có lựa chọn nào tự gửi gì lên máy chủ.</p>
    </Banner>
  );
}
