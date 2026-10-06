"use client";

import React, { FC } from "react";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import type { ListingGalleryImage } from "@/components/listing-image-gallery/utils/types";

export interface RoomHeaderGalleryProps {
  images: ListingGalleryImage[];
  roomName: string;
  onOpen: () => void;
}

const Empty: FC<{ label: string }> = ({ label }) => (
  <div
    role="img"
    aria-label={label}
    className="absolute inset-0 flex items-center justify-center bg-neutral-100 p-2 text-center text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
  >
    Ảnh đang được cập nhật
  </div>
);

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the template's top mosaic exactly — one large picture and four small
 * ones (the fourth is hidden on phones), same grid, gaps, ratios and rounding — fed by the RoomType's
 * own images. A slot with no picture says so; no picture is repeated and none belongs to another room.
 */
const RoomHeaderGallery: FC<RoomHeaderGalleryProps> = ({ images, roomName, onOpen }) => {
  const slot = (index: number) => images[index];
  const main = slot(0);

  return (
    <header className="rounded-md sm:rounded-xl">
      <div className="relative grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2">
        <div
          className={`col-span-2 row-span-3 sm:row-span-2 relative rounded-md sm:rounded-xl overflow-hidden ${
            main ? "cursor-pointer" : ""
          }`}
          onClick={main ? onOpen : undefined}
        >
          {main ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={main.url} alt={main.alt ?? roomName} className="absolute inset-0 h-full w-full object-cover rounded-md sm:rounded-xl" />
          ) : (
            <Empty label={`${roomName}: ảnh đang được cập nhật`} />
          )}
          {main && <div className="absolute inset-0 bg-neutral-900 bg-opacity-20 opacity-0 hover:opacity-100 transition-opacity"></div>}
        </div>
        {[1, 2, 3, 4].map((index) => {
          const image = slot(index);
          return (
            <div
              key={index}
              className={`relative rounded-md sm:rounded-xl overflow-hidden ${index >= 4 ? "hidden sm:block" : ""}`}
            >
              <div className="aspect-w-4 aspect-h-3 sm:aspect-w-6 sm:aspect-h-5">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.url} alt={image.alt ?? ""} className="h-full w-full object-cover rounded-md sm:rounded-xl" />
                ) : (
                  <Empty label={`${roomName}: ảnh đang được cập nhật`} />
                )}
              </div>
              {image && (
                <button
                  type="button"
                  aria-label={`Xem ảnh: ${image.alt ?? roomName}`}
                  className="absolute inset-0 bg-neutral-900 bg-opacity-20 opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
                  onClick={onOpen}
                />
              )}
            </div>
          );
        })}

        {main && (
          <button
            type="button"
            className="absolute flex items-center justify-center left-3 bottom-3 px-4 py-2 rounded-xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200 z-10"
            onClick={onOpen}
          >
            <Squares2X2Icon className="w-5 h-5" />
            <span className="ml-2 text-neutral-800 text-sm font-medium">
              {images.length > 1 ? `Xem tất cả ${images.length} ảnh` : "Xem ảnh"}
            </span>
          </button>
        )}
      </div>
    </header>
  );
};

export default RoomHeaderGallery;
