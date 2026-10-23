import { parseCategory, parsePostDetail, parsePostItem, type BlogCategory, type BlogPostDetail, type BlogPostItem } from "./blog";

/**
 * Test fixtures for the Blog, in the shape the API serves (design §6) — only ever used by tests. A post is built as the API would send it, then read by the
 * same parser the pages use, so a fixture that the parser refuses fails loudly instead of rendering something else.
 */
export const API = "https://api.test";
const mediaPath = (n: number) => `/api/v1/website/blog/media/aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;

export const apiVariants = (n: number) =>
  (["thumb", "card", "article"] as const).flatMap((preset, i) => [
    { preset, format: "webp", type: "image/webp", url: `${mediaPath(n)}/1/${preset}.webp`, width: 320 * (i + 1), height: 213 * (i + 1) },
    { preset, format: "jpg", type: "image/jpeg", url: `${mediaPath(n)}/1/${preset}.jpg`, width: 320 * (i + 1), height: 213 * (i + 1) },
  ]);

export const apiCover = (n: number, alt = `Ảnh bìa ${n}`) => ({ url: mediaPath(n), alt, width: 1200, height: 800, variants: apiVariants(n) });

export const apiItem = (n: number, patch: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`,
  slug: `bai-viet-${n}`,
  title: `Bài viết ${n}`,
  summary: `Tóm tắt bài viết ${n}`,
  cover: apiCover(n),
  author: "Ban biên tập",
  firstPublishedAt: "2026-10-20T03:00:00+00:00",
  modifiedAt: "2026-10-21T03:00:00+00:00",
  primaryCategory: { slug: "diem-den", name: "Điểm đến", isPrimary: true },
  categories: [{ slug: "diem-den", name: "Điểm đến", isPrimary: true }],
  ...patch,
});

export const item = (n: number, patch: Record<string, unknown> = {}): BlogPostItem => parsePostItem(apiItem(n, patch), API)!;
export const items = (count: number) => Array.from({ length: count }, (_, i) => item(i + 1));

export const category = (slug = "diem-den", name = "Điểm đến", postCount = 3): BlogCategory => parseCategory({ slug, name, description: null, postCount })!;

export const apiDetail = (patch: Record<string, unknown> = {}) => ({
  ...apiItem(1),
  locale: "vi",
  body: { schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Nội dung" }] }] },
  media: {},
  properties: {},
  seo: { metaTitle: null, metaDescription: null, ogImageUrl: null },
  alternates: [],
  contentHash: "h",
  ...patch,
});

export const detail = (patch: Record<string, unknown> = {}): BlogPostDetail => parsePostDetail(apiDetail(patch), API)!;
