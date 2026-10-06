"use client";

import converSelectedDateToString from "@/utils/converSelectedDateToString";
import React, { useState } from "react";
import { GuestsObject } from "../../type";
import GuestsInput from "../GuestsInput";
import LocationInput from "../LocationInput";
import DatesRangeInput from "../DatesRangeInput";
import { useStaySearch } from "@/components/StaySearchProvider";
import { FEATURED_TAB_LABELS } from "@/lib/featuredBrands";
import { dateToIso, isoToDate, todayLocal } from "@/lib/staySearch";

/**
 * `live` (CP02-C3) connects the form to the shared stay search: location is one of the three BHA
 * brands, dates and party are the draft. Without it (or without the provider) it is the template's
 * own demo form with local state.
 */
const StaySearchForm = ({ live = false }: { live?: boolean }) => {
  const ctx = useStaySearch();
  const shared = live ? ctx : null;
  //
  const [fieldNameShow, setFieldNameShow] = useState<
    "location" | "dates" | "guests"
  >("location");
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
            <span className="text-neutral-400">Where</span>
            <span>{locationInputTo || "Location"}</span>
          </button>
        ) : (
          <LocationInput
            defaultValue={locationInputTo}
            options={shared ? FEATURED_TAB_LABELS : undefined}
            headingText={shared ? "Which BHA?" : undefined}
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
            <span className="text-neutral-400">When</span>
            <span>
              {startDate
                ? converSelectedDateToString([startDate, endDate])
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
      guestSelected = `${total} guests, ${shared.draft.rooms} ${shared.draft.rooms === 1 ? "room" : "rooms"}`;
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
            <span className="text-neutral-400">Who</span>
            <span>{guestSelected || `Add guests`}</span>
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
