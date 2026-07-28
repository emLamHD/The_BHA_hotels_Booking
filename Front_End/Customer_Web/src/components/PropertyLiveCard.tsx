"use client";

import React, { FC, useState } from "react";
import Image from "next/image";
import Badge from "@/shared/Badge";
import placeholderImage from "@/images/placeholder-large-h.png";
import { PropertyDto } from "@/lib/api/propertyTypes";
import {
  formatLocation,
  formatTime,
  selectCoverImage,
} from "@/lib/api/propertyPresentation";

export interface PropertyLiveCardProps {
  className?: string;
  data: PropertyDto;
}

const PropertyLiveCard: FC<PropertyLiveCardProps> = ({
  className = "",
  data,
}) => {
  const [apiImageFailed, setApiImageFailed] = useState(false);
  const coverImage = selectCoverImage(data.media);
  const useApiImage = !!coverImage && !apiImageFailed;
  const location = formatLocation(data);
  const name = data.name ?? "Property";

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
                alt={coverImage!.altText ?? `${name} photo`}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                onError={() => setApiImageFailed(true)}
              />
            ) : (
              <Image
                src={placeholderImage}
                alt={`${name} photo placeholder`}
                fill
                sizes="(max-width: 640px) 100vw, 256px"
                className="object-cover"
              />
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

            {data.description && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">
                {data.description}
              </p>
            )}

            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Check-in {formatTime(data.checkInTime)} · Check-out{" "}
              {formatTime(data.checkOutTime)}
            </div>

            {data.amenities && data.amenities.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.amenities.map((amenity) => (
                  <Badge key={amenity.id} name={amenity.name ?? amenity.code} />
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
