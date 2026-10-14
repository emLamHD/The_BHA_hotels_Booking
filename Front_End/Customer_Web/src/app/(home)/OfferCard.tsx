import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { MockOffer, OFFER_BADGE, OFFER_REAL_CTA } from "@/data/homepageOffers";
import { discountPercent, formatVnd } from "@/lib/homepageContent";
import { OFFERS_PATH, RESULTS_PATH } from "@/lib/riversideHomeContent";

/**
 * CUST-WEB-001-CP08a-C2: one sample offer. Everything printed is the offer's own mock data and the percent
 * computed from its own two prices; it says it is a sample, shows no stock, rating or timer, and its only
 * way into the booking system is the real search, whose price comes from the server for the dates chosen.
 */
const OfferCard: FC<{ offer: MockOffer; highlighted?: boolean; sizes?: string }> = ({ offer, highlighted = false, sizes = "(min-width: 1024px) 25vw, 80vw" }) => {
  const percent = discountPercent(offer.originalPrice, offer.discountPrice);
  return (
    <article
      id={`offer-${offer.slug}`}
      aria-labelledby={`offer-title-${offer.slug}`}
      className={`nc-OfferCard flex w-full scroll-mt-28 flex-col overflow-hidden rounded-3xl border bg-white dark:bg-neutral-900 ${
        highlighted ? "border-primary-500 ring-2 ring-primary-500" : "border-neutral-200 dark:border-neutral-700"
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <Image src={`/media/the-bha-riverside/${offer.image}`} alt={offer.imageAlt} width={offer.imageWidth} height={offer.imageHeight} sizes={sizes} className="h-full w-full object-cover" />
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-neutral-800 shadow dark:bg-neutral-900/90 dark:text-neutral-100">{OFFER_BADGE}</span>
        {percent > 0 && (
          <span aria-label={`Giảm ${percent}%`} className="absolute right-3 top-3 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white shadow">
            -{percent}%
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 id={`offer-title-${offer.slug}`} className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          <Link href={`${OFFERS_PATH}?offer=${offer.slug}` as Route} className="hover:underline focus:outline-none focus-visible:underline">
            {offer.title}
          </Link>
        </h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{offer.summary}</p>
        <div className="mt-auto space-y-3 pt-2">
          {/* Always two lines (original, then offer price + unit), so the price block is the same height on every card
              and, being pinned to the bottom, the prices and buttons line up across cards whatever the text above. */}
          <p>
            <span className="block text-sm text-neutral-500 line-through dark:text-neutral-400">
              <span className="sr-only">Giá gốc minh hoạ </span>
              {formatVnd(offer.originalPrice)}
            </span>
            <span className="flex items-baseline gap-x-2 whitespace-nowrap">
              <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                <span className="sr-only">Giá ưu đãi minh hoạ </span>
                {formatVnd(offer.discountPrice)}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">/ đêm (minh hoạ)</span>
            </span>
          </p>
          <Link
            href={RESULTS_PATH as Route}
            className="flex w-full items-center justify-center rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {OFFER_REAL_CTA}
          </Link>
        </div>
      </div>
    </article>
  );
};

export default OfferCard;
