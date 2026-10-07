"use client";

import React, { FC } from "react";
import LocationInput from "../LocationInput";
import GuestsInput from "../GuestsInput";
import StayDatesRangeInput from "./StayDatesRangeInput";
import { useStaySearch } from "@/components/StaySearchProvider";
import { LOCATION_OPTION_LABELS } from "@/lib/featuredBrands";
import { dateToIso, isoToDate, todayLocal } from "@/lib/staySearch";

const FORM_CLASS =
  "w-full relative mt-8 flex rounded-full shadow-xl dark:shadow-2xl bg-white dark:bg-neutral-800 ";

/** The template's own stay form: used where there is no booking system behind it. */
const TemplateStaySearchForm: FC = () => (
  <form className={FORM_CLASS}>
    <LocationInput className="flex-[1.5]" />
    <div className="self-center border-r border-slate-200 dark:border-slate-700 h-8"></div>
    <StayDatesRangeInput className="flex-1" />
    <div className="self-center border-r border-slate-200 dark:border-slate-700 h-8"></div>
    <GuestsInput className="flex-1" />
  </form>
);

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the template's stay form (location popover, two-month calendar popover,
 * guest popover, round search button) wired to the shared stay search: location is one of the three BHA
 * brands, dates and party are the draft, and Search validates it and asks the booking system for The BHA
 * Riverside's offers (the Featured cards below show them).
 */
const LiveStaySearchForm: FC = () => {
  const ctx = useStaySearch();
  if (!ctx) return <TemplateStaySearchForm />;
  const { draft, updateDraft, submit, search } = ctx;

  return (
    <div>
      <form
        className={FORM_CLASS}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <LocationInput
          className="flex-[1.5]"
          options={LOCATION_OPTION_LABELS}
          value={draft.brand}
          onSelect={(brand) => updateDraft({ brand })}
          placeHolder="Location"
          optionsHeading="The BHA"
        />
        <div className="self-center border-r border-slate-200 dark:border-slate-700 h-8"></div>
        <StayDatesRangeInput
          className="flex-1"
          startDate={isoToDate(draft.checkIn)}
          endDate={isoToDate(draft.checkOut)}
          minDate={todayLocal()}
          onDatesChange={([start, end]) =>
            updateDraft({ checkIn: start ? dateToIso(start) : "", checkOut: end ? dateToIso(end) : "" })
          }
        />
        <div className="self-center border-r border-slate-200 dark:border-slate-700 h-8"></div>
        <GuestsInput
          className="flex-1"
          live={{
            adults: draft.adults,
            children: draft.children,
            rooms: draft.rooms,
            onChange: (patch) => updateDraft(patch),
            onSubmit: submit,
          }}
        />
      </form>

      <div aria-live="polite" className="mt-3 min-h-[1.25rem] px-6 text-sm">
        {search.status === "loading" && <span className="text-neutral-500">Đang tìm phòng…</span>}
        {(search.status === "invalid" || search.status === "error") && (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {search.message}
          </span>
        )}
      </div>
    </div>
  );
};

export default LiveStaySearchForm;
