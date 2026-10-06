import React, { FC } from "react";
import HeroSearchForm from "../(client-components)/(HeroSearchForm)/HeroSearchForm";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";

export interface SectionHeroProps {
  className?: string;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template hero (headline, intro, CTA, picture, overlapping search
 * form). The picture is a published The BHA Riverside photograph (the template illustration has no
 * rights evidence) and the CTA leads to the real room section.
 */
const SectionHero: FC<SectionHeroProps> = ({ className = "" }) => {
  return (
    <div
      className={`nc-SectionHero flex flex-col-reverse lg:flex-col relative ${className}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center">
        <div className="flex-shrink-0 lg:w-1/2 flex flex-col items-start space-y-8 sm:space-y-10 pb-14 lg:pb-64 xl:pr-14 lg:mr-10 xl:mr-0">
          <h2 className="font-medium text-4xl md:text-5xl xl:text-7xl !leading-[114%] ">
            Đặt phòng trực tiếp tại The BHA
          </h2>
          <span className="text-base md:text-lg text-neutral-500 dark:text-neutral-400">
            Chọn loại phòng, xem giá theo từng đêm và giữ phòng ngay trên website, không qua trung gian.
          </span>
          <ShowcaseNavLink
            section="rooms"
            className="inline-flex items-center justify-center rounded-full bg-primary-6000 px-5 py-4 sm:px-7 text-sm sm:text-base font-medium text-neutral-50 hover:bg-primary-700"
          >
            Xem phòng
          </ShowcaseNavLink>
        </div>
        <div className="flex-grow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="w-full aspect-[4/3] rounded-3xl object-cover"
            src="/media/the-bha-riverside/rooftop-pool-day.webp"
            alt="Hồ bơi trên sân thượng The BHA Riverside vào ban ngày"
          />
        </div>
      </div>

      <div className="hidden lg:block z-10 mb-12 lg:mb-0 lg:-mt-40 w-full">
        <HeroSearchForm />
      </div>
    </div>
  );
};

export default SectionHero;
