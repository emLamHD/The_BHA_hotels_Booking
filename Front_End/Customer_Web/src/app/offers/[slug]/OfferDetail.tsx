"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import Amount from "@/components/Amount";
import { promotionLabel } from "@/components/PromotionBadge";
import type { PromotionDetail } from "@/lib/promotions/promotions";
import { periodKind } from "@/lib/promotions/promotions";
import { buildRoomDetailsHref } from "@/lib/roomDetailsRoute";
import { buildStayListingHref } from "@/lib/stayListingQuery";
import { useDateFormat } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";

const RIVERSIDE_SLUG = "the-bha-riverside";

/**
 * The full page of one promotion: content, conditions, where it applies, and the way into booking. It never shows a discounted price — only the
 * rule and the conditions; the booking system prices the dates the guest picks. The links carry the Property and the room type, never the promotion
 * (the backend decides, from the dates, whether a promotion applies).
 */
export default function OfferDetail({ detail }: { detail: PromotionDetail }) {
  const { t, locale, content } = useI18n();
  const dates = useDateFormat();
  const { promotion, property, roomTypes } = detail;
  const { terms } = promotion;
  const propertyName = content("property", property.id, "name", property.name);

  const period = (from: string | null, to: string | null) => {
    switch (periodKind(from, to)) {
      case "range": return t("customer.offers.detail.periodRange", { from: dates.stayDate(from!), to: dates.stayDate(to!) });
      case "from": return t("customer.offers.detail.periodFrom", { from: dates.stayDate(from!) });
      case "until": return t("customer.offers.detail.periodUntil", { to: dates.stayDate(to!) });
      default: return t("customer.offers.detail.periodAny");
    }
  };
  const roomHref = (roomTypeId: string) => buildRoomDetailsHref({ propertyId: property.id, roomTypeId }) as Route;
  const only = roomTypes.length === 1 ? roomTypes[0] : null;

  return (
    <article aria-labelledby="offer-title" className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
      <div className="space-y-4">
        {promotion.coverImageUrl && (
          <div className="overflow-hidden rounded-3xl bg-neutral-100 dark:bg-neutral-800">
            <Image src={promotion.coverImageUrl} alt={promotion.coverAltText ?? ""} width={1200} height={900} sizes="(min-width: 1024px) 55vw, 100vw" unoptimized priority className="h-auto w-full object-cover" />
          </div>
        )}
      </div>
      <div className="space-y-6">
        <header className="space-y-3">
          <span data-testid="offer-rule" className="inline-block rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
            {promotionLabel(t, locale, { kind: terms.kind, value: terms.value, title: "" })}
          </span>
          <h1 id="offer-title" className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{promotion.title}</h1>
          <p className="text-lg text-neutral-600 dark:text-neutral-300">{promotion.summary}</p>
        </header>

        {detail.body.length > 0 && (
          <div className="space-y-3 text-neutral-700 dark:text-neutral-200" data-testid="offer-body">
            {detail.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
          </div>
        )}

        <section aria-labelledby="offer-conditions" className="space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-700">
          <h2 id="offer-conditions" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("customer.offers.detail.conditions")}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.discount")}</dt>
            <dd data-testid="offer-discount">
              {terms.kind === "Percent" ? (
                t("customer.offers.detail.discountPercent", { percent: terms.value })
              ) : (
                <>
                  <Amount amount={terms.value} currencyCode={terms.currencyCode} /> {t("customer.offers.detail.discountFixed")}
                </>
              )}
            </dd>
            <dt className="text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.bookingPeriod")}</dt>
            <dd data-testid="offer-booking-period">{period(terms.bookingFrom, terms.bookingTo)}</dd>
            <dt className="text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.stayPeriod")}</dt>
            <dd data-testid="offer-stay-period">{period(terms.stayFrom, terms.stayTo)}</dd>
            <dt className="text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.minNights")}</dt>
            <dd data-testid="offer-min-nights">{t("customer.booking.nights", { nights: terms.minNights })}</dd>
          </dl>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.stayNote")}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400" data-testid="offer-no-price">{t("customer.offers.detail.noPrice")}</p>
        </section>

        <section aria-labelledby="offer-where" className="space-y-3">
          <h2 id="offer-where" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("customer.offers.detail.rooms")}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-300" data-testid="offer-property">
            {t("customer.offers.detail.property")}: <span className="font-medium">{propertyName}</span>
            {detail.allRoomTypes && <> · {t("customer.offers.detail.allRooms", { property: propertyName })}</>}
          </p>
          {roomTypes.length === 0 ? (
            <p role="status" className="text-sm text-neutral-500 dark:text-neutral-400">{t("customer.offers.detail.noRooms")}</p>
          ) : (
            <ul className="space-y-2" data-testid="offer-room-types">
              {roomTypes.map((room) => (
                <li key={room.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-700">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{content("roomType", room.id, "name", room.name)}</span>
                  <Link href={roomHref(room.id)} data-testid={`offer-room-${room.id}`} className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-600 dark:hover:bg-neutral-800">
                    {t("customer.offers.detail.chooseDates")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            {only && (
              <Link href={roomHref(only.id)} data-testid="offer-cta" className="inline-flex items-center rounded-full bg-primary-6000 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                {t("customer.offers.detail.chooseDates")}
              </Link>
            )}
            {property.slug === RIVERSIDE_SLUG && (
              <Link href={buildStayListingHref("riverside") as Route} data-testid="offer-find" className="inline-flex items-center rounded-full border border-neutral-300 px-6 py-3 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">
                {t("customer.offers.detail.findRooms", { property: propertyName })}
              </Link>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}
