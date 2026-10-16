"use client";

import { MapPinIcon } from "@heroicons/react/24/solid";
import LocationMarker from "@/components/AnyReactComponent/LocationMarker";
import Label from "@/components/Label";
import GoogleMapReact from "google-map-react";
import React, { FC } from "react";
import ButtonSecondary from "@/shared/ButtonSecondary";
import Input from "@/shared/Input";
import Select from "@/shared/Select";
import FormItem from "../FormItem";

import { useT } from "@/lib/i18n/I18nProvider";
export interface PageAddListing2Props {}

const PageAddListing2: FC<PageAddListing2Props> = () => {
  const t = useT();
  return (
    <>
      <h2 className="text-2xl font-semibold">{t("customer.addListing.stepIndex.pageAddListing2.yourPlaceLocation")}</h2>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      {/* FORM */}
      <div className="space-y-8">
        <ButtonSecondary>
          <MapPinIcon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
          <span className="ml-3">{t("customer.addListing.stepIndex.pageAddListing2.useCurrentLocation")}</span>
        </ButtonSecondary>
        {/* ITEM */}
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing2.countryRegion")}>
          <Select>
            <option value="Viet Nam">{t("customer.addListing.stepIndex.pageAddListing2.vietNam")}</option>
            <option value="Thailand">{t("customer.addListing.stepIndex.pageAddListing2.thailand")}</option>
            <option value="France">{t("customer.addListing.stepIndex.pageAddListing2.france")}</option>
            <option value="Singapore">{t("customer.addListing.stepIndex.pageAddListing2.singapore")}</option>
            <option value="Jappan">{t("customer.common.jappan")}</option>
            <option value="Korea">{t("customer.addListing.stepIndex.pageAddListing2.korea")}</option>
            <option value="...">...</option>
          </Select>
        </FormItem>
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing2.street")}>
          <Input placeholder="..." />
        </FormItem>
        <FormItem label={t("customer.addListing.stepIndex.pageAddListing2.roomNumberOptional")}>
          <Input />
        </FormItem>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-5">
          <FormItem label={t("customer.addListing.stepIndex.pageAddListing2.city")}>
            <Input />
          </FormItem>
          <FormItem label={t("customer.addListing.stepIndex.pageAddListing2.state")}>
            <Input />
          </FormItem>
          <FormItem label={t("customer.addListing.stepIndex.pageAddListing2.postalCode")}>
            <Input />
          </FormItem>
        </div>
        <div>
          <Label>{t("customer.addListing.stepIndex.pageAddListing2.detailedAddress")}</Label>
          <span className="block mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("customer.addListing.stepIndex.pageAddListing2.1110PennsylvaniaAvenueNwWashington")}</span>
          <div className="mt-4">
            <div className="aspect-w-5 aspect-h-5 sm:aspect-h-3">
              <div className="rounded-xl overflow-hidden">
                <GoogleMapReact
                  bootstrapURLKeys={{
                    key: "AIzaSyAGVJfZMAKYfZ71nzL_v5i3LjTTWnCYwTY",
                  }}
                  yesIWantToUseGoogleMapApiInternals
                  defaultZoom={15}
                  defaultCenter={{
                    lat: 55.9607277,
                    lng: 36.2172614,
                  }}
                >
                  <LocationMarker lat={55.9607277} lng={36.2172614} />
                </GoogleMapReact>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PageAddListing2;
