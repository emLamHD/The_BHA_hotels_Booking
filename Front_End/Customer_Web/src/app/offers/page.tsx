import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import { MOCK_OFFERS } from "@/data/homepageOffers";
import { resolveOfferHighlight } from "@/lib/homepageContent";
import { RESULTS_PATH } from "@/lib/riversideHomeContent";
import OfferCard from "../(home)/OfferCard";
import OfferHighlightScroller from "./OfferHighlightScroller";

import { getT } from "@/lib/i18n/server";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.offers.title"), description: t("customer.meta.offers.description") };
}

interface OffersPageProps {
  searchParams?: { offer?: string | string[] };
}

/**
 * CUST-WEB-001-CP08a-C2: every sample offer of the home page (the same mock data, `data/homepageOffers`). It
 * is not connected to the booking system: no price here reaches a quote, a hold or a reservation. `?offer=<slug>`
 * highlights one known offer and scrolls to it; an unknown, empty or repeated value highlights nothing.
 */
export default async function OffersPage({ searchParams }: OffersPageProps) {
  const t = await getT();
  const highlighted = resolveOfferHighlight(searchParams?.offer);
  return (
    <div className="nc-OffersPage relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <header className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{t("customer.common.roomOffers")}</h1>
          <p role="note" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-neutral-800 dark:text-amber-200">
            {t("customer.offers.disclosure")}
          </p>
          <p>
            <Link href={RESULTS_PATH as Route} className="font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">{t("customer.offers.page.findRoomsAndSeeReal")}</Link>
          </p>
        </header>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {MOCK_OFFERS.map((offer) => (
            <li key={offer.id} className="flex">
              <OfferCard offer={offer} highlighted={highlighted?.id === offer.id} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
            </li>
          ))}
        </ul>
        {highlighted && <OfferHighlightScroller slug={highlighted.slug} />}
      </div>
    </div>
  );
}
