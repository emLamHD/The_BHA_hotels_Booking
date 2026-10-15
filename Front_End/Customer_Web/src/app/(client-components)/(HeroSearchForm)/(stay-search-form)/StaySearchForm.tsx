"use client";

import React, { FC, useEffect, useRef } from "react";
import LocationInput from "../LocationInput";
import GuestsInput from "../GuestsInput";
import StayDatesRangeInput from "./StayDatesRangeInput";
import { useStaySearch } from "@/components/StaySearchProvider";
import { brandInfo } from "@/lib/stayListingQuery";
import { dateToIso, isoToDate, todayLocal } from "@/lib/staySearch";

import { useT } from "@/lib/i18n/I18nProvider";
const FORM_CLASS =
  "w-full relative mt-8 flex rounded-full shadow-xl dark:shadow-2xl bg-white dark:bg-neutral-800 ";

/** The only place offered to search: House and Villa are not bookable online, so the picker does not offer them. */
const RIVERSIDE_LABEL = brandInfo("riverside").label;

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
 * The template's stay form (location popover, two-month calendar popover, guest popover, round search
 * button) on the shared draft. CUST-WEB-001-CP08a: Search validates the draft and goes to the canonical
 * /listing-stay URL (one navigation); an incomplete draft stays here, says what is missing in a live
 * alert that takes focus, and asks the server for nothing. Click on the round button and Enter in a
 * field are the same action through the same function.
 */
const LiveStaySearchForm: FC = () => {
  const t = useT();
  const ctx = useStaySearch();
  const problemRef = useRef<HTMLParagraphElement>(null);
  const problemId = ctx?.problem?.id;
  // Only a problem that appears while this form is on screen takes focus: one that was already there when
  // the form mounted is an old message and is left alone.
  const seenProblem = useRef(problemId);

  useEffect(() => {
    if (problemId && problemId !== seenProblem.current) problemRef.current?.focus();
    seenProblem.current = problemId;
  }, [problemId]);

  if (!ctx) return <TemplateStaySearchForm />;
  const { draft, updateDraft, submit, problem } = ctx;

  return (
    <div>
      <form
        aria-label={t("customer.common.findARoom")}
        className={FORM_CLASS}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          // A text field has no submit button to answer Enter; the round button answers its own Enter.
          if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
            event.preventDefault();
            submit();
          }
          // The location popover closes only on an outside click; Esc should close it too.
          if (event.key === "Escape") document.body.click();
        }}
      >
        <LocationInput
          className="flex-[1.5]"
          options={[RIVERSIDE_LABEL]}
          value={draft.brand}
          onSelect={(brand) => updateDraft({ brand })}
          placeHolder="Chỗ nghỉ"
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
            submitLabel: "Tìm phòng",
          }}
        />
      </form>

      <div className="mt-3 min-h-[1.25rem] px-6 text-sm">
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
      </div>
    </div>
  );
};

export default LiveStaySearchForm;
