import { describe, expect, it } from "vitest";
import {
  formatLocation,
  formatTime,
  selectCoverImage,
} from "../propertyPresentation";
import { MediaDto, PropertyDto } from "../propertyTypes";

function media(overrides: Partial<MediaDto>): MediaDto {
  return {
    id: "m1",
    url: "https://images.example.com/a.jpg",
    altText: null,
    mediaType: "Image",
    sortOrder: 0,
    isCover: false,
    ...overrides,
  };
}

function property(overrides: Partial<PropertyDto>): PropertyDto {
  return {
    id: "p1",
    name: "The BHA Hotel",
    slug: "the-bha-hotel",
    description: null,
    address: "1 BHA Avenue",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    timeZone: "Asia/Ho_Chi_Minh",
    checkInTime: "14:00:00",
    checkOutTime: "12:00:00",
    amenities: null,
    media: null,
    ...overrides,
  };
}

describe("selectCoverImage", () => {
  it("prefers the server-flagged cover image regardless of sort order", () => {
    const cover = media({ id: "b", isCover: true, sortOrder: 10 });
    const other = media({ id: "a", isCover: false, sortOrder: 0 });

    expect(selectCoverImage([other, cover])).toBe(cover);
  });

  it("falls back to SortOrder then media ID when no cover is flagged", () => {
    const second = media({ id: "z", isCover: false, sortOrder: 1 });
    const first = media({ id: "a", isCover: false, sortOrder: 0 });

    expect(selectCoverImage([second, first])).toBe(first);
  });

  it("ignores video media and media without a URL", () => {
    const video = media({ id: "v", mediaType: "Video", isCover: true });
    const noUrl = media({ id: "n", url: null, isCover: true });
    const usable = media({ id: "u", isCover: false, sortOrder: 5 });

    expect(selectCoverImage([video, noUrl, usable])).toBe(usable);
  });

  it("returns undefined instead of fabricating an image when none exists", () => {
    expect(selectCoverImage(null)).toBeUndefined();
    expect(selectCoverImage([])).toBeUndefined();
    expect(selectCoverImage([media({ mediaType: "Video" })])).toBeUndefined();
  });

  it("preserves the backend altText value verbatim", () => {
    const cover = media({ isCover: true, altText: "The BHA Hotel exterior" });
    expect(selectCoverImage([cover])?.altText).toBe("The BHA Hotel exterior");
  });
});

describe("formatLocation", () => {
  it("joins city and country when both are present", () => {
    expect(formatLocation(property({ city: "Ho Chi Minh City", country: "Vietnam" }))).toBe(
      "Ho Chi Minh City, Vietnam"
    );
  });

  it("uses only the field that is present", () => {
    expect(formatLocation(property({ city: "Ho Chi Minh City", country: null }))).toBe(
      "Ho Chi Minh City"
    );
  });

  it("returns null rather than fabricating a placeholder when both are absent", () => {
    expect(formatLocation(property({ city: null, country: null }))).toBeNull();
  });

  it("treats a blank string the same as absent", () => {
    expect(formatLocation(property({ city: "   ", country: null }))).toBeNull();
  });
});

describe("formatTime", () => {
  it("formats a server TimeOnly value down to HH:mm", () => {
    expect(formatTime("14:00:00")).toBe("14:00");
    expect(formatTime("09:05:00")).toBe("09:05");
  });

  it("passes through an unexpected value unchanged rather than fabricating one", () => {
    expect(formatTime("not-a-time")).toBe("not-a-time");
  });
});
