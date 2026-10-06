import type { PropertyDto } from "@/lib/api/propertyTypes";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the three brand tabs of the home page's "Featured places to stay".
 * They are static. Only The BHA Riverside is backed by the API (its Property is found by slug);
 * House and Villa are announced brands with no catalog yet, so they never call the API and never
 * borrow another Property's rooms.
 */
export interface FeaturedBrandTab {
  /** The tab label shown to the visitor (also the HeaderFilter tab id). */
  label: string;
  /** The Property slug that backs the tab; null when the brand has no catalog yet. */
  slug: string | null;
}

export const FEATURED_BRAND_TABS: readonly FeaturedBrandTab[] = [
  { label: "The BHA Riverside", slug: "the-bha-riverside" },
  { label: "The BHA House", slug: null },
  { label: "The BHA Villa", slug: null },
];

export const FEATURED_TAB_LABELS: string[] = FEATURED_BRAND_TABS.map((tab) => tab.label);
export const DEFAULT_FEATURED_TAB: string = FEATURED_BRAND_TABS[0].label;

export function featuredTabByLabel(label: string): FeaturedBrandTab | undefined {
  return FEATURED_BRAND_TABS.find((tab) => tab.label === label);
}

/**
 * The Property for a slug, or undefined. Deliberately no fallback: when the slug is absent from the
 * API's list the section reports "not available", it never shows `properties[0]` instead.
 */
export function findPropertyBySlug(
  properties: readonly PropertyDto[],
  slug: string
): PropertyDto | undefined {
  return properties.find((property) => property.slug === slug);
}
