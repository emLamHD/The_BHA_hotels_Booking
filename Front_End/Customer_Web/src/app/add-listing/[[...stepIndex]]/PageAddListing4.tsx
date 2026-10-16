"use client";

import React, { FC } from "react";
import Checkbox from "@/shared/Checkbox";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing4Props {}

const PageAddListing4: FC<PageAddListing4Props> = () => {
  const t = useT();
  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing4.amenities")}</h2>
        <span className="block mt-2 text-neutral-500 dark:text-neutral-400">{t("customer.addListing.stepIndex.pageAddListing4.manyCustomersHaveSearchedFor")}</span>
      </div>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      {/* FORM */}
      <div className="space-y-8">
        {/* ITEM */}
        <div>
          <label className="text-lg font-semibold" htmlFor="">{t("customer.common.generalAmenities")}</label>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.wifi")} name="Wifi" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.internet")} name="Internet" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.tv")} name="TV" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.airConditioning")} name="Air conditioning" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.fan")} name="Fan" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.privateEntrance")} name="Private entrance" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.dryer")} name="Dryer" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.heater")} name="Heater" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.washingMachine")} name="Washing machine" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.detergent")} name="Detergent" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.clothesDryer")} name="Clothes dryer" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.babyCot")} name="Baby cot" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.desk")} name="Desk " defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.fridge")} name="Fridge" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.dryer")} name="Dryer" defaultChecked />
          </div>
        </div>

        {/* ITEM */}
        <div>
          <label className="text-lg font-semibold" htmlFor="">{t("customer.addListing.stepIndex.pageAddListing4.otherAmenities")}</label>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.wardrobe")} name="Wardrobe" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.clothHook")} name="Cloth hook" />
            <Checkbox
              label={t("customer.addListing.stepIndex.pageAddListing4.extraCushion")}
              name="Extra cushion"
              defaultChecked
            />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.gasStove")} name="Gas stove" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.toiletPaper")} name="Toilet paper" />
            <Checkbox
              label={t("customer.addListing.stepIndex.pageAddListing4.freeToiletries")}
              name="Free toiletries"
              defaultChecked
            />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.makeupTable")} name="Makeup table" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.hotPot")} name="Hot pot" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.bathroomHeaters")} name="Bathroom heaters" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.kettle")} name="Kettle" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.dishwasher")} name="Dishwasher" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.bbqGrill")} name="BBQ grill" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.toaster")} name="Toaster" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.towel")} name="Towel" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.diningTable")} name="Dining table" />
          </div>
        </div>

        {/* ITEM */}
        <div>
          <label className="text-lg font-semibold" htmlFor="">{t("customer.addListing.stepIndex.pageAddListing4.safeAmenities")}</label>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.fireSiren")} name="Fire siren" defaultChecked />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.fireExtinguisher")} name="Fire extinguisher" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.antiTheftKey")} name="Anti-theft key" />
            <Checkbox label={t("customer.addListing.stepIndex.pageAddListing4.safeVault")} name="Safe vault" />
          </div>
        </div>
      </div>
    </>
  );
};

export default PageAddListing4;
