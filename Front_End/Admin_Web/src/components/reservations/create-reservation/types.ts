/**
 * Typed view model for the Create Reservation demo workspace (ADMIN-002.1-C4).
 * Frontend-only, deterministic mock data. Reads (never mutates) the shared
 * Reservation Board mock IDs from `@/components/calendar/reservation-board`
 * so PropertyId/RoomTypeId/PhysicalRoomId/BookingSourceId stay consistent
 * with the Reservation Board — see mockData.ts for the rate-plan/nationality
 * data this feature owns independently.
 */

import type {
  BookingSourceId,
  IsoDate,
  PhysicalRoomId,
  PropertyId,
  RoomTypeId,
} from "@/components/calendar/reservation-board/types";

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
  nightlyAmount: number | null;
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
