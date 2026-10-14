"use client";

import React, { FC, useEffect, useRef, useState } from "react";
import LocationInput from "../(client-components)/(HeroSearchForm)/LocationInput";
import GuestsInput from "../(client-components)/(HeroSearchForm)/GuestsInput";
import StayDatesRangeInput from "../(client-components)/(HeroSearchForm)/(stay-search-form)/StayDatesRangeInput";
import { AvailabilityDraft, MAX_STAY_NIGHTS, calculateNights, validateAvailabilityDraft } from "@/lib/api/availabilityValidation";
import { dateToIso, isoToDate, todayLocal } from "@/lib/staySearch";
import {
  DEFAULT_STAY_BRAND,
  STAY_BRANDS,
  StayBrand,
  StayListingQuery,
  brandFromLabel,
  brandInfo,
} from "@/lib/stayListingQuery";

interface FormDraft {
  brand: StayBrand;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
}

/** The form starts from what the URL applied; an invalid URL starts from the defaults, never repaired. */
function draftFromQuery(query: StayListingQuery): FormDraft {
  const base: FormDraft = {
    brand: query.brand ?? DEFAULT_STAY_BRAND,
    checkIn: "",
    checkOut: "",
    adults: 2,
    children: 0,
    rooms: 1,
  };
  if (query.kind !== "search") return base;
  const { search } = query;
  return {
    ...base,
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    adults: Number(search.adults),
    children: Number(search.children),
    rooms: Number(search.rooms),
  };
}

function problemWith(draft: FormDraft): string | null {
  if (!draft.checkIn || !draft.checkOut) return "Chọn ngày nhận phòng và trả phòng.";
  const nights = calculateNights(draft.checkIn, draft.checkOut);
  if (nights !== null && nights > MAX_STAY_NIGHTS) return `Thời gian lưu trú tối đa ${MAX_STAY_NIGHTS} đêm.`;
  const candidate: AvailabilityDraft = {
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: String(draft.adults),
    children: String(draft.children),
    rooms: String(draft.rooms),
  };
  return validateAvailabilityDraft(candidate).ok ? null : "Kiểm tra lại ngày và số khách.";
}

export interface ListingStaySearchFormProps {
  /** What the URL currently applies. The parent remounts the form (by key) when it changes. */
  applied: StayListingQuery;
  /** A valid, complete search for a brand; the parent decides between pushing the URL and re-reading. */
  onApply: (brand: StayBrand, search: AvailabilityDraft) => void;
  onClear: () => void;
}

const FIELD_DIVIDER = "border-b border-slate-200 dark:border-slate-700 md:border-b-0 md:self-center md:border-r md:h-8";

/**
 * CUST-WEB-001-CP05a: the filter form of /listing-stay. The template's own controls (location choice,
 * two-month calendar, guests and rooms) held in a draft of their own: nothing changes the URL or the
 * results until Search. One submit path serves the round button and the Enter key; an incomplete draft
 * says what is missing and starts no request.
 */
const ListingStaySearchForm: FC<ListingStaySearchFormProps> = ({ applied, onApply, onClear }) => {
  const [draft, setDraft] = useState<FormDraft>(() => draftFromQuery(applied));
  const [problem, setProblem] = useState<{ id: number; message: string } | null>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const update = (patch: Partial<FormDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const message = problemWith(draft);
    if (message) {
      setProblem((previous) => ({ id: (previous?.id ?? 0) + 1, message }));
      return;
    }
    setProblem(null);
    onApply(draft.brand, {
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      adults: String(draft.adults),
      children: String(draft.children),
      rooms: String(draft.rooms),
    });
  };

  const hasFilters = applied.kind !== "browse" || applied.brand !== DEFAULT_STAY_BRAND;

  return (
    <div>
      <form
        aria-label="Tìm phòng"
        className="w-full relative flex flex-col md:flex-row rounded-3xl md:rounded-full shadow-xl dark:shadow-2xl bg-white dark:bg-neutral-800 [&_button[aria-label=Search]]:px-6 md:[&_button[aria-label=Search]]:px-0"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          // The template's location popover closes only on an outside click (the shared control is not
          // changed here); the calendar and guest popovers already close on Esc. A click on the body is
          // the outside click that lets Esc close the location list too.
          if (event.key === "Escape") document.body.click();
        }}
      >
        <LocationInput
          className="flex-[1.5]"
          options={STAY_BRANDS.map((item) => item.label)}
          value={brandInfo(draft.brand).label}
          onSelect={(label) => {
            const brand = brandFromLabel(label);
            if (brand) update({ brand });
          }}
          placeHolder="Location"
          optionsHeading="The BHA"
        />
        <div className={FIELD_DIVIDER}></div>
        <StayDatesRangeInput
          className="flex-1"
          startDate={isoToDate(draft.checkIn)}
          endDate={isoToDate(draft.checkOut)}
          minDate={todayLocal()}
          onDatesChange={([start, end]) =>
            update({ checkIn: start ? dateToIso(start) : "", checkOut: end ? dateToIso(end) : "" })
          }
        />
        <div className={FIELD_DIVIDER}></div>
        <GuestsInput
          className="flex-1"
          live={{
            adults: draft.adults,
            children: draft.children,
            rooms: draft.rooms,
            onChange: (patch) => update(patch),
            onSubmit: submit,
          }}
        />
      </form>

      <div className="mt-3 flex min-h-[1.5rem] flex-wrap items-center gap-x-4 px-6 text-sm">
        {problem && (
          <p
            key={problem.id}
            ref={problemRef}
            role="alert"
            tabIndex={-1}
            className="text-red-600 focus:outline-none dark:text-red-400"
          >
            {problem.message}
          </p>
        )}
        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            className="text-neutral-600 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
          >
            Xoá bộ lọc
          </button>
        )}
      </div>
    </div>
  );
};

export default ListingStaySearchForm;
