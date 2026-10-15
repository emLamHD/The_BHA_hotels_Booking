"use client";

import React, { FC } from "react";
import { DEMO_CAR_LISTINGS } from "@/data/listings";
import { CarDataType } from "@/data/types";
import Pagination from "@/shared/Pagination";
import TabFilters from "./TabFilters";
import Heading2 from "@/shared/Heading2";
import CarCard from "@/components/CarCard";

import { useT } from "@/lib/i18n/I18nProvider";
export interface SectionGridFilterCardProps {
  className?: string;
  data?: CarDataType[];
}

const DEMO_DATA: CarDataType[] = DEMO_CAR_LISTINGS.filter((_, i) => i < 12);

const SectionGridFilterCard: FC<SectionGridFilterCardProps> = ({
  className = "",
  data = DEMO_DATA,
}) => {
  const t = useT();
  return (
    <div className={`nc-SectionGridFilterCard ${className}`}>
      <Heading2
        heading={t("customer.common.carsInTokyo")}
        subHeading={
          <span className="block text-neutral-500 dark:text-neutral-400 mt-3">{t("customer.common.233Cars")}<span className="mx-2">·</span>{t("customer.common.aug1218")}</span>
        }
      />

      <div className="mb-8 lg:mb-11">
        <TabFilters />
      </div>
      <div className="grid grid-cols-1 gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.map((car) => (
          <CarCard key={car.id} data={car} />
        ))}
      </div>
      <div className="flex mt-16 justify-center items-center">
        <Pagination />
      </div>
    </div>
  );
};

export default SectionGridFilterCard;
