"use client";

import React from "react";
import ReactDatePicker from "react-datepicker";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the calendar in the visitor's language. react-datepicker names the weekdays in English;
 * they come from `Intl` for the visitor's format locale instead — no per-language bundle — so a language added from the Admin
 * needs no code. Month names are drawn by the shared header (`DatePickerCustomHeaderTwoMonth`) the same way.
 */
const ENGLISH_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The callers keep react-datepicker's own prop typing (its overloaded selectsRange/single props); only the weekday names differ.
const LocalizedDatePicker = ((props: React.ComponentProps<typeof ReactDatePicker>) => {
  const { formatLocale } = useI18n();
  const formatWeekDay = React.useCallback(
    (name: string) => {
      const index = Math.max(0, ENGLISH_WEEKDAYS.indexOf(name));
      // 2021-01-03 is a Sunday
      return new Intl.DateTimeFormat(formatLocale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2021, 0, 3 + index)));
    },
    [formatLocale]
  );
  return <ReactDatePicker formatWeekDay={formatWeekDay} {...props} />;
}) as unknown as typeof ReactDatePicker;

export default LocalizedDatePicker;
