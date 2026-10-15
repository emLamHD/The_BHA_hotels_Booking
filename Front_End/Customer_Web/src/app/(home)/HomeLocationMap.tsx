"use client";

import React, { FC } from "react";
import { MapPinIcon } from "@heroicons/react/24/outline";
import {
  RIVERSIDE_FULL_ADDRESS,
  RIVERSIDE_NAME,
  riversideMapEmbedUrl,
  riversideMapLink,
} from "@/lib/riversideHomeContent";

import { useT } from "@/lib/i18n/I18nProvider";
/**
 * CUST-WEB-001-CP08a-C3 (Owner): where The BHA Riverside is. A Google Maps embed (plain iframe, loaded only when
 * it nears the screen, no script of ours, no API key) of the Owner-given address, with a link that opens the place
 * in Google Maps for directions. Nothing from the booking system or the visitor is involved.
 */
const HomeLocationMap: FC = () => {
  const t = useT();
  return (
  <section aria-labelledby="location-heading" className="nc-HomeLocationMap relative">
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h2 id="location-heading" className="text-3xl font-semibold md:text-4xl">{t("customer.home.homeLocationMap.locationOf", { RIVERSIDENAME: RIVERSIDE_NAME })}
        </h2>
        <p className="mt-3 flex items-start gap-2 text-neutral-600 dark:text-neutral-300">
          <MapPinIcon className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <span>{RIVERSIDE_FULL_ADDRESS}</span>
        </p>
      </div>
      <a
        href={riversideMapLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-12 flex-shrink-0 items-center justify-center rounded-full border border-neutral-300 px-6 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >{t("customer.home.homeLocationMap.openInGoogleMaps")}<span className="sr-only">{" "}{t("customer.home.homeLocationMap.opensInANewTab")}</span>
      </a>
    </div>
    <div className="overflow-hidden rounded-3xl border border-neutral-200 dark:border-neutral-700">
      <iframe
        title={t("customer.home.map.title", { name: RIVERSIDE_NAME, address: RIVERSIDE_FULL_ADDRESS })}
        src={riversideMapEmbedUrl()}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        className="block h-[320px] w-full border-0 sm:h-[400px] lg:h-[460px]"
      />
    </div>
  </section>
);
};

export default HomeLocationMap;
