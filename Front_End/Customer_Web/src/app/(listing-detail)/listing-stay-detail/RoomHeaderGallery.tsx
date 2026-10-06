"use client";

import React, { FC } from "react";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import type { ListingGalleryImage } from "@/components/listing-image-gallery/utils/types";

export interface RoomHeaderGalleryProps {
  images: ListingGalleryImage[];
  roomName: string;
  onOpen: () => void;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's top mosaic (one large picture plus up to four) fed by
 * the RoomType's own images. The template needs five pictures; the mosaic here fills the same
 * frame with however many the room has (0 shows a neutral block, never a stand-in photograph).
 */
const Tile: FC<{ image: ListingGalleryImage; className: string; onOpen: () => void }> = ({ image, className, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label={`Xem ảnh: ${image.alt ?? "ảnh phòng"}`}
    className={`relative overflow-hidden rounded-md sm:rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000 ${className}`}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.url} alt={image.alt ?? ""} className="absolute inset-0 h-full w-full object-cover" />
    <span className="absolute inset-0 bg-neutral-900 bg-opacity-20 opacity-0 hover:opacity-100 transition-opacity" />
  </button>
);

const RoomHeaderGallery: FC<RoomHeaderGalleryProps> = ({ images, roomName, onOpen }) => {
  if (images.length === 0) {
    return (
      <header className="rounded-md sm:rounded-xl">
        <div
          role="img"
          aria-label={`${roomName}: ảnh đang được cập nhật`}
          className="flex aspect-[16/7] w-full items-center justify-center rounded-md bg-neutral-100 text-sm text-neutral-500 sm:rounded-xl dark:bg-neutral-800 dark:text-neutral-400"
        >
          Ảnh đang được cập nhật
        </div>
      </header>
    );
  }

  const [main, ...rest] = images;
  const smalls = rest.slice(0, 4);
  // Spans of the small tiles in the 2x2 area right of the large picture (sm and up).
  const smallClass = (index: number): string => {
    const n = smalls.length;
    if (n === 1) return "sm:col-span-2 sm:row-span-2";
    if (n === 2) return "sm:col-span-1 sm:row-span-2";
    if (n === 3) return index === 0 ? "sm:col-span-1 sm:row-span-2" : "sm:col-span-1 sm:row-span-1";
    return "sm:col-span-1 sm:row-span-1";
  };
  const mainClass =
    smalls.length === 0
      ? "col-span-1 sm:col-span-4 aspect-[16/9]"
      : "col-span-1 sm:col-span-2 sm:row-span-2 aspect-[4/3] sm:aspect-[auto]";

  return (
    <header className="rounded-md sm:rounded-xl">
      <div
        className={`relative grid grid-cols-1 gap-1 sm:gap-2 ${
          smalls.length > 0 ? "sm:grid-cols-4 sm:grid-rows-2 sm:h-[26rem]" : "sm:grid-cols-4"
        }`}
      >
        <Tile image={main} onOpen={onOpen} className={mainClass} />
        {smalls.map((image, index) => (
          <Tile key={image.id} image={image} onOpen={onOpen} className={`hidden sm:block ${smallClass(index)}`} />
        ))}

        <button
          type="button"
          onClick={onOpen}
          className="absolute left-3 bottom-3 z-10 flex items-center justify-center rounded-xl bg-neutral-100 px-4 py-2 text-neutral-500 hover:bg-neutral-200"
        >
          <Squares2X2Icon className="h-5 w-5" />
          <span className="ml-2 text-sm font-medium text-neutral-800">
            {images.length > 1 ? `Xem tất cả ${images.length} ảnh` : "Xem ảnh"}
          </span>
        </button>
      </div>
    </header>
  );
};

export default RoomHeaderGallery;
