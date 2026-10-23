import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderWithI18n } from "@/lib/i18n/testkit";
import HomeOfferSection from "./HomeOfferSection";
import HomeNewsletter from "./HomeNewsletter";
import HomeNewsSection from "./HomeNewsSection";
import HomeRiversideTeaser from "./HomeRiversideTeaser";
import { CARDS } from "@/lib/promotions/promotionTestkit";
import { items as blogItems } from "@/lib/blog/blogTestkit";
import { BENEFITS, SPACE_GALLERY } from "@/lib/riversideHomeContent";

/** CUST-WEB-001-CP08a-C2 polish: taller hero, offer cards whose price and button line up, a newsletter that matches the page. */
const offers = renderWithI18n(React.createElement(HomeOfferSection, { items: CARDS }));
const newsletter = renderWithI18n(React.createElement(HomeNewsletter));
const news = renderWithI18n(React.createElement(HomeNewsSection, { locale: "vi", items: blogItems(5) }));
const teaser = renderWithI18n(React.createElement(HomeRiversideTeaser));
const hero = readFileSync(new URL("./HomeHeroCarousel.tsx", import.meta.url), "utf8");

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("home hero height", () => {
  it("is a tenth taller again on desktop (620 -> 682px); phone and tablet heights are unchanged", () => {
    expect(hero).toContain("h-[380px]");
    expect(hero).toContain("sm:h-[460px]");
    expect(hero).toContain("lg:h-[682px]");
    expect(682).toBe(Math.round(620 * 1.1));
  });
});

describe("offer cards on the home page", () => {
  it("stretch to one height and pin price + button in one bottom block per card", () => {
    expect(count(offers, "mt-auto space-y-3 pt-2")).toBe(CARDS.length);
    expect(count(offers, "w-full items-center justify-center rounded-full")).toBe(CARDS.length);
    expect(offers).not.toContain("h-full scroll-mt-28");
    // space-y-* puts a margin-top on the block that out-ranks mt-auto and stops it reaching the bottom; gap-3 does not.
    expect(count(offers, "flex flex-1 flex-col gap-3 p-5")).toBe(CARDS.length);
    expect(offers).not.toContain("flex-col space-y-3 p-5");
  });
});

describe("newsletter", () => {
  it("keeps its heading, label, visible disclosure and a text submit whose accessible name starts with its text", () => {
    expect(newsletter).toContain('id="newsletter-heading"');
    expect(newsletter).toContain('for="newsletter-email"');
    expect(newsletter).toContain('id="newsletter-disclosure"');
    expect(newsletter).toMatch(/<button type="submit" aria-label="Đăng ký \(bản demo[^"]*"[^>]*>Đăng ký</);
  });

  it("stays a UI preview: no form action, no field name", () => {
    expect(newsletter).not.toMatch(/<form[^>]*action=/);
    expect(newsletter).not.toMatch(/<input[^>]*name=/);
  });
});

describe("news block: one large card and four small ones", () => {
  it("renders 1 large and 4 small cards of the published posts, each leading to its own article in the page's language, with no sample", () => {
    expect(count(news, "nc-NewsCardLarge")).toBe(1);
    expect(count(news, "nc-NewsCardSmall")).toBe(4);
    expect(count(news, "Bài mẫu")).toBe(0);
    for (let n = 1; n <= 5; n += 1) expect(news).toContain(`href="/blog/bai-viet-${n}?locale=vi"`);
    expect(news).toContain('href="/blog?locale=vi"');                           // "see more" keeps the language
  });

  it("is absent when there is nothing published", () => {
    expect(renderWithI18n(React.createElement(HomeNewsSection, { locale: "vi", items: [] }))).not.toContain("home-news");
  });
});

describe("the real-booking teaser", () => {
  it("lists the booking page's own three points and a three-picture property collage, and still has the real-search link", () => {
    for (const benefit of BENEFITS) expect(teaser).toContain(benefit.title);
    for (const file of ["rooftop-pool-day.webp", "lobby-sofa.webp", "entrance-logo.webp"]) {
      const image = SPACE_GALLERY.find((item) => item.file === file)!;
      expect(teaser).toContain(encodeURIComponent(`/media/the-bha-riverside/${file}`));
      expect(teaser).toContain(`alt="${image.alt}"`);
    }
    expect(teaser).toContain('href="/listing-stay"');
    expect(teaser).toContain('id="rooms"');
  });
});
