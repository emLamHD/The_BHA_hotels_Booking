import { apiGet, ApiRequestOptions } from "./httpClient";
import { PropertyDto } from "./propertyTypes";

const PROPERTIES_PATH = "/api/v1/properties";

/** GET /api/v1/properties — active properties with amenities and ordered media. */
export async function getProperties(
  options: ApiRequestOptions = {}
): Promise<PropertyDto[]> {
  const data = await apiGet<PropertyDto[]>(PROPERTIES_PATH, options);
  return data ?? [];
}
