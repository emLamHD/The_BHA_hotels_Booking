"use client";

import React, { FC, useState } from "react";
import Image from "next/image";
import Badge from "@/shared/Badge";
import placeholderImage from "@/images/placeholder-large-h.png";
import { RoomTypeDto } from "@/lib/api/propertyTypes";
import { selectCoverImage } from "@/lib/api/propertyPresentation";
import {
  formatDesignedForOccupancy,
  formatMaxOccupancy,
} from "@/lib/api/roomTypePresentation";

export interface RoomTypeLiveCardProps {
  className?: string;
  data: RoomTypeDto;
}

const RoomTypeLiveCard: FC<RoomTypeLiveCardProps> = ({
  className = "",
  data,
}) => {
  const [apiImageFailed, setApiImageFailed] = useState(false);
  const coverImage = selectCoverImage(data.media);
  const useApiImage = !!coverImage && !apiImageFailed;
  const name = data.name ?? "Room type";

  return (
    <div
      className={`nc-RoomTypeLiveCard group relative bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 rounded-3xl overflow-hidden ${className}`}
    >
      <div className="relative w-full aspect-w-6 aspect-h-5 overflow-hidden bg-neutral-100 dark:bg-neutral-800">
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
            sizes="(max-width: 640px) 100vw, 384px"
            className="object-cover"
          />
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <h3 className="text-lg font-medium capitalize">
          <span className="line-clamp-2">{name}</span>
        </h3>

        {data.description && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">
            {data.description}
          </p>
        )}

        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {formatDesignedForOccupancy(data.baseOccupancy)} ·{" "}
          {formatMaxOccupancy(data.maxOccupancy)}
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
  );
};

export default RoomTypeLiveCard;
