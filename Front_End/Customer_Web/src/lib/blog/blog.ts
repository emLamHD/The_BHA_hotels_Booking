/**
 * BHA-BLOG-001-CP04: the public Blog the Admin publishes, as `GET /api/v1/website/blog/*` serves it (design §6). The API has already chosen the
 * language, dropped everything that is not published and sent no Staff field; this module only checks the shape (a proxy's error page or an older
 * API is "not a post", never half of one), makes a picture's address absolute, and builds the Customer URLs. Reading and rendering never trust a
 * field the contract does not name: an unknown block is left out, an unsafe link is shown as plain text.
 */

export interface BlogVariant {
  preset: "thumb" | "card" | "article";
  format: "webp" | "jpg" | "png";
  type: string;
  url: string;
  width: number;
  height: number;
}

export interface BlogCover {
  url: string;
  alt: string;
  width: number;
  height: number;
  variants: BlogVariant[];
}

export interface BlogCategoryRef {
  slug: string;
  name: string;
  isPrimary: boolean;
}

export interface BlogPostItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  cover: BlogCover;
  author: string;
  firstPublishedAt: string;
  modifiedAt: string;
  primaryCategory: BlogCategoryRef | null;
  categories: BlogCategoryRef[];
}

export interface BlogPostList {
  locale: string;
  items: BlogPostItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BlogCategory {
  slug: string;
  name: string;
  description: string | null;
  postCount: number;
}

export interface BlogMediaRef {
  url: string;
  width: number;
  height: number;
  variants: BlogVariant[];
}

export interface BlogPostDetail extends BlogPostItem {
  locale: string;
  body: unknown;
  media: Record<string, BlogMediaRef>;
  properties: Record<string, { slug: string; name: string }>;
  seo: { metaTitle: string | null; metaDescription: string | null; ogImageUrl: string | null };
  alternates: { locale: string; slug: string }[];
}

export interface BlogHomeSection {
  locale: string;
  category: BlogCategory | null;
  items: BlogPostItem[];
}

const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A picture is only ever one of the API's own Blog media addresses: the plain one, or a sized one that names its generation, preset and format. */
const MEDIA_PATH = new RegExp(`^/api/v1/website/blog/media/${GUID}(?:/\\d+/(?:thumb|card|article)\\.(?:webp|jpg|png))?$`, "i");
export const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRESETS = new Set(["thumb", "card", "article"]);
const FORMATS = new Set(["webp", "jpg", "png"]);

const rec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
const size = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0;
const iso = (x: unknown): x is string => typeof x === "string" && !Number.isNaN(Date.parse(x));

function absolute(path: unknown, apiBase: string): string | null {
  return typeof path === "string" && MEDIA_PATH.test(path) ? `${apiBase}${path}` : null;
}

function parseVariant(x: unknown, apiBase: string): BlogVariant | null {
  if (!rec(x) || !PRESETS.has(x.preset as string) || !FORMATS.has(x.format as string) || !text(x.type) || !size(x.width) || !size(x.height)) return null;
  const url = absolute(x.url, apiBase);
  return url ? { preset: x.preset as BlogVariant["preset"], format: x.format as BlogVariant["format"], type: x.type, url, width: x.width, height: x.height } : null;
}

const variants = (x: unknown, apiBase: string): BlogVariant[] =>
  Array.isArray(x) ? x.map((v) => parseVariant(v, apiBase)).filter((v): v is BlogVariant => v !== null) : [];

function parseCover(x: unknown, apiBase: string): BlogCover | null {
  if (!rec(x) || typeof x.alt !== "string" || !size(x.width) || !size(x.height)) return null;
  const url = absolute(x.url, apiBase);
  return url ? { url, alt: x.alt, width: x.width, height: x.height, variants: variants(x.variants, apiBase) } : null;
}

function parseCategoryRef(x: unknown): BlogCategoryRef | null {
  return rec(x) && text(x.slug) && BLOG_SLUG.test(x.slug) && text(x.name) && typeof x.isPrimary === "boolean" ? { slug: x.slug, name: x.name, isPrimary: x.isPrimary } : null;
}

const categoryRefs = (x: unknown): BlogCategoryRef[] => (Array.isArray(x) ? x.map(parseCategoryRef).filter((c): c is BlogCategoryRef => c !== null) : []);

export function parsePostItem(x: unknown, apiBase: string): BlogPostItem | null {
  if (!rec(x) || !text(x.id) || !text(x.slug) || !BLOG_SLUG.test(x.slug) || !text(x.title) || !text(x.summary) || typeof x.author !== "string") return null;
  if (!iso(x.firstPublishedAt) || !iso(x.modifiedAt)) return null;
  const cover = parseCover(x.cover, apiBase);
  if (!cover) return null;
  return {
    id: x.id, slug: x.slug, title: x.title, summary: x.summary, cover, author: x.author, firstPublishedAt: x.firstPublishedAt, modifiedAt: x.modifiedAt,
    primaryCategory: x.primaryCategory === null || x.primaryCategory === undefined ? null : parseCategoryRef(x.primaryCategory), categories: categoryRefs(x.categories),
  };
}

/** A card the API sent that cannot be read is left out; it never breaks the others. */
const items = (x: unknown, apiBase: string): BlogPostItem[] => (Array.isArray(x) ? x.map((i) => parsePostItem(i, apiBase)).filter((i): i is BlogPostItem => i !== null) : []);

export function parsePostList(json: unknown, apiBase: string): BlogPostList | null {
  if (!rec(json) || !text(json.locale) || !Array.isArray(json.items) || !size(json.page) || !size(json.pageSize)) return null;
  if (typeof json.total !== "number" || !Number.isInteger(json.total) || json.total < 0) return null;
  return { locale: json.locale, items: items(json.items, apiBase), page: json.page, pageSize: json.pageSize, total: json.total };
}

export function parseCategory(x: unknown): BlogCategory | null {
  if (!rec(x) || !text(x.slug) || !BLOG_SLUG.test(x.slug) || !text(x.name) || typeof x.postCount !== "number" || !Number.isInteger(x.postCount) || x.postCount < 0) return null;
  return { slug: x.slug, name: x.name, description: typeof x.description === "string" && x.description.trim() !== "" ? x.description : null, postCount: x.postCount };
}

export function parseCategoryList(json: unknown): BlogCategory[] | null {
  if (!rec(json) || !Array.isArray(json.items)) return null;
  return json.items.map(parseCategory).filter((c): c is BlogCategory => c !== null);
}

export function parseHomeSection(json: unknown, apiBase: string): BlogHomeSection | null {
  if (!rec(json) || !text(json.locale) || !Array.isArray(json.items)) return null;
  return { locale: json.locale, category: json.category ? parseCategory(json.category) : null, items: items(json.items, apiBase) };
}

export function parsePostDetail(json: unknown, apiBase: string): BlogPostDetail | null {
  const base = parsePostItem(json, apiBase);
  if (!base || !rec(json) || !text(json.locale) || !rec(json.body) || !rec(json.media) || !rec(json.properties) || !rec(json.seo) || !Array.isArray(json.alternates)) return null;
  const media: Record<string, BlogMediaRef> = {};
  for (const [id, ref] of Object.entries(json.media)) {
    if (!rec(ref) || !size(ref.width) || !size(ref.height)) continue;
    const url = absolute(ref.url, apiBase);
    if (url) media[id.toLowerCase()] = { url, width: ref.width, height: ref.height, variants: variants(ref.variants, apiBase) };
  }
  const properties: Record<string, { slug: string; name: string }> = {};
  for (const [id, p] of Object.entries(json.properties)) {
    if (rec(p) && text(p.slug) && text(p.name)) properties[id.toLowerCase()] = { slug: p.slug, name: p.name };
  }
  const seo = json.seo;
  const optional = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const alternates = json.alternates
    .filter((a): a is { locale: string; slug: string } => rec(a) && typeof a.locale === "string" && normalizeLocale(a.locale) !== null && typeof a.slug === "string" && BLOG_SLUG.test(a.slug))
    .map((a) => ({ locale: normalizeLocale(a.locale)!, slug: a.slug }));
  return {
    ...base, locale: json.locale, body: json.body, media, properties, alternates,
    seo: { metaTitle: optional(seo.metaTitle), metaDescription: optional(seo.metaDescription), ogImageUrl: absolute(seo.ogImageUrl, apiBase) },
  };
}

// ---- locale ------------------------------------------------------------------------------------------------------------------------------

/** BHA-BLOG-001-CP04-CP05-C7: the one internal step that lets the language switch leave a Blog 404 for a Blog index of the SAME pathname (see `app/blog-recover`). */
export const BLOG_RECOVER_PATH = "/blog-recover";
export const blogRecoverHref = (locale: string) => `${BLOG_RECOVER_PATH}?locale=${encodeURIComponent(locale)}`;

/**
 * Next 13.4.3's not-found boundary clears only when the pathname changes, so a switch from a Blog index 404 (`/blog?page=abc`, `/blog?locale=zz`) to `/blog?locale=en`
 * leaves the 404 body on a valid page. When the reader is on the Blog index's own pathname, each target that is the Blog index goes through the recovery step instead;
 * every other target (and every other pathname) is unchanged.
 */
export function recoverSamePath(targets: Record<string, string>, pathname: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(targets).map(([code, href]) => {
      const locale = new URLSearchParams(href.split("?")[1] ?? "").get("locale");
      return [code, pathname === BLOG_ROOT && href.split("?")[0] === BLOG_ROOT && locale !== null ? blogRecoverHref(locale) : href];
    })
  );
}

