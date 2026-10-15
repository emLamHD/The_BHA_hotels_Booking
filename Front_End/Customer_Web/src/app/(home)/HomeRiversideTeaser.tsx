"use client";

import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { CalendarDaysIcon, ClockIcon, HomeModernIcon } from "@heroicons/react/24/outline";
import ButtonPrimary from "@/shared/ButtonPrimary";
import {
  BENEFITS,
  HOME_SECTION,
  RESULTS_PATH,
  RIVERSIDE_ADDRESS,
  RIVERSIDE_NAME,
  RIVERSIDE_PATH,
  SPACE_GALLERY,
  mediaUrl,
  riversideSectionHref,
} from "@/lib/riversideHomeContent";

import { useT } from "@/lib/i18n/I18nProvider";
const BENEFIT_ICON: Record<string, typeof HomeModernIcon> = { types: HomeModernIcon, price: CalendarDaysIcon, hold: ClockIcon };

/** Property-level pictures from the Riverside gallery: the pool by day, the lobby and the entrance with the brand's sign. */
const COLLAGE = ["rooftop-pool-day.webp", "lobby-sofa.webp", "entrance-logo.webp"].map((file) => SPACE_GALLERY.find((image) => image.file === file)!);

/**
 * CUST-WEB-001-CP08a-C2: a short pointer to the property whose rooms the booking system really sells. It
 * carries no price, no availability and no catalog data; the Riverside page, the results and the room page do.
 * It keeps the old `#rooms` anchor, so an older `/#rooms` link still lands on something that leads to the rooms.
 * The three points under the text are the booking page's own `BENEFITS` (what it really does today) and the
 * collage is three property pictures from `SPACE_GALLERY`, so the section is as full as the ones around it.
 */
const HomeRiversideTeaser: FC = () => {
  const t = useT();
  return (
  <section
    id={HOME_SECTION.rooms}
    aria-labelledby="riverside-teaser-heading"
    className="nc-HomeRiversideTeaser relative grid scroll-mt-24 items-center gap-10 lg:grid-cols-2 lg:gap-14"
  >
    <div className="space-y-5">
      <span className="text-sm uppercase tracking-widest text-neutral-500 dark:text-neutral-400">{t("customer.home.homeRiversideTeaser.realBooking")}</span>
      <h2 id="riverside-teaser-heading" className="text-3xl font-semibold md:text-4xl">
        {RIVERSIDE_NAME}
      </h2>
      <p className="text-neutral-600 dark:text-neutral-300">{t("customer.home.homeRiversideTeaser.servicedApartmentsAtChooseDates", { RIVERSIDEADDRESS: RIVERSIDE_ADDRESS })}</p>
      <ul className="space-y-4 border-t border-neutral-200 pt-6 dark:border-neutral-700">
        {BENEFITS.map((benefit) => {
          const Icon = BENEFIT_ICON[benefit.id] ?? HomeModernIcon;
          return (
            <li key={benefit.id} className="flex gap-4">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-6000 dark:bg-neutral-800 dark:text-primary-300">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{benefit.title}</h3>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{benefit.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3 pt-2">
        <ButtonPrimary href={RESULTS_PATH as Route}>{t("customer.home.homeRiversideTeaser.seeRealRoomsAndPrices")}</ButtonPrimary>
        <Link
          href={RIVERSIDE_PATH as Route}
          className="nc-Button relative inline-flex h-auto items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 sm:px-6 sm:text-base"
        >{t("customer.home.homeRiversideTeaser.discoverRiverside")}</Link>
        <Link
          href={riversideSectionHref(HOME_SECTION.rooms) as Route}
          className="inline-flex items-center px-2 py-3 text-sm font-medium text-primary-6000 underline underline-offset-2 hover:text-primary-700 focus:outline-none dark:text-primary-300 dark:hover:text-primary-200 focus-visible:ring-2 focus-visible:ring-primary-500"
        >{t("customer.home.homeRiversideTeaser.roomTypes")}</Link>
      </div>
    </div>
    <div className="grid h-[340px] grid-cols-2 grid-rows-2 gap-3 sm:h-[440px] lg:h-[520px]">
      {COLLAGE.map((image, index) => (
        <div key={image.file} className={`relative overflow-hidden rounded-3xl ${index === 0 ? "row-span-2" : ""}`}>
          <Image
            src={mediaUrl(image.file)}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes="(min-width: 1024px) 25vw, 50vw"
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  </section>
);
};

export default HomeRiversideTeaser;
