import { MediaDto } from "./propertyTypes";
import { isUsableMediaUrl } from "./propertyPresentation";

/**
 * CUST-WEB-SHOWCASE-001-CP02: pure rules behind the image gallery and the cover
 * fallbacks, kept apart from React so they are unit-tested.
 */

/** Every usable image of an item: the cover first, then API order (sortOrder, id). */
export function selectGalleryImages(media: MediaDto[] | null | undefined): MediaDto[] {
  const images = (media ?? []).filter(
    (item) => item.mediaType === "Image" && isUsableMediaUrl(item.url)
  );
  return [...images].sort(
    (a, b) =>
      Number(b.isCover) - Number(a.isCover) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id)
  );
}

/** The images the browser has not failed to load. */
export function visibleImages(images: MediaDto[], failedUrls: readonly string[]): MediaDto[] {
  return images.filter((image) => !failedUrls.includes(image.url ?? ""));
}

/** The image to show large: the chosen one if it is still visible, else the first. */
export function pickMainImage(visible: MediaDto[], selectedUrl: string | null): MediaDto | undefined {
  return visible.find((image) => image.url === selectedUrl) ?? visible[0];
}

/**
 * A single cover remembers the URL that failed, not "something failed": when the item
 * shows a different image (another offer, another search), the old failure is not carried over.
 */
export function coverHasFailed(cover: MediaDto | undefined, failedUrl: string | null): boolean {
  return !cover || cover.url === failedUrl;
}
