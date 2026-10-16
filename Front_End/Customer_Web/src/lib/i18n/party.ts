import type { useDateFormat } from "./dates";
import type { Translate } from "./types";

/** "15 Oct 2026 → 18 Oct 2026 · 1 room · 2 adults, 1 child": each count is its own plural message; the API sends numbers, never words. */
export function partyLine(
  t: Translate,
  dates: ReturnType<typeof useDateFormat>,
  stay: { checkIn: string; checkOut: string; rooms: number; adults: number; children: number }
): string {
  const parts = [
    `${dates.stayDate(stay.checkIn)} → ${dates.stayDate(stay.checkOut)}`,
    t("customer.booking.rooms", { rooms: stay.rooms }),
    t("customer.booking.adults", { adults: stay.adults }),
  ];
  if (stay.children > 0) parts.push(t("customer.booking.children", { children: stay.children }));
  return parts.join(" · ");
}
