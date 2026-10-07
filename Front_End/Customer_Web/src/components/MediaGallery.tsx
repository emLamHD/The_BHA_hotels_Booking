"use client";

import React, { FC, useState } from "react";
import { MediaDto } from "@/lib/api/propertyTypes";
import { pickMainImage, selectGalleryImages, visibleImages } from "@/lib/api/mediaPresentation";

export interface MediaGalleryProps {
  media: MediaDto[] | null | undefined;
  /** What to call the item in labels, e.g. the room type name. */
  name: string;
  /** Text shown where the large image would be when no image is usable; omit to render nothing. */
  emptyLabel?: string;
  className?: string;
  /** Tailwind aspect classes for the large image. */
  aspectClass?: string;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02: the API's images for one Property or RoomType. One large
 * image and, when there is more than one, a row of thumbnails that switch it. An image
 * the browser cannot load is dropped from the set, never replaced by a stand-in picture.
 */
const MediaGallery: FC<MediaGalleryProps> = ({
  media,
  name,
  emptyLabel,
  className = "",
  aspectClass = "aspect-[3/2]",
}) => {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  const visible = visibleImages(selectGalleryImages(media), failedUrls);
  const main = pickMainImage(visible, selectedUrl);
  const markFailed = (url: string | null) =>
    setFailedUrls((current) => (url && !current.includes(url) ? [...current, url] : current));

  if (!main) {
    return emptyLabel ? (
      <div className={`relative w-full ${aspectClass} rounded-xl bg-neutral-100 dark:bg-neutral-800 ${className}`}>
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          {emptyLabel}
        </div>
      </div>
    ) : null;
  }

  return (
    <div className={className}>
      <div className={`relative w-full ${aspectClass} overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={main.url ?? main.id}
          src={main.url!}
          alt={main.altText ?? `${name} photo`}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => markFailed(main.url)}
        />
      </div>
      {visible.length > 1 && (
        <ul className="mt-2 grid grid-cols-5 gap-2" aria-label={`${name} photos`}>
          {visible.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setSelectedUrl(image.url)}
                aria-pressed={image.url === main.url}
                aria-label={`${name}: ${image.altText ?? `photo ${index + 1}`}`}
                className={`relative block w-full aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000 ${
                  image.url === main.url ? "ring-2 ring-primary-6000" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url!}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  onError={() => markFailed(image.url)}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MediaGallery;
