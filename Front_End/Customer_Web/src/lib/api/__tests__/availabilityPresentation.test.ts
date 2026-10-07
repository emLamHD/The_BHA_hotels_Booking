import { describe, expect, it } from "vitest";
import { formatCurrencyAmount } from "../availabilityPresentation";
import { selectCoverImage } from "../propertyPresentation";
import { AvailabilityOfferDto } from "../availabilityTypes";
import { MediaDto } from "../propertyTypes";

describe("formatCurrencyAmount", () => {
  it("formats using the server-supplied currency code", () => {
    const formatted = formatCurrencyAmount(3000000, "VND");
    expect(formatted).toMatch(/3[,.]000[,.]000/);
    expect(formatted).toMatch(/₫|VND/);
  });

  it("never converts currency — a VND amount stays labeled as VND", () => {
    const formatted = formatCurrencyAmount(3000000, "VND");
    expect(formatted).not.toMatch(/USD|\$/);
  });

  it("selects the exact supplied amount for display rather than recomputing it", () => {
    // A contrived offer whose nightlyRates sum would differ from totalAmount
    // if the UI recomputed the total instead of trusting the server value.
    const offer: Pick<AvailabilityOfferDto, "totalAmount" | "currencyCode"> = {
      totalAmount: 9999999,
      currencyCode: "VND",
    };
    const formatted = formatCurrencyAmount(offer.totalAmount, offer.currencyCode);
    expect(formatted).toMatch(/9[,.]999[,.]999/);
  });

  it("falls back to a plain formatted amount with the code appended when currency is absent", () => {
    const formatted = formatCurrencyAmount(1500000, null);
    expect(formatted).toContain("1,500,000.00");
    expect(formatted).not.toMatch(/undefined|null/i);
  });

  it("falls back gracefully for a malformed/unrecognized currency code instead of throwing", () => {
    expect(() => formatCurrencyAmount(1000, "NOT-A-CODE")).not.toThrow();
    const formatted = formatCurrencyAmount(1000, "NOT-A-CODE");
    expect(formatted).toContain("NOT-A-CODE");
  });
});

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

describe("Availability offer media selection (reuses the shared selectCoverImage contract)", () => {
  it("selects a usable backend cover image for an Availability offer", () => {
    const cover = media({ isCover: true, url: USABLE_URL });
    expect(selectCoverImage([cover])).toBe(cover);
  });

  it("rejects the seeded example-host media, yielding the presentation fallback path", () => {
    const seeded = media({
      isCover: true,
      url: "https://images.example.com/the-bha/deluxe-king.jpg",
    });
    expect(selectCoverImage([seeded])).toBeUndefined();
  });
});
