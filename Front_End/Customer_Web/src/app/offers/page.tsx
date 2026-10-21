import React from "react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import { RESULTS_PATH, OFFERS_PATH } from "@/lib/riversideHomeContent";
import { getPromotions } from "@/lib/promotions/server";
import OfferCard from "../(home)/OfferCard";

import { getT } from "@/lib/i18n/server";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.offers.title"), description: t("customer.meta.offers.description") };
}

interface OffersPageProps {
  searchParams?: { offer?: string | string[] };
}

/**
 * BHA-BOOKING-PROMOTIONS-001: every promotion that is public today (the Admin's, the same data as the home page). A card leads to its own page
 * (`/offers/<slug>`); the old sample links (`?offer=<slug>`) just return here. No price appears on this page: a price belongs to dates.
 */
export default async function OffersPage({ searchParams }: OffersPageProps) {
  if (searchParams?.offer !== undefined) redirect(OFFERS_PATH);
  const t = await getT();
  const result = await getPromotions();
  return (
    <div className="nc-OffersPage relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <header className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{t("customer.common.roomOffers")}</h1>
          <p>
            <Link href={RESULTS_PATH as Route} className="font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">{t("customer.offers.page.findRoomsAndSeeReal")}</Link>
          </p>
        </header>
        {result.status === "error" && (
          <p role="alert" data-testid="offers-unavailable" className="mt-10 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-neutral-800 dark:text-amber-200">
            {t("customer.offers.unavailable")}
          </p>
        )}
        {result.status === "ok" && result.items.length === 0 && (
          <p role="status" data-testid="offers-empty" className="mt-10 text-neutral-600 dark:text-neutral-300">{t("customer.offers.empty")}</p>
        )}
        {result.status === "ok" && result.items.length > 0 && (
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {result.items.map((promotion) => (
              <li key={promotion.id} className="flex">
                <OfferCard promotion={promotion} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
