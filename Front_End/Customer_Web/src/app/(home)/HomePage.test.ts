import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
import React from "react";
import { renderPage, renderWithI18n } from "@/lib/i18n/testkit";
import PageHome from "@/app/page";
import PageRiverside from "@/app/riverside/page";
import OffersPage from "@/app/offers/page";
import MediaCreditsPage from "@/app/media-credits/page";
import { MOCK_OFFERS } from "@/data/homepageOffers";
import { HERO_SLIDES } from "@/data/heroSlides";
import { TRAVEL_POSTS } from "@/data/travelPosts";
import { BookingHoldProvider } from "@/app/BookingHoldProvider";

/**
 * CUST-WEB-001-CP08a-C2: what the server renders for the booking-portal home page and its sibling pages. The
 * browser run covers behaviour; these pin the contract that does not need one: one H1, the real links, the
 * mock/real boundary, and that the portal is not the Riverside landing page.
 */
let home = "";
let riverside = "";
let offers = "";
let credits = "";
beforeAll(async () => {
  home = await renderPage(PageHome);
  riverside = renderWithI18n(React.createElement(BookingHoldProvider, null, (await PageRiverside()) as React.ReactElement));
  offers = await renderPage(OffersPage, { searchParams: { offer: MOCK_OFFERS[2].slug } });
  credits = await renderPage(MediaCreditsPage);
});

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("the home page is the booking portal", () => {
  it("has one H1 and a slideshow of at least three distinct pictures, only the first with priority", () => {
    expect(count(home, "<h1")).toBe(1);
    const files = HERO_SLIDES.map((slide) => slide.file);
    for (const file of files) expect(home).toContain(encodeURIComponent(`/media/the-bha-travel/${file}`));
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(count(home, 'fetchPriority="high"') + count(home, 'fetchpriority="high"')).toBe(1);
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

  it("shows the sample offers as sample data, with the real search as the only way to a real price", () => {
    expect(count(home, "Ưu đãi minh hoạ")).toBeGreaterThanOrEqual(MOCK_OFFERS.length);
    expect(home).toContain("chưa gắn với hệ thống đặt phòng");
    expect(home).toContain("Xem phòng và giá thực tế");
    expect(home).not.toContain("Giữ phòng");
    expect(home).not.toContain("<form action");
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

  it("the offers' price and button sit in one block pinned to the bottom of an equal-height card", () => {
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
  it("renders every offer once, highlights only the named one, and says it is not connected to booking", () => {
    for (const offer of MOCK_OFFERS) expect(count(offers, `id="offer-${offer.slug}"`)).toBe(1);
    expect(count(offers, "border-primary-500 ring-2 ring-primary-500")).toBe(1);
    expect(offers).toContain("chưa gắn với hệ thống đặt phòng");
    expect(count(offers, "<h1")).toBe(1);
  });

  it("highlights nothing for an unknown or repeated value", async () => {
    for (const offer of ["unknown", ["a", "b"] as unknown as string]) {
      const markup = await renderPage(OffersPage, { searchParams: { offer } });
      expect(count(markup, "border-primary-500 ring-2 ring-primary-500")).toBe(0);
    }
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
