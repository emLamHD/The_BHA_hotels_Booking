import { describe, expect, it } from "vitest";
import {
  formatDesignedForOccupancy,
  formatMaxOccupancy,
} from "../roomTypePresentation";
import { selectCoverImage } from "../propertyPresentation";
import { MediaDto, RoomTypeDto } from "../propertyTypes";

describe("formatDesignedForOccupancy", () => {
  it("uses singular 'guest' for an occupancy of exactly one", () => {
    expect(formatDesignedForOccupancy(1)).toBe("Designed for 1 guest");
  });

  it("uses plural 'guests' for an occupancy greater than one", () => {
    expect(formatDesignedForOccupancy(2)).toBe("Designed for 2 guests");
  });

  it("does not mention beds, bedrooms, physical rooms, or availability", () => {
    expect(formatDesignedForOccupancy(4)).not.toMatch(/bed|room|available/i);
  });
});

describe("formatMaxOccupancy", () => {
  it("uses singular 'guest' for a maximum occupancy of exactly one", () => {
    expect(formatMaxOccupancy(1)).toBe("Up to 1 guest");
  });

  it("uses plural 'guests' for a maximum occupancy greater than one", () => {
    expect(formatMaxOccupancy(4)).toBe("Up to 4 guests");
  });

  it("does not mention beds, bedrooms, physical rooms, or availability", () => {
    expect(formatMaxOccupancy(4)).not.toMatch(/bed|room|available/i);
  });
});

// Deliberately not a reserved example host, so this test isn't incidentally
// exercising the reserved-host filter (covered by propertyPresentation.test.ts).
const USABLE_URL = "https://cdn.thebha-hotels.test/photos/deluxe-king.jpg";

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

function roomType(overrides: Partial<RoomTypeDto>): RoomTypeDto {
  return {
    id: "r1",
    propertyId: "p1",
    code: "DLX-KING",
    name: "Deluxe King",
    slug: "deluxe-king",
    description: "A comfortable king room.",
    baseOccupancy: 2,
    maxOccupancy: 2,
    amenities: null,
    media: null,
    ...overrides,
  };
}

describe("RoomType media selection (reuses the shared selectCoverImage contract)", () => {
  it("selects a usable backend cover image for a RoomType", () => {
    const cover = media({ id: "m1", isCover: true, url: USABLE_URL });
    const data = roomType({ media: [cover] });

    expect(selectCoverImage(data.media)).toBe(cover);
  });

  it("rejects the seeded example-host RoomType media, yielding the presentation fallback path", () => {
    const seeded = media({
      isCover: true,
      url: "https://images.example.com/the-bha/deluxe-king.jpg",
    });
    const data = roomType({ media: [seeded] });

    expect(selectCoverImage(data.media)).toBeUndefined();
  });
});
