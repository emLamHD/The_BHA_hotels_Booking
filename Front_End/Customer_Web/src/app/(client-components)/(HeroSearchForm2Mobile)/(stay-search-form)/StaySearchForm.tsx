"use client";

import React, { useState } from "react";
import { GuestsObject } from "../../type";
import GuestsInput from "../GuestsInput";
import LocationInput from "../LocationInput";
import DatesRangeInput from "../DatesRangeInput";
import { useStaySearch } from "@/components/StaySearchProvider";
import { brandInfo } from "@/lib/stayListingQuery";
import { dateToIso, isoToDate, todayLocal } from "@/lib/staySearch";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** The only place offered to search: House and Villa are not bookable online, so the picker does not offer them. */
const RIVERSIDE_LABEL = brandInfo("riverside").label;

/** "10 Nov - 12 Nov": the picked days in the visitor's own format (month names from `Intl`). */
const dayMonth = (date: Date | null, locale: string) => (date ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date) : "");

/**
 * `live` (CP02-C3) connects the form to the shared stay search: location, dates and party are the draft.
 * Without it (or without the provider) it is the template's own demo form with local state.
 * CP08a: the modal only holds this form now, so the home and header searches use it with `live`.
 */
const StaySearchForm = ({ live = false }: { live?: boolean }) => {
  const { t, formatLocale } = useI18n();
  const ctx = useStaySearch();
  const shared = live ? ctx : null;
  //
  const [fieldNameShow, setFieldNameShow] = useState<
    "location" | "dates" | "guests"
  >(shared ? "dates" : "location");
  //
  const [ownLocation, setLocationInputTo] = useState("");
  const locationInputTo = shared ? shared.draft.brand : ownLocation;
  const [guestInput, setGuestInput] = useState<GuestsObject>({
    guestAdults: 0,
    guestChildren: 0,
    guestInfants: 0,
  });
  const [ownStart, setStartDate] = useState<Date | null>(null);
  const [ownEnd, setEndDate] = useState<Date | null>(null);
  const startDate = shared ? isoToDate(shared.draft.checkIn) : ownStart;
  const endDate = shared ? isoToDate(shared.draft.checkOut) : ownEnd;
  //

  const onChangeDate = (dates: [Date | null, Date | null]) => {
    if (shared) {
      const [start, end] = dates;
      shared.updateDraft({ checkIn: start ? dateToIso(start) : "", checkOut: end ? dateToIso(end) : "" });
      return;
    }
    const [start, end] = dates;
    setStartDate(start);
    setEndDate(end);
  };

  const renderInputLocation = () => {
    const isActive = fieldNameShow === "location";
    return (
      <div
        className={`w-full bg-white dark:bg-neutral-800 ${
          isActive
            ? "rounded-2xl shadow-lg"
            : "rounded-xl shadow-[0px_2px_2px_0px_rgba(0,0,0,0.25)]"
        }`}
      >
        {!isActive ? (
          <button
            className={`w-full flex justify-between text-sm font-medium p-4`}
            onClick={() => setFieldNameShow("location")}
          >
            <span className="text-neutral-400">{t("customer.search.property")}</span>
            <span>{locationInputTo || t("customer.search.pickProperty")}</span>
          </button>
        ) : (
          <LocationInput
            defaultValue={locationInputTo}
            options={shared ? [RIVERSIDE_LABEL] : undefined}
            headingText={shared ? t("customer.search.property") : undefined}
            onChange={(value) => {
              if (shared) shared.updateDraft({ brand: value });
              else setLocationInputTo(value);
              setFieldNameShow("dates");
            }}
          />
        )}
      </div>
    );
  };

  const renderInputDates = () => {
    const isActive = fieldNameShow === "dates";

    return (
      <div
        className={`w-full bg-white dark:bg-neutral-800 overflow-hidden ${
          isActive
            ? "rounded-2xl shadow-lg"
            : "rounded-xl shadow-[0px_2px_2px_0px_rgba(0,0,0,0.25)]"
        }`}
      >
        {!isActive ? (
          <button
            className={`w-full flex justify-between text-sm font-medium p-4  `}
            onClick={() => setFieldNameShow("dates")}
          >
            <span className="text-neutral-400">{t("customer.search.dateShort")}</span>
            <span>
              {startDate
                ? `${dayMonth(startDate, formatLocale)}${endDate ? ` - ${dayMonth(endDate, formatLocale)}` : ""}`
                : shared
                  ? t("customer.search.dates.add")
                  : t("customer.search.dates.add")}
            </span>
          </button>
        ) : (
          <DatesRangeInput
            startDate={startDate}
            endDate={endDate}
            onDatesChange={shared ? onChangeDate : undefined}
            minDate={shared ? todayLocal() : undefined}
          />
        )}
      </div>
    );
  };

  const renderInputGuests = () => {
    const isActive = fieldNameShow === "guests";
    let guestSelected = "";
    if (shared) {
      const total = shared.draft.adults + shared.draft.children;
      guestSelected = `${t("customer.booking.guests", { guests: total })}, ${t("customer.booking.rooms", { rooms: shared.draft.rooms })}`;
    } else if (guestInput.guestAdults || guestInput.guestChildren) {
      const guest =
        (guestInput.guestAdults || 0) + (guestInput.guestChildren || 0);
      guestSelected += t("customer.booking.guests", { guests: guest });
    }

    if (!shared && guestInput.guestInfants) {
      guestSelected += `, ${t("customer.booking.infants", { infants: guestInput.guestInfants })}`;
    }

    return (
      <div
        className={`w-full bg-white dark:bg-neutral-800 overflow-hidden ${
          isActive
            ? "rounded-2xl shadow-lg"
            : "rounded-xl shadow-[0px_2px_2px_0px_rgba(0,0,0,0.25)]"
        }`}
      >
        {!isActive ? (
          <button
            className={`w-full flex justify-between text-sm font-medium p-4`}
            onClick={() => setFieldNameShow("guests")}
          >
            <span className="text-neutral-400">{t("customer.search.who")}</span>
            <span>{guestSelected || t("customer.search.guests.add")}</span>
          </button>
        ) : (
          <GuestsInput
            defaultValue={guestInput}
            onChange={setGuestInput}
            live={
              shared
                ? {
                    adults: shared.draft.adults,
                    children: shared.draft.children,
                    rooms: shared.draft.rooms,
                    onChange: (patch) => shared.updateDraft(patch),
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="w-full space-y-5">
        {/*  */}
        {renderInputLocation()}
        {/*  */}
        {renderInputDates()}
        {/*  */}
        {renderInputGuests()}
      </div>
    </div>
  );
};

export default StaySearchForm;
