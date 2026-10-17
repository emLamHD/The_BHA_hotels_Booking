import { describe, expect, it, vi } from "vitest";
import { renderPage, testT } from "@/lib/i18n/testkit";

const state = vi.hoisted(() => ({ locale: "vi" }));
// The page reads its texts through the server helpers; they follow the locale the test is in.
vi.mock("@/lib/i18n/server", async () => {
  const kit = await import("@/lib/i18n/testkit");
  return {
    getI18n: () => kit.serverModuleMock(state.locale).getI18n(),
    getT: () => kit.serverModuleMock(state.locale).getT(),
    getContentMessages: () => kit.serverModuleMock(state.locale).getContentMessages(),
    getContent: () => kit.serverModuleMock(state.locale).getContent(),
  };
});
vi.mock("@/components/BgGlassmorphism", () => ({ default: () => null }));

import PageFaq, { generateMetadata } from "./page";

/** The six questions of `buildFaq` (keys `customer.faq.*`): the one policy text of the site, shown on /faq as on the Riverside page. */
const QUESTIONS = ["datesGuests", "snapshot", "holdVsConfirm", "payment", "reload", "times"] as const;

describe("/faq is a real page made of the existing FAQ, in the visitor's language", () => {
  for (const locale of ["vi", "en", "fr"] as const) {
    it(`${locale}: the heading, the description and the six questions come from the pack of that language`, async () => {
      state.locale = locale;
      const t = testT(locale);
      const html = await renderPage(PageFaq as never, {}, locale);
      expect(html).toContain(t("customer.home.riversideHomeContent.goodToKnow"));
      expect(html).toContain(t("customer.home.riversideHomeContent.locationAndThingsToKnow"));
      for (const key of QUESTIONS) expect(html).toContain(t(`customer.faq.${key}.q`).replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
    });
  }

  it("the accordion is made of real buttons a keyboard can operate, and the page asks the booking system for nothing", async () => {
    state.locale = "vi";
    const html = await renderPage(PageFaq as never, {}, "vi");
    expect((html.match(/<button/g) ?? []).length).toBe(QUESTIONS.length);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/availability|hold|idempotency/i);
  });

  it("the page title and description follow the language", async () => {
    state.locale = "vi";
    const meta = await generateMetadata();
    expect(String(meta.title)).toContain("Thông tin cần biết");
    expect(String(meta.description)).toContain("Vị trí");
  });
});
