/**
 * BHA-BLOG-001-CP03: the Admin client of the Blog (`/api/admin/v1/website/blog`, design §5, §9.4).
 *
 * It rides on `call` from `website.ts` — the one fetch wrapper every website screen uses (Staff cookie, no-store, 401/403/409 sorted, a lost answer on a
 * write is `unverified`) — and adds nothing to what that decides. The server is the authority on every permission, version and limit; the shapes below
 * are only checked enough to refuse an answer that is not the one the screens were written for.
 *
 * Three things here differ from the rest of the website client, each for a stated reason: picture bytes are read with credentials into a Blob (so the
 * Staff session, not a public address, gates a draft's pictures), an upload is an `XMLHttpRequest` (only it reports bytes sent), and the list of active
 * languages is the public configuration (the Blog-only account has no right to the settings route that lists them).
 */

import { call, type WebsiteResult } from "./website";
import { getApiBaseUrl } from "./env";
import { getAccessMode } from "./accessMode";

export type { WebsiteResult };

// ---------------------------------------------------------------- permissions (display only: the server decides again on every request)

export const BLOG_EDIT = "BlogEdit";
export const BLOG_PUBLISH = "BlogPublish";

export interface BlogRights {
  /** Edit or publish: the whole Blog Admin may be read. */
  access: boolean;
  edit: boolean;
  publish: boolean;
}

export function blogRights(permissions: readonly string[] | undefined): BlogRights {
  const edit = !!permissions?.includes(BLOG_EDIT);
  const publish = !!permissions?.includes(BLOG_PUBLISH);
  return { access: edit || publish, edit, publish };
}

// ---------------------------------------------------------------- shapes

export type BlogStatus = "Draft" | "Published" | "Unpublished" | "Archived";

export interface BlogStaffRef {
  id: string;
  email: string | null;
}

export interface BlogRevision {
  id: string;
  number: number;
  state: "Draft" | "Frozen";
  origin: string;
  restoredFromRevisionId: string | null;
  title: string;
  slug: string;
  summary: string;
  /** The stored body as the server sent it (`schemaVersion` 1 — see `lib/blog/bodyModel`). */
  body: unknown;
  coverMediaId: string | null;
  coverAlt: string;
  authorName: string;
  metaTitle: string;
  metaDescription: string;
  ogImageMediaId: string | null;
  categoryIds: string[];
  primaryCategoryId: string | null;
  createdAtUtc: string;
  createdBy: BlogStaffRef | null;
  updatedAtUtc: string;
  updatedBy: BlogStaffRef | null;
  publishedAtUtc: string | null;
  publishedBy: BlogStaffRef | null;
}

export interface BlogTranslation {
  translationId: string;
  locale: string;
  status: BlogStatus;
  version: number;
  hasDraft: boolean;
  firstPublishedAtUtc: string | null;
  updatedAtUtc: string;
  updatedBy: BlogStaffRef | null;
  draft: BlogRevision | null;
  published: BlogRevision | null;
}

export interface BlogPost {
  id: string;
  createdAtUtc: string;
  translations: BlogTranslation[];
}

export interface BlogTranslationRow {
  locale: string;
  status: BlogStatus;
  version: number;
  title: string;
  slug: string;
  hasDraft: boolean;
  updatedAtUtc: string;
  updatedBy: BlogStaffRef | null;
  coverMediaId: string | null;
}

export interface BlogPostRow {
  id: string;
  updatedAtUtc: string;
  translations: BlogTranslationRow[];
}

