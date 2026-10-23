/**
 * BHA-BLOG-001-CP03: the post form — what the editor holds, how it is told apart from what the server has (dirty), what it sends, and the
 * Vietnamese wording of the server's Blog refusals. No React here, so the rules are testable on their own.
 */

import type { BlogDraftInput, BlogPost, BlogRevision, BlogStatus, BlogTranslation } from "@/lib/api/blog";
import type { WebsiteFailure } from "@/lib/api/website";
import { canonicalBody } from "./bodyModel";

export interface PostForm {
  title: string;
  slug: string;
  summary: string;
  authorName: string;
  coverMediaId: string | null;
  coverAlt: string;
  ogImageMediaId: string | null;
  metaTitle: string;
  metaDescription: string;
  categoryIds: string[];
  primaryCategoryId: string | null;
}

export const EMPTY_FORM: PostForm = {
  title: "", slug: "", summary: "", authorName: "", coverMediaId: null, coverAlt: "", ogImageMediaId: null, metaTitle: "", metaDescription: "", categoryIds: [], primaryCategoryId: null,
};

export const FORM_LIMITS = { title: 150, slug: 120, summary: 300, author: 120, alt: 200, metaTitle: 70, metaDescription: 170 } as const;

export function formFromRevision(revision: BlogRevision | null): PostForm {
  if (!revision) return { ...EMPTY_FORM };
  return {
    title: revision.title, slug: revision.slug, summary: revision.summary, authorName: revision.authorName, coverMediaId: revision.coverMediaId, coverAlt: revision.coverAlt,
    ogImageMediaId: revision.ogImageMediaId, metaTitle: revision.metaTitle, metaDescription: revision.metaDescription, categoryIds: [...revision.categoryIds].sort(),
    primaryCategoryId: revision.primaryCategoryId,
  };
}

/** The revision an editor works on for a translation: its open draft, else the published revision (editing it makes a new draft). */
export const workingRevision = (translation: BlogTranslation | undefined): BlogRevision | null => translation?.draft ?? translation?.published ?? null;

/**
 * The draft to send. Text is sent as typed (the server trims); an empty text is sent as empty, never omitted — a field the editor cleared must clear on
 * the server. `body` is the body JSON the editor produced (or the stored one, untouched, when the editor does not open it).
 */
export function draftOf(form: PostForm, body: unknown): BlogDraftInput {
  return {
    title: form.title, slug: form.slug, summary: form.summary, body, coverMediaId: form.coverMediaId, coverAlt: form.coverAlt, authorName: form.authorName,
    metaTitle: form.metaTitle, metaDescription: form.metaDescription, ogImageMediaId: form.ogImageMediaId, categoryIds: [...form.categoryIds].sort(),
    primaryCategoryId: form.primaryCategoryId,
  };
}

/** What two states are compared by to tell "edited" from "not": the trimmed fields (the server trims) and the canonical body. */
export function snapshotOf(form: PostForm, bodyCanonical: string): string {
  return JSON.stringify([
    form.title.trim(), form.slug.trim(), form.summary.trim(), form.authorName.trim(), form.coverMediaId, form.coverAlt.trim(), form.ogImageMediaId, form.metaTitle.trim(),
    form.metaDescription.trim(), [...form.categoryIds].sort(), form.primaryCategoryId, bodyCanonical,
  ]);
}

export const snapshotOfRevision = (revision: BlogRevision | null): string => snapshotOf(formFromRevision(revision), canonicalBody(revision?.body ?? null));

/** A slug suggestion from a title: ASCII lowercase letters and digits, single hyphens, at most 120 — the server's shape. */
export function suggestSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FORM_LIMITS.slug)
    .replace(/-+$/g, "");
  return slug;
}

const RESERVED_SLUGS = new Set(["category", "categories", "page", "tag", "tags", "feed", "rss", "search", "preview", "sitemap", "new"]);

/** `null` when the slug has the server's shape (the server still decides — it also knows which slugs are taken). */
export function checkSlugShape(slug: string): string | null {
  const text = slug.trim();
  if (text === "") return null;
  if (text.length < 2 || text.length > FORM_LIMITS.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) return "Slug gồm 2–120 chữ thường và số, nối bằng một dấu gạch ngang, không dấu.";
  return RESERVED_SLUGS.has(text) ? "Từ này đã được địa chỉ của website dùng; hãy chọn slug khác." : null;
}

// ---------------------------------------------------------------- wording

export const STATUS_LABEL: Record<BlogStatus, string> = { Draft: "Bản nháp", Published: "Đã xuất bản", Unpublished: "Đã gỡ", Archived: "Đã lưu trữ" };

