"use client";

import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import type { PromotionCard } from "@/lib/promotions/promotions";
import { PromotionRule } from "@/components/PromotionBadge";
import { OFFERS_PATH } from "@/lib/riversideHomeContent";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * BHA-BOOKING-PROMOTIONS-001: one real promotion the Admin manages. It states the programme (its rule, said from the rule's own fields) and its
 * conditions; it never shows a discounted price, because a price belongs to dates and only the booking system, asked for those dates, states it.
 * Its way in is the detail page, which leads to the right Property and room types.
 */
const OfferCard: FC<{ promotion: PromotionCard; sizes?: string }> = ({ promotion, sizes = "(min-width: 1024px) 25vw, 80vw" }) => {
  const { t } = useI18n();
  const { terms } = promotion;
  return (
    <article
      id={`offer-${promotion.slug}`}
      aria-labelledby={`offer-title-${promotion.slug}`}
      className="nc-OfferCard flex w-full scroll-mt-28 flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        {promotion.coverImageUrl && (
          // The API serves id-addressed pictures (a new file is a new URL), so the optimizer is bypassed like the hero's.
          <Image src={promotion.coverImageUrl} alt={promotion.coverAltText ?? ""} width={800} height={600} sizes={sizes} unoptimized className="h-full w-full object-cover" />
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-neutral-800 shadow dark:bg-neutral-900/90 dark:text-neutral-100">{t("customer.offers.badge")}</span>
        <span data-testid="offer-rule" className="absolute right-3 top-3 max-w-[70%] rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white shadow"><PromotionRule kind={terms.kind} value={terms.value} currencyCode={terms.currencyCode} /></span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 id={`offer-title-${promotion.slug}`} className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          <Link href={`${OFFERS_PATH}/${promotion.slug}` as Route} className="hover:underline focus:outline-none focus-visible:underline">
            {promotion.title}
          </Link>
        </h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{promotion.summary}</p>
        {terms.minNights > 1 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.minNightsLine", { nights: terms.minNights })}</p>
        )}
        <div className="mt-auto space-y-3 pt-2">
          <Link
            href={`${OFFERS_PATH}/${promotion.slug}` as Route}
            className="flex w-full items-center justify-center rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {t("customer.offers.cardCta")}
          </Link>
        </div>
      </div>
    </article>
  );
};

export default OfferCard;
