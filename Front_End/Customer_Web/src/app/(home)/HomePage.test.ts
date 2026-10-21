import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("@/lib/hero/server", () => ({ getHeroSnapshot: vi.fn() }));
vi.mock("@/lib/promotions/server", () => ({ getPromotions: vi.fn(), getPromotion: vi.fn() }));
import React from "react";
import { renderPage, renderWithI18n } from "@/lib/i18n/testkit";
import PageHome from "@/app/page";
import PageRiverside from "@/app/riverside/page";
import OffersPage from "@/app/offers/page";
import MediaCreditsPage from "@/app/media-credits/page";
import { getPromotions, type PromotionsResult } from "@/lib/promotions/server";
import { CARDS } from "@/lib/promotions/promotionTestkit";
import { getHeroSnapshot } from "@/lib/hero/server";
import type { HeroSnapshot } from "@/lib/hero/hero";
import { TRAVEL_POSTS } from "@/data/travelPosts";
import { BookingHoldProvider } from "@/app/BookingHoldProvider";

/**
 * CUST-WEB-001-CP08a-C2: what the server renders for the booking-portal home page and its sibling pages. The
 * browser run covers behaviour; these pin the contract that does not need one: one H1, the real links, the
 * mock/real boundary, and that the portal is not the Riverside landing page.
 */
/** What the API serves today: the four built-in photographs, the way migration 13 seeds them. */
const API = "https://api.test/api/v1/website/hero/media";
const SEEDS = ["hero-dragon-bridge-dusk.webp", "hero-my-khe-beach.webp", "hero-danang-skyline.webp", "hero-han-river-night.webp"];
const HERO: HeroSnapshot = {
  revision: "r1", locale: "vi", generatedAt: Date.parse("2026-10-17T01:00:00Z"), fontKey: "default", autoplayEnabled: true, intervalSeconds: 6,
  title: "The BHA — Đà Nẵng", description: "Đặt phòng trực tiếp, xem giá từng đêm.", primaryAction: "Tìm phòng", secondaryAction: "Xem Riverside",
  slides: SEEDS.map((file, index) => ({
    id: `slide-${index}`, imageUrl: `${API}/aaaaaaaa-0000-0000-0000-00000000000${index}`, seedFile: file, focalPosition: "50% 50%", alt: `Ảnh ${index}`, caption: `Chú thích ${index}`,
  })),
};

