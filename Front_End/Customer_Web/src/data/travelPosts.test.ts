import { describe, expect, it } from "vitest";
import { creditForFile } from "./heroSlides";
import { POST_CATEGORIES, TRAVEL_POSTS } from "./travelPosts";
import { isSafeSourceUrl } from "@/lib/homepageContent";

describe("the post registry that feeds the home cards, /blog and /blog/<slug>", () => {
  it("has at least six destinations and three news summaries", () => {
    expect(TRAVEL_POSTS.filter((post) => post.kind === "destination").length).toBeGreaterThanOrEqual(6);
    expect(TRAVEL_POSTS.filter((post) => post.kind === "news").length).toBeGreaterThanOrEqual(3);
  });

  it("ids and slugs are unique, and a slug is one lowercase ASCII segment", () => {
    expect(new Set(TRAVEL_POSTS.map((post) => post.id)).size).toBe(TRAVEL_POSTS.length);
    expect(new Set(TRAVEL_POSTS.map((post) => post.slug)).size).toBe(TRAVEL_POSTS.length);
    for (const post of TRAVEL_POSTS) expect(post.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("every post is in a registered category and the kind matches it", () => {
    const slugs = POST_CATEGORIES.map((category) => category.slug);
    for (const post of TRAVEL_POSTS) {
      expect(slugs).toContain(post.category);
      expect(post.kind).toBe(post.category === "diem-den-noi-bat" ? "destination" : "news");
    }
  });

  it("every post has its own cover (licensed and credited), text, dates and sources", () => {
    for (const post of TRAVEL_POSTS) {
      expect(creditForFile(post.cover), `${post.slug}: ${post.cover} has no credit record`).toBeDefined();
      expect(post.coverAlt.trim().length).toBeGreaterThan(0);
      expect(post.excerpt.trim().length).toBeGreaterThan(20);
      expect(post.sections.length).toBeGreaterThanOrEqual(2);
      for (const section of post.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.paragraphs.length + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
      }
      expect(post.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(post.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A sample post is the one exception: it summarises no report, so it has no source to list.
      if (post.sample) expect(post.sources).toHaveLength(0);
      else expect(post.sources.length).toBeGreaterThanOrEqual(1);
    }
    const covers = TRAVEL_POSTS.filter((post) => post.kind === "destination").map((post) => post.cover);
    expect(new Set(covers).size).toBe(covers.length);
    const newsCovers = TRAVEL_POSTS.filter((post) => post.kind === "news").map((post) => post.cover);
    expect(new Set(newsCovers).size).toBe(newsCovers.length);
  });

  it("sample posts say so, state no figure and are only news filler", () => {
    const samples = TRAVEL_POSTS.filter((post) => post.sample);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    for (const post of samples) {
      expect(post.kind).toBe("news");
      expect(post.title.startsWith("Bài mẫu")).toBe(true);
      expect(post.excerpt).toContain("Bài mẫu minh hoạ");
      expect(JSON.stringify(post.sections)).not.toMatch(/\d/);
    }
    // Real posts never carry the flag, and the first news post (the large card) is a real one.
    expect(TRAVEL_POSTS.filter((post) => post.kind === "news")[0].sample).toBeUndefined();
  });

  it("every source link is a safe https URL naming its publisher", () => {
    for (const post of TRAVEL_POSTS) {
      for (const source of post.sources) {
        expect(isSafeSourceUrl(source.url), `${post.slug}: ${source.url}`).toBe(true);
        expect(source.label.trim().length).toBeGreaterThan(0);
        expect(source.publisher.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("has no template filler, invented author, comment or counter", () => {
    const text = JSON.stringify(TRAVEL_POSTS);
    expect(text).not.toMatch(/lorem|ipsum|dolor sit|Eden Smith|bình luận|comments?\b|lượt xem|lượt thích/i);
    for (const post of TRAVEL_POSTS) {
      expect(Object.keys(post)).not.toContain("author");
    }
  });

  it("names no BHA event, partnership or promotion, and no 2025 administrative unit", () => {
    // The one allowed mention is the disclaimer that an event is NOT organised by The BHA.
    const text = JSON.stringify(TRAVEL_POSTS).replace("không phải sự kiện do The BHA tổ chức", "");
    expect(text).not.toMatch(/The BHA (hợp tác|tổ chức|đối tác|khuyến mại|giới thiệu|sở hữu)/i);
    expect(text).not.toMatch(/quận (Ngũ Hành Sơn|Sơn Trà|Hải Châu)|tỉnh (Quảng Nam|Thừa Thiên)/i);
  });

  it("no news summary is dated after the day it was written", () => {
    for (const post of TRAVEL_POSTS) expect(post.publishedAt <= post.updatedAt).toBe(true);
    for (const post of TRAVEL_POSTS) expect(post.updatedAt <= "2026-10-14").toBe(true);
  });
});
