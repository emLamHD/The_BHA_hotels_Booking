const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * BHA-CHECKOUT-001-PR08: the properties whose guests are offered "pay at the property". A build-time list of
 * property ids (`NEXT_PUBLIC_DIRECT_BOOKING_PROPERTY_IDS`, comma-separated GUIDs). Unset, blank or ANY malformed
 * entry means off everywhere (fail closed): a typo never widens the pilot. It only decides whether the choice is
 * offered; the API still decides eligibility, price and stock (`checkout.direct-unavailable`).
 */
export function parseDirectBookingPropertyIds(raw: string | undefined): ReadonlySet<string> {
  if (!raw || raw.trim() === "") return new Set();
  const ids = raw.split(",").map((part) => part.trim());
  return ids.every((id) => GUID.test(id)) ? new Set(ids.map((id) => id.toLowerCase())) : new Set();
}

export function isDirectBookingEnabled(
  propertyId: string,
  raw: string | undefined = process.env.NEXT_PUBLIC_DIRECT_BOOKING_PROPERTY_IDS
): boolean {
  return parseDirectBookingPropertyIds(raw).has(propertyId.toLowerCase());
}
