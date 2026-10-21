import React from "react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import { OFFERS_PATH } from "@/lib/riversideHomeContent";
import { getPromotion } from "@/lib/promotions/server";
import { getT } from "@/lib/i18n/server";
import OfferDetail from "./OfferDetail";

interface OfferPageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: OfferPageProps): Promise<Metadata> {
  const result = await getPromotion(params.slug);
  if (result.status !== "ok") return {};
  const t = await getT();
  return { title: t("customer.meta.offerDetail.title", { title: result.detail.promotion.title }), description: result.detail.promotion.summary };
}

/**
 * BHA-BOOKING-PROMOTIONS-001: one promotion that is public today. A draft, a disabled, a hidden or an out-of-window one is the same as none: 404. It
 * states the programme and its conditions and leads to the right Property and room types; it states no price (that needs dates, and is the booking
 * system's). A read that fails is not a 404: the page says it could not load.
 */
export default async function OfferPage({ params }: OfferPageProps) {
  const result = await getPromotion(params.slug);
  if (result.status === "missing") notFound();
  const t = await getT();
  return (
    <div className="nc-OfferPage relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <p className="mb-6">
          <Link href={OFFERS_PATH as Route} className="text-sm font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">{t("customer.offers.back")}</Link>
        </p>
        {result.status === "error" ? (
          <p role="alert" data-testid="offer-unavailable" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-neutral-800 dark:text-amber-200">
            {t("customer.offers.unavailable")}
          </p>
        ) : (
          <OfferDetail detail={result.detail} />
        )}
      </div>
    </div>
  );
}