export interface BlogPostList {
  items: BlogPostRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BlogRevisionSummary {
  id: string;
  number: number;
  state: "Draft" | "Frozen";
  origin: string;
  title: string;
  slug: string;
  createdAtUtc: string;
  createdBy: BlogStaffRef | null;
  publishedAtUtc: string | null;
  publishedBy: BlogStaffRef | null;
  isDraft: boolean;
  isPublished: boolean;
}

export interface BlogCategoryText {
  name: string;
  slug: string;
  description: string | null;
}

export interface BlogCategory {
  id: string;
  systemKey: string | null;
  sortOrder: number;
  version: number;
  translations: Record<string, BlogCategoryText>;
  revisionCount: number;
  pinCount: number;
  isHomeSection: boolean;
}

export interface BlogPin {
  postId: string;
  position: number;
  effective: boolean;
  titles: Record<string, string>;
}

export interface BlogPins {
  categoryId: string;
  version: number;
  pins: BlogPin[];
}

export interface BlogSettings {
  homeSectionCategoryId: string | null;
  version: number;
  updatedAtUtc: string;
}

export interface BlogMediaVariant {
  preset: string;
  format: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface BlogMedia {
  id: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAtUtc: string;
  displayName: string;
  originalFileName: string;
  description: string;
  credit: string;
  sourceUrl: string;
  licence: string;
  focalX: number;
  focalY: number;
  version: number;
  pipeline: "current" | "legacy";
  originalSha256: string | null;
  updatedAtUtc: string;
  variants: BlogMediaVariant[];
  usage: { revisions: number; inPublished: number; inDrafts: number };
}

export interface BlogMediaList {
  items: BlogMedia[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BlogMediaUse {
  postId: string;
  locale: string;
  postStatus: string;
  title: string;
  revisionId: string;
  revisionNumber: number;
  revisionState: "Draft" | "Frozen";
  isPublished: boolean;
  kinds: string[];
}

export interface BlogMediaUsage {
  mediaId: string;
  total: number;
  truncated: boolean;
  items: BlogMediaUse[];
}

export interface BlogPreviewVariant {
  preset: string;
  format: string;
  type: string;
  url: string;
  width: number;
  height: number;
}

export interface BlogPreviewMedia {
  url: string;
  width: number;
  height: number;
  variants: BlogPreviewVariant[];
}

export interface BlogPreview {
  source: "draft" | "published";
  revisionNumber: number;
  status: BlogStatus;
  version: number;
  id: string;
  locale: string;
  slug: string;
  title: string;
  summary: string;
  body: unknown;
  cover: (BlogPreviewMedia & { alt: string }) | null;
  author: string;
  firstPublishedAt: string;
  modifiedAt: string;
  primaryCategory: { slug: string; name: string; isPrimary: boolean } | null;
  categories: { slug: string; name: string; isPrimary: boolean }[];
  media: Record<string, BlogPreviewMedia>;
  properties: Record<string, { slug: string; name: string }>;
  seo: { metaTitle: string | null; metaDescription: string | null; ogImageUrl: string | null };
  alternates: { locale: string; slug: string }[];
}

/** The draft the server accepts (`BlogDraftRequest`): anything may be missing, nothing may be malformed. */
export interface BlogDraftInput {
  title?: string | null;
  slug?: string | null;
  summary?: string | null;
  body?: unknown;
  coverMediaId?: string | null;
  coverAlt?: string | null;
  authorName?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImageMediaId?: string | null;
  categoryIds?: string[];
  primaryCategoryId?: string | null;
}

// ---------------------------------------------------------------- reading the answers (just enough to refuse a wrong one)

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);
const isStrOrNull = (x: unknown): x is string | null => x === null || isStr(x);

const asList = <T>(x: unknown, parse: (item: unknown) => T | null): T[] | null => {
  if (!Array.isArray(x)) return null;
  const out: T[] = [];
  for (const item of x) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
};

const staff = (x: unknown): BlogStaffRef | null | undefined => {
  if (x === null || x === undefined) return null;
  return isRec(x) && isStr(x.id) ? { id: x.id, email: isStr(x.email) ? x.email : null } : undefined;
};

function revision(x: unknown): BlogRevision | null {
  if (!isRec(x)) return null;
  const createdBy = staff(x.createdBy);
  const updatedBy = staff(x.updatedBy);
  const publishedBy = staff(x.publishedBy);
  const categoryIds = asList(x.categoryIds, (id) => (isStr(id) ? id : null));
  if (
    !isStr(x.id) || !isInt(x.number) || (x.state !== "Draft" && x.state !== "Frozen") || !isStr(x.origin) || !isStr(x.title) || !isStr(x.slug) || !isStr(x.summary) ||
    !isStrOrNull(x.coverMediaId ?? null) || !isStr(x.coverAlt) || !isStr(x.authorName) || !isStr(x.metaTitle) || !isStr(x.metaDescription) ||
    !isStrOrNull(x.ogImageMediaId ?? null) || !categoryIds || !isStrOrNull(x.primaryCategoryId ?? null) || !isStr(x.createdAtUtc) || !isStr(x.updatedAtUtc) ||
    !isStrOrNull(x.publishedAtUtc ?? null) || createdBy === undefined || updatedBy === undefined || publishedBy === undefined
  ) {
    return null;
  }
  return {
    id: x.id, number: x.number, state: x.state, origin: x.origin, restoredFromRevisionId: (x.restoredFromRevisionId as string | null | undefined) ?? null,
    title: x.title, slug: x.slug, summary: x.summary, body: x.body, coverMediaId: (x.coverMediaId as string | null | undefined) ?? null, coverAlt: x.coverAlt,
    authorName: x.authorName, metaTitle: x.metaTitle, metaDescription: x.metaDescription, ogImageMediaId: (x.ogImageMediaId as string | null | undefined) ?? null,
    categoryIds, primaryCategoryId: (x.primaryCategoryId as string | null | undefined) ?? null, createdAtUtc: x.createdAtUtc, createdBy,
    updatedAtUtc: x.updatedAtUtc, updatedBy, publishedAtUtc: (x.publishedAtUtc as string | null | undefined) ?? null, publishedBy,
  };
}

const STATUSES = new Set(["Draft", "Published", "Unpublished", "Archived"]);

function translation(x: unknown): BlogTranslation | null {
  if (!isRec(x)) return null;
  const updatedBy = staff(x.updatedBy);
  const draft = x.draft === null || x.draft === undefined ? null : revision(x.draft);
  const published = x.published === null || x.published === undefined ? null : revision(x.published);
  if (
    !isStr(x.translationId) || !isStr(x.locale) || !isStr(x.status) || !STATUSES.has(x.status) || !isInt(x.version) || typeof x.hasDraft !== "boolean" ||
    !isStr(x.updatedAtUtc) || !isStrOrNull(x.firstPublishedAtUtc ?? null) || updatedBy === undefined ||
    (x.draft != null && !draft) || (x.published != null && !published)
  ) {
    return null;
  }
  return {
    translationId: x.translationId, locale: x.locale, status: x.status as BlogStatus, version: x.version, hasDraft: x.hasDraft,
    firstPublishedAtUtc: (x.firstPublishedAtUtc as string | null | undefined) ?? null, updatedAtUtc: x.updatedAtUtc, updatedBy, draft, published,
  };
}

export function parseBlogPost(x: unknown): BlogPost | null {
  if (!isRec(x) || !isStr(x.id) || !isStr(x.createdAtUtc)) return null;
  const translations = asList(x.translations, translation);
  return translations ? { id: x.id, createdAtUtc: x.createdAtUtc, translations } : null;
}

function row(x: unknown): BlogTranslationRow | null {
  if (!isRec(x)) return null;
  const updatedBy = staff(x.updatedBy);
  if (!isStr(x.locale) || !isStr(x.status) || !STATUSES.has(x.status) || !isInt(x.version) || !isStr(x.title) || !isStr(x.slug) || typeof x.hasDraft !== "boolean" || !isStr(x.updatedAtUtc) || updatedBy === undefined) {
    return null;
  }
  return { locale: x.locale, status: x.status as BlogStatus, version: x.version, title: x.title, slug: x.slug, hasDraft: x.hasDraft, updatedAtUtc: x.updatedAtUtc, updatedBy, coverMediaId: isStr(x.coverMediaId) ? x.coverMediaId : null };
}

const parseList = (x: unknown): BlogPostList | null => {
  if (!isRec(x) || !isInt(x.page) || !isInt(x.pageSize) || !isInt(x.total)) return null;
  const items = asList(x.items, (item) => {
    if (!isRec(item) || !isStr(item.id) || !isStr(item.updatedAtUtc)) return null;
    const translations = asList(item.translations, row);
    return translations ? { id: item.id, updatedAtUtc: item.updatedAtUtc, translations } : null;
  });
  return items ? { items, page: x.page, pageSize: x.pageSize, total: x.total } : null;
};

const parseSummaries = (x: unknown): BlogRevisionSummary[] | null =>
  asList(x, (item) => {
    if (!isRec(item)) return null;
    const createdBy = staff(item.createdBy);
    const publishedBy = staff(item.publishedBy);
    if (
      !isStr(item.id) || !isInt(item.number) || (item.state !== "Draft" && item.state !== "Frozen") || !isStr(item.origin) || !isStr(item.title) || !isStr(item.slug) ||
      !isStr(item.createdAtUtc) || !isStrOrNull(item.publishedAtUtc ?? null) || typeof item.isDraft !== "boolean" || typeof item.isPublished !== "boolean" ||
      createdBy === undefined || publishedBy === undefined
    ) {
      return null;
    }
    return {
      id: item.id, number: item.number, state: item.state, origin: item.origin, title: item.title, slug: item.slug, createdAtUtc: item.createdAtUtc, createdBy,
      publishedAtUtc: (item.publishedAtUtc as string | null | undefined) ?? null, publishedBy, isDraft: item.isDraft, isPublished: item.isPublished,
    };
  });

function categoryTexts(x: unknown): Record<string, BlogCategoryText> | null {
  if (!isRec(x)) return null;
  const out: Record<string, BlogCategoryText> = {};
  for (const [locale, text] of Object.entries(x)) {
    if (!isRec(text) || !isStr(text.name) || !isStr(text.slug) || !isStrOrNull(text.description ?? null)) return null;
    out[locale] = { name: text.name, slug: text.slug, description: (text.description as string | null | undefined) ?? null };
  }
  return out;
}

const parseCategory = (x: unknown): BlogCategory | null => {
  if (!isRec(x)) return null;
  const translations = categoryTexts(x.translations);
  if (!isStr(x.id) || !isStrOrNull(x.systemKey ?? null) || !isInt(x.sortOrder) || !isInt(x.version) || !translations || !isInt(x.revisionCount) || !isInt(x.pinCount) || typeof x.isHomeSection !== "boolean") {
    return null;
  }
  return { id: x.id, systemKey: (x.systemKey as string | null | undefined) ?? null, sortOrder: x.sortOrder, version: x.version, translations, revisionCount: x.revisionCount, pinCount: x.pinCount, isHomeSection: x.isHomeSection };
};

const parseCategories = (x: unknown) => asList(x, parseCategory);

const parsePins = (x: unknown): BlogPins | null => {
  if (!isRec(x) || !isStr(x.categoryId) || !isInt(x.version)) return null;
  const pins = asList(x.pins, (pin) => {
    if (!isRec(pin) || !isStr(pin.postId) || !isInt(pin.position) || typeof pin.effective !== "boolean" || !isRec(pin.titles)) return null;
    return { postId: pin.postId, position: pin.position, effective: pin.effective, titles: Object.fromEntries(Object.entries(pin.titles).filter(([, v]) => isStr(v))) as Record<string, string> };
  });
  return pins ? { categoryId: x.categoryId, version: x.version, pins } : null;
};

const parseSettings = (x: unknown): BlogSettings | null =>
  isRec(x) && isStrOrNull(x.homeSectionCategoryId ?? null) && isInt(x.version) && isStr(x.updatedAtUtc)
    ? { homeSectionCategoryId: (x.homeSectionCategoryId as string | null | undefined) ?? null, version: x.version, updatedAtUtc: x.updatedAtUtc }
    : null;

export function parseBlogMedia(x: unknown): BlogMedia | null {
  if (!isRec(x)) return null;
  const variants = asList(x.variants, (v) =>
    isRec(v) && isStr(v.preset) && isStr(v.format) && isStr(v.contentType) && isInt(v.width) && isInt(v.height) && isNum(v.byteSize)
      ? { preset: v.preset, format: v.format, contentType: v.contentType, width: v.width, height: v.height, byteSize: v.byteSize }
      : null);
  const usage = x.usage;
  if (
    !isStr(x.id) || !isStr(x.contentType) || !isNum(x.byteSize) || !isInt(x.width) || !isInt(x.height) || !isStr(x.createdAtUtc) || !isStr(x.displayName) ||
    !isStr(x.originalFileName) || !isStr(x.description) || !isStr(x.credit) || !isStr(x.sourceUrl) || !isStr(x.licence) || !isNum(x.focalX) || !isNum(x.focalY) ||
    !isInt(x.version) || (x.pipeline !== "current" && x.pipeline !== "legacy") || !isStrOrNull(x.originalSha256 ?? null) || !isStr(x.updatedAtUtc) || !variants ||
    !isRec(usage) || !isInt(usage.revisions) || !isInt(usage.inPublished) || !isInt(usage.inDrafts)
  ) {
    return null;
  }
  return {
    id: x.id, contentType: x.contentType, byteSize: x.byteSize, width: x.width, height: x.height, createdAtUtc: x.createdAtUtc, displayName: x.displayName,
    originalFileName: x.originalFileName, description: x.description, credit: x.credit, sourceUrl: x.sourceUrl, licence: x.licence, focalX: x.focalX, focalY: x.focalY,
    version: x.version, pipeline: x.pipeline, originalSha256: (x.originalSha256 as string | null | undefined) ?? null, updatedAtUtc: x.updatedAtUtc, variants,
    usage: { revisions: usage.revisions, inPublished: usage.inPublished, inDrafts: usage.inDrafts },
  };
}

const parseMediaList = (x: unknown): BlogMediaList | null => {
  if (!isRec(x) || !isInt(x.page) || !isInt(x.pageSize) || !isInt(x.total)) return null;
  const items = asList(x.items, parseBlogMedia);
  return items ? { items, page: x.page, pageSize: x.pageSize, total: x.total } : null;
};

const parseUsage = (x: unknown): BlogMediaUsage | null => {
  if (!isRec(x) || !isStr(x.mediaId) || !isInt(x.total) || typeof x.truncated !== "boolean") return null;
  const items = asList(x.items, (use) =>
    isRec(use) && isStr(use.postId) && isStr(use.locale) && isStr(use.postStatus) && isStr(use.title) && isStr(use.revisionId) && isInt(use.revisionNumber) &&
    (use.revisionState === "Draft" || use.revisionState === "Frozen") && typeof use.isPublished === "boolean" && Array.isArray(use.kinds)
      ? { postId: use.postId, locale: use.locale, postStatus: use.postStatus, title: use.title, revisionId: use.revisionId, revisionNumber: use.revisionNumber, revisionState: use.revisionState as "Draft" | "Frozen", isPublished: use.isPublished, kinds: use.kinds.filter(isStr) }
      : null);
  return items ? { mediaId: x.mediaId, total: x.total, truncated: x.truncated, items } : null;
};

const previewMedia = (x: unknown): BlogPreviewMedia | null => {
  if (!isRec(x) || !isStr(x.url) || !isInt(x.width) || !isInt(x.height)) return null;
  const variants = asList(x.variants, (v) => (isRec(v) && isStr(v.preset) && isStr(v.format) && isStr(v.type) && isStr(v.url) && isInt(v.width) && isInt(v.height) ? { preset: v.preset, format: v.format, type: v.type, url: v.url, width: v.width, height: v.height } : null));
  return variants ? { url: x.url, width: x.width, height: x.height, variants } : null;
};

const categoryRef = (x: unknown) => (isRec(x) && isStr(x.slug) && isStr(x.name) && typeof x.isPrimary === "boolean" ? { slug: x.slug, name: x.name, isPrimary: x.isPrimary } : null);

const parsePreview = (x: unknown): BlogPreview | null => {
  if (!isRec(x)) return null;
  const cover = x.cover === null || x.cover === undefined ? null : previewMedia(x.cover);
  const categories = asList(x.categories, categoryRef);
  const alternates = asList(x.alternates, (a) => (isRec(a) && isStr(a.locale) && isStr(a.slug) ? { locale: a.locale, slug: a.slug } : null));
  const media: Record<string, BlogPreviewMedia> = {};
  if (!isRec(x.media) || !isRec(x.properties) || !isRec(x.seo)) return null;
  for (const [id, m] of Object.entries(x.media)) {
    const parsed = previewMedia(m);
    if (!parsed) return null;
    media[id] = parsed;
  }
  const properties: Record<string, { slug: string; name: string }> = {};
  for (const [id, p] of Object.entries(x.properties)) {
    if (!isRec(p) || !isStr(p.slug) || !isStr(p.name)) return null;
    properties[id] = { slug: p.slug, name: p.name };
  }
  if (
    (x.source !== "draft" && x.source !== "published") || !isInt(x.revisionNumber) || !isStr(x.status) || !STATUSES.has(x.status) || !isInt(x.version) || !isStr(x.id) ||
    !isStr(x.locale) || !isStr(x.slug) || !isStr(x.title) || !isStr(x.summary) || !isStr(x.author) || !isStr(x.firstPublishedAt) || !isStr(x.modifiedAt) ||
    !categories || !alternates || (x.cover != null && !cover)
  ) {
    return null;
  }
  const alt = isRec(x.cover) && isStr(x.cover.alt) ? x.cover.alt : "";
  return {
    source: x.source, revisionNumber: x.revisionNumber, status: x.status as BlogStatus, version: x.version, id: x.id, locale: x.locale, slug: x.slug, title: x.title,
    summary: x.summary, body: x.body, cover: cover ? { ...cover, alt } : null, author: x.author, firstPublishedAt: x.firstPublishedAt, modifiedAt: x.modifiedAt,
    primaryCategory: categoryRef(x.primaryCategory), categories, media, properties,
    seo: { metaTitle: isStr(x.seo.metaTitle) ? x.seo.metaTitle : null, metaDescription: isStr(x.seo.metaDescription) ? x.seo.metaDescription : null, ogImageUrl: isStr(x.seo.ogImageUrl) ? x.seo.ogImageUrl : null },
    alternates,
  };
};

// ---------------------------------------------------------------- calls

const BLOG = "/api/admin/v1/website/blog";
const enc = encodeURIComponent;

const read = <T,>(path: string, parse: (x: unknown) => T | null, signal?: AbortSignal) => call<T>("GET", `${BLOG}${path}`, undefined, { write: false, parse, signal });
const write = <T,>(path: string, body: unknown, parse: (x: unknown) => T | null) => call<T>("POST", `${BLOG}${path}`, body, { write: true, parse });
const writeNoContent = (path: string, body: unknown) => call<undefined>("POST", `${BLOG}${path}`, body, { write: true, noContent: true });

export interface PostQuery {
  q?: string;
  categoryId?: string;
  status?: string;
  locale?: string;
  page: number;
  pageSize: number;
}

export const listPosts = (query: PostQuery, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.status) params.set("status", query.status);
  if (query.locale) params.set("locale", query.locale);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return read(`/posts?${params}`, parseList, signal);
};

export const getPost = (id: string, signal?: AbortSignal) => read(`/posts/${enc(id)}`, parseBlogPost, signal);

/** Starts a post. `id` is the client's: the same id is sent again if the answer is lost, so the post exists once (a repeat is 409 `blog.duplicate-id`). */
export const createPost = (id: string, locale: string, draft: BlogDraftInput) => write("/posts", { id, locale, draft }, parseBlogPost);

/** `expectedVersion` 0 creates the translation; any other must be the version last read. */
export const saveDraft = (postId: string, locale: string, expectedVersion: number, draft: BlogDraftInput) =>
  write(`/posts/${enc(postId)}/translations/${enc(locale)}/draft`, { expectedVersion, draft }, parseBlogPost);

export type BlogTransition = "publish" | "unpublish" | "archive" | "unarchive";

export const transitionPost = (postId: string, locale: string, action: BlogTransition, expectedVersion: number) =>
  write(`/posts/${enc(postId)}/translations/${enc(locale)}/${action}`, { expectedVersion }, parseBlogPost);

export const restoreRevision = (postId: string, locale: string, revisionId: string, expectedVersion: number) =>
  write(`/posts/${enc(postId)}/translations/${enc(locale)}/revisions/${enc(revisionId)}/restore`, { expectedVersion }, parseBlogPost);

export const listRevisions = (postId: string, locale: string, signal?: AbortSignal) =>
  read(`/posts/${enc(postId)}/translations/${enc(locale)}/revisions`, parseSummaries, signal);

export const getRevision = (postId: string, locale: string, revisionId: string, signal?: AbortSignal) =>
  read(`/posts/${enc(postId)}/translations/${enc(locale)}/revisions/${enc(revisionId)}`, revision, signal);

export const getPreview = (postId: string, locale: string, signal?: AbortSignal) =>
  read(`/posts/${enc(postId)}/translations/${enc(locale)}/preview`, parsePreview, signal);

export const listCategories = (signal?: AbortSignal) => read("/categories", parseCategories, signal);

export type CategoryTexts = Record<string, { name: string; slug: string; description: string | null }>;

export const createCategory = (id: string, sortOrder: number, translations: CategoryTexts) => write("/categories", { id, sortOrder, translations }, parseCategory);

export const saveCategory = (id: string, expectedVersion: number, sortOrder: number, translations: CategoryTexts) =>
  write(`/categories/${enc(id)}/save`, { expectedVersion, sortOrder, translations }, parseCategory);

export const deleteCategory = (id: string, expectedVersion: number) => writeNoContent(`/categories/${enc(id)}/delete`, { expectedVersion });

export const getPins = (categoryId: string, signal?: AbortSignal) => read(`/categories/${enc(categoryId)}/pins`, parsePins, signal);

export const savePins = (categoryId: string, expectedVersion: number, postIds: string[]) => write(`/categories/${enc(categoryId)}/pins/save`, { expectedVersion, postIds }, parsePins);

export const getSettings = (signal?: AbortSignal) => read("/settings", parseSettings, signal);

export const saveSettings = (expectedVersion: number, homeSectionCategoryId: string | null) => write("/settings/save", { expectedVersion, homeSectionCategoryId }, parseSettings);

export interface MediaQuery {
  q?: string;
  usage?: "used" | "unused";
  page: number;
  pageSize: number;
}

export const listMedia = (query: MediaQuery, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.usage) params.set("usage", query.usage);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return read(`/media?${params}`, parseMediaList, signal);
};

export const getMedia = (id: string, signal?: AbortSignal) => read(`/media/${enc(id)}/detail`, parseBlogMedia, signal);

export const getMediaUsage = (id: string, signal?: AbortSignal) => read(`/media/${enc(id)}/usage`, parseUsage, signal);

export interface MediaFields {
  displayName: string;
  description: string;
  credit: string;
  sourceUrl: string;
  licence: string;
  focalX: number;
  focalY: number;
}

export const saveMedia = (id: string, expectedVersion: number, fields: MediaFields) => write(`/media/${enc(id)}/save`, { expectedVersion, ...fields }, parseBlogMedia);

export const deleteMedia = (id: string, expectedVersion: number) => writeNoContent(`/media/${enc(id)}/delete`, { expectedVersion });

// ---------------------------------------------------------------- pictures: bytes through the Staff session

export type PreviewPreset = "thumb" | "card" | "article";

/** The address of a picture on the Staff route — never a public one. `null` when the API address is not configured. */
export function staffMediaUrl(path: string): string | null {
  const base = getApiBaseUrl();
  return base.ok ? `${base.baseUrl}${path}` : null;
}

export const mediaPreviewPath = (id: string, preset: PreviewPreset) => `${BLOG}/media/${enc(id)}/preview/${preset}`;

/**
 * Reads a Staff picture (an API path as the preview or `mediaPreviewPath` gives it) with the Staff cookie. The caller owns the Blob and must revoke
 * the object URL it makes (`useStaffImage` does). A 401/403 is reported, never retried.
 */
export async function fetchStaffImage(path: string, signal?: AbortSignal): Promise<WebsiteResult<Blob>> {
  const mode = getAccessMode();
  const base = getApiBaseUrl();
  if (!mode.ok || mode.mode !== "Staff" || !base.ok) return { kind: "config", message: "Ảnh Staff cần đăng nhập Staff và địa chỉ API HTTPS." };
  try {
    const response = await fetch(`${base.baseUrl}${path}`, { method: "GET", credentials: "include", cache: "no-store", redirect: "error", signal });
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "denied" };
    if (!response.ok) return { kind: "error", status: response.status, message: `Không tải được ảnh (HTTP ${response.status}).` };
    const blob = await response.blob();
    return blob.type.startsWith("image/") ? { kind: "ok", data: blob } : { kind: "invalid-response", message: "Máy chủ không trả về ảnh." };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "network", message: "Yêu cầu đã bị huỷ." };
    return { kind: "network", message: "Không kết nối được tới máy chủ Admin." };
  }
}

