"use client";

import React, { FC } from "react";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import type { Route } from "next";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import HomeSlider from "./HomeSlider";
import OfferCard from "./OfferCard";
import type { PromotionCard } from "@/lib/promotions/promotions";
import { OFFERS_PATH } from "@/lib/riversideHomeContent";
import { useT } from "@/lib/i18n/I18nProvider";

/**
 * BHA-BOOKING-PROMOTIONS-001: the home page's offers, read from the Admin's promotions that are public today (see `lib/promotions/server`). With none
 * the whole block is absent — there is no sample to stand in — and "Xem thêm ưu đãi" leads to `/offers`, which lists the same data.
 */
const HomeOfferSection: FC<{ items: PromotionCard[] }> = ({ items }) => {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="offers-heading" className="nc-HomeOfferSection relative">
      <Heading id="offers-heading">{t("customer.common.roomOffers")}</Heading>
      <HomeSlider label={t("customer.common.roomOffers")}>
        {items.map((promotion) => (
          <li key={promotion.id} className="flex w-[80%] flex-shrink-0 snap-start sm:w-[46%] lg:w-[31.5%] xl:w-[23.5%]">
            <OfferCard promotion={promotion} />
          </li>
        ))}
      </HomeSlider>
      <div className="mt-6 flex justify-center">
        <ButtonSecondary href={OFFERS_PATH as Route} className="!leading-none">
          <div className="flex items-center justify-center">
            <span>{t("customer.home.homeOfferSection.seeMoreOffers")}</span>
            <ArrowRightIcon aria-hidden="true" className="ml-3 h-5 w-5" />
          </div>
        </ButtonSecondary>
      </div>
    </section>
  );
};

export default HomeOfferSection;