let home = "";
let riverside = "";
let offers = "";
let credits = "";
beforeAll(async () => {
  vi.mocked(getHeroSnapshot).mockResolvedValue(HERO);
  vi.mocked(getPromotions).mockResolvedValue({ status: "ok", items: CARDS });
  home = await renderPage(PageHome);
  riverside = renderWithI18n(React.createElement(BookingHoldProvider, null, (await PageRiverside()) as React.ReactElement));
  offers = await renderPage(OffersPage, { searchParams: {} });
  credits = await renderPage(MediaCreditsPage);
});

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("the home page is the booking portal", () => {
  it("has one H1 and a slideshow of at least three distinct pictures, only the first with priority", () => {
    expect(count(home, "<h1")).toBe(1);
    for (const slide of HERO.slides) expect(home).toContain(slide.imageUrl);
    expect(HERO.slides.length).toBeGreaterThanOrEqual(3);
    expect(count(home, 'fetchPriority="high"') + count(home, 'fetchpriority="high"')).toBe(1);
  });

  it("draws the Admin's texts, with the chosen font only on the title and the description", async () => {
    expect(home).toContain("Đặt phòng trực tiếp, xem giá từng đêm.");
    expect(home).not.toMatch(/<h1[^>]*font-family/);                                      // the theme default sets no family
    vi.mocked(getHeroSnapshot).mockResolvedValueOnce({ ...HERO, fontKey: "system-serif", title: "Khách sạn mới", primaryAction: "Đặt ngay" });
    const serif = await renderPage(PageHome);
    expect(serif).toMatch(/<h1 style="font-family:ui-serif[^"]*"[^>]*>Khách sạn mới<\/h1>/);
    expect(serif).toMatch(/<p style="font-family:ui-serif[^"]*" class="[^"]*max-w-md/);
    expect(serif).toContain("Đặt ngay");
    expect(count(serif, "font-family")).toBe(2);                                          // not the header, the search form or anything else
    expect(count(serif, "<h1")).toBe(1);
  });

  it("with no hero at all (the API down on the first load) keeps one H1, the catalog's texts and the search, and draws no picture", async () => {
    vi.mocked(getHeroSnapshot).mockResolvedValueOnce(null);
    const degraded = await renderPage(PageHome);
    expect(count(degraded, "<h1")).toBe(1);
    expect(degraded).toContain("The BHA — Đà Nẵng");
    expect(degraded).toContain('href="/riverside"');
    expect(degraded).toContain('id="tim-phong"');
    expect(degraded).not.toContain(API);
    expect(degraded).not.toContain('aria-label="Ảnh trước"');                              // nothing to move between
  });

  it("leads to the pages the Owner named, with real URLs", () => {
    expect(home).toContain('href="/offers"');
    expect(home).toContain('href="/blog?category=diem-den-noi-bat"');
    expect(home).toContain('href="/blog"');
    expect(home).toContain('href="/riverside"');
    expect(home).toContain("Xem thêm ưu đãi");
    expect(home).toContain("Xem thêm điểm đến");
    expect(home).toContain("Xem thêm tin tức");
    expect(home).toContain("/media-credits");
  });

  it("has no dead fragment link and none of the four old anchors", () => {
    expect(home).not.toMatch(/href="#[^"]*"/);
    expect(home).not.toContain('href="/#');
    for (const gone of ["#gioi-thieu", "#booking-guide", "#faq"]) expect(home).not.toContain(gone);
  });

  it("shows the Admin's real offers: each card leads to its own page and states no price", () => {
    for (const card of CARDS) {
      expect(count(home, `id="offer-${card.slug}"`)).toBe(1);
      expect(home).toContain(`href="/offers/${card.slug}"`);
      expect(home).toContain(card.title);
    }
    expect(home).toContain("Giảm 15%");                                                  // the rule, said from its fields
    expect(home).not.toMatch(/Ưu đãi minh hoạ|chưa gắn với hệ thống đặt phòng|Giá thật/); // no sample wording is left
    expect(home).not.toMatch(/line-through/);                                              // nothing is struck through without dates
    expect(home).not.toContain("Giữ phòng");
    expect(home).not.toContain("<form action");
  });

  it("hides the whole offers block, with no sample in its place, when there is nothing public or the read failed", async () => {
    const results: PromotionsResult[] = [{ status: "ok", items: [] }, { status: "error" }];
    for (const result of results) {
      vi.mocked(getPromotions).mockResolvedValueOnce(result);
      const markup = await renderPage(PageHome);
      expect(markup).not.toContain("offers-heading");
      expect(markup).not.toContain("nc-HomeOfferSection");
      expect(markup).not.toContain("nc-OfferCard");
      expect(markup).toContain("<h1");                                                    // the rest of the page is intact
    }
  });

  it("links every destination and news card to its own article", () => {
    for (const post of TRAVEL_POSTS) expect(home).toContain(`href="/blog/${post.slug}"`);
  });

  it("is not the Riverside landing page", () => {
    for (const riversideOnly of ["Cách đặt phòng", "Thông tin cần biết", "Khám phá không gian", "Loại phòng tại The BHA Riverside"]) {
      expect(home).not.toContain(riversideOnly);
    }
  });

  it("does not claim the pictures show the rooms, and carries the newsletter preview with its disclosure", () => {
    expect(home).toContain("Bản demo: email chỉ được kiểm tra định dạng, không được gửi đi hay lưu lại.");
    expect(home).not.toContain("thành công");
    expect(home).not.toMatch(/name="newsletter/);
  });
});

describe("the home page carries the property's map and no demo banner", () => {
  it("has a titled Google Maps iframe after the newsletter, lazy, plus a safe link to open it", () => {
    expect(home.indexOf("newsletter-heading")).toBeLessThan(home.indexOf("location-heading"));
    expect(home).toContain("162 Nghiêm Xuân Yêm, phường Ngũ Hành Sơn, Thành phố Đà Nẵng");
    expect(home).toMatch(/<iframe[^>]+src="https:\/\/www\.google\.com\/maps\?q=/);
    expect(home).toMatch(/<iframe[^>]+loading="lazy"/);
    expect(home).toMatch(/<iframe[^>]+title="Bản đồ Google Maps/);
    expect(home).toMatch(/href="https:\/\/www\.google\.com\/maps\/search\/\?api=1[^"]*"[^>]*rel="noopener noreferrer"/);
  });

  it("the offers' button sits in one block pinned to the bottom of an equal-height card", () => {
    expect(home).toContain("mt-auto space-y-3 pt-2");
    expect(home).not.toContain("Bản demo: phòng, giá và đặt phòng");
  });
});

describe("/riverside keeps the Riverside composition", () => {
  it("has the four sections with their anchors, once each, and one H1", () => {
    for (const id of ["gioi-thieu", "rooms", "booking-guide", "faq"]) expect(count(riverside, `id="${id}"`)).toBe(1);
    expect(count(riverside, "<h1")).toBe(1);
    expect(riverside).toContain("The BHA Riverside");
  });
});

describe("/offers", () => {
  it("lists every public promotion once, each with a link to its page, and no price", () => {
    for (const card of CARDS) {
      expect(count(offers, `id="offer-${card.slug}"`)).toBe(1);
      expect(offers).toContain(`href="/offers/${card.slug}"`);
    }
    expect(count(offers, "<h1")).toBe(1);
    expect(offers).not.toMatch(/Ưu đãi minh hoạ|chưa gắn với hệ thống đặt phòng/);
    expect(offers).not.toMatch(/line-through/);
  });

  it("says plainly when there is nothing to show, and when the read failed", async () => {
    vi.mocked(getPromotions).mockResolvedValueOnce({ status: "ok", items: [] });
    expect(await renderPage(OffersPage, { searchParams: {} })).toContain('data-testid="offers-empty"');
    vi.mocked(getPromotions).mockResolvedValueOnce({ status: "error" });
    const failed = await renderPage(OffersPage, { searchParams: {} });
    expect(failed).toContain('data-testid="offers-unavailable"');
    expect(failed).not.toContain("nc-OfferCard");
  });

  it("sends an old sample link (?offer=<slug>) back to the plain list", async () => {
    await expect(renderPage(OffersPage, { searchParams: { offer: "dat-som-can-ho-1-phong-ngu" } })).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("/media-credits", () => {
  it("credits every photograph with its author, licence and Commons page", () => {
    for (const author of ["Quangpraha", ". Ray in Manila", "Mustang Joe", "Dominic Nelson", "Alexkom000", "Christophe95", "Vivu Vietnam", "lumoplank"]) {
      expect(credits).toContain(author);
    }
    expect(credits).toContain("https://creativecommons.org/licenses/by/2.0");
    expect(credits).toContain("https://commons.wikimedia.org/wiki/File:");
    expect(credits).toContain('rel="noopener noreferrer"');
    expect(count(credits, "<h1")).toBe(1);
  });
});
