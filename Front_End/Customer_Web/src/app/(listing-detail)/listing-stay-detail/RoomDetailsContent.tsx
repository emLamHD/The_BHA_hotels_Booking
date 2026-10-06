"use client";

import React, { FC, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Badge from "@/shared/Badge";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import MediaGallery from "@/components/MediaGallery";
import ListingImageGallery from "@/components/listing-image-gallery/ListingImageGallery";
import type { ListingGalleryImage } from "@/components/listing-image-gallery/utils/types";
import SectionAvailabilitySearch from "@/app/(home)/SectionAvailabilitySearch";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { selectGalleryImages, visibleImages } from "@/lib/api/mediaPresentation";
import { formatTime } from "@/lib/api/propertyPresentation";
import { formatDesignedForOccupancy, formatMaxOccupancy } from "@/lib/api/roomTypePresentation";
import {
  buildRoomDetailsHref,
  inProgressBookingTarget,
  sameId,
  withQueryParam,
} from "@/lib/roomDetailsRoute";
import MobileBookingBar, { BOOKING_PANEL_ID } from "../(components)/MobileBookingBar";
import RoomHeaderGallery from "./RoomHeaderGallery";

const PHOTO_TOUR = "PHOTO_TOUR_SCROLLABLE";

export interface RoomDetailsContentProps {
  property: PropertyDto;
  roomType: RoomTypeDto;
  /** All of the Property's room types, for the links to the other rooms. */
  roomTypes: RoomTypeDto[];
}

const Section: FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="listingSection__wrap">
    <div>
      <h2 className="text-2xl font-semibold">{title}</h2>
      {hint && <span className="block mt-2 text-neutral-500 dark:text-neutral-400">{hint}</span>}
    </div>
    <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
    {children}
  </div>
);

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's room page for one RoomType: top gallery, content
 * column of `listingSection__wrap` blocks, sticky sidebar. Every fact shown comes from the Property
 * and RoomType the API returned. What the API does not say (beds, baths, area, address, map,
 * reviews, host, cancellation terms, rates tables) is not shown at all.
 */
