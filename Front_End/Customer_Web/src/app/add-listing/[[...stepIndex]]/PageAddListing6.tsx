"use client";

import React, { FC } from "react";
import Textarea from "@/shared/Textarea";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing6Props {}

const PageAddListing6: FC<PageAddListing6Props> = () => {
  const t = useT();
  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing6.yourPlaceDescriptionForClient")}</h2>
        <span className="block mt-2 text-neutral-500 dark:text-neutral-400">{t("customer.addListing.stepIndex.pageAddListing6.mentionTheBestFeaturesOf")}</span>
      </div>

      <Textarea placeholder="..." rows={14} />
    </>
  );
};

export default PageAddListing6;
