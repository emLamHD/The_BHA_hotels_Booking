import { describe, expect, it } from "vitest";
import type { PromotionEditor } from "@/lib/api/promotions";
import { discountLabel, draftOf, emptyDraft, fingerprint, slugify, toBody, validateDraft, type PromotionDraft } from "./promotionModel";

const valid = (patch: Partial<PromotionDraft> = {}): PromotionDraft => ({
  ...emptyDraft(), title: "Đặt sớm", slug: "dat-som", summary: "Giảm khi đặt sớm", value: "15", ...patch,
});

describe("validateDraft", () => {
  it("accepts a complete percentage promotion", () => {
    expect(validateDraft(valid())).toEqual({});
  });

  it.each([
    ["0", false], ["-5", false], ["100", false], ["100.5", false], ["0.01", true], ["99.99", true], ["12.345", false], ["abc", false], ["", false],
  ])("a percentage of %s is valid=%s (no free booking)", (value, isValid) => {
    expect("value" in validateDraft(valid({ value }))).toBe(!isValid);
  });

  it("accepts a comma as the decimal mark", () => {
    expect(validateDraft(valid({ value: "12,5" }))).toEqual({});
    expect(toBody(valid({ value: "12,5" }), false).value).toBe(12.5);
  });

  it("asks a fixed amount for a currency and keeps VND whole", () => {
    expect(validateDraft(valid({ kind: "FixedAmount", currencyCode: "VND", value: "200000" }))).toEqual({});
    expect(validateDraft(valid({ kind: "FixedAmount", currencyCode: "VND", value: "200000.5" })).value).toMatch(/số nguyên/);
    expect(validateDraft(valid({ kind: "FixedAmount", currencyCode: "USD", value: "10.25" }))).toEqual({});
    expect(validateDraft(valid({ kind: "FixedAmount", currencyCode: "USD", value: "10.255" })).value).toBeDefined();
    expect(validateDraft(valid({ kind: "FixedAmount", currencyCode: "VN", value: "10" })).currencyCode).toBeDefined();
  });

  it("checks the three windows, minimum nights and order", () => {
    const e = validateDraft(valid({
      bookingFrom: "2026-11-02", bookingTo: "2026-11-01", stayFrom: "2026-11-02", stayTo: "2026-11-01", displayFrom: "2026-11-02", displayTo: "2026-11-01",
      minNights: "0", sortOrder: "10000",
    }));
    expect(Object.keys(e).sort()).toEqual(["bookingTo", "displayTo", "minNights", "sortOrder", "stayTo"]);
    expect(validateDraft(valid({ bookingFrom: "2026-11-01", bookingTo: "2026-11-01" }))).toEqual({});   // one day is a valid window
  });

  it("needs a cover for the homepage and an alt text for a cover", () => {
    expect(validateDraft(valid({ showOnHomepage: true })).showOnHomepage).toBeDefined();
    expect(validateDraft(valid({ coverMediaId: "m1", coverAltText: " " })).coverAltText).toBeDefined();
    expect(validateDraft(valid({ coverMediaId: "m1", coverAltText: "Phòng", showOnHomepage: true }))).toEqual({});
  });

  it("needs a room type when the scope is not all of them", () => {
    expect(validateDraft(valid({ allRoomTypes: false })).roomTypeIds).toBeDefined();
    expect(validateDraft(valid({ allRoomTypes: false, roomTypeIds: ["r1"] }))).toEqual({});
  });

  it("keeps the text plain: no markup, no line break, a limit per paragraph and eight paragraphs", () => {
    expect(validateDraft(valid({ title: "<b>x</b>" })).title).toBeDefined();
    expect(validateDraft(valid({ body: ["một\nhai"] })).body1).toBeDefined();
    expect(validateDraft(valid({ body: ["x".repeat(1001)] })).body1).toBeDefined();
    expect(validateDraft(valid({ body: Array.from({ length: 9 }, () => "x") })).body).toBeDefined();
    expect(validateDraft(valid({ slug: "Not A Slug" })).slug).toBeDefined();
  });

  it("checks translated texts by language and field", () => {
    const e = validateDraft(valid({ translations: { en: { title: "<x>", summary: "ok", coverAltText: "", body: ["a\nb"] } } }));
    expect(Object.keys(e).sort()).toEqual(["translations.en.body1", "translations.en.title"]);
  });
});

