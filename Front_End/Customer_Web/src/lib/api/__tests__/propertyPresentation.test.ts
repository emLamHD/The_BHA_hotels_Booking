import { describe, expect, it } from "vitest";
import {
  formatLocation,
  formatTime,
  isUsableMediaUrl,
  selectCoverImage,
} from "../propertyPresentation";
import { MediaDto, PropertyDto } from "../propertyTypes";

// Deliberately not a reserved example host, so tests that don't care about
// media-URL usability aren't incidentally exercising the reserved-host filter.
const USABLE_URL = "https://cdn.thebha-hotels.test/photos/a.jpg";

function media(overrides: Partial<MediaDto>): MediaDto {
  return {
    id: "m1",
    url: USABLE_URL,
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

  it("excludes the current seeded images.example.com URL and falls back to the placeholder", () => {
    const seeded = media({
      isCover: true,
      url: "https://images.example.com/the-bha/property-cover.jpg",
    });

    expect(selectCoverImage([seeded])).toBeUndefined();
  });

  it("keeps a valid, non-reserved backend media URL selected", () => {
    const valid = media({ isCover: true, url: USABLE_URL });
    expect(selectCoverImage([valid])).toBe(valid);
  });

  it("falls back to the placeholder for absent, malformed, or unsupported media URLs", () => {
    expect(selectCoverImage([media({ url: null })])).toBeUndefined();
    expect(selectCoverImage([media({ url: "" })])).toBeUndefined();
    expect(selectCoverImage([media({ url: "not a url" })])).toBeUndefined();
    expect(
      selectCoverImage([media({ url: "javascript:alert(1)" })])
    ).toBeUndefined();
    expect(selectCoverImage([media({ url: "ftp://files.example.net/a.jpg" })])).toBeUndefined();
  });

  it("does not alter or fabricate the source Property's text fields when filtering media", () => {
    const source = property({
      name: "The BHA Hotel",
      description: "A welcoming city hotel.",
      media: [
        media({ isCover: true, url: "https://images.example.com/cover.jpg" }),
      ],
    });
    const snapshot = JSON.parse(JSON.stringify(source));

    selectCoverImage(source.media);

    expect(source).toEqual(snapshot);
    expect(source.name).toBe("The BHA Hotel");
    expect(source.description).toBe("A welcoming city hotel.");
  });
});

describe("isUsableMediaUrl", () => {
  it("accepts a well-formed, non-reserved http(s) URL", () => {
    expect(isUsableMediaUrl(USABLE_URL)).toBe(true);
    expect(isUsableMediaUrl("http://localhost:5145/media/a.jpg")).toBe(true);
  });

  it("rejects RFC 2606 reserved example hosts and their subdomains", () => {
    expect(isUsableMediaUrl("https://example.com/a.jpg")).toBe(false);
    expect(isUsableMediaUrl("https://images.example.com/a.jpg")).toBe(false);
    expect(isUsableMediaUrl("https://sub.deep.example.net/a.jpg")).toBe(false);
    expect(isUsableMediaUrl("http://example.org/a.jpg")).toBe(false);
  });

  it("rejects absent, empty, or malformed values", () => {
    expect(isUsableMediaUrl(null)).toBe(false);
    expect(isUsableMediaUrl(undefined)).toBe(false);
    expect(isUsableMediaUrl("")).toBe(false);
    expect(isUsableMediaUrl("not a url")).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isUsableMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isUsableMediaUrl("ftp://files.example.net/a.jpg")).toBe(false);
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
