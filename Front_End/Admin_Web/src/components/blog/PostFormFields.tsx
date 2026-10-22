"use client";

/** BHA-BLOG-001-CP03: the plain fields of a post — title, slug, summary, author, cover, categories, SEO. The body is the editor's. */

import React from "react";
import type { BlogCategory } from "@/lib/api/blog";
import { mediaPreviewPath } from "@/lib/api/blog";
import { ActionButton, TextAreaField, TextField } from "@/components/website/WebsiteUi";
import { FORM_LIMITS, checkSlugShape, suggestSlug, type PostForm } from "@/lib/blog/blogModel";
import { StaffImage } from "./useStaffImage";

export type FieldErrors = Partial<Record<"title" | "slug" | "summary" | "authorName" | "cover" | "coverAlt" | "categories" | "metaTitle" | "metaDescription" | "og" | "body", string>>;

function MediaField({ label, mediaId, error, disabled, onPick, onClear, testId }: { label: string; mediaId: string | null; error?: string; disabled: boolean; onPick: () => void; onClear: () => void; testId: string }) {
  return (
    <div data-testid={testId}>
      <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-400">{label}</p>
      <div className="flex items-center gap-3">
        {mediaId ? <StaffImage path={mediaPreviewPath(mediaId, "card")} alt={label} className="h-24 w-36 rounded-lg object-cover" testId={`${testId}-img`} /> : <div className="flex h-24 w-36 items-center justify-center rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 dark:border-gray-700">Chưa chọn</div>}
        <div className="flex flex-col gap-2">
          <ActionButton variant="outline" onClick={onPick} disabled={disabled} testId={`${testId}-pick`}>{mediaId ? "Đổi ảnh" : "Chọn ảnh"}</ActionButton>
          {mediaId && <ActionButton variant="outline" onClick={onClear} disabled={disabled}>Bỏ ảnh</ActionButton>}
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-error-500" role="alert">{error}</p>}
    </div>
  );
}

export default function PostFormFields({
  form,
  set,
  errors,
  disabled,
  categories,
  locale,
  slugTouched,
  onSlugTouched,
  onPickCover,
  onPickOg,
}: {
  form: PostForm;
  set: (patch: Partial<PostForm>) => void;
  errors: FieldErrors;
  disabled: boolean;
  categories: BlogCategory[];
  locale: string;
  slugTouched: boolean;
  onSlugTouched: () => void;
  onPickCover: () => void;
  onPickOg: () => void;
}) {
  const nameOf = (c: BlogCategory) => c.translations[locale]?.name ?? null;
  const toggle = (id: string) => {
    const has = form.categoryIds.includes(id);
    const ids = has ? form.categoryIds.filter((x) => x !== id) : [...form.categoryIds, id];
    const primary = has && form.primaryCategoryId === id ? (ids[0] ?? null) : (form.primaryCategoryId ?? (ids.length === 1 ? ids[0] : null));
    set({ categoryIds: ids, primaryCategoryId: ids.length === 0 ? null : primary });
  };
  const slugError = errors.slug ?? checkSlugShape(form.slug);
  return (
    <div className="grid gap-5">
      <TextField label="Tiêu đề" value={form.title} maxLength={FORM_LIMITS.title} disabled={disabled} testId="post-title" error={errors.title}
        onChange={(title) => set(slugTouched ? { title } : { title, slug: suggestSlug(title) })} />
      <div>
        <TextField label="Slug (đường dẫn)" value={form.slug} maxLength={FORM_LIMITS.slug} disabled={disabled} testId="post-slug" error={slugError} hint="Chữ thường không dấu, số và dấu gạch ngang. Slug đã có không tự đổi khi sửa tiêu đề."
          onChange={(slug) => { onSlugTouched(); set({ slug }); }} />
        {!disabled && <button type="button" className="mt-1 text-xs font-medium text-brand-600 underline" data-testid="slug-suggest" onClick={() => { onSlugTouched(); set({ slug: suggestSlug(form.title) }); }}>Gợi ý slug từ tiêu đề</button>}
      </div>
      <TextAreaField label="Tóm tắt" value={form.summary} maxLength={FORM_LIMITS.summary} rows={3} disabled={disabled} testId="post-summary" error={errors.summary} onChange={(summary) => set({ summary })} />
      <TextField label="Tác giả hiển thị công khai" value={form.authorName} maxLength={FORM_LIMITS.author} disabled={disabled} testId="post-author" error={errors.authorName} hint="Tên người viết như độc giả thấy; không lấy từ tài khoản Staff." onChange={(authorName) => set({ authorName })} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <MediaField label="Ảnh bìa" mediaId={form.coverMediaId} error={errors.cover} disabled={disabled} onPick={onPickCover} onClear={() => set({ coverMediaId: null })} testId="post-cover" />
          <TextField label="Văn bản thay thế (alt) của ảnh bìa" value={form.coverAlt} maxLength={FORM_LIMITS.alt} disabled={disabled} testId="post-cover-alt" error={errors.coverAlt} onChange={(coverAlt) => set({ coverAlt })} />
        </div>
        <MediaField label="Ảnh khi chia sẻ (OG)" mediaId={form.ogImageMediaId} error={errors.og} disabled={disabled} onPick={onPickOg} onClear={() => set({ ogImageMediaId: null })} testId="post-og" />
      </div>

      <fieldset data-testid="post-categories">
        <legend className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-400">Chuyên mục</legend>
        {categories.length === 0 ? <p className="text-sm text-gray-500">Chưa có chuyên mục nào.</p> : (
          <ul className="flex flex-col gap-1.5">
            {categories.map((c) => {
              const checked = form.categoryIds.includes(c.id);
              const name = nameOf(c);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(c.id)} data-testid={`category-check-${c.id}`} />
                    <span className="text-gray-800 dark:text-white/90">{name ?? Object.values(c.translations)[0]?.name ?? "(chưa có tên)"}</span>
                  </label>
                  {!name && <span className="text-xs text-warning-700 dark:text-warning-300">chưa có tên ở ngôn ngữ {locale} — thêm bản dịch chuyên mục trước khi xuất bản</span>}
                  {checked && form.categoryIds.length > 1 && (
                    <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                      <input type="radio" name="primary-category" checked={form.primaryCategoryId === c.id} disabled={disabled} onChange={() => set({ primaryCategoryId: c.id })} /> chuyên mục chính
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {errors.categories && <p className="mt-1.5 text-xs text-error-500" role="alert">{errors.categories}</p>}
        <p className="mt-1 text-xs text-gray-500">Chuyên mục thuộc từng bản dịch; hệ thống không tự đồng bộ sang ngôn ngữ khác.</p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="SEO: tiêu đề" value={form.metaTitle} maxLength={FORM_LIMITS.metaTitle} disabled={disabled} testId="post-meta-title" error={errors.metaTitle} onChange={(metaTitle) => set({ metaTitle })} />
        <TextAreaField label="SEO: mô tả" value={form.metaDescription} maxLength={FORM_LIMITS.metaDescription} rows={2} disabled={disabled} testId="post-meta-description" error={errors.metaDescription} onChange={(metaDescription) => set({ metaDescription })} />
      </div>
    </div>
  );
}
