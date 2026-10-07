/**
 * Deterministic typed mock data owned by the Create Reservation feature
 * (ADMIN-002.1-C4). Not connected to any backend; every value is fixed and
 * fictional. Reservation Board mock IDs (properties/RoomTypes/PhysicalRooms/
 * booking sources) are imported read-only from that feature's mockData.ts —
 * this file never mutates them and owns only rate plans and nationality
 * options, which are specific to this create-reservation workflow.
 */

import type { RatePlan, GuestNationalityOption } from "./types";

export const MOCK_RATE_PLANS: RatePlan[] = [
  { id: "rate-house-deluxe-standard", roomTypeId: "rt-house-deluxe", name: "Standard Rate", nightlyAmount: 1_200_000, currency: "VND" },
  { id: "rate-house-deluxe-nonref", roomTypeId: "rt-house-deluxe", name: "Non-refundable Rate", nightlyAmount: 1_000_000, currency: "VND" },
  { id: "rate-house-suite-standard", roomTypeId: "rt-house-suite", name: "Standard Rate", nightlyAmount: 2_500_000, currency: "VND" },
  { id: "rate-house-suite-breakfast", roomTypeId: "rt-house-suite", name: "Breakfast Included", nightlyAmount: 2_800_000, currency: "VND" },
  { id: "rate-riverside-standard-standard", roomTypeId: "rt-riverside-standard", name: "Standard Rate", nightlyAmount: 900_000, currency: "VND" },
  { id: "rate-riverside-standard-nonref", roomTypeId: "rt-riverside-standard", name: "Non-refundable Rate", nightlyAmount: 750_000, currency: "VND" },
  { id: "rate-riverside-family-standard", roomTypeId: "rt-riverside-family", name: "Standard Rate", nightlyAmount: 1_800_000, currency: "VND" },
  { id: "rate-riverside-family-breakfast", roomTypeId: "rt-riverside-family", name: "Breakfast Included", nightlyAmount: 2_100_000, currency: "VND" },
];

export function ratePlansForRoomType(roomTypeId: string): RatePlan[] {
  return MOCK_RATE_PLANS.filter((plan) => plan.roomTypeId === roomTypeId);
}

export const MOCK_NATIONALITIES: GuestNationalityOption[] = [
  { code: "VN", label: "Vietnam", flag: "🇻🇳" },
  { code: "US", label: "United States", flag: "🇺🇸" },
  { code: "JP", label: "Japan", flag: "🇯🇵" },
  { code: "KR", label: "South Korea", flag: "🇰🇷" },
  { code: "GB", label: "United Kingdom", flag: "🇬🇧" },
  { code: "AU", label: "Australia", flag: "🇦🇺" },
  { code: "FR", label: "France", flag: "🇫🇷" },
  { code: "TH", label: "Thailand", flag: "🇹🇭" },
];
