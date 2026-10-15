"use client";

import NcInputNumber from "@/components/NcInputNumber";
import React, { FC } from "react";
import Select from "@/shared/Select";
import FormItem from "../FormItem";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing3Props {}

const PageAddListing3: FC<PageAddListing3Props> = () => {
  const t = useT();
  return (
    <>
      <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing3.sizeOfYourLocation")}</h2>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      {/* FORM */}
      <div className="space-y-8">
        {/* ITEM */}
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing3.acreageM2")}>
          <Select>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="300">300</option>
            <option value="400">400</option>
            <option value="500">500</option>
          </Select>
        </FormItem>
        <NcInputNumber label={t("customer.common.guests")} defaultValue={4} />
        <NcInputNumber label={t("customer.addListing.stepIndex.pageAddListing3.bedroom")} defaultValue={4} />
        <NcInputNumber label={t("customer.common.beds2")} defaultValue={4} />
        <NcInputNumber label={t("customer.addListing.stepIndex.pageAddListing3.bathroom")} defaultValue={2} />
        <NcInputNumber label={t("customer.addListing.stepIndex.pageAddListing3.kitchen")} defaultValue={2} />
      </div>
    </>
  );
};

export default PageAddListing3;
