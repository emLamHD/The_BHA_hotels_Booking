/**
 * Typed view model for the Create Reservation demo workspace (ADMIN-002.1-C4).
 * Frontend-only, deterministic mock data. Reads (never mutates) the shared
 * Reservation Board mock IDs from `@/components/calendar/reservation-board`
 * so PropertyId/RoomTypeId/PhysicalRoomId/BookingSourceId stay consistent
 * with the Reservation Board — see mockData.ts for the rate-plan/nationality
 * data this feature owns independently.
 */

import { compareIsoDate } from "@/components/calendar/reservation-board/dateMath";
import type {
  BookingSourceId,
  IsoDate,
  PhysicalRoomId,
  PropertyId,
  RoomTypeId,
} from "@/components/calendar/reservation-board/types";

/** Realistic demo booking window (ADMIN-002.1-C5 §4.2) — applied via both HTML min/max and form-level validation. */
export const MIN_RESERVATION_DATE: IsoDate = "2020-01-01";
export const MAX_RESERVATION_DATE: IsoDate = "2035-12-31";

const ISO_DATE_STRUCTURE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict ISO date validation (ADMIN-002.1-C5 §4.3) — never relies only on
 * lexical string comparison. Confirms `YYYY-MM-DD` structure, round-trips
 * the parsed components through `Date.UTC` so an out-of-range day/month
 * (e.g. "2026-02-30") is rejected rather than silently normalized, and
 * finally checks the value falls within the configured demo window.
 */
export function isValidReservationIsoDate(value: string): boolean {
  if (!ISO_DATE_STRUCTURE_PATTERN.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!roundTrips) return false;
  return (
    compareIsoDate(value, MIN_RESERVATION_DATE) >= 0 &&
    compareIsoDate(value, MAX_RESERVATION_DATE) <= 0
  );
}

/** Frontend-only safety bounds for a negotiated actual nightly price (ADMIN-002.1-C5 §3.3). */
export const MIN_ACTUAL_NIGHTLY_AMOUNT = 0;
export const MAX_ACTUAL_NIGHTLY_AMOUNT = 1_000_000_000;

export interface ActualNightlyAmountResult {
  /** True when the raw string is empty/whitespace-only — not itself invalid; the Rate Plan price applies. */
  isBlank: boolean;
  isValid: boolean;
  /** Parsed whole-VND amount, or null when blank or invalid. */
  amount: number | null;
}

/**
 * Parses a negotiated "Actual nightly price" input (ADMIN-002.1-C5 §3.3).
 * Accepts only an empty value (blank override) or digits — no sign,
 * decimal point, exponent notation, NaN, or Infinity can pass the `^[0-9]+$`
 * check — within [MIN_ACTUAL_NIGHTLY_AMOUNT, MAX_ACTUAL_NIGHTLY_AMOUNT].
 */
export function parseActualNightlyAmount(raw: string): ActualNightlyAmountResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { isBlank: true, isValid: true, amount: null };
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return { isBlank: false, isValid: false, amount: null };
  }
  const amount = Number(trimmed);
  if (
    !Number.isSafeInteger(amount) ||
    amount < MIN_ACTUAL_NIGHTLY_AMOUNT ||
    amount > MAX_ACTUAL_NIGHTLY_AMOUNT
  ) {
    return { isBlank: false, isValid: false, amount: null };
  }
  return { isBlank: false, isValid: true, amount };
}

export type ReservationUnitId = string;

/** A deterministic demo nightly rate, scoped to one sold RoomType. */
export interface RatePlan {
  id: string;
  roomTypeId: RoomTypeId;
  name: string;
  nightlyAmount: number;
  currency: "VND";
}

export interface GuestNationalityOption {
  code: string;
  label: string;
  flag: string;
}

export interface CreateReservationGuestDetails {
  fullName: string;
  phone: string;
  email: string;
  /** "" = not selected. */
  nationalityCode: string;
}

/**
 * One commercially sold room within the reservation, independent of any
 * PhysicalRoom assignment — mirrors Reservation → ReservationUnits.
 * `physicalRoomId` of "" means intentionally left Unassigned.
 */
export interface ReservationUnitDraft {
  id: ReservationUnitId;
  soldRoomTypeId: RoomTypeId | "";
  ratePlanId: string;
  physicalRoomId: PhysicalRoomId | "";
  checkIn: IsoDate | "";
  checkOut: IsoDate | "";
  adults: number;
  children: number;
  specialRequest: string;
  /**
   * Raw negotiated nightly price, kept as a string so an empty value stays
   * distinguishable from zero. Blank = use the Rate Plan price. Never
   * mutates `ratePlanId` or the Rate Plan itself (ADMIN-002.1-C5 §3.2).
   */
  actualNightlyAmount: string;
}

export interface CreateReservationFormState {
  propertyId: PropertyId | "";
  sourceId: BookingSourceId | "";
  guest: CreateReservationGuestDetails;
  units: ReservationUnitDraft[];
  internalNote: string;
  /** Internal counter for generating stable new-unit IDs; never rendered. */
  nextUnitSeq: number;
}

/** `path` identifies the field: "propertyId", "guest.fullName", or "unit:<unitId>.<field>". */
export interface FieldError {
  path: string;
  message: string;
}

export function findFieldError(errors: FieldError[], path: string): string | undefined {
  return errors.find((error) => error.path === path)?.message;
}

export interface ReservationUnitSummary {
  unitId: ReservationUnitId;
  soldRoomTypeName: string | null;
  physicalRoomLabel: string;
  assignedRoomTypeName: string | null;
  crossesRoomType: boolean;
  checkIn: IsoDate | "";
  checkOut: IsoDate | "";
  nights: number;
  adults: number;
  children: number;
  ratePlanName: string | null;
  /** The selected Rate Plan's own price — always shown as the reference amount. */
  ratePlanNightlyAmount: number | null;
  /** Amount actually used for totals: the negotiated override when present and valid, otherwise the Rate Plan price. */
  effectiveNightlyAmount: number | null;
  /** True when a valid, non-blank negotiated price is overriding the Rate Plan price. */
  hasPriceOverride: boolean;
  subtotal: number | null;
}

export interface ReservationReviewData {
  propertyName: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  guestNationalityLabel: string | null;
  sourceLabel: string;
  units: ReservationUnitSummary[];
  aggregateTotal: number;
  internalNote: string;
}
