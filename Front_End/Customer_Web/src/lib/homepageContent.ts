import { POST_CATEGORIES, PostCategory, TRAVEL_POSTS, TravelPost } from "@/data/travelPosts";
import { BLOG_PATH } from "@/lib/riversideHomeContent";

/**
 * CUST-WEB-001-CP08a-C2: the decisions behind the booking-portal home page, `/offers`, `/blog` and
 * `/blog/<slug>`, kept as pure functions so that what a URL means is tested rather than assumed.
 */

/** 1089000 → "1.089.000 ₫". Formatted by hand so the server and the browser print the same characters. */
export function formatVnd(amount: number): string {
  const whole = Math.round(amount);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole < 0 ? "-" : ""}${digits} ₫`;
}

// ---- blog -------------------------------------------------------------------------------------------

export const postPath = (slug: string) => `${BLOG_PATH}/${slug}`;
export const blogCategoryPath = (category: string) => `${BLOG_PATH}?category=${category}`;

export function findCategory(slug: string): PostCategory | undefined {
  return POST_CATEGORIES.find((category) => category.slug === slug);
}

export type BlogFilter = { kind: "all" } | { kind: "category"; category: PostCategory } | { kind: "invalid" };

/**
 * What `?category=` means on `/blog`. Absent or empty: every post. Exactly one value naming a category
 * that has posts: that category. Anything else — an unknown value, a repeated parameter, a different
 * letter case — is `invalid`, and the page answers 404 instead of guessing which list the link meant.
 */
export function resolveBlogFilter(param: string | string[] | undefined): BlogFilter {
  if (param === undefined || param === "") return { kind: "all" };
  if (typeof param !== "string") return { kind: "invalid" };
  const category = findCategory(param);
  if (!category || postsInCategory(category.slug).length === 0) return { kind: "invalid" };
  return { kind: "category", category };
}

export function postsInCategory(category: string): TravelPost[] {
  return TRAVEL_POSTS.filter((post) => post.category === category);
}

export function postsForFilter(filter: BlogFilter): TravelPost[] {
  if (filter.kind === "category") return postsInCategory(filter.category.slug);
  if (filter.kind === "all") return [...TRAVEL_POSTS];
  return [];
}

/**
 * The post a `/blog/<…>` path names. Only a single segment that equals a slug exactly resolves: no
 * trailing path, no other case, no encoded variant, nothing from the old template's single-article route.
 */
export function findPostBySegments(segments: string[] | undefined): TravelPost | undefined {
  if (!segments || segments.length !== 1) return undefined;
  return TRAVEL_POSTS.find((post) => post.slug === segments[0]);
}

export function relatedPosts(post: TravelPost): TravelPost[] {
  const related: TravelPost[] = [];
  for (const slug of post.related) {
    const other = TRAVEL_POSTS.find((candidate) => candidate.slug === slug);
    if (other && other.slug !== post.slug && related.indexOf(other) === -1) related.push(other);
  }
  return related;
}

export const homeDestinations = (): TravelPost[] => postsInCategory("diem-den-noi-bat");
export const homeNews = (): TravelPost[] => postsInCategory("tin-du-lich");

/** "2026-10-14" → "14/10/2026"; anything that is not an ISO date is not printed. */
export function formatPostDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** A source link opens only when it is `https`; the page renders it with `rel="noopener noreferrer"`. */
export function isSafeSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}
