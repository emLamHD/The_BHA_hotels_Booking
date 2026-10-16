"use client";
import React, { useEffect, useState } from "react";
import NcInputNumber from "@/components/NcInputNumber";
import { FC } from "react";
import { GuestsObject } from "../type";

import { useT } from "@/lib/i18n/I18nProvider";
/** CP02-C3: the live party (adults, children, rooms) owned by the shared stay search draft. */
export interface LiveMobileGuests {
  adults: number;
  children: number;
  rooms: number;
  onChange: (patch: { adults?: number; children?: number; rooms?: number }) => void;
}

export interface GuestsInputProps {
  defaultValue?: GuestsObject;
  onChange?: (data: GuestsObject) => void;
  className?: string;
  live?: LiveMobileGuests;
}

const GuestsInput: FC<GuestsInputProps> = ({
  defaultValue,
  onChange,
  className = "",
  live,
}) => {
  const t = useT();
  const [guestAdultsInputValue, setGuestAdultsInputValue] = useState(
    defaultValue?.guestAdults || 0
  );
  const [guestChildrenInputValue, setGuestChildrenInputValue] = useState(
    defaultValue?.guestChildren || 0
  );
  const [guestInfantsInputValue, setGuestInfantsInputValue] = useState(
    defaultValue?.guestInfants || 0
  );

  useEffect(() => {
    setGuestAdultsInputValue(defaultValue?.guestAdults || 0);
  }, [defaultValue?.guestAdults]);
  useEffect(() => {
    setGuestChildrenInputValue(defaultValue?.guestChildren || 0);
  }, [defaultValue?.guestChildren]);
  useEffect(() => {
    setGuestInfantsInputValue(defaultValue?.guestInfants || 0);
  }, [defaultValue?.guestInfants]);

  const handleChangeData = (value: number, type: keyof GuestsObject) => {
    let newValue = {
      guestAdults: guestAdultsInputValue,
      guestChildren: guestChildrenInputValue,
      guestInfants: guestInfantsInputValue,
    };
    if (type === "guestAdults") {
      setGuestAdultsInputValue(value);
      newValue.guestAdults = value;
    }
    if (type === "guestChildren") {
      setGuestChildrenInputValue(value);
      newValue.guestChildren = value;
    }
    if (type === "guestInfants") {
      setGuestInfantsInputValue(value);
      newValue.guestInfants = value;
    }
    onChange && onChange(newValue);
  };

  if (live) {
    return (
      <div className={`flex flex-col relative p-5 ${className}`}>
        <span className="mb-5 block font-semibold text-xl sm:text-2xl">{t("customer.heroSearchForm2Mobile.guestsInput.whoSComing")}</span>
        <NcInputNumber
          className="w-full"
          value={live.adults}
          onChange={(value) => live.onChange({ adults: value })}
          max={10}
          min={1}
          label={t("customer.common.adults")}
          desc={t("customer.common.ages13OrAbove")}
        />
        <NcInputNumber
          className="w-full mt-6"
          value={live.children}
          onChange={(value) => live.onChange({ children: value })}
          max={4}
          label={t("customer.common.children")}
          desc={t("customer.common.ages212")}
        />
        <NcInputNumber
          className="w-full mt-6"
          value={live.rooms}
          onChange={(value) => live.onChange({ rooms: value })}
          max={10}
          min={1}
          label={t("customer.heroSearchForm2Mobile.guestsInput.rooms")}
          desc={t("customer.heroSearchForm2Mobile.guestsInput.numberOfApartments")}
        />
        <p className="mt-5 text-xs text-neutral-500 dark:text-neutral-400">{t("customer.common.childrenUnder2HaveNo")}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col relative p-5 ${className}`}>
      <span className="mb-5 block font-semibold text-xl sm:text-2xl">
        {t("customer.heroSearchForm2Mobile.guestsInput.whoSComing")}
      </span>
      <NcInputNumber
        className="w-full"
        defaultValue={guestAdultsInputValue}
        onChange={(value) => handleChangeData(value, "guestAdults")}
        max={20}
        label={t("customer.common.adults")}
        desc={t("customer.common.ages13OrAbove")}
      />
      <NcInputNumber
        className="w-full mt-6"
        defaultValue={guestChildrenInputValue}
        onChange={(value) => handleChangeData(value, "guestChildren")}
        max={20}
        label={t("customer.common.children")}
        desc={t("customer.common.ages212")}
      />

      <NcInputNumber
        className="w-full mt-6"
        defaultValue={guestInfantsInputValue}
        onChange={(value) => handleChangeData(value, "guestInfants")}
        max={20}
        label={t("customer.common.infants")}
        desc={t("customer.common.ages02")}
      />
    </div>
  );
};

export default GuestsInput;
