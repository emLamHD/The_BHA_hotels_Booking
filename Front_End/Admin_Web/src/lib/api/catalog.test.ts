import { describe, expect, it } from "vitest";
import { bodyOf, parseEditor, parseGallery, parseProductSummary, removeImage, type CatalogEditor, type GalleryItem } from "./catalog";

const item = (mediaId: string, isCover = false): GalleryItem => ({ mediaId, url: `/api/admin/v1/catalog/properties/p/media/${mediaId}`, altText: null, isCover });

describe("catalog editor contract", () => {
  it("parses nullable, read-only room properties without filling old data", () => {
    const data: CatalogEditor = {
      propertyId: "p1", roomTypeId: "r1", version: 2, sourceLocale: "vi", name: "Room", description: null, slug: "room", code: "R-1",
      address: null, city: null, country: null, areaSquareMeters: null, bedrooms: null, bedDescription: null,
      baseOccupancy: 2, maxOccupancy: 2, physicalRoomCount: 3, isActive: true, timeZone: "Asia/Ho_Chi_Minh", checkInTime: "14:00", checkOutTime: "12:00",
      updatedAt: "2026-10-18T00:00:00Z", updatedByStaffId: null, roomTypes: [], gallery: [], amenityIds: [], amenities: [], translationOverrideKeys: [],
    };
    expect(parseEditor(data)).toEqual(data);
    expect(bodyOf(data)).toMatchObject({ areaSquareMeters: null, bedrooms: null, bedDescription: null, expectedVersion: 2 });
    expect(parseEditor({ ...data, version: 0 })).toBeNull();
  });

  it("rejects malformed media and selects a deterministic cover fallback after removal", () => {
    expect(parseGallery({ ...item("a"), isCover: "true" })).toBeNull();
    expect(removeImage([item("a", true), item("b")], "a")).toEqual([item("b", true)]);
    expect(removeImage([item("a", true)], "a")).toEqual([]);
  });

  it("accepts only complete product summaries without editor gallery data", () => {
    const summary = { propertyId: "p", roomTypeId: "r", code: "RIV-1BR", name: "One bedroom", description: null,
      baseOccupancy: 2, maxOccupancy: 2, physicalRoomCount: 3, galleryCount: 6, coverMediaId: "m", coverAltText: null, isActive: true };
    expect(parseProductSummary(summary)).toEqual(summary);
    expect(parseProductSummary({ ...summary, galleryCount: -1 })).toBeNull();
    expect(parseProductSummary({ ...summary, gallery: [item("m", true)] })).toBeNull();
  });
});
