import { testT } from "@/lib/i18n/testkit";
import { describe, expect, it } from "vitest";
import {
  NEWSLETTER_STORAGE_NOTICE,
  NEWSLETTER_INVALID_MESSAGE,
  NEWSLETTER_FAILED_MESSAGE,
  NEWSLETTER_RECEIVED_MESSAGE,
  NEWSLETTER_SUBSCRIBE_LABEL,
  NEWSLETTER_TOO_MANY_MESSAGE,
  NEWSLETTER_REQUIRED_MESSAGE,
  validateNewsletterEmail,
} from "./newsletterUi";

describe("newsletter e-mail check", () => {
  it("asks for an address when the field is empty or only spaces", () => {
    for (const value of ["", "   ", "\t"]) {
      expect(validateNewsletterEmail(value)).toEqual({ ok: false, message: NEWSLETTER_REQUIRED_MESSAGE });
    }
  });

  it.each(["abc", "abc@", "@example.com", "a@b", "a@@b.com", "a b@example.com", "a@exa mple.com", "a@.com", "a@example..com", "a@example.c", "a@-example.com", ".a@example.com", "a.@example.com", "a..b@example.com", "a@example.com."])(
    "rejects %j",
    (value) => {
      expect(validateNewsletterEmail(value)).toEqual({ ok: false, message: NEWSLETTER_INVALID_MESSAGE });
    }
  );

  it("rejects an address longer than 254 characters", () => {
    expect(validateNewsletterEmail(`${"a".repeat(250)}@b.com`).ok).toBe(false);
  });

  it.each(["ten@example.com", " ten@example.com ", "ten.nguoi+bha@mail.example.vn", "a_b-c@sub.example.org"])("accepts %j", (value) => {
    expect(validateNewsletterEmail(value)).toEqual({ ok: true });
  });

  it("never returns the address it was given", () => {
    const typed = "private.person@example.com";
    expect(JSON.stringify(validateNewsletterEmail(typed))).not.toContain("private");
    expect(JSON.stringify(validateNewsletterEmail("private person"))).not.toContain("private");
  });

  it("says the request was recorded, not that anything was sent or verified", () => {
    expect(testT("vi")(NEWSLETTER_RECEIVED_MESSAGE)).toBe("Đã ghi nhận yêu cầu đăng ký.");
    for (const text of [NEWSLETTER_RECEIVED_MESSAGE, NEWSLETTER_STORAGE_NOTICE].map((key) => testT("vi")(key))) {
      expect(text).not.toMatch(/thành công|cảm ơn|sẽ gửi|đã xác minh/i);
    }
  });

  it("states the purpose next to the button in every language and keeps the retry messages", () => {
    for (const locale of ["vi", "en", "fr"] as const) {
      const t = testT(locale);
      expect(t(NEWSLETTER_STORAGE_NOTICE)).not.toBe(NEWSLETTER_STORAGE_NOTICE);
      expect(t(NEWSLETTER_FAILED_MESSAGE)).not.toBe(NEWSLETTER_FAILED_MESSAGE);
      expect(t(NEWSLETTER_TOO_MANY_MESSAGE)).not.toBe(NEWSLETTER_TOO_MANY_MESSAGE);
    }
  });

  it("has its own keys for the storage notice and the button's name, saying the address is stored and nothing about a demo (BHA-NEWSLETTER-001-C3)", () => {
    // Fixed names: a site whose pack was installed before this form stored anything holds the old keys' demo texts as stored rows.
    expect(NEWSLETTER_STORAGE_NOTICE).toBe("customer.newsletter.storageNotice");
    expect(NEWSLETTER_SUBSCRIBE_LABEL).toBe("customer.newsletter.subscribeLabel");
    const stores = { vi: /lưu email/, en: /stores your email/, fr: /enregistre votre adresse/ };
    for (const locale of ["vi", "en", "fr"] as const) {
      const t = testT(locale);
      expect(t(NEWSLETTER_STORAGE_NOTICE)).toMatch(stores[locale]);
      expect(t(NEWSLETTER_STORAGE_NOTICE)).not.toMatch(/demo|démo|not (sent or )?stored|n’est ni envoyée|không được (gửi đi hay )?lưu/i);
      expect(t(NEWSLETTER_SUBSCRIBE_LABEL)).not.toBe(NEWSLETTER_SUBSCRIBE_LABEL);
      expect(t(NEWSLETTER_SUBSCRIBE_LABEL)).not.toMatch(/demo|démo/i);
    }
  });
});
