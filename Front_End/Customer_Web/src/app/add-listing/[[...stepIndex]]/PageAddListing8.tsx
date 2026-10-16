"use client";

import React, { FC } from "react";
import Input from "@/shared/Input";
import Select from "@/shared/Select";
import FormItem from "../FormItem";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing8Props {}

const PageAddListing8: FC<PageAddListing8Props> = () => {
  const t = useT();
  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing8.priceYourSpace")}</h2>
        <span className="block mt-2 text-neutral-500 dark:text-neutral-400">
          {" "}{t("customer.addListing.stepIndex.pageAddListing8.theHostSRevenueIs")}
        </span>
      </div>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      {/* FORM */}
      <div className="space-y-8">
        {/* ITEM */}
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing8.currency")}>
          <Select>
            <option value="USD">{t("customer.addListing.stepIndex.pageAddListing8.usd")}</option>
            <option value="VND">{t("customer.addListing.stepIndex.pageAddListing8.vnd")}</option>
            <option value="EURRO">{t("customer.addListing.stepIndex.pageAddListing8.eurro")}</option>
          </Select>
        </FormItem>
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing8.basePriceMondayThuday")}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500">$</span>
            </div>
            <Input className="!pl-8 !pr-10" placeholder="0.00" />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500">{t("customer.addListing.stepIndex.pageAddListing8.usd")}</span>
            </div>
          </div>
        </FormItem>
        {/* ----- */}
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing8.basePriceFridaySunday")}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500">$</span>
            </div>
            <Input className="!pl-8 !pr-10" placeholder="0.00" />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500">{t("customer.addListing.stepIndex.pageAddListing8.usd")}</span>
            </div>
          </div>
        </FormItem>
        {/* ----- */}
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing8.longTermPriceMonthlyDiscount")}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500">%</span>
            </div>
            <Input className="!pl-8 !pr-10" placeholder="0.00" />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500">{t("customer.addListing.stepIndex.pageAddListing8.everyMonth")}</span>
            </div>
          </div>
        </FormItem>
      </div>
    </>
  );
};

export default PageAddListing8;