// ---------------------------------------------------------------- uploads (XMLHttpRequest: the only API that reports bytes sent)

export type UploadOutcome =
  | { kind: "ok"; media: BlogMedia }
  /** The server refused it and stored nothing (a 4xx other than a duplicate id). */
  | { kind: "refused"; status: number; code: string | null; detail: string }
  /** `409 blog.duplicate-id`: a picture with this id exists. Read it back before believing anything about it. */
  | { kind: "duplicate" }
  | { kind: "unauthenticated" }
  | { kind: "denied" }
  /** No answer (network error, timeout, a 5xx, an unreadable 2xx): the picture may or may not exist. */
  | { kind: "unconfirmed"; message: string }
  /** The caller aborted. The server may still have received it: this proves nothing about whether it exists. */
  | { kind: "aborted" };

export interface UploadHandle {
  done: Promise<UploadOutcome>;
  abort: () => void;
}

/**
 * Sends one picture with `id` as its client id (a repeat of an id that exists is `409 blog.duplicate-id`, never a second copy). `onProgress` reports
 * bytes sent to the network — not that the server has processed the picture; that is only the answer.
 */
export function uploadMedia(file: File, id: string, onProgress: (sent: number, total: number) => void): UploadHandle {
  const request = new XMLHttpRequest();
  const done = new Promise<UploadOutcome>((resolve) => {
    const mode = getAccessMode();
    const base = getApiBaseUrl();
    if (!mode.ok || mode.mode !== "Staff" || !base.ok) {
      resolve({ kind: "unconfirmed", message: "Tải ảnh cần đăng nhập Staff và địa chỉ API HTTPS; chưa có gì được gửi." });
      return;
    }

    request.open("POST", `${base.baseUrl}${BLOG}/media`);
    request.withCredentials = true;
    request.responseType = "text";
    request.setRequestHeader("Accept", "application/json");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onabort = () => resolve({ kind: "aborted" });
    request.onerror = () => resolve({ kind: "unconfirmed", message: "Mất kết nối khi tải ảnh lên; ảnh có thể đã hoặc chưa được lưu." });
    request.ontimeout = () => resolve({ kind: "unconfirmed", message: "Máy chủ không trả lời kịp; ảnh có thể đã hoặc chưa được lưu." });
    request.onload = () => {
      const status = request.status;
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // Not JSON: judged by the status alone.
      }
      if (status === 401) return resolve({ kind: "unauthenticated" });
      if (status === 403) return resolve({ kind: "denied" });
      if (status === 409 && isRec(body) && body.code === "blog.duplicate-id") return resolve({ kind: "duplicate" });
      if (status === 413) return resolve({ kind: "refused", status, code: "hero-image-too-large", detail: "Ảnh lớn hơn 10 MB." });
      if (status === 400 || status === 404 || status === 409) {
        return resolve({ kind: "refused", status, code: isRec(body) && isStr(body.code) ? body.code : null, detail: isRec(body) && isStr(body.detail) ? body.detail : `Máy chủ từ chối ảnh (HTTP ${status}).` });
      }
      if (status >= 500) return resolve({ kind: "unconfirmed", message: `Máy chủ trả lời HTTP ${status}; ảnh có thể đã hoặc chưa được lưu.` });
      const media = status === 200 ? parseBlogMedia(body) : null;
      resolve(media ? { kind: "ok", media } : { kind: "unconfirmed", message: "Không đọc được câu trả lời của máy chủ; ảnh có thể đã hoặc chưa được lưu." });
    };

    const form = new FormData();
    form.append("file", file, file.name);
    form.append("id", id);
    request.send(form);
  });
  return { done, abort: () => request.abort() };
}

