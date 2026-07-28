import { MediaDto, PropertyDto } from "./propertyTypes";

/**
 * Picks the media item the UI should render as the Property's cover image.
 * Prefers the server-flagged cover; otherwise falls back to API ordering
 * (SortOrder then media ID, per docs/BE-001-PROPERTY-INVENTORY.md). Returns
 * undefined when no usable image exists so the caller can fall back to a
 * bundled template asset instead of fabricating one.
 */
export function selectCoverImage(
  media: MediaDto[] | null | undefined
): MediaDto | undefined {
  if (!media || media.length === 0) {
    return undefined;
  }

  const images = media.filter(
    (item) => item.mediaType === "Image" && !!item.url
  );
  if (images.length === 0) {
    return undefined;
  }

  const cover = images.find((item) => item.isCover);
  if (cover) {
    return cover;
  }

  return [...images].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  )[0];
}

/** Joins city/country when present; returns null rather than inventing a placeholder. */
export function formatLocation(property: PropertyDto): string | null {
  const parts = [property.city, property.country].filter(
    (part): part is string => !!part && part.trim().length > 0
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Formats the server TimeOnly ("HH:mm:ss") down to "HH:mm" for display. */
export function formatTime(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}
