"use client";

import React, { FC } from "react";
import Input from "@/shared/Input";
import Select from "@/shared/Select";
import FormItem from "../FormItem";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing1Props {}

const PageAddListing1: FC<PageAddListing1Props> = () => {
  const t = useT();
  return (
    <>
      <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing1.choosingListingCategories")}</h2>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      {/* FORM */}
      <div className="space-y-8">
        {/* ITEM */}
        <FormItem
          label={t("customer.addListing.stepIndex.pageAddListing1.chooseAPropertyType")}
          desc={t("customer.addListing.stepIndex.pageAddListing1.hotelProfessionalHospitalityBusinessesThat")}
        >
          <Select>
            <option value="Hotel">{t("customer.addListing.stepIndex.pageAddListing1.hotel")}</option>
            <option value="Cottage">{t("customer.addListing.stepIndex.pageAddListing1.cottage")}</option>
            <option value="Villa">{t("customer.addListing.stepIndex.pageAddListing1.villa")}</option>
            <option value="Cabin">{t("customer.addListing.stepIndex.pageAddListing1.cabin")}</option>
            <option value="Farm stay">{t("customer.addListing.stepIndex.pageAddListing1.farmStay")}</option>
            <option value="Houseboat">{t("customer.addListing.stepIndex.pageAddListing1.houseboat")}</option>
            <option value="Lighthouse">{t("customer.addListing.stepIndex.pageAddListing1.lighthouse")}</option>
          </Select>
        </FormItem>
        <FormItem
          label={t("customer.addListing.stepIndex.pageAddListing1.placeName")}
          desc={t("customer.addListing.stepIndex.pageAddListing1.aCatchyNameUsuallyIncludes")}
        >
          <Input placeholder={t("customer.addListing.stepIndex.pageAddListing1.placesName")} />
        </FormItem>
        <FormItem
          label={t("customer.addListing.stepIndex.pageAddListing1.rentalForm")}
          desc={t("customer.addListing.stepIndex.pageAddListing1.entirePlaceGuestsHaveThe")}
        >
          <Select>
            <option value="Hotel">{t("customer.addListing.stepIndex.pageAddListing1.entirePlace")}</option>
            <option value="Private room">{t("customer.addListing.stepIndex.pageAddListing1.privateRoom")}</option>
            <option value="Share room">{t("customer.addListing.stepIndex.pageAddListing1.shareRoom")}</option>
          </Select>
        </FormItem>
      </div>
    </>
  );
};

export default PageAddListing1;
