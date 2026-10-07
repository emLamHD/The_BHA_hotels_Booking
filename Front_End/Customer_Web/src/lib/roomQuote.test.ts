import { describe, expect, it } from "vitest";
import type { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { quoteForRoomType } from "./roomQuote";

const R1 = "a3000000-0000-0000-0000-000000000001";
const R2 = "a3000000-0000-0000-0000-000000000002";

const offer = (roomTypeId: string, total: number, rates: number[], plan = "STD"): AvailabilityOfferDto =>
  ({
    roomTypeId,
    ratePlanId: plan,
    ratePlanName: plan,
    currencyCode: "VND",
    nights: rates.length,
    nightlyRates: rates.map((amount, index) => ({ stayDate: `2026-11-0${index + 1}`, amount })),
    totalAmount: total,
  } as AvailabilityOfferDto);

describe("quoteForRoomType", () => {
  it("is null without an offer for that room type (no price is invented)", () => {
    expect(quoteForRoomType([], R1)).toBeNull();
    expect(quoteForRoomType([offer(R2, 2_000_000, [1_000_000, 1_000_000])], R1)).toBeNull();
  });

  it("returns the server's total, currency and nights, never a recomputed amount", () => {
    const quote = quoteForRoomType([offer(R1, 2_000_000, [1_000_000, 1_000_000])], R1)!;
    expect(quote).toMatchObject({ totalAmount: 2_000_000, currencyCode: "VND", nights: 2, uniformNightlyAmount: 1_000_000 });
  });

  it("gives a nightly figure only when every night is the same", () => {
    expect(quoteForRoomType([offer(R1, 2_300_000, [1_000_000, 1_300_000])], R1)!.uniformNightlyAmount).toBeNull();
    expect(quoteForRoomType([offer(R1, 1_000_000, [1_000_000])], R1)!.uniformNightlyAmount).toBe(1_000_000);
  });

  it("picks the cheapest rate plan for the same stay and does not mix rooms", () => {
    const quote = quoteForRoomType(
      [offer(R1, 2_400_000, [1_200_000, 1_200_000], "FLEX"), offer(R1, 2_000_000, [1_000_000, 1_000_000], "STD"), offer(R2, 1, [1])],
      R1
    )!;
    expect(quote.totalAmount).toBe(2_000_000);
    expect(quote.ratePlanName).toBe("STD");
  });

  it("matches ids case-insensitively", () => {
    expect(quoteForRoomType([offer(R1.toUpperCase(), 1, [1])], R1)).not.toBeNull();
  });
});
