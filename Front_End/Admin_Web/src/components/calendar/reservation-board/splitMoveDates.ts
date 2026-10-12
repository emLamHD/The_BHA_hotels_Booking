/**
 * PMS-CAL-002-CP04: pure date helpers for the split-move dialog — the split date's bounds, validity,
 * night counts and the Property-date comparison (D4). Everything works on real Gregorian dates
 * 0001–9999 through `gregorianDayNumber` (`splitMoveTarget.ts`, the C1-corrected arithmetic); it
 * never uses `Date`, the clock or the browser timezone, and it does not use `dateMath.ts`, whose
 * `Date.UTC` maps years 0–99 onto 1900–1999 and whose `formatIsoDate` does not pad the year.
 *
 * Dates are half-open, as everywhere on the board: a split at `d` leaves the source room
 * `[start, d)` and gives the destination `[d, end)`, so `d` must lie strictly inside the source
 * range (`start + 1 … end - 1`). Strings the server sent are never rewritten; only days computed
 * here (the bounds and the last night of the first part) are formatted, always as `YYYY-MM-DD`.
 */

import { gregorianDayNumber } from "./splitMoveTarget";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_PER_400_YEARS = 146_097;
const DAYS_PER_100_YEARS = 36_524;
const DAYS_PER_4_YEARS = 1_461;
const LAST_DAY_NUMBER = 3_652_059; // 9999-12-31

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Inverse of `gregorianDayNumber`: `null` outside 0001-01-01 … 9999-12-31, otherwise a zero-padded `YYYY-MM-DD`. */
export function isoFromGregorianDayNumber(dayNumber: number): string | null {
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > LAST_DAY_NUMBER) return null;
  let rest = dayNumber - 1;
  const cycles400 = Math.floor(rest / DAYS_PER_400_YEARS);
  rest %= DAYS_PER_400_YEARS;
  const centuries = Math.min(Math.floor(rest / DAYS_PER_100_YEARS), 3);
  rest -= centuries * DAYS_PER_100_YEARS;
  const fours = Math.floor(rest / DAYS_PER_4_YEARS);
  rest %= DAYS_PER_4_YEARS;
  const years = Math.min(Math.floor(rest / 365), 3);
  rest -= years * 365;
  const year = cycles400 * 400 + centuries * 100 + fours * 4 + years + 1;
  let month = 0;
  for (; month < 12; month += 1) {
    const length = DAYS_IN_MONTH[month] + (month === 1 && isLeapYear(year) ? 1 : 0);
    if (rest < length) break;
    rest -= length;
  }
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(rest + 1, 2)}`;
}

/** The calendar day `days` after (or, if negative, before) `iso`, or `null` if either end is not a real day of 0001–9999. */
export function shiftIsoDate(iso: string, days: number): string | null {
  const dayNumber = gregorianDayNumber(iso);
  return dayNumber === null ? null : isoFromGregorianDayNumber(dayNumber + days);
}

/** Nights in `[startDate, endDate)`, or `null` unless both are real dates and the range is not empty or reversed. */
export function countNights(startDate: string, endDate: string): number | null {
  const start = gregorianDayNumber(startDate);
  const end = gregorianDayNumber(endDate);
  return start === null || end === null || end <= start ? null : end - start;
}

export interface SplitDateBounds {
  /** `startDate + 1`: the earliest split date, leaving the first part one night. */
  min: string;
  /** `endDate - 1`: the latest split date, leaving the second part one night. */
  max: string;
}

/** The selectable split dates of a source range, or `null` when there is none (one night, or not a valid range). */
export function splitDateBounds(startDate: string, endDate: string): SplitDateBounds | null {
  const nights = countNights(startDate, endDate);
  if (nights === null || nights < 2) return null;
  const min = shiftIsoDate(startDate, 1);
  const max = shiftIsoDate(endDate, -1);
  return min === null || max === null ? null : { min, max };
}

export type SplitDateCheck =
  | { kind: "no-interior-date" }
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "out-of-range"; min: string; max: string }
  | { kind: "ok"; prefixNights: number; suffixNights: number };

/** Validates `value` as a split date of `[startDate, endDate)` and counts the nights of both parts. */
export function checkSplitDate(startDate: string, endDate: string, value: string): SplitDateCheck {
  const bounds = splitDateBounds(startDate, endDate);
  if (bounds === null) return { kind: "no-interior-date" };
  if (value === "") return { kind: "empty" };
  const split = gregorianDayNumber(value);
  if (split === null) return { kind: "invalid" };
  const start = gregorianDayNumber(startDate);
  const end = gregorianDayNumber(endDate);
  if (start === null || end === null || split <= start || split >= end) {
    return { kind: "out-of-range", ...bounds };
  }
  return { kind: "ok", prefixNights: split - start, suffixNights: end - split };
}

/**
 * The Property's date against the split date (D4): `before` means the split date lies before
 * `localToday` and rewrites nights that have already passed; `null` means either date is not a real
 * date, which the caller must treat as "cannot tell" and never as "not in the past".
 */
export function compareSplitDateToToday(splitDate: string, localToday: string): "before" | "on-or-after" | null {
  const split = gregorianDayNumber(splitDate);
  const today = gregorianDayNumber(localToday);
  if (split === null || today === null) return null;
  return split < today ? "before" : "on-or-after";
}

/**
 * Default split date: the Property's `localToday` when it is a real date strictly inside the source,
 * otherwise nothing — never clamped to a bound.
 */
export function defaultSplitDate(startDate: string, endDate: string, localToday: string): string {
  return checkSplitDate(startDate, endDate, localToday).kind === "ok" ? localToday : "";
}
