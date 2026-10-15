import { describe, expect, it } from "vitest";
import React from "react";
import PropertyLiveCard from "./PropertyLiveCard";
import { PropertyDto } from "@/lib/api/propertyTypes";
import { renderWithI18n } from "@/lib/i18n/testkit";

const property = {
  id: "a1000000-0000-0000-0000-000000000001",
  name: "The BHA Riverside",
  slug: "riverside",
  description: "The BHA Riverside. Thông tin chi tiết về chỗ nghỉ đang được cập nhật; giờ nhận phòng 14:00",
  address: "Địa chỉ đang được cập nhật",
  city: "Đang cập nhật",
  country: "Việt Nam",
  timeZone: "Asia/Ho_Chi_Minh",
  checkInTime: "14:00:00",
  checkOutTime: "12:00:00",
  amenities: [{ id: "unknown-amenity", code: "WIFI", name: "Wifi miễn phí", category: null }],
  media: [],
} as unknown as PropertyDto;

describe("PropertyLiveCard", () => {
  it.each([
    ["vi", "Đang cập nhật, Việt Nam", "Thông tin chi tiết về chỗ nghỉ"],
    ["en", "Being updated, Vietnam", "Detailed information about the property"],
    ["fr", "En cours de mise à jour, Vietnam", "Les informations détaillées sur l’établissement"],
  ])("shows the location and description in %s", (locale, location, description) => {
    const html = renderWithI18n(React.createElement(PropertyLiveCard, { data: property }), locale);
    expect(html).toContain(location);
    expect(html).toContain(description);
  });

  it("falls back to the catalog's own text for an amenity the language has no entry for", () => {
    expect(renderWithI18n(React.createElement(PropertyLiveCard, { data: property }), "en")).toContain("Wifi miễn phí");
  });
});
