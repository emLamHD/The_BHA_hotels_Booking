"use client";

import React, { FC, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import GallerySlider from "@/components/GallerySlider";
import BtnLikeIcon from "@/components/BtnLikeIcon";
import StartRating from "@/components/StartRating";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { selectGalleryImages, visibleImages } from "@/lib/api/mediaPresentation";
import Amount from "@/components/Amount";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { RoomQuote } from "@/lib/roomQuote";

/** What the card knows about price: nothing asked yet, being asked, no room for the dates, or an answer. */
export type RoomCardPrice =
  | { state: "none" }
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "quoted"; quote: RoomQuote };

export interface RoomTypeStayCardProps {
  className?: string;
  property: PropertyDto;
  roomType: RoomTypeDto;
  /** The room page's URL, carrying the visitor's search when there is a valid one. */
  href: string;
  price: RoomCardPrice;
  /**
   * CUST-WEB-001-CP05a: presentation only. The home page keeps the template's sample star rating and heart
   * (both default on); the live results page turns them off because neither is backed by anything real.
   */
  showRating?: boolean;
  showWishlist?: boolean;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the template's StayCard2 — the same slider (12:11, small rounded corners,
 * dots, arrows), heart, small category line, bold name, location line, divider and price/rating row —
 * fed by one RoomType of the booking system. Every figure on it is the API's: the category line and
 * location come from the RoomType and Property, the price from an availability answer for the dates
 * the visitor chose (or a prompt to choose them). The star rating is the template's sample value and
 * is labelled as such; it is not a guest review.
 */
const RoomTypeStayCard: FC<RoomTypeStayCardProps> = ({
  className = "",
  property,
  roomType,
  href,
  price,
  showRating = true,
  showWishlist = true,
}) => {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const { t, content } = useI18n();
  const name = content("roomType", roomType.id, "name", roomType.name ?? t("customer.booking.offer.roomTypeFallback"));

  const gallery = useMemo(
    () =>
      visibleImages(selectGalleryImages(roomType.media), failedUrls)
        .map((image) => image.url)
        .filter((url): url is string => !!url),
    [roomType.media, failedUrls]
  );

  const renderPrice = () => {
    switch (price.state) {
      case "quoted": {
        const { quote } = price;
        return (
          <span className="text-base font-semibold">
            {quote.uniformNightlyAmount !== null ? (
              <>
                <Amount amount={quote.uniformNightlyAmount} currencyCode={quote.currencyCode} />
                {` `}
                <span className="text-sm text-neutral-500 dark:text-neutral-400 font-normal">{t("customer.stay.perNight")}</span>
              </>
            ) : (
              <>
                <Amount amount={quote.totalAmount} currencyCode={quote.currencyCode} />
                {` `}
                <span className="text-sm text-neutral-500 dark:text-neutral-400 font-normal">
                  {t("customer.stay.totalForNights", { nights: quote.nights })}
                </span>
              </>
            )}
          </span>
        );
      }
      case "loading":
        return <span className="text-sm text-neutral-500 dark:text-neutral-400">{t("customer.stay.searchingPrice")}</span>;
      case "unavailable":
        return <span className="text-sm font-medium text-red-600 dark:text-red-400">{t("customer.stay.soldOut")}</span>;
      default:
        return <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{t("customer.stay.pickDates")}</span>;
    }
  };

  return (
    <div className={`nc-StayCard2 group relative ${className}`}>
      <div className="relative w-full">
        {gallery.length > 0 ? (
          <GallerySlider
            uniqueID={`RoomTypeStayCard_${roomType.id}`}
            ratioClass="aspect-w-12 aspect-h-11"
            galleryImgs={gallery}
            imageClass="rounded-lg"
            href={href as Route}
            unoptimized
            onImageError={(image) =>
              typeof image === "string" &&
              setFailedUrls((current) => (current.includes(image) ? current : [...current, image]))
            }
          />
        ) : (
          <Link href={href as Route} aria-label={name} className="block w-full">
            <div className="aspect-w-12 aspect-h-11 w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
              <div className="flex items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                {t("customer.booking.offer.photoPending")}
              </div>
            </div>
          </Link>
        )}
        {showWishlist && <BtnLikeIcon className="absolute right-3 top-3 z-[1]" />}
      </div>

      <Link href={href as Route}>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              {t("customer.stay.apartment")} · {t("customer.booking.upTo", { guests: roomType.maxOccupancy })}
            </span>
            <div className="flex items-center space-x-2">
              <h2 className="font-semibold text-neutral-900 dark:text-white text-base">
                <span className="line-clamp-1">{name}</span>
              </h2>
            </div>
            <div className="flex items-center text-neutral-500 dark:text-neutral-400 text-sm space-x-1.5">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="">{content("property", property.id, "name", property.name ?? "The BHA")}</span>
            </div>
          </div>
          <div className="w-14 border-b border-neutral-100 dark:border-neutral-800"></div>
          <div className="flex justify-between items-center">
            {renderPrice()}
            {showRating && (
              <span className="shrink-0" title={t("customer.stay.sampleRatingTitle")}>
                <StartRating sample="short" className="whitespace-nowrap" />
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
};

export default RoomTypeStayCard;
