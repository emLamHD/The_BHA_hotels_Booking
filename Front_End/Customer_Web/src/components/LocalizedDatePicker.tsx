"use client";

import React from "react";
import ReactDatePicker from "react-datepicker";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the calendar in the visitor's language. react-datepicker (date-fns) names weekdays and months
 * in English and says "Choose Sunday, January 29th, 2023" to a screen reader. Here those words come from `Intl` for the
 * visitor's format locale — a date-fns locale object built on the fly, no per-language bundle — so a language added from
 * the Admin needs no code. Typed dates still parse by their numeric parts (the pickers are `dd/MM`-style numeric formats).
 */
const ENGLISH_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Width = "narrow" | "short" | "abbreviated" | "wide" | undefined;
const noMatch = () => null;

export function intlDateFnsLocale(formatLocale: string) {
  const monthName = (index: number, width: Width) =>
    new Intl.DateTimeFormat(formatLocale, { month: width === "wide" ? "long" : width === "narrow" ? "narrow" : "short", timeZone: "UTC" }).format(Date.UTC(2021, index, 1));
  // 2021-01-03 is a Sunday
  const dayName = (index: number, width: Width) =>
    new Intl.DateTimeFormat(formatLocale, { weekday: width === "wide" ? "long" : width === "narrow" ? "narrow" : "short", timeZone: "UTC" }).format(Date.UTC(2021, 0, 3 + index));
  return {
    code: formatLocale,
    localize: {
      ordinalNumber: (value: number) => String(value),
      era: () => "",
      quarter: (value: number) => `Q${value + 1}`,
      month: (value: number, options?: { width?: Width }) => monthName(value, options?.width),
      day: (value: number, options?: { width?: Width }) => dayName(value, options?.width),
      dayPeriod: () => "",
    },
    formatLong: {
      date: ({ width }: { width?: string } = {}) => (width === "full" ? "EEEE d MMMM y" : width === "long" ? "d MMMM y" : "dd/MM/y"),
      time: () => "HH:mm",
      dateTime: () => "{{date}} {{time}}",
    },
    match: { ordinalNumber: noMatch, era: noMatch, quarter: noMatch, month: noMatch, day: noMatch, dayPeriod: noMatch },
    options: { weekStartsOn: 0 as const, firstWeekContainsDate: 1 as const },
  };
}

// The callers keep react-datepicker's own prop typing (its overloaded selectsRange/single props); only the words differ.
const LocalizedDatePicker = ((props: React.ComponentProps<typeof ReactDatePicker>) => {
  const { formatLocale, t } = useI18n();
  const formatWeekDay = React.useCallback(
    (name: string) => {
      const index = Math.max(0, ENGLISH_WEEKDAYS.indexOf(name));
      return new Intl.DateTimeFormat(formatLocale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2021, 0, 3 + index)));
    },
    [formatLocale]
  );
  const locale = React.useMemo(() => intlDateFnsLocale(formatLocale), [formatLocale]);
  return (
    <ReactDatePicker
      formatWeekDay={formatWeekDay}
      locale={locale as never}
      chooseDayAriaLabelPrefix={t("customer.datePicker.choose")}
      disabledDayAriaLabelPrefix={t("customer.datePicker.notAvailable")}
      weekAriaLabelPrefix={t("customer.datePicker.week")}
      monthAriaLabelPrefix={t("customer.datePicker.month")}
      {...props}
    />
  );
}) as unknown as typeof ReactDatePicker;

export default LocalizedDatePicker;
