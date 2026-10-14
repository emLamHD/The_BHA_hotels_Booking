import { describe, expect, it } from "vitest";
import { MOCK_OFFERS } from "@/data/homepageOffers";
import { POST_CATEGORIES, TRAVEL_POSTS } from "@/data/travelPosts";
import {
  blogCategoryPath,
  discountPercent,
  findPostBySegments,
  formatPostDate,
  formatVnd,
  homeDestinations,
  homeNews,
  isSafeSourceUrl,
  postPath,
  postsForFilter,
  postsInCategory,
  relatedPosts,
  resolveBlogFilter,
  resolveOfferHighlight,
} from "./homepageContent";

describe("offers: mock prices and the percent they show", () => {
  it("the badge is the whole percent of the price drop", () => {
    expect(discountPercent(1000000, 800000)).toBe(20);
    expect(discountPercent(1350000, 1089000)).toBe(19);
    expect(discountPercent(1590000, 1247000)).toBe(22);
    expect(discountPercent(1000000, 999999)).toBe(0);
  });

  it("shows no badge for a price that is not a discount", () => {
    for (const [original, discount] of [[1000, 1000], [1000, 1200], [0, 0], [-5, -10], [1000, 0], [NaN, 5], [1000, Infinity]]) {
      expect(discountPercent(original, discount)).toBe(0);
    }
  });

  it("every sample offer is a real discount with a distinct slug, and the badge follows from its own prices", () => {
    expect(MOCK_OFFERS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(MOCK_OFFERS.map((offer) => offer.slug)).size).toBe(MOCK_OFFERS.length);
    expect(new Set(MOCK_OFFERS.map((offer) => offer.id)).size).toBe(MOCK_OFFERS.length);
    for (const offer of MOCK_OFFERS) {
      expect(Number.isInteger(offer.originalPrice) && Number.isInteger(offer.discountPrice)).toBe(true);
      expect(offer.discountPrice).toBeLessThan(offer.originalPrice);
      const percent = discountPercent(offer.originalPrice, offer.discountPrice);
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThan(100);
      expect(offer.image).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/);
      expect(offer.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("the sample offers say nothing about stock, time limits, ratings or reviews", () => {
    const text = JSON.stringify(MOCK_OFFERS);
    expect(text).not.toMatch(/còn \d|sắp hết|chỉ còn|hết hạn|đếm ngược|đánh giá|sao\b|review/i);
  });

  it("amounts print the same everywhere", () => {
    expect(formatVnd(1089000)).toBe("1.089.000 ₫");
    expect(formatVnd(950)).toBe("950 ₫");
    expect(formatVnd(1000)).toBe("1.000 ₫");
    expect(formatVnd(0)).toBe("0 ₫");
  });

  it("?offer highlights one known slug and nothing else", () => {
    expect(resolveOfferHighlight(MOCK_OFFERS[1].slug)?.id).toBe(MOCK_OFFERS[1].id);
    for (const bad of [undefined, "", "unknown", MOCK_OFFERS[0].slug.toUpperCase(), [MOCK_OFFERS[0].slug, MOCK_OFFERS[1].slug], ["x"]]) {
      expect(resolveOfferHighlight(bad as string)).toBeUndefined();
    }
  });
});

describe("blog filter: what ?category= means", () => {
  it("shows everything with no category, or an empty one", () => {
    expect(resolveBlogFilter(undefined)).toEqual({ kind: "all" });
    expect(resolveBlogFilter("")).toEqual({ kind: "all" });
    expect(postsForFilter({ kind: "all" })).toHaveLength(TRAVEL_POSTS.length);
  });

  it("shows one category, with its own posts only", () => {
    const filter = resolveBlogFilter("diem-den-noi-bat");
    expect(filter.kind).toBe("category");
    const posts = postsForFilter(filter);
    expect(posts.length).toBeGreaterThanOrEqual(6);
    expect(posts.every((post) => post.category === "diem-den-noi-bat")).toBe(true);
    expect(posts.every((post) => post.kind === "destination")).toBe(true);
    const news = postsForFilter(resolveBlogFilter("tin-du-lich"));
    expect(news.length).toBeGreaterThanOrEqual(3);
    expect(news.every((post) => post.kind === "news")).toBe(true);
  });

  it.each([["unknown"], ["Diem-Den-Noi-Bat"], ["diem-den-noi-bat "], ["diem-den-noi-bat,tin-du-lich"], ["%64iem-den-noi-bat"], [["diem-den-noi-bat", "tin-du-lich"]], [["diem-den-noi-bat", "diem-den-noi-bat"]], [["diem-den-noi-bat"]]])(
    "%j is invalid, not a guess",
    (value) => {
      const filter = resolveBlogFilter(value as string | string[]);
      expect(filter).toEqual({ kind: "invalid" });
      expect(postsForFilter(filter)).toEqual([]);
    }
  );

  it("every category in the allowlist has posts, so none is a dead filter", () => {
    for (const category of POST_CATEGORIES) expect(postsInCategory(category.slug).length).toBeGreaterThan(0);
    expect(resolveBlogFilter("cam-nang")).toEqual({ kind: "invalid" });
  });

  it("the home page's destination link is the real filter", () => {
    expect(blogCategoryPath("diem-den-noi-bat")).toBe("/blog?category=diem-den-noi-bat");
    expect(resolveBlogFilter("diem-den-noi-bat").kind).toBe("category");
  });
});

describe("blog detail: which path is an article", () => {
  it("resolves a slug exactly, from the home cards' own links", () => {
    for (const post of TRAVEL_POSTS) {
      expect(postPath(post.slug)).toBe(`/blog/${post.slug}`);
      expect(findPostBySegments([post.slug])?.id).toBe(post.id);
    }
    for (const card of [...homeDestinations(), ...homeNews()]) expect(findPostBySegments([card.slug])).toBeDefined();
  });

  it.each([[undefined], [[]], [["unknown"]], [["bai-bien-my-khe", "extra"]], [["bai-bien-my-khe", ""]], [["Bai-Bien-My-Khe"]], [["bai-bien-my-khe/"]], [["single"]], [["bai-bien-my-khe%2Fx"]], [["", "bai-bien-my-khe"]]])(
    "%j is not an article",
    (segments) => {
      expect(findPostBySegments(segments as string[] | undefined)).toBeUndefined();
    }
  );

  it("related posts exist, are not the post itself and carry no duplicates", () => {
    for (const post of TRAVEL_POSTS) {
      const related = relatedPosts(post);
      expect(related.length).toBeGreaterThan(0);
      expect(related.map((other) => other.slug)).toEqual([...post.related]);
      expect(related.some((other) => other.slug === post.slug)).toBe(false);
    }
  });
});

describe("small helpers", () => {
  it("prints a date as day/month/year and nothing for a non-date", () => {
    expect(formatPostDate("2026-10-14")).toBe("14/10/2026");
    for (const bad of ["", "14/10/2026", "2026-10-14T00:00:00Z", "tomorrow"]) expect(formatPostDate(bad)).toBe("");
  });

  it("a source link is https without credentials", () => {
    expect(isSafeSourceUrl("https://www.vietnamplus.vn/x")).toBe(true);
    for (const bad of ["http://example.com", "javascript:alert(1)", "//example.com", "https://user:pw@example.com", "not a url", ""]) {
      expect(isSafeSourceUrl(bad)).toBe(false);
    }
  });
});
