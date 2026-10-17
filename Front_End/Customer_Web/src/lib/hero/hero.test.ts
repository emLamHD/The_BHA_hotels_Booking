import { describe, expect, it } from "vitest";
import { HERO_FONT_KEYS, HERO_FONT_STACKS, heroFontStyle, isSameHero, parseHero } from "./hero";

const BASE = "https://api.test";
const slide = (n: number, patch: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-00000000000${n}`,
  imageUrl: `/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-00000000000${n}`,
  seedFile: null,
  focalPosition: "50% 50%",
  alt: `Ảnh ${n}`,
  caption: `Chú thích ${n}`,
  ...patch,
});
const body = (patch: Record<string, unknown> = {}) => ({
  revision: "r1", locale: "vi", generatedAtUtc: "2026-10-17T01:00:00Z", fontKey: "default", autoplayEnabled: true, intervalSeconds: 6,
  title: "Tiêu đề", description: "Mô tả", primaryAction: "Tìm phòng", secondaryAction: "Xem Riverside", slides: [slide(1), slide(2)], ...patch,
});

describe("the hero as the API serves it", () => {
  it("is read into a snapshot whose pictures are on the API's origin", () => {
    const hero = parseHero(body(), BASE)!;
    expect(hero.slides.map((item) => item.imageUrl)).toEqual([
      "https://api.test/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000001",
      "https://api.test/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000002",
    ]);
    expect(hero.generatedAt).toBe(Date.parse("2026-10-17T01:00:00Z"));
    expect([hero.fontKey, hero.autoplayEnabled, hero.intervalSeconds]).toEqual(["default", true, 6]);
  });

  it("is not a hero when it is not the API's shape, has no usable slide, or has an interval outside 3–60", () => {
    for (const bad of [null, "x", {}, body({ slides: [] }), body({ slides: "no" }), body({ title: "" }), body({ revision: 3 }), body({ generatedAtUtc: "never" }),
      body({ intervalSeconds: 2 }), body({ intervalSeconds: 61 }), body({ intervalSeconds: 6.5 }), body({ intervalSeconds: "6" }), body({ autoplayEnabled: "yes" })]) {
      expect(parseHero(bad, BASE)).toBeNull();
    }
  });

  it("only ever draws a picture from the API's own media path, so a stored URL cannot point anywhere else", () => {
    const hostile = [
      slide(1, { imageUrl: "https://evil.example/a.png" }),
      slide(2, { imageUrl: "javascript:alert(1)" }),
      slide(3, { imageUrl: "//evil.example/a.png" }),
      slide(4, { imageUrl: "/api/v1/website/hero/media/../../admin" }),
      slide(5, { imageUrl: "/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000005?x=https://evil" }),
      slide(6, { alt: "" }),
    ];
    expect(parseHero(body({ slides: hostile }), BASE)).toBeNull();
    expect(parseHero(body({ slides: [...hostile, slide(7)] }), BASE)!.slides.map((item) => item.alt)).toEqual(["Ảnh 7"]);
  });

  it("keeps a built-in photograph's file only in its exact shape, and a focal position only as two percentages", () => {
    const hero = parseHero(body({ slides: [slide(1, { seedFile: "hero-my-khe-beach.webp", focalPosition: "40% 50%" }), slide(2, { seedFile: "../x.webp", focalPosition: "center; x:y" })] }), BASE)!;
    expect(hero.slides.map((item) => item.seedFile)).toEqual(["hero-my-khe-beach.webp", null]);
    expect(hero.slides.map((item) => item.focalPosition)).toEqual(["40% 50%", "50% 50%"]);
  });

  it("shows at most ten slides, and falls back to the theme font for a font it does not know", () => {
    const many = Array.from({ length: 12 }, (_, index) => slide(index % 9 + 1, { id: `s${index}` }));
    expect(parseHero(body({ slides: many }), BASE)!.slides).toHaveLength(10);
    expect(parseHero(body({ fontKey: "comic-sans" }), BASE)!.fontKey).toBe("default");
    expect(parseHero(body({ fontKey: "system-serif" }), BASE)!.fontKey).toBe("system-serif");
  });

  it("maps every offered font to a family, and the theme default to none", () => {
    expect(HERO_FONT_KEYS).toEqual(["default", "be-vietnam-pro", "system-sans", "system-serif"]);
    expect(heroFontStyle("default")).toBeUndefined();
    for (const key of HERO_FONT_KEYS.filter((item) => item !== "default")) expect(heroFontStyle(key)?.fontFamily).toBe(HERO_FONT_STACKS[key]);
    expect(Object.values(HERO_FONT_STACKS).join(" ")).not.toMatch(/url\(|@import|http/i);
  });

  it("is the same hero when revision and language are the same, whatever the clock says", () => {
    const first = parseHero(body(), BASE)!;
    expect(isSameHero(first, parseHero(body({ generatedAtUtc: "2026-10-17T01:00:10Z" }), BASE)!)).toBe(true);
    expect(isSameHero(first, parseHero(body({ revision: "r2" }), BASE)!)).toBe(false);
    expect(isSameHero(first, parseHero(body({ locale: "en" }), BASE)!)).toBe(false);
    expect(isSameHero(null, first)).toBe(false);
  });
});
