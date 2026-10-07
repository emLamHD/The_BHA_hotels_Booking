"use client";

import React, { FC } from "react";
import Badge from "@/shared/Badge";
import { RoomTypeDto } from "@/lib/api/propertyTypes";
import MediaGallery from "@/components/MediaGallery";
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
  const name = data.name ?? "Room type";

  return (
    <div
      className={`nc-RoomTypeLiveCard group relative bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 rounded-3xl overflow-hidden ${className}`}
    >
      <div className="p-3 pb-0">
        {/* CUST-WEB-SHOWCASE-001-CP02: every image the API has for this room type, never a stand-in. */}
        <MediaGallery
          media={data.media}
          name={name}
          emptyLabel="Ảnh đang được cập nhật"
          aspectClass="aspect-[6/5]"
        />
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
