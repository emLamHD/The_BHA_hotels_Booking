import type { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { sameId } from "@/lib/roomDetailsRoute";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: what a Featured card may say about a price. Only what an availability
 * response states: the server's total, currency, number of nights and nightly amounts. Nothing is
 * converted, averaged across rate plans or invented; with no response there is no number.
 */
export interface RoomQuote {
  totalAmount: number;
  currencyCode: string | null;
  nights: number;
  /** The nightly amount when every night costs the same, otherwise null (the card shows the total only). */
  uniformNightlyAmount: number | null;
  ratePlanName: string | null;
}

export function quoteForRoomType(
  offers: readonly AvailabilityOfferDto[],
  roomTypeId: string
): RoomQuote | null {
  const matching = offers.filter((offer) => sameId(offer.roomTypeId, roomTypeId));
  if (matching.length === 0) return null;
  // Several rate plans: the cheapest total for the same dates and party.
  const best = matching.reduce((low, offer) => (offer.totalAmount < low.totalAmount ? offer : low));
  const rates = best.nightlyRates ?? [];
  const first = rates[0]?.amount;
  const uniform = rates.length > 0 && rates.every((rate) => rate.amount === first);
  return {
    totalAmount: best.totalAmount,
    currencyCode: best.currencyCode,
    nights: best.nights,
    uniformNightlyAmount: uniform ? first : null,
    ratePlanName: best.ratePlanName,
  };
}
