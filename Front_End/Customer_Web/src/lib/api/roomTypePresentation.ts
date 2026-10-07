function pluralizeGuests(count: number): string {
  return `${count} guest${count === 1 ? "" : "s"}`;
}

/**
 * Formats RoomTypeDto.baseOccupancy as an honest guest count. Does not
 * reinterpret occupancy as beds, bedrooms, or available-room counts.
 */
export function formatDesignedForOccupancy(baseOccupancy: number): string {
  return `Designed for ${pluralizeGuests(baseOccupancy)}`;
}

/**
 * Formats RoomTypeDto.maxOccupancy as an honest guest count. Does not
 * reinterpret occupancy as beds, bedrooms, or available-room counts.
 */
export function formatMaxOccupancy(maxOccupancy: number): string {
  return `Up to ${pluralizeGuests(maxOccupancy)}`;
}
