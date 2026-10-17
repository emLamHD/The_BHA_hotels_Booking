import { testT } from "@/lib/i18n/testkit";
import { describe, expect, it } from "vitest";
import manifest from "../../scripts/riverside-media/manifest.json";
import {
  BENEFITS,
  BOOKING_STEPS,
  HERO_IMAGE,
  HOME_SECTION,
  HOME_SECTION_IDS,
  INTRO_IMAGE,
  RIVERSIDE_PATH,
  RIVERSIDE_SECTION_LINKS,
  riversideSectionHref,
  RIVERSIDE_FULL_ADDRESS,
  riversideMapEmbedUrl,
  riversideMapLink,
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

const t = testT("vi");

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

describe("Riverside page sections (the header menu itself is data from the API, see lib/menus)", () => {
  it("section links name sections the Riverside page has, and resolve to /riverside#section", () => {
    for (const item of RIVERSIDE_SECTION_LINKS) {
      expect(HOME_SECTION_IDS).toContain(item.section);
      expect(riversideSectionHref(item.section as string)).toBe(`${RIVERSIDE_PATH}#${item.section}`);
    }
    expect(new Set(RIVERSIDE_SECTION_LINKS.map((item) => item.id)).size).toBe(RIVERSIDE_SECTION_LINKS.length);
  });

  it("section ids are stable ASCII anchors", () => {
    for (const id of HOME_SECTION_IDS) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(Object.values(HOME_SECTION)).toEqual([...HOME_SECTION_IDS]);
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
    const answer = (times: Parameters<typeof buildFaq>[0]) => buildFaq(times, t).find((item) => item.id === "times")?.answer ?? "";
    expect(answer({ checkIn: "14:00", checkOut: "12:00" })).toContain("14:00");
    expect(answer({ checkIn: "14:00", checkOut: "12:00" })).toContain("12:00");
    expect(answer(null)).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("claims the booking system cannot back are not made", () => {
  const everything = JSON.stringify([BENEFITS, BOOKING_STEPS, buildFaq(null, t)]);

  it("no rating, review, award, discount, 'cheapest', instant, free-cancellation or visitor-count claim", () => {
    for (const pattern of [/đánh giá/i, /\bsao\b/i, /giải thưởng/i, /giảm giá/i, /rẻ nhất/i, /tức thì/i, /miễn phí/i, /hủy miễn phí/i, /khách hàng đã/i, /\d+\s*(?:\+|nghìn|triệu)/i]) {
      expect(everything).not.toMatch(pattern);
    }
  });

  it("says plainly that there is no online payment and no confirmation e-mail yet", () => {
    const payment = buildFaq(null, t).find((item) => item.id === "payment")?.answer ?? "";
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

describe("the property's map", () => {
  it("embeds and links Google Maps (https, google.com) for exactly the Owner-given address", () => {
    expect(RIVERSIDE_FULL_ADDRESS).toBe("162 Nghiêm Xuân Yêm, phường Ngũ Hành Sơn, Thành phố Đà Nẵng");
    const embed = new URL(riversideMapEmbedUrl());
    const link = new URL(riversideMapLink());
    expect(embed.protocol).toBe("https:");
    expect(embed.hostname).toBe("www.google.com");
    expect(embed.pathname).toBe("/maps");
    expect(embed.searchParams.get("output")).toBe("embed");
    expect(embed.searchParams.get("q")).toBe(`The BHA Riverside, ${RIVERSIDE_FULL_ADDRESS}`);
    expect(link.protocol).toBe("https:");
    expect(link.hostname).toBe("www.google.com");
    expect(link.searchParams.get("query")).toBe(`The BHA Riverside, ${RIVERSIDE_FULL_ADDRESS}`);
  });

  it("encodes the address so it cannot add parameters or change the host", () => {
    const embed = new URL(riversideMapEmbedUrl("x&output=nope#frag"));
    expect(embed.searchParams.get("output")).toBe("embed");
    expect(embed.searchParams.get("q")).toContain("x&output=nope#frag");
    expect(embed.hash).toBe("");
  });
});
