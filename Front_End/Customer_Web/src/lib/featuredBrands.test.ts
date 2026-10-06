import { describe, expect, it } from "vitest";
import type { PropertyDto } from "@/lib/api/propertyTypes";
import {
  DEFAULT_FEATURED_TAB,
  FEATURED_BRAND_TABS,
  FEATURED_TAB_LABELS,
  featuredTabByLabel,
  findPropertyBySlug,
} from "./featuredBrands";

const property = (id: string, slug: string | null): PropertyDto => ({
  id,
  name: slug,
  slug,
  description: null,
  address: null,
  city: null,
  country: null,
  timeZone: null,
  checkInTime: "14:00:00",
  checkOutTime: "12:00:00",
  amenities: [],
  media: [],
});

describe("featured brand tabs", () => {
  it("are exactly Riverside, House, Villa in that order, Riverside first", () => {
    expect(FEATURED_TAB_LABELS).toEqual(["The BHA Riverside", "The BHA House", "The BHA Villa"]);
    expect(DEFAULT_FEATURED_TAB).toBe("The BHA Riverside");
  });

  it("only Riverside is backed by a Property slug; House and Villa never call the API", () => {
    expect(FEATURED_BRAND_TABS.map((tab) => tab.slug)).toEqual(["the-bha-riverside", null, null]);
    expect(featuredTabByLabel("The BHA House")?.slug).toBeNull();
    expect(featuredTabByLabel("The BHA Villa")?.slug).toBeNull();
    expect(featuredTabByLabel("Tokyo")).toBeUndefined();
  });
});

describe("findPropertyBySlug", () => {
  const list = [property("a", "other-hotel"), property("b", "the-bha-riverside")];

  it("returns the Property whose slug matches, not the first one", () => {
    expect(findPropertyBySlug(list, "the-bha-riverside")?.id).toBe("b");
  });

  it("returns undefined, never properties[0], when the slug is absent", () => {
    expect(findPropertyBySlug([property("a", "other-hotel")], "the-bha-riverside")).toBeUndefined();
    expect(findPropertyBySlug([], "the-bha-riverside")).toBeUndefined();
  });
});
