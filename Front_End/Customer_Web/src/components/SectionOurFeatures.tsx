"use client";

import React, { FC } from "react";
import rightImgPng from "@/images/our-features.png";
import Image, { StaticImageData } from "next/image";
import Badge from "@/shared/Badge";

import { useT } from "@/lib/i18n/I18nProvider";
export interface SectionOurFeaturesProps {
  className?: string;
  rightImg?: StaticImageData;
  type?: "type1" | "type2";
}

const SectionOurFeatures: FC<SectionOurFeaturesProps> = ({
  className = "lg:py-14",
  rightImg = rightImgPng,
  type = "type1",
}) => {
  const t = useT();
  return (
    <div
      className={`nc-SectionOurFeatures relative flex flex-col items-center ${
        type === "type1" ? "lg:flex-row" : "lg:flex-row-reverse"
      } ${className}`}
      data-nc-id="SectionOurFeatures"
    >
      <div className="flex-grow">
        <Image src={rightImg} alt="" />
      </div>
      <div
        className={`max-w-2xl flex-shrink-0 mt-10 lg:mt-0 lg:w-2/5 ${
          type === "type1" ? "lg:pl-16" : "lg:pr-16"
        }`}
      >
        <span className="uppercase text-sm text-gray-400 tracking-widest">{t("customer.sectionOurFeatures.bennefits")}</span>
        <h2 className="font-semibold text-4xl mt-5">{t("customer.sectionOurFeatures.happeningCities")}</h2>

        <ul className="space-y-10 mt-16">
          <li className="space-y-4">
            <Badge name="Advertising" />
            <span className="block text-xl font-semibold">{t("customer.sectionOurFeatures.costEffectiveAdvertising")}</span>
            <span className="block mt-5 text-neutral-500 dark:text-neutral-400">{t("customer.sectionOurFeatures.withAFreeListingYou")}</span>
          </li>
          <li className="space-y-4">
            <Badge color="green" name="Exposure" />
            <span className="block text-xl font-semibold">{t("customer.sectionOurFeatures.reachMillionsWithChisfis")}</span>
            <span className="block mt-5 text-neutral-500 dark:text-neutral-400">{t("customer.sectionOurFeatures.millionsOfPeopleAreSearching")}</span>
          </li>
          <li className="space-y-4">
            <Badge color="red" name="Secure" />
            <span className="block text-xl font-semibold">{t("customer.sectionOurFeatures.secureAndSimple")}</span>
            <span className="block mt-5 text-neutral-500 dark:text-neutral-400">{t("customer.sectionOurFeatures.aHolidayLettingsListingGives")}</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default SectionOurFeatures;
