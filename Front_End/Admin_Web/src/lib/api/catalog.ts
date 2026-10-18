import { call } from "./website";
import { getApiBaseUrl } from "./env";

export interface PropertyChoice { id: string; name: string; slug: string }
export interface CatalogProductSummary {
  propertyId: string; roomTypeId: string; code: string; name: string; description: string | null;
  baseOccupancy: number; maxOccupancy: number; physicalRoomCount: number; galleryCount: number;
  coverMediaId: string | null; coverAltText: string | null; isActive: boolean;
}
export interface GalleryItem { mediaId: string; url: string; altText: string | null; isCover: boolean }
export interface Amenity { id: string; code: string; name: string; category: string }
export interface CatalogEditor {
  propertyId: string; roomTypeId: string | null; version: number; sourceLocale: string;
  name: string; description: string | null; slug: string; code: string | null;
  address: string | null; city: string | null; country: string | null;
  areaSquareMeters: number | null; bedrooms: number | null; bedDescription: string | null;
  baseOccupancy: number | null; maxOccupancy: number | null; physicalRoomCount: number; isActive: boolean;
  timeZone: string; checkInTime: string; checkOutTime: string; updatedAt: string; updatedByStaffId: string | null;
  roomTypes: { id: string; code: string; name: string }[]; gallery: GalleryItem[];
  amenityIds: string[]; amenities: Amenity[]; translationOverrideKeys: string[];
}
export type CatalogBody = Pick<CatalogEditor, "name" | "description" | "address" | "city" | "country" | "areaSquareMeters" | "bedrooms" | "bedDescription" | "amenityIds" | "gallery"> & { expectedVersion: number };
const rec = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const nullable = (x: unknown, kind: "string" | "number") => x === null || typeof x === kind;
export function parseGallery(x: unknown): GalleryItem | null {
  return rec(x) && typeof x.mediaId === "string" && typeof x.url === "string" && nullable(x.altText, "string") && typeof x.isCover === "boolean" ? x as unknown as GalleryItem : null;
}
export function parseProductSummary(x: unknown): CatalogProductSummary | null {
  if (!rec(x) || "gallery" in x || ![x.propertyId, x.roomTypeId, x.code, x.name].every(v => typeof v === "string") ||
      !nullable(x.description, "string") || !nullable(x.coverMediaId, "string") || !nullable(x.coverAltText, "string") ||
      ![x.baseOccupancy, x.maxOccupancy, x.physicalRoomCount, x.galleryCount].every(v => Number.isInteger(v) && Number(v) >= 0) ||
      typeof x.isActive !== "boolean") return null;
  return x as unknown as CatalogProductSummary;
}
export function parseAmenity(x: unknown): Amenity | null {
  return rec(x) && [x.id, x.code, x.name, x.category].every(v => typeof v === "string") ? x as unknown as Amenity : null;
}
export function parseEditor(x: unknown): CatalogEditor | null {
  if (!rec(x) || !["propertyId", "sourceLocale", "name", "slug", "timeZone", "checkInTime", "checkOutTime", "updatedAt"].every(k => typeof x[k] === "string") ||
      !["roomTypeId", "description", "code", "address", "city", "country", "bedDescription", "updatedByStaffId"].every(k => nullable(x[k], "string")) ||
      !["areaSquareMeters", "bedrooms", "baseOccupancy", "maxOccupancy"].every(k => nullable(x[k], "number")) ||
      !Number.isInteger(x.version) || Number(x.version) < 1 || !Number.isInteger(x.physicalRoomCount) || typeof x.isActive !== "boolean" ||
      !Array.isArray(x.gallery) || !x.gallery.every(v => parseGallery(v) !== null) || !Array.isArray(x.amenities) || !x.amenities.every(v => parseAmenity(v) !== null) ||
      !Array.isArray(x.amenityIds) || !x.amenityIds.every(v => typeof v === "string") || !Array.isArray(x.translationOverrideKeys) || !x.translationOverrideKeys.every(v => typeof v === "string") ||
      !Array.isArray(x.roomTypes) || !x.roomTypes.every(v => rec(v) && [v.id, v.code, v.name].every(t => typeof t === "string"))) return null;
  return x as unknown as CatalogEditor;
}
export const ownerPath = (p: string, r: string | null) => `/api/admin/v1/catalog/properties/${encodeURIComponent(p)}${r ? `/room-types/${encodeURIComponent(r)}` : ""}`;
export const getCatalogProperties = (signal?: AbortSignal) => call<PropertyChoice[]>("GET", "/api/admin/v1/catalog/properties", undefined, {
  write: false, signal, parse: x => Array.isArray(x) && x.every(v => rec(v) && [v.id, v.name, v.slug].every(t => typeof t === "string")) ? x : null,
});
export const getCatalogProducts = (propertyId: string, signal?: AbortSignal) => call<CatalogProductSummary[]>("GET", `${ownerPath(propertyId, null)}/products`, undefined, {
  write: false, signal, parse: x => Array.isArray(x) && x.every(v => parseProductSummary(v) !== null) ? x as CatalogProductSummary[] : null,
});
export const getCatalog = (p: string, r: string | null, signal?: AbortSignal) => call("GET", ownerPath(p, r), undefined, { write: false, parse: parseEditor, signal });
export const saveCatalog = (p: string, r: string | null, body: CatalogBody) => call("POST", `${ownerPath(p, r)}/save`, body, { write: true, parse: parseEditor });
export function uploadCatalog(p: string, r: string | null, file: File) {
  const body = new FormData(); body.append("file", file);
  return call("POST", `${ownerPath(p, r)}/media`, body, { write: true, parse: parseGallery });
}
export const createAmenity = (p: string, body: { code: string; name: string; category: string }) => call("POST", `${ownerPath(p, null)}/amenities`, body, { write: true, parse: parseAmenity });
export function catalogImage(p: string, r: string | null, id: string): string | null {
  const base = getApiBaseUrl();
  return base.ok ? `${base.baseUrl}${ownerPath(p, r)}/media/${encodeURIComponent(id)}` : null;
}
export function bodyOf(x: CatalogEditor): CatalogBody {
  return { expectedVersion: x.version, name: x.name, description: x.description, address: x.address, city: x.city, country: x.country,
    areaSquareMeters: x.areaSquareMeters, bedrooms: x.bedrooms, bedDescription: x.bedDescription, gallery: x.gallery, amenityIds: x.amenityIds };
}
export function removeImage(items: GalleryItem[], id: string): GalleryItem[] {
  const next = items.filter(x => x.mediaId !== id);
  return next.some(x => x.isCover) ? next : next.map((x, i) => ({ ...x, isCover: i === 0 }));
}
