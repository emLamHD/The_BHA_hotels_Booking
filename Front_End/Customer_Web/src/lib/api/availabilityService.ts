import { apiGet, ApiRequestOptions } from "./httpClient";
import { AvailabilityOfferDto, AvailabilityQuery } from "./availabilityTypes";

function availabilityPath(propertyId: string): string {
  return `/api/v1/properties/${propertyId}/availability`;
}

/**
 * GET /api/v1/properties/{propertyId}/availability — a safe, unauthenticated
 * read of stably ordered stay offers. `propertyId` must come from a live
 * GET /api/v1/properties response; this function does not validate, infer,
 * or default it. The five query values are passed via Axios `params` only —
 * no CSRF, Idempotency-Key, or booking-access-token header is ever added.
 */
export async function searchAvailability(
  propertyId: string,
  query: AvailabilityQuery,
  options: ApiRequestOptions = {}
): Promise<AvailabilityOfferDto[]> {
  const data = await apiGet<AvailabilityOfferDto[]>(availabilityPath(propertyId), {
    ...options,
    params: {
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      adults: query.adults,
      children: query.children,
      rooms: query.rooms,
    },
  });
  return data ?? [];
}
