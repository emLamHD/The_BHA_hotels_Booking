import React, { FC } from "react";
import Image from "next/image";
import StaySearchForm from "../(client-components)/(HeroSearchForm)/(stay-search-form)/StaySearchForm";
import { HeroActions, HERO_SEARCH_ID } from "../(home)/RiversideHomeSections";
import { HERO_IMAGE, RIVERSIDE_NAME, mediaUrl } from "@/lib/riversideHomeContent";

export interface SectionHeroProps {
  className?: string;
}

/**
 * CUST-WEB-001-CP08a: the home page's first screen. One H1 with the property's name, one line about what
 * it is, one photograph of the property, two actions, and — on large screens — the real search form (the
 * same Search as the header's compact search on small screens). The template's "Hotel, car & experiences"
 * copy, its stock illustration and the Experiences/Cars/Flights tabs are not part of it.
 */
const SectionHero: FC<SectionHeroProps> = ({ className = "" }) => {
  return (
    <div className={`nc-SectionHero flex flex-col-reverse lg:flex-col relative ${className}`}>
      <div className="flex flex-col lg:flex-row lg:items-center">
        <div className="flex-shrink-0 lg:w-1/2 flex flex-col items-start space-y-8 sm:space-y-10 pb-14 lg:pb-64 xl:pr-14 lg:mr-10 xl:mr-0">
          <h1 className="font-medium text-4xl md:text-5xl xl:text-7xl !leading-[114%] ">{RIVERSIDE_NAME}</h1>
          <p className="text-base md:text-lg text-neutral-500 dark:text-neutral-400">
            Căn hộ lưu trú tại Đà Nẵng. Chọn ngày, xem giá từng đêm và đặt phòng trực tiếp ngay trên trang.
          </p>
          <HeroActions />
        </div>
        <div className="flex-grow">
          <Image
            className="w-full rounded-3xl object-cover"
            src={mediaUrl(HERO_IMAGE.file)}
            alt={HERO_IMAGE.alt}
            width={HERO_IMAGE.width}
            height={HERO_IMAGE.height}
            sizes="(min-width: 1024px) 50vw, 100vw"
            priority
          />
        </div>
      </div>

      <div id={HERO_SEARCH_ID} className="hidden lg:block z-10 mb-12 lg:mb-0 lg:-mt-40 w-full max-w-6xl scroll-mt-28">
        <StaySearchForm />
      </div>
    </div>
  );
};

export default SectionHero;
