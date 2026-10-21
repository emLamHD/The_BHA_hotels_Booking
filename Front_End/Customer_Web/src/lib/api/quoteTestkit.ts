import type { PriceQuote } from "./availabilityTypes";

/** A quote with no promotion, for tests that need an offer snapshot but not a price story. */
export const TEST_QUOTE: PriceQuote = {
  currencyCode: "VND",
  totalAmount: 3000000,
  listTotalAmount: 3000000,
  discountTotalAmount: 0,
  nightlyRates: [
    { stayDate: "2026-08-01", amount: 1500000, listAmount: 1500000, discountAmount: 0 },
    { stayDate: "2026-08-02", amount: 1500000, listAmount: 1500000, discountAmount: 0 },
  ],
  appliedPromotion: null,
};
