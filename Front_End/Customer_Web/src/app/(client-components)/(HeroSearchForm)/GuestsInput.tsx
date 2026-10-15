"use client";

import React, { Fragment, useEffect, useState } from "react";
import { Popover, Transition } from "@headlessui/react";
import NcInputNumber from "@/components/NcInputNumber";
import { FC } from "react";
import ClearDataButton from "./ClearDataButton";
import ButtonSubmit from "./ButtonSubmit";
import { PathName } from "@/routers/types";
import { UserPlusIcon } from "@heroicons/react/24/outline";
import { GuestsObject } from "../type";

import { useT } from "@/lib/i18n/I18nProvider";
/**
 * CP02-C3: the live stay search's party, owned by the shared draft. The booking API knows adults,
 * children and rooms; it has no separate infant count, so the live popover offers exactly those.
 */
export interface LiveGuestsControl {
  adults: number;
  children: number;
  rooms: number;
  onChange: (patch: { adults?: number; children?: number; rooms?: number }) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** CP08a: accessible name of the round Search button; the default keeps the template's "Search". */
  submitLabel?: string;
}

export interface GuestsInputProps {
  fieldClassName?: string;
  className?: string;
  buttonSubmitHref?: PathName;
  hasButtonSubmit?: boolean;
  live?: LiveGuestsControl;
}

const GuestsInput: FC<GuestsInputProps> = ({
  fieldClassName = "[ nc-hero-field-padding ]",
  className = "[ nc-flex-1 ]",
  buttonSubmitHref = "/listing-stay-map",
  hasButtonSubmit = true,
  live,
}) => {
  const t = useT();
  const [guestAdultsInputValue, setGuestAdultsInputValue] = useState(2);
  const [guestChildrenInputValue, setGuestChildrenInputValue] = useState(1);
  const [guestInfantsInputValue, setGuestInfantsInputValue] = useState(1);

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
  };

  const totalGuests = live
    ? live.adults + live.children
    : guestChildrenInputValue + guestAdultsInputValue + guestInfantsInputValue;

  return (
    <Popover className={`flex relative ${className}`}>
      {({ open }) => (
        <>
          <div
            className={`flex-1 z-10 flex items-center focus:outline-none ${
              open ? "nc-hero-field-focused" : ""
            }`}
          >
            <Popover.Button
              disabled={live?.disabled}
              className={`relative z-10 flex-1 flex text-left items-center ${fieldClassName} space-x-3 focus:outline-none`}
            >
              <div className="text-neutral-300 dark:text-neutral-400">
                <UserPlusIcon className="w-5 h-5 lg:w-7 lg:h-7" />
              </div>
              <div className="flex-grow">
                <span className="block xl:text-lg font-semibold">
                  {live ? `${totalGuests} khách` : `${totalGuests || ""} Guests`}
                </span>
                <span className="block mt-1 text-sm text-neutral-400 leading-none font-light">
                  {live
                    ? `${live.rooms} phòng`
                    : totalGuests
                      ? "Guests"
                      : "Add guests"}
                </span>
              </div>

              {!live && !!totalGuests && open && (
                <ClearDataButton
                  onClick={() => {
                    setGuestAdultsInputValue(0);
                    setGuestChildrenInputValue(0);
                    setGuestInfantsInputValue(0);
                  }}
                />
              )}
            </Popover.Button>

            {/* BUTTON SUBMIT OF FORM */}
            {hasButtonSubmit && (
              <div className="pr-2 xl:pr-4">
                {live ? (
                  <ButtonSubmit onClick={live.onSubmit} disabled={live.disabled} label={live.submitLabel} />
                ) : (
                  <ButtonSubmit href={buttonSubmitHref} />
                )}
              </div>
            )}
          </div>

          {open && (
            <div className="h-8 absolute self-center top-1/2 -translate-y-1/2 z-0 -left-0.5 right-0.5 bg-white dark:bg-neutral-800"></div>
          )}
          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute right-0 z-10 w-full sm:min-w-[340px] max-w-sm bg-white dark:bg-neutral-800 top-full mt-3 py-5 sm:py-6 px-4 sm:px-8 rounded-3xl shadow-xl">
              {live ? (
                <>
                  <NcInputNumber
                    className="w-full"
                    value={live.adults}
                    onChange={(value) => live.onChange({ adults: value })}
                    max={10}
                    min={1}
                    label={t("customer.heroSearchForm.guestsInput.adults")}
                    desc={t("customer.heroSearchForm.guestsInput.ages13OrAbove")}
                  />
                  <NcInputNumber
                    className="w-full mt-6"
                    value={live.children}
                    onChange={(value) => live.onChange({ children: value })}
                    max={4}
                    label={t("customer.heroSearchForm.guestsInput.children")}
                    desc={t("customer.heroSearchForm.guestsInput.ages212")}
                  />
                  <NcInputNumber
                    className="w-full mt-6"
                    value={live.rooms}
                    onChange={(value) => live.onChange({ rooms: value })}
                    max={10}
                    min={1}
                    label={t("customer.heroSearchForm.guestsInput.rooms")}
                    desc={t("customer.heroSearchForm.guestsInput.numberOfApartments")}
                  />
                  <p className="mt-5 text-xs text-neutral-500 dark:text-neutral-400">{t("customer.common.childrenUnder2HaveNo")}</p>
                </>
              ) : (
                <>
              <NcInputNumber
                className="w-full"
                defaultValue={guestAdultsInputValue}
                onChange={(value) => handleChangeData(value, "guestAdults")}
                max={10}
                min={1}
                label={t("customer.common.adults")}
                desc={t("customer.common.ages13OrAbove")}
              />
              <NcInputNumber
                className="w-full mt-6"
                defaultValue={guestChildrenInputValue}
                onChange={(value) => handleChangeData(value, "guestChildren")}
                max={4}
                label={t("customer.common.children")}
                desc={t("customer.common.ages212")}
              />

              <NcInputNumber
                className="w-full mt-6"
                defaultValue={guestInfantsInputValue}
                onChange={(value) => handleChangeData(value, "guestInfants")}
                max={4}
                label={t("customer.common.infants")}
                desc={t("customer.common.ages02")}
              />
                </>
              )}
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default GuestsInput;
