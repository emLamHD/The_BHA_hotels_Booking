import { apiGet, ApiRequestOptions } from "./httpClient";
import { RoomTypeDto } from "./propertyTypes";

function roomTypesPath(propertyId: string): string {
  return `/api/v1/properties/${propertyId}/room-types`;
}

/**
 * GET /api/v1/properties/{propertyId}/room-types — active RoomTypes for an
 * active, live Property, ordered by name then ID as returned by the server.
 * `propertyId` must come from a live GET /api/v1/properties response; this
 * function does not validate, infer, or default it.
 */
export async function getRoomTypes(
  propertyId: string,
  options: ApiRequestOptions = {}
): Promise<RoomTypeDto[]> {
  const data = await apiGet<RoomTypeDto[]>(roomTypesPath(propertyId), options);
  return data ?? [];
}
