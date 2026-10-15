"use client";

import React, { FC, useState } from "react";
import Badge from "@/shared/Badge";
import { PropertyDto } from "@/lib/api/propertyTypes";
import { coverHasFailed } from "@/lib/api/mediaPresentation";
import {
  formatLocation,
  formatTime,
  selectCoverImage,
} from "@/lib/api/propertyPresentation";

import { useI18n } from "@/lib/i18n/I18nProvider";
export interface PropertyLiveCardProps {
  className?: string;
  data: PropertyDto;
}

const PropertyLiveCard: FC<PropertyLiveCardProps> = ({
  className = "",
  data,
}) => {
  const { t, content } = useI18n();
  // The URL that failed, not a flag: a different cover is never judged by an old failure.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const coverImage = selectCoverImage(data.media);
  const useApiImage = !coverHasFailed(coverImage, failedUrl);
  const location = formatLocation({
    ...data,
    city: content("property", data.id, "city", data.city),
    country: content("property", data.id, "country", data.country),
  });
  const name = content("property", data.id, "name", data.name ?? t("customer.search.propertyFallback"));
  const description = content("property", data.id, "description", data.description);

  return (
    <div
      className={`nc-PropertyLiveCard group relative bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 rounded-3xl overflow-hidden ${className}`}
    >
      <div className="h-full w-full flex flex-col sm:flex-row sm:items-stretch">
        <div className="flex-shrink-0 p-3 w-full sm:w-64">
          <div className="relative w-full aspect-w-1 aspect-h-1 rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-800">
            {useApiImage ? (
              // selectCoverImage already excludes reserved-example-host and malformed
              // URLs, so this src is never a known-unusable request. onError stays as a
              // defensive fallback for unexpected runtime failures (e.g. a genuine host
              // returning 404), not as the primary filter.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImage!.url!}
                alt={content("media", coverImage!.id, "altText", coverImage!.altText) ?? t("customer.media.photoOf", { name })}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                onError={() => setFailedUrl(coverImage!.url)}
              />
            ) : (
              // CUST-WEB-SHOWCASE-001-CP01: no bundled template bitmap without rights evidence.
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">{t("customer.propertyLiveCard.photosAreBeingUpdated")}</div>
            )}
          </div>
        </div>

        <div className="flex-grow p-3 sm:pr-6 flex flex-col items-start">
          <div className="space-y-3 w-full">
            <h2 className="text-lg font-medium capitalize">
              <span className="line-clamp-2">{name}</span>
            </h2>

            {location && (
              <div className="flex items-center text-sm text-neutral-500 dark:text-neutral-400">
                <i className="las la-map-marker-alt text-lg mr-1"></i>
                <span>{location}</span>
              </div>
            )}

            {description && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">
                {description}
              </p>
            )}

            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.propertyLiveCard.checkIn")}{" "}{formatTime(data.checkInTime)}{" "}{t("customer.propertyLiveCard.checkOut")}{" "}
              {formatTime(data.checkOutTime)}
            </div>

            {data.amenities && data.amenities.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.amenities.map((amenity) => (
                  <Badge key={amenity.id} name={content("amenity", amenity.id, "name", amenity.name ?? amenity.code)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyLiveCard;
