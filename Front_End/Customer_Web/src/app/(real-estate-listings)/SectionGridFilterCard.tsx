"use client";

import React, { FC } from "react";
import { DEMO_STAY_LISTINGS } from "@/data/listings";
import { StayDataType } from "@/data/types";
import Pagination from "@/shared/Pagination";
import TabFilters from "./TabFilters";
import Heading2 from "@/shared/Heading2";
import PropertyCardH from "@/components/PropertyCardH";

import { useT } from "@/lib/i18n/I18nProvider";
export interface SectionGridFilterCardProps {
  className?: string;
  data?: StayDataType[];
}

const DEMO_DATA: StayDataType[] = DEMO_STAY_LISTINGS.filter((_, i) => i < 8);

const SectionGridFilterCard: FC<SectionGridFilterCardProps> = ({
  className = "",
  data = DEMO_DATA,
}) => {
  const t = useT();
  return (
    <div className={`nc-SectionGridFilterCard ${className}`}>
      <Heading2
        heading={t("customer.realEstateListings.sectionGridFilterCard.propertyInTokyo")}
        subHeading={
          <span className="block text-neutral-500 dark:text-neutral-400 mt-3">{t("customer.realEstateListings.sectionGridFilterCard.233Property")}<span className="mx-2">·</span>{t("customer.common.aug1218")}</span>
        }
      />

      <div className="mb-8 lg:mb-11">
        <TabFilters />
      </div>
      <div className="grid grid-cols-1 gap-6 md:gap-8 xl:grid-cols-2 ">
        {data.map((stay) => (
          <PropertyCardH key={stay.id} data={stay} />
        ))}
      </div>
      <div className="flex mt-16 justify-center items-center">
        <Pagination />
      </div>
    </div>
  );
};

export default SectionGridFilterCard;
