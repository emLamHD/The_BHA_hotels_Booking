"use client";

import React, { FC, useState } from "react";
import ButtonPrimary from "@/shared/ButtonPrimary";
import { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { selectCoverImage } from "@/lib/api/propertyPresentation";
import { coverHasFailed } from "@/lib/api/mediaPresentation";
import PriceBreakdown from "@/components/PriceBreakdown";
import { useDateFormat } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";

export interface AvailabilityOfferCardProps {
  className?: string;
  data: AvailabilityOfferDto;
  /** Selects this exact offer for a Hold attempt; absent when Holds are out of scope for this render. */
  onHold?: () => void;
  /** True once an active Hold already exists, or another offer is mid-selection; disables this CTA. */
  holdDisabled?: boolean;
  /** Sidebar use: the room's own page already shows its photographs, so the card omits them. */
  hideMedia?: boolean;
}

const AvailabilityOfferCard: FC<AvailabilityOfferCardProps> = ({
  className = "",
  data,
  onHold,
  holdDisabled = false,
  hideMedia = false,
}) => {
  const { t, content } = useI18n();
  const dates = useDateFormat();
  // The URL that failed, not a flag: a different cover is never judged by an old failure.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const coverImage = selectCoverImage(data.media);
  const useApiImage = !coverHasFailed(coverImage, failedUrl);
  const roomTypeName = content("roomType", data.roomTypeId, "name", data.roomTypeName ?? t("customer.booking.offer.roomTypeFallback"));
  const nightlyRates = data.nightlyRates ?? [];

  return (
    <div
      className={`nc-AvailabilityOfferCard group relative bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 rounded-3xl overflow-hidden ${className}`}
    >
      {!hideMedia && (
      <div className="relative w-full aspect-w-6 aspect-h-5 overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        {useApiImage ? (
          // selectCoverImage already excludes reserved-example-host and malformed
          // URLs, so this src is never a known-unusable request. onError stays as a
          // defensive fallback for unexpected runtime failures, not the primary filter.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImage!.url!}
            alt={coverImage!.altText ?? t("customer.booking.offer.photoAlt", { name: roomTypeName })}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setFailedUrl(coverImage!.url)}
          />
        ) : (
          // CUST-WEB-SHOWCASE-001-CP01: no bundled template bitmap without rights evidence.
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {t("customer.booking.offer.photoPending")}
          </div>
        )}
      </div>
      )}

      <div className="p-4 sm:p-5 space-y-3">
        <h3 className="text-lg font-medium capitalize">
          <span className="line-clamp-2">{roomTypeName}</span>
        </h3>

        {data.roomTypeDescription && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">
            {content("roomType", data.roomTypeId, "description", data.roomTypeDescription)}
          </p>
        )}

        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {content("ratePlan", data.ratePlanId, "name", data.ratePlanName ?? t("customer.booking.offer.ratePlanFallback"))}
        </div>

        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {dates.stayDate(data.checkIn)} → {dates.stayDate(data.checkOut)} · {t("customer.booking.nights", { nights: data.nights })}
        </div>

        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("customer.booking.offer.requestedAvailable", { rooms: data.requestedRooms, available: data.availableRooms })}
        </div>

        <div className="w-14 border-b border-neutral-200/80 dark:border-neutral-700"></div>

        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          <PriceBreakdown
            rows={nightlyRates.map((rate) => ({ key: rate.stayDate, label: dates.stayDate(rate.stayDate), amount: rate.amount, listAmount: rate.listAmount ?? undefined }))}
            totalAmount={data.totalAmount}
            currencyCode={data.currencyCode}
            discount={{ listTotal: data.listTotalAmount ?? data.totalAmount, discountTotal: data.discountTotalAmount ?? 0, promotion: data.appliedPromotion }}
            totalLabel={<span className="text-sm">{t("customer.booking.offer.total")}</span>}
            totalClassName="mt-2 flex justify-between items-center"
          />
        </div>

        {onHold && (
          <ButtonPrimary
            type="button"
            className="w-full !py-2.5"
            disabled={holdDisabled}
            onClick={onHold}
          >
            {t("customer.booking.offer.holdThisRoom")}
          </ButtonPrimary>
        )}
      </div>
    </div>
  );
};

export default AvailabilityOfferCard;