// ---------------------------------------------------------------- what the screens need that is not Blog-only

export interface ActiveLanguage {
  code: string;
  displayName: string;
  nativeName: string;
  isDefault: boolean;
}

/** The shape the backend accepts for a language (`LanguageTag.Shape`): language, optional 4-letter script, optional 2-letter or 3-digit region. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?$/;

/**
 * The key the Blog stores and returns a language under: the backend's `LanguageTag.TryNormalize` (trim, check the shape, case-fold). The public configuration
 * spells the same language in its canonical casing (`en-US`), which is not that key. Text that is not such a tag is left as it is - no alias is invented.
 */
export function normalizeLanguageCode(code: string): string {
  const trimmed = code.trim();
  return LANGUAGE_TAG.test(trimmed) ? trimmed.toLowerCase() : code;
}

/**
 * The website's active languages, from the public configuration — the settings route that lists them needs a permission a Blog-only account does
 * not have. The policy is uncredentialed, so the cookie is not sent. The codes leave here as the Blog's own keys (`normalizeLanguageCode`).
 */
export async function fetchActiveLanguages(signal?: AbortSignal): Promise<WebsiteResult<ActiveLanguage[]>> {
  const base = getApiBaseUrl();
  if (!base.ok) return { kind: "config", message: "Chưa cấu hình địa chỉ API HTTPS." };
  try {
    const response = await fetch(`${base.baseUrl}/api/v1/website/config`, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } });
    if (!response.ok) return { kind: "error", status: response.status, message: `Không đọc được danh sách ngôn ngữ (HTTP ${response.status}).` };
    const body: unknown = await response.json();
    const languages = isRec(body)
      ? asList(body.locales, (l) => (isRec(l) && isStr(l.code) && isStr(l.displayName) && isStr(l.nativeName) && typeof l.isDefault === "boolean" ? { code: normalizeLanguageCode(l.code), displayName: l.displayName, nativeName: l.nativeName, isDefault: l.isDefault } : null))
      : null;
    return languages ? { kind: "ok", data: languages } : { kind: "invalid-response", message: "Không đọc được danh sách ngôn ngữ." };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "network", message: "Yêu cầu đã bị huỷ." };
    return { kind: "network", message: "Không kết nối được tới máy chủ để đọc danh sách ngôn ngữ." };
  }
}
