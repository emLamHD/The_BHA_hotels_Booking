"use client";

import React, { useState } from "react";
import { GuestsObject } from "../../type";
import GuestsInput from "../GuestsInput";
import LocationInput from "../LocationInput";
import DatesRangeInput from "../DatesRangeInput";
import { useStaySearch } from "@/components/StaySearchProvider";
import { brandInfo } from "@/lib/stayListingQuery";
import { dateToIso, isoToDate, todayLocal } from "@/lib/staySearch";

/** The only place offered to search: House and Villa are not bookable online, so the picker does not offer them. */
const RIVERSIDE_LABEL = brandInfo("riverside").label;

/** "10/11 - 12/11": the picked days as the guest reads them (no English month names). */
const dayMonth = (date: Date | null) =>
  date ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}` : "";

/**
 * `live` (CP02-C3) connects the form to the shared stay search: location, dates and party are the draft.
 * Without it (or without the provider) it is the template's own demo form with local state.
 * CP08a: the modal only holds this form now, so the home and header searches use it with `live`.
 */
const StaySearchForm = ({ live = false }: { live?: boolean }) => {
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
            <span className="text-neutral-400">{shared ? "Chỗ nghỉ" : "Where"}</span>
            <span>{locationInputTo || (shared ? "Chọn chỗ nghỉ" : "Location")}</span>
          </button>
        ) : (
          <LocationInput
            defaultValue={locationInputTo}
            options={shared ? [RIVERSIDE_LABEL] : undefined}
            headingText={shared ? "Chỗ nghỉ" : undefined}
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
            <span className="text-neutral-400">{shared ? "Ngày" : "When"}</span>
            <span>
              {startDate
                ? `${dayMonth(startDate)}${endDate ? ` - ${dayMonth(endDate)}` : ""}`
                : shared
                  ? "Thêm ngày"
                  : "Add date"}
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
      guestSelected = `${total} khách, ${shared.draft.rooms} phòng`;
    } else if (guestInput.guestAdults || guestInput.guestChildren) {
      const guest =
        (guestInput.guestAdults || 0) + (guestInput.guestChildren || 0);
      guestSelected += `${guest} guests`;
    }

    if (!shared && guestInput.guestInfants) {
      guestSelected += `, ${guestInput.guestInfants} infants`;
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
            <span className="text-neutral-400">{shared ? "Khách" : "Who"}</span>
            <span>{guestSelected || (shared ? "Thêm khách" : `Add guests`)}</span>
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