const RoomDetailsContent: FC<RoomDetailsContentProps> = ({ property, roomType, roomTypes }) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const modalOpen = searchParams?.get("modal") === PHOTO_TOUR;
  const roomName = roomType.name ?? "Room type";
  const propertyName = property.name ?? "The BHA";

  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const images = useMemo<ListingGalleryImage[]>(
    () =>
      visibleImages(selectGalleryImages(roomType.media), failedUrls).map((image, index) => ({
        id: index,
        url: image.url ?? "",
        alt: image.altText ?? `${roomName}`,
      })),
    [roomType.media, failedUrls, roomName]
  );

  // Pictures the browser cannot load are dropped, never replaced by another photograph.
  useEffect(() => {
    let cancelled = false;
    const sources = selectGalleryImages(roomType.media)
      .map((image) => image.url)
      .filter((url): url is string => !!url);
    sources.forEach((url) => {
      const probe = new window.Image();
      probe.onerror = () => {
        if (!cancelled) setFailedUrls((current) => (current.includes(url) ? current : [...current, url]));
      };
      probe.src = url;
    });
    return () => {
      cancelled = true;
    };
  }, [roomType.media]);

  // The modal state lives in the URL next to the room identity; opening/closing keeps every other parameter.
  const openGallery = () => router.push(`${pathname}?${withQueryParam(search, "modal", PHOTO_TOUR)}` as Route);
  const closeGallery = () => {
    const next = withQueryParam(withQueryParam(search, "modal", null), "photoId", null);
    router.push((next ? `${pathname}?${next}` : pathname) as Route);
  };

  // The fixed mobile bar must not hide a control that receives focus.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "6rem";
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, []);

  const amenities = (roomType.amenities ?? []).length > 0 ? roomType.amenities ?? [] : [];
  const propertyAmenities = property.amenities ?? [];

  return (
    <div className="nc-ListingStayDetailPage pb-24 lg:pb-0">
      <div className="pt-4 pb-4">
        <ShowcaseNavLink section="rooms" className="inline-flex items-center text-sm font-medium text-neutral-600 hover:text-primary-6000 dark:text-neutral-300">
          ← Tất cả phòng
        </ShowcaseNavLink>
      </div>

      <RoomHeaderGallery images={images} roomName={roomName} onOpen={openGallery} />

      <main className="relative z-10 mt-11 flex flex-col lg:flex-row">
        {/* CONTENT */}
        <div className="w-full lg:w-3/5 xl:w-2/3 space-y-8 lg:space-y-10 lg:pr-10">
          <div className="listingSection__wrap !space-y-6">
            <div className="flex justify-between items-center">
              <Badge name={propertyName} />
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold">{roomName}</h1>
            <div className="flex items-center text-neutral-500 dark:text-neutral-400">
              <i className="las la-map-marker-alt"></i>
              <span className="ml-1">{propertyName}</span>
            </div>
            <div className="w-full border-b border-neutral-100 dark:border-neutral-700" />
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-neutral-700 dark:text-neutral-300">
              <div className="flex items-center space-x-3">
                <i className="las la-user text-2xl"></i>
                <span>{formatMaxOccupancy(roomType.maxOccupancy)}</span>
              </div>
              <div className="flex items-center space-x-3">
                <i className="las la-users text-2xl"></i>
                <span>{formatDesignedForOccupancy(roomType.baseOccupancy)}</span>
              </div>
            </div>
          </div>

          <Section title="Thông tin phòng">
            <div className="text-neutral-6000 dark:text-neutral-300">
              {roomType.description ?? "Thông tin chi tiết đang được cập nhật."}
            </div>
          </Section>

          {(amenities.length > 0 || propertyAmenities.length > 0) && (
            <Section
              title="Tiện ích"
              hint={amenities.length > 0 ? undefined : `Tiện ích chung tại ${propertyName}`}
            >
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 text-sm text-neutral-700 dark:text-neutral-300">
                {(amenities.length > 0 ? amenities : propertyAmenities).map((amenity) => (
                  <div key={amenity.id} className="flex items-center space-x-3">
                    <i className="text-3xl las la-check-circle"></i>
                    <span>{amenity.name ?? amenity.code}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {selectGalleryImages(property.media).length > 0 && (
            <Section title="Không gian chung" hint={`Hình ảnh chung của ${propertyName}, không phải riêng phòng này.`}>
              <MediaGallery media={property.media} name={propertyName} aspectClass="aspect-[16/9]" />
            </Section>
          )}

          {roomTypes.some((other) => !sameId(other.id, roomType.id)) && (
            <Section title="Loại phòng khác" hint={`Các loại phòng khác tại ${propertyName}`}>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {roomTypes
                  .filter((other) => !sameId(other.id, roomType.id))
                  .map((other) => (
                    <li key={other.id}>
                      <Link
                        href={buildRoomDetailsHref({ propertyId: property.id, roomTypeId: other.id }) as Route}
                        className="block rounded-2xl border border-neutral-200 p-4 hover:border-primary-6000 dark:border-neutral-700"
                      >
                        <span className="block font-medium">{other.name ?? "Room type"}</span>
                        <span className="block mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                          {formatMaxOccupancy(other.maxOccupancy)}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Section>
          )}

          <Section title="Nhận phòng và trả phòng">
            <div className="max-w-md text-sm sm:text-base text-neutral-500 dark:text-neutral-400">
              <div className="flex space-x-10 justify-between p-3 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
                <span>Nhận phòng</span>
                <span>từ {formatTime(property.checkInTime)}</span>
              </div>
              <div className="flex space-x-10 justify-between p-3">
                <span>Trả phòng</span>
                <span>trước {formatTime(property.checkOutTime)}</span>
              </div>
            </div>
          </Section>
        </div>

        {/* SIDEBAR: the one booking panel, for desktop and mobile alike */}
        <div className="block flex-grow mt-14 lg:mt-0">
          <div
            id={BOOKING_PANEL_ID}
            className="scroll-mt-28 lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"
          >
            <div className="listingSectionSidebar__wrap shadow-xl">
              <RoomBookingSidebar property={property} roomType={roomType} />
            </div>
          </div>
        </div>
      </main>

      <ListingImageGallery isShowModal={modalOpen} onClose={closeGallery} images={images} />
      <MobileBookingBar />
    </div>
  );
};

/** The booking panel for this room, or a pointer back to the room whose booking is under way. */
const RoomBookingSidebar: FC<{ property: PropertyDto; roomType: RoomTypeDto }> = ({ property, roomType }) => {
  const { state } = useBookingHoldFlow();
  const inProgress = inProgressBookingTarget(state);
  const roomName = roomType.name ?? "Room type";

  return (
    <>
      <div>
        <span className="block text-2xl font-semibold">Đặt phòng</span>
        <span className="block mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {roomName} · Chọn ngày để xem giá
        </span>
      </div>

      {inProgress && !sameId(inProgress.roomTypeId, roomType.id) ? (
        <div
          role="status"
          className="space-y-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-primary-300"
        >
          <p>
            Bạn đang có một đặt phòng đang thực hiện cho một phòng khác. Hãy tiếp tục hoặc hoàn tất đặt phòng đó
            trước khi đặt phòng này.
          </p>
          <Link href={buildRoomDetailsHref(inProgress) as Route} className="font-medium underline underline-offset-2">
            Tiếp tục đặt phòng
          </Link>
        </div>
      ) : (
        <SectionAvailabilitySearch properties={[property]} lockedRoomType={{ id: roomType.id, name: roomName }} />
      )}
    </>
  );
};

export default RoomDetailsContent;
