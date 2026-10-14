import { describe, expect, it } from "vitest";
import manifest from "../../scripts/riverside-media/manifest.json";
import {
  BENEFITS,
  BOOKING_STEPS,
  HERO_IMAGE,
  HOME_SECTION,
  HOME_SECTION_IDS,
  INTRO_IMAGE,
  RIVERSIDE_NAV,
  SPACE_GALLERY,
  amenityNames,
  buildFaq,
  checkTimes,
  clockTime,
} from "./riversideHomeContent";

interface PublishedEntry {
  derivative: string;
  width: number;
  height: number;
  altText: string;
  ownerType: string;
}
const published = (manifest as { published: PublishedEntry[] }).published;

describe("pictures: every one is a published manifest entry, described and sized as the manifest says", () => {
  const used = [HERO_IMAGE, INTRO_IMAGE, ...SPACE_GALLERY];

  it.each(used.map((image) => [image.file, image] as const))("%s", (_file, image) => {
    const entry = published.find((item) => item.derivative === image.file);
    expect(entry, `${image.file} is not published in the manifest`).toBeDefined();
    expect(image.alt).toBe(entry?.altText);
    expect([image.width, image.height]).toEqual([entry?.width, entry?.height]);
  });

  it("the gallery is the property's own pictures (pool, lobby, entrance) and repeats none", () => {
    for (const image of SPACE_GALLERY) {
      expect(published.find((item) => item.derivative === image.file)?.ownerType).toBe("property");
    }
    expect(new Set(SPACE_GALLERY.map((image) => image.file)).size).toBe(SPACE_GALLERY.length);
    expect(SPACE_GALLERY.some((image) => image.file === HERO_IMAGE.file)).toBe(false);
  });

  it("every picture name is lowercase-hyphenated .webp, the only shape the media route lets through", () => {
    for (const image of used) expect(image.file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/);
  });
});

describe("navigation: every entry leads somewhere that exists", () => {
  it("section entries point at section ids the page has, page entries at the results page, none is a dead '#'", () => {
    for (const item of RIVERSIDE_NAV) {
      if (item.section) expect(HOME_SECTION_IDS).toContain(item.section);
      else expect(item.href).toBe("/listing-stay");
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(`${item.section ?? ""}${item.href ?? ""}`).not.toMatch(/^#+$/);
    }
    expect(new Set(RIVERSIDE_NAV.map((item) => item.id)).size).toBe(RIVERSIDE_NAV.length);
  });

  it("section ids are stable ASCII anchors", () => {
    for (const id of HOME_SECTION_IDS) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(Object.values(HOME_SECTION)).toEqual([...HOME_SECTION_IDS]);
  });

  it("offers neither template routes nor unsupported destinations", () => {
    const targets = RIVERSIDE_NAV.map((item) => item.href ?? item.section).join(" ");
    for (const banned of ["/about", "/contact", "/checkout", "/author", "/add-listing", "/account-savelists", "/listing-stay-map"]) {
      expect(targets).not.toContain(banned);
    }
  });
});

describe("what is shown from the catalog is the catalog's", () => {
  it("clockTime keeps only real clock times", () => {
    expect(clockTime("14:00:00")).toBe("14:00");
    expect(clockTime("09:30")).toBe("09:30");
    for (const bad of ["", "24:00:00", "14:60:00", "14", "noon", null, undefined]) expect(clockTime(bad as string)).toBeNull();
  });

  it("checkTimes needs both times; nothing is invented when the catalog has none", () => {
    expect(checkTimes({ checkInTime: "14:00:00", checkOutTime: "12:00:00" })).toEqual({ checkIn: "14:00", checkOut: "12:00" });
    expect(checkTimes({ checkInTime: "14:00:00", checkOutTime: "" })).toBeNull();
    expect(checkTimes(undefined)).toBeNull();
  });

  it("amenityNames lists the catalog's names once each, skipping blanks, and an unknown property shows none", () => {
    const amenity = (name: string | null) => ({ id: name ?? "x", code: null, name, category: null });
    expect(amenityNames({ amenities: [amenity("Hồ bơi trên sân thượng"), amenity("Sân thượng"), amenity("Sân thượng"), amenity(" "), amenity(null)] })).toEqual([
      "Hồ bơi trên sân thượng",
      "Sân thượng",
    ]);
    expect(amenityNames({ amenities: null })).toEqual([]);
    expect(amenityNames(undefined)).toEqual([]);
  });

  it("the FAQ's times answer states the times when known and does not claim any when not", () => {
    const answer = (times: Parameters<typeof buildFaq>[0]) => buildFaq(times).find((item) => item.id === "times")?.answer ?? "";
    expect(answer({ checkIn: "14:00", checkOut: "12:00" })).toContain("14:00");
    expect(answer({ checkIn: "14:00", checkOut: "12:00" })).toContain("12:00");
    expect(answer(null)).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("claims the booking system cannot back are not made", () => {
  const everything = JSON.stringify([BENEFITS, BOOKING_STEPS, buildFaq(null)]);

  it("no rating, review, award, discount, 'cheapest', instant, free-cancellation or visitor-count claim", () => {
    for (const pattern of [/đánh giá/i, /\bsao\b/i, /giải thưởng/i, /giảm giá/i, /rẻ nhất/i, /tức thì/i, /miễn phí/i, /hủy miễn phí/i, /khách hàng đã/i, /\d+\s*(?:\+|nghìn|triệu)/i]) {
      expect(everything).not.toMatch(pattern);
    }
  });

  it("says plainly that there is no online payment and no confirmation e-mail yet", () => {
    const payment = buildFaq(null).find((item) => item.id === "payment")?.answer ?? "";
    expect(payment).toMatch(/chưa thu tiền trực tuyến/);
    expect(payment).toMatch(/chưa gửi email/);
    expect(everything).not.toMatch(/đã gửi email|thanh toán thành công|đã thanh toán/i);
  });

  it("separates the snapshot, the hold and the confirmed reservation", () => {
    const text = BOOKING_STEPS.map((step) => step.body).join(" ");
    expect(text).toMatch(/chưa giữ phòng/);
    expect(text).toMatch(/15 phút/);
    expect(text).toMatch(/mã xác nhận/);
  });

  it("has exactly three steps, numbered in order", () => {
    expect(BOOKING_STEPS.map((step) => step.id)).toEqual([1, 2, 3]);
  });
});
