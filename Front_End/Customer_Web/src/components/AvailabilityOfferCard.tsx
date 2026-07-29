"use client";

import React, { FC, useState } from "react";
import Image from "next/image";
import placeholderImage from "@/images/placeholder-large-h.png";
import { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { selectCoverImage } from "@/lib/api/propertyPresentation";
import { formatCurrencyAmount } from "@/lib/api/availabilityPresentation";

export interface AvailabilityOfferCardProps {
  className?: string;
  data: AvailabilityOfferDto;
}

const AvailabilityOfferCard: FC<AvailabilityOfferCardProps> = ({
  className = "",
  data,
}) => {
  const [apiImageFailed, setApiImageFailed] = useState(false);
  const coverImage = selectCoverImage(data.media);
  const useApiImage = !!coverImage && !apiImageFailed;
  const roomTypeName = data.roomTypeName ?? "Room type";
  const nightlyRates = data.nightlyRates ?? [];

  return (
    <div
      className={`nc-AvailabilityOfferCard group relative bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 rounded-3xl overflow-hidden ${className}`}
    >
      <div className="relative w-full aspect-w-6 aspect-h-5 overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        {useApiImage ? (
          // selectCoverImage already excludes reserved-example-host and malformed
          // URLs, so this src is never a known-unusable request. onError stays as a
          // defensive fallback for unexpected runtime failures, not the primary filter.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImage!.url!}
            alt={coverImage!.altText ?? `${roomTypeName} photo`}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setApiImageFailed(true)}
          />
        ) : (
          <Image
            src={placeholderImage}
            alt={`${roomTypeName} photo placeholder`}
            fill
            sizes="(max-width: 640px) 100vw, 384px"
            className="object-cover"
          />
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <h3 className="text-lg font-medium capitalize">
          <span className="line-clamp-2">{roomTypeName}</span>
        </h3>

        {data.roomTypeDescription && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">
            {data.roomTypeDescription}
          </p>
        )}

        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {data.ratePlanName ?? "Rate plan"}
        </div>

        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {data.checkIn} → {data.checkOut} · {data.nights} night
          {data.nights === 1 ? "" : "s"}
        </div>

        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Requested {data.requestedRooms} room{data.requestedRooms === 1 ? "" : "s"} ·{" "}
          {data.availableRooms} available
        </div>

        {nightlyRates.length > 0 && (
          <ul className="text-xs text-neutral-500 dark:text-neutral-400 divide-y divide-neutral-100 dark:divide-neutral-800">
            {nightlyRates.map((rate) => (
              <li key={rate.stayDate} className="flex justify-between gap-4 py-1">
                <span>{rate.stayDate}</span>
                <span>{formatCurrencyAmount(rate.amount, data.currencyCode)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="w-14 border-b border-neutral-200/80 dark:border-neutral-700"></div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">Total</span>
          <span className="text-base font-semibold text-secondary-500">
            {formatCurrencyAmount(data.totalAmount, data.currencyCode)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AvailabilityOfferCard;