/** Whether a URL path is a page of the Blog (`/blog`, `/blog/...`); `/blog-moved` and `/blogging` are not. */
export const isBlogPath = (pathname: string): boolean => pathname === "/blog" || pathname.startsWith("/blog/");

const LOCALE_SHAPE = /^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?(?:-([A-Za-z]{2}|[0-9]{3}))?$/;

/** The key the backend uses (`en-US` → `en-us`, `zh-Hant` → `zh-hant`): the same grammar, case-folded. `null` for a text that is not a language tag. */
export function normalizeLocale(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return LOCALE_SHAPE.test(trimmed) && trimmed.length <= 35 ? trimmed.toLowerCase() : null;
}

/** The tag in its canonical casing (language lower, script Title, region UPPER), for `hreflang` and `og:locale`. */
export function languageTag(normalized: string): string {
  return normalized
    .split("-")
    .map((part, i) => (i === 0 ? part : part.length === 4 ? part[0].toUpperCase() + part.slice(1) : part.toUpperCase()))
    .join("-");
}

/** The locale a Blog URL means: its explicit `?locale=` (validated), else the one the site resolved for the visitor. `null` = the URL names a locale that is no language tag. */
export function blogLocaleOf(explicit: string | string[] | undefined, siteLocale: string): string | null {
  if (explicit === undefined) return normalizeLocale(siteLocale);
  return typeof explicit === "string" ? normalizeLocale(explicit) : null;
}

// ---- URLs --------------------------------------------------------------------------------------------------------------------------------

export const BLOG_ROOT = "/blog";

function withQuery(path: string, locale: string, page?: number): string {
  const query = new URLSearchParams({ locale });
  if (page && page > 1) query.set("page", String(page));
  return `${path}?${query.toString()}`;
}

/** Every Blog link keeps the locale it was made for: copied into another window, it opens the same translation whatever that window's cookie says. */
export const blogIndexHref = (locale: string, page?: number) => withQuery(BLOG_ROOT, locale, page);
export const blogCategoryHref = (locale: string, slug: string, page?: number) => withQuery(`${BLOG_ROOT}/category/${slug}`, locale, page);
export const blogPostHref = (locale: string, slug: string) => withQuery(`${BLOG_ROOT}/${slug}`, locale);

/** `?page=` is a positive integer or absent; anything else is `null` (a 404, not a guess). */
export function parsePage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) return null;
  return Number(value);
}

export const lastPageOf = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** A post date as the reader's calendar day in Viet Nam (the site's time zone), in the visitor's format locale. */
export function formatPostDate(iso: string, formatLocale: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(parsed);
}
