import { testT } from "@/lib/i18n/testkit";
import { describe, expect, it } from "vitest";
import {
  NEWSLETTER_DISCLOSURE,
  NEWSLETTER_INVALID_MESSAGE,
  NEWSLETTER_NOT_STORED_MESSAGE,
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

  it("the messages never say it worked or promise a message", () => {
    for (const text of [NEWSLETTER_NOT_STORED_MESSAGE, NEWSLETTER_DISCLOSURE].map((key) => testT("vi")(key))) {
      expect(text).not.toMatch(/thành công|cảm ơn|sẽ gửi|đã đăng ký/i);
    }
    expect(testT("vi")(NEWSLETTER_NOT_STORED_MESSAGE)).toBe("Bản demo chưa tiếp nhận đăng ký. Email chưa được lưu.");
  });
});