describe("toBody and fingerprint", () => {
  it("sends nulls for empty dates, drops blank paragraphs and sorts room types", () => {
    const body = toBody(valid({ body: ["  một  ", "", "hai"], allRoomTypes: false, roomTypeIds: ["b", "a"], bookingFrom: "", stayTo: "2026-11-05" }), false);

    expect(body.body).toEqual(["một", "hai"]);
    expect(body.roomTypeIds).toEqual(["a", "b"]);
    expect([body.bookingFrom, body.stayTo, body.currencyCode]).toEqual([null, "2026-11-05", null]);
    expect(body.translations).toBeUndefined();
  });

  it("sends the currency only for a fixed amount, and no alt text without a cover", () => {
    expect(toBody(valid({ kind: "FixedAmount", currencyCode: "vnd", value: "100000" }), false).currencyCode).toBe("VND");
    expect(toBody(valid({ coverMediaId: null, coverAltText: "left over" }), false).coverAltText).toBeNull();
  });

  it("does not count spacing or trailing blank paragraphs as a change", () => {
    expect(fingerprint(valid({ title: " Đặt sớm ", body: ["x", ""] }))).toBe(fingerprint(valid({ body: ["x"] })));
    expect(fingerprint(valid({ value: "16" }))).not.toBe(fingerprint(valid()));
  });
});

describe("draftOf", () => {
  const editor: PromotionEditor = {
    id: "p1", propertyId: "prop", slug: "dat-som", status: "Active", kind: "FixedAmount", value: 200000, currencyCode: "VND", allRoomTypes: false, roomTypeIds: ["r1"],
    bookingFrom: "2026-10-01", bookingTo: null, stayFrom: null, stayTo: "2026-12-31", minNights: 2, title: "Đặt sớm", summary: "Tóm tắt", body: ["Một", "Hai"],
    coverMediaId: "m1", coverAltText: "Phòng", showOnHomepage: true, sortOrder: 5, displayFrom: null, displayTo: null, publicNow: true,
    translations: { en: { title: "Early", summary: null, coverAltText: null, body: ["One"] } },
    languages: [{ code: "vi", displayName: "Tiếng Việt", isSource: true }, { code: "en", displayName: "English", isSource: false }],
    version: 3, createdAtUtc: "2026-10-01T00:00:00Z", updatedAtUtc: "2026-10-02T00:00:00Z", updatedByStaffId: "s1",
  };

  it("round-trips the editor through a draft and back to the same body", () => {
    const draft = draftOf(editor);

    expect(draft.value).toBe("200000");
    expect(draft.translations.en).toEqual({ title: "Early", summary: "", coverAltText: "", body: ["One"] });
    expect(draft.translations.vi).toBeUndefined();   // the source language is the columns, never a translation
    const body = toBody(draft, true);
    expect(body).toMatchObject({ slug: "dat-som", kind: "FixedAmount", value: 200000, currencyCode: "VND", roomTypeIds: ["r1"], minNights: 2, sortOrder: 5, showOnHomepage: true });
  });
});

describe("slugify and discountLabel", () => {
  it("turns a Vietnamese title into a plain slug", () => {
    expect(slugify("Ưu đãi Đặt sớm — Cuối tuần!")).toBe("uu-dai-dat-som-cuoi-tuan");
    expect(slugify("  --  ")).toBe("");
    expect(slugify("x".repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it("states the rule from its fields", () => {
    expect(discountLabel("Percent", 15, null)).toBe("Giảm 15% mỗi đêm");
    expect(discountLabel("FixedAmount", 200000, "VND")).toMatch(/^Giảm 200\.000 ₫ mỗi phòng mỗi đêm$/);
    expect(discountLabel("FixedAmount", 10, "USD")).toBe("Giảm 10 USD mỗi phòng mỗi đêm");
  });
});
