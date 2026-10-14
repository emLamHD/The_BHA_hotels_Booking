import React, { FC } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import HomeSlider from "./HomeSlider";
import OfferCard from "./OfferCard";
import { MOCK_OFFERS, OFFER_DISCLOSURE } from "@/data/homepageOffers";
import { OFFERS_PATH } from "@/lib/riversideHomeContent";

/**
 * CUST-WEB-001-CP08a-C2: the home page's sample offers (mock data, see `data/homepageOffers`). The disclosure is
 * above the cards, not in a footnote; "Xem thêm ưu đãi" leads to `/offers`, which shows the same data.
 */
const HomeOfferSection: FC = () => (
  <section aria-labelledby="offers-heading" className="nc-HomeOfferSection relative">
    <Heading id="offers-heading" desc={OFFER_DISCLOSURE}>
      Ưu đãi phòng
    </Heading>
    <HomeSlider label="Ưu đãi phòng minh hoạ">
      {MOCK_OFFERS.map((offer) => (
        <li key={offer.id} className="flex w-[80%] flex-shrink-0 snap-start sm:w-[46%] lg:w-[31.5%] xl:w-[23.5%]">
          <OfferCard offer={offer} />
        </li>
      ))}
    </HomeSlider>
    <div className="mt-6 flex justify-center">
      <ButtonSecondary href={OFFERS_PATH as Route} className="!leading-none">
        <div className="flex items-center justify-center">
          <span>Xem thêm ưu đãi</span>
          <ArrowRightIcon aria-hidden="true" className="ml-3 h-5 w-5" />
        </div>
      </ButtonSecondary>
    </div>
  </section>
);

export default HomeOfferSection;
