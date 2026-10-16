import type { Translate } from "@/lib/i18n/types";

/**
 * Formats RoomTypeDto.baseOccupancy as an honest guest count. Does not
 * reinterpret occupancy as beds, bedrooms, or available-room counts.
 */
export function formatDesignedForOccupancy(baseOccupancy: number, t: Translate): string {
  return t("customer.booking.designedFor", { guests: baseOccupancy });
}

/**
 * Formats RoomTypeDto.maxOccupancy as an honest guest count. Does not
 * reinterpret occupancy as beds, bedrooms, or available-room counts.
 */
export function formatMaxOccupancy(maxOccupancy: number, t: Translate): string {
  return t("customer.booking.upTo", { guests: maxOccupancy });
}