export const STATUS_TONE: Record<BlogStatus, "success" | "warning" | "info" | "error"> = { Draft: "info", Published: "success", Unpublished: "warning", Archived: "error" };

const CODE_TEXT: Record<string, string> = {
  "blog.stale-version": "Bài đã được người khác (hoặc tab khác) thay đổi. Chưa có gì được lưu.",
  "blog.slug-taken": "Một trang khác đang dùng slug này.",
  "blog.slug-required": "Cần nhập slug để xuất bản.",
  "blog.slug-invalid": "Slug không hợp lệ.",
  "blog.title-required": "Cần nhập tiêu đề.",
  "blog.summary-required": "Cần nhập tóm tắt để xuất bản.",
  "blog.cover-required": "Cần chọn ảnh bìa để xuất bản.",
  "blog.cover-alt-required": "Cần nhập văn bản thay thế (alt) cho ảnh bìa để xuất bản.",
  "blog.image-alt-required": "Mỗi ảnh trong bài cần có văn bản thay thế (alt) để xuất bản.",
  "blog.category-required": "Cần chọn ít nhất một chuyên mục để xuất bản.",
  "blog.category-primary-required": "Khi có nhiều chuyên mục, cần chọn một chuyên mục chính.",
  "blog.category-locale-missing": "Một chuyên mục chưa có tên cho ngôn ngữ này. Hãy thêm bản dịch của chuyên mục trước khi xuất bản.",
  "blog.category-missing": "Một chuyên mục đã chọn không còn tồn tại.",
  "blog.category-in-use": "Chuyên mục đang được bài viết, ghim hoặc mục trang chủ sử dụng nên chưa xoá được.",
  "blog.body-empty": "Nội dung bài chưa có chữ để xuất bản.",
  "blog.body-invalid": "Nội dung bài có phần máy chủ không chấp nhận.",
  "blog.property-missing": "Một cơ sở lưu trú được nhắc trong bài không còn tồn tại.",
  "blog.media-missing": "Một ảnh được chọn không còn trong thư viện.",
  "blog.media-in-use": "Ảnh đang được bài viết (nháp, đã xuất bản hoặc lịch sử) sử dụng nên chưa xoá được.",
  "blog.duplicate-id": "Mã này đã được dùng.",
  "blog.archived": "Bài đã lưu trữ; hãy bỏ lưu trữ trước khi sửa.",
  "blog.invalid-state": "Trạng thái hiện tại của bài không cho phép thao tác này.",
  "blog.nothing-to-publish": "Bài không có bản nháp để xuất bản.",
  "blog.pin-not-published": "Chỉ ghim được bài đã xuất bản trong chuyên mục này.",
  "blog.locale-unsupported": "Website chưa có ngôn ngữ này.",
  "blog.not-found": "Mục này không còn trên máy chủ.",
  "blog.storage-not-configured": "Máy chủ chưa cấu hình nơi lưu ảnh nên chưa tải ảnh lên được.",
};

export function describeBlogFailure(failure: WebsiteFailure): string {
  switch (failure.kind) {
    case "refused": {
      const known = failure.code ? CODE_TEXT[failure.code] : undefined;
      return known && failure.code !== "blog.validation" ? known : failure.detail;
    }
    case "unverified":
    case "network":
    case "error":
    case "invalid-response":
    case "config":
      return failure.message;
    case "denied":
      return "Máy chủ từ chối yêu cầu: tài khoản này có thể không còn quyền với Blog.";
    case "unauthenticated":
      return "Phiên đăng nhập Staff của bạn đã kết thúc.";
  }
}

/** Which form field a refusal's `field` belongs to (the server names it: `title`, `slug`, `body`, `coverMediaId`…), or `null`. */
export function formFieldOf(field: string | null): "title" | "slug" | "summary" | "authorName" | "cover" | "coverAlt" | "body" | "categories" | "metaTitle" | "metaDescription" | "og" | null {
  if (!field) return null;
  const f = field.toLowerCase();
  if (f.startsWith("body")) return "body";
  if (f.includes("coveralt")) return "coverAlt";
  if (f.includes("cover")) return "cover";
  if (f.includes("ogimage")) return "og";
  if (f.includes("categor")) return "categories";
  for (const key of ["title", "slug", "summary", "authorName", "metaTitle", "metaDescription"] as const) {
    if (f === key.toLowerCase() || f.endsWith(`.${key.toLowerCase()}`)) return key;
  }
  return null;
}

export const translationOf = (post: BlogPost | null, locale: string): BlogTranslation | undefined => post?.translations.find((t) => t.locale === locale);
