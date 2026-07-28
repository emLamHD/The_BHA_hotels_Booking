import { MediaDto, PropertyDto } from "./propertyTypes";

// RFC 2606 reserves these domains (and their subdomains) for documentation
// and examples; they are guaranteed to never resolve to a real image. The
// current seed data's images.example.com URLs fall under this rule.
const RESERVED_EXAMPLE_HOSTS = ["example.com", "example.net", "example.org"];

function isReservedExampleHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return RESERVED_EXAMPLE_HOSTS.some(
    (reserved) => lower === reserved || lower.endsWith(`.${reserved}`)
  );
}

/**
 * True when a media URL is a well-formed, absolute http(s) URL that is not
 * a known-unusable placeholder host (RFC 2606 reserved example domains).
 * Used to decide whether the browser should ever be asked to request it.
 */
export function isUsableMediaUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  return !isReservedExampleHost(parsed.hostname);
}

/**
 * Picks the media item the UI should render as the Property's cover image.
 * Prefers the server-flagged cover; otherwise falls back to API ordering
 * (SortOrder then media ID, per docs/BE-001-PROPERTY-INVENTORY.md). Excludes
 * reserved-example-host URLs so the browser is never asked to request a
 * known-unusable image. Returns undefined when no usable image exists so the
 * caller can fall back to a bundled template asset instead of fabricating one.
 */
export function selectCoverImage(
  media: MediaDto[] | null | undefined
): MediaDto | undefined {
  if (!media || media.length === 0) {
    return undefined;
  }

  const images = media.filter(
    (item) => item.mediaType === "Image" && isUsableMediaUrl(item.url)
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
