/**
 * Deterministic calendar-date arithmetic for the Reservation Board.
 * All calculations use explicitly parsed ISO (YYYY-MM-DD) components and
 * UTC epoch-day primitives — never Date.now(), locale parsing, or client
 * timezone — so results are identical regardless of runtime timezone.
 */

import type { IsoDate, ReservationBoardRangeLength } from "./types";

interface IsoDateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

const MS_PER_DAY = 86_400_000;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function parseIsoDate(iso: IsoDate): IsoDateParts {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toEpochDay(iso: IsoDate): number {
  const { year, month, day } = parseIsoDate(iso);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): IsoDate {
  const date = new Date(epochDay * MS_PER_DAY);
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDaysIso(iso: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(iso) + days);
}

export function diffDaysIso(fromIso: IsoDate, toIso: IsoDate): number {
  return toEpochDay(toIso) - toEpochDay(fromIso);
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

export function maxIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDate(a, b) >= 0 ? a : b;
}

export function minIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDate(a, b) <= 0 ? a : b;
}

export function getWeekdayLabel(iso: IsoDate): string {
  const { year, month, day } = parseIsoDate(iso);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_LABELS[dayOfWeek];
}

export function isWeekendIso(iso: IsoDate): boolean {
  const { year, month, day } = parseIsoDate(iso);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function formatDisplayDate(iso: IsoDate): string {
  const { year, month, day } = parseIsoDate(iso);
  return `${MONTH_LABELS[month - 1]} ${day}, ${year}`;
}

export interface VisibleRange {
  start: IsoDate;
  endExclusive: IsoDate;
  length: ReservationBoardRangeLength;
}

export function buildVisibleRange(
  start: IsoDate,
  length: ReservationBoardRangeLength
): VisibleRange {
  return { start, endExclusive: addDaysIso(start, length), length };
}

export function generateRangeDates(range: VisibleRange): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let i = 0; i < range.length; i += 1) {
    dates.push(addDaysIso(range.start, i));
  }
  return dates;
}

export function formatRangeLabel(range: VisibleRange): string {
  const lastInclusiveDay = addDaysIso(range.endExclusive, -1);
  return `${formatDisplayDate(range.start)} – ${formatDisplayDate(lastInclusiveDay)}`;
}

export interface ClippedSpan {
  /** 0-based date-column index within the visible range where the span starts */
  startCol: number;
  /** number of date columns the span occupies */
  span: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Clips a half-open [itemStart, itemEnd) span to a visible range and returns
 * exact grid-column start/span, or null when the span does not intersect
 * the visible range (visibleEnd must be strictly greater than visibleStart).
 */
export function clipToVisibleRange(
  itemStart: IsoDate,
  itemEnd: IsoDate,
  range: VisibleRange
): ClippedSpan | null {
  const visibleStart = maxIsoDate(itemStart, range.start);
  const visibleEnd = minIsoDate(itemEnd, range.endExclusive);

  if (compareIsoDate(visibleEnd, visibleStart) <= 0) {
    return null;
  }

  return {
    startCol: diffDaysIso(range.start, visibleStart),
    span: diffDaysIso(visibleStart, visibleEnd),
    clippedStart: compareIsoDate(itemStart, range.start) < 0,
    clippedEnd: compareIsoDate(itemEnd, range.endExclusive) > 0,
  };
}

export function isIsoDateWithinRange(iso: IsoDate, range: VisibleRange): boolean {
  return compareIsoDate(iso, range.start) >= 0 && compareIsoDate(iso, range.endExclusive) < 0;
}
