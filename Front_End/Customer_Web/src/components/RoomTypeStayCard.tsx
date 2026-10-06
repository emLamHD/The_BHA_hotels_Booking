"use client";

import React, { FC, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import GallerySlider from "@/components/GallerySlider";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { selectGalleryImages, visibleImages } from "@/lib/api/mediaPresentation";
import { formatDesignedForOccupancy, formatMaxOccupancy } from "@/lib/api/roomTypePresentation";
import { buildRoomDetailsHref } from "@/lib/roomDetailsRoute";

export interface RoomTypeStayCardProps {
  className?: string;
  property: PropertyDto;
  roomType: RoomTypeDto;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's StayCard2 markup (slider, category line, title,
 * location line, divider, price row) fed by one RoomType from the API. The gallery, the title and
 * the price row all link to the details route of this same RoomType. There is no price here: the
 * catalog has none, and a nightly rate is only meaningful for chosen dates, so the row asks for
 * dates instead of showing a number.
 */
const RoomTypeStayCard: FC<RoomTypeStayCardProps> = ({ className = "", property, roomType }) => {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const name = roomType.name ?? "Room type";
  const href = buildRoomDetailsHref({ propertyId: property.id, roomTypeId: roomType.id }) as Route;

  const gallery = useMemo(
    () =>
      visibleImages(selectGalleryImages(roomType.media), failedUrls)
        .map((image) => image.url)
        .filter((url): url is string => !!url),
    [roomType.media, failedUrls]
  );

  return (
    <div className={`nc-StayCard2 group relative ${className}`}>
      <div className="relative w-full">
        {gallery.length > 0 ? (
          <GallerySlider
            uniqueID={`RoomTypeStayCard_${roomType.id}`}
            ratioClass="aspect-w-12 aspect-h-11"
            galleryImgs={gallery}
            imageClass="rounded-lg"
            href={href}
            unoptimized
            onImageError={(image) =>
              typeof image === "string" &&
              setFailedUrls((current) => (current.includes(image) ? current : [...current, image]))
            }
          />
        ) : (
          <Link href={href} aria-label={name} className="block w-full">
            <div className="aspect-w-12 aspect-h-11 w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
              <div className="flex items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                Ảnh đang được cập nhật
              </div>
            </div>
          </Link>
        )}
      </div>

      <Link href={href}>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              {property.name ?? "Property"} · {formatMaxOccupancy(roomType.maxOccupancy)}
            </span>
            <h2 className="font-semibold text-neutral-900 dark:text-white text-base">
              <span className="line-clamp-1">{name}</span>
            </h2>
            {roomType.description && (
              <div className="flex items-start text-neutral-500 dark:text-neutral-400 text-sm space-x-1.5">
                <span className="line-clamp-2">{roomType.description}</span>
              </div>
            )}
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {formatDesignedForOccupancy(roomType.baseOccupancy)}
            </div>
          </div>
          <div className="w-14 border-b border-neutral-100 dark:border-neutral-800"></div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              Chọn ngày để xem giá
            </span>
            <span className="text-sm font-medium text-primary-6000">Xem phòng →</span>
          </div>
        </div>
      </Link>
    </div>
  );
};

export default RoomTypeStayCard;
