"use client";

import React, { FC } from "react";
import rightImgDemo from "@/images/BecomeAnAuthorImg.png";
import ButtonPrimary from "@/shared/ButtonPrimary";
import Logo from "@/shared/Logo";
import Image from "next/image";

import { useT } from "@/lib/i18n/I18nProvider";
export interface SectionBecomeAnAuthorProps {
  className?: string;
  rightImg?: string;
}

const SectionBecomeAnAuthor: FC<SectionBecomeAnAuthorProps> = ({
  className = "",
  rightImg = rightImgDemo,
}) => {
  const t = useT();
  return (
    <div
      className={`nc-SectionBecomeAnAuthor relative flex flex-col lg:flex-row items-center  ${className}`}
      data-nc-id="SectionBecomeAnAuthor"
    >
      <div className="flex-shrink-0 mb-16 lg:mb-0 lg:mr-10 lg:w-2/5">
        <Logo className="w-20" />
        <h2 className="font-semibold text-3xl sm:text-4xl mt-6 sm:mt-11">{t("customer.sectionBecomeAnAuthor.whyDidYouChooseUs")}</h2>
        <span className="block mt-6 text-neutral-500 dark:text-neutral-400">{t("customer.sectionBecomeAnAuthor.accompanyingUsYouHaveA")}</span>
        <ButtonPrimary className="mt-6 sm:mt-11">{t("customer.sectionBecomeAnAuthor.becomeAnAuthor")}</ButtonPrimary>
      </div>
      <div className="flex-grow">
        <Image alt="" src={rightImg} />
      </div>
    </div>
  );
};

export default SectionBecomeAnAuthor;
