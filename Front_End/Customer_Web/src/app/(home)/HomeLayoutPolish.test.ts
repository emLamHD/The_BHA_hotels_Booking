import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import HomeOfferSection from "./HomeOfferSection";
import HomeNewsletter from "./HomeNewsletter";
import { MOCK_OFFERS } from "@/data/homepageOffers";

/** CUST-WEB-001-CP08a-C2 polish: taller hero, offer cards whose price and button line up, a newsletter that matches the page. */
const offers = renderToStaticMarkup(React.createElement(HomeOfferSection));
const newsletter = renderToStaticMarkup(React.createElement(HomeNewsletter));
const hero = readFileSync(new URL("./HomeHeroCarousel.tsx", import.meta.url), "utf8");

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("home hero height", () => {
  it("is about a tenth taller than before, and 380:620 stays at the golden ratio", () => {
    expect(hero).toContain("h-[380px]");
    expect(hero).toContain("sm:h-[460px]");
    expect(hero).toContain("lg:h-[620px]");
    expect(380 / 620).toBeCloseTo(1 / 1.618, 1);
  });
});

describe("offer cards on the home page", () => {
  it("stretch to one height and pin price + button in one bottom block per card", () => {
    expect(count(offers, "mt-auto space-y-3 pt-2")).toBe(MOCK_OFFERS.length);
    expect(count(offers, "whitespace-nowrap")).toBe(MOCK_OFFERS.length);
    expect(count(offers, "w-full items-center justify-center rounded-full")).toBe(MOCK_OFFERS.length);
    expect(offers).not.toContain("h-full scroll-mt-28");
    // space-y-* puts a margin-top on the block that out-ranks mt-auto and stops it reaching the bottom; gap-3 does not.
    expect(count(offers, "flex flex-1 flex-col gap-3 p-5")).toBe(MOCK_OFFERS.length);
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
