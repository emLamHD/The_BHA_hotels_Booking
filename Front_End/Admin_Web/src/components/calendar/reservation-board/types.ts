/**
 * Typed view model for the PMS Reservation Board UI baseline (ADMIN-002.1).
 * All data consumed here is deterministic mock data — see mockData.ts.
 * This module intentionally owns no rendering and no mock data values.
 */

export type IsoDate = string; // YYYY-MM-DD, half-open range convention: start <= night < end

export type PropertyId = string;
export type RoomTypeId = string;
export type PhysicalRoomId = string;
export type BookingSourceId = "direct" | "booking_com" | "agoda";

export interface Property {
  id: PropertyId;
  name: string;
}

export interface RoomType {
  id: RoomTypeId;
  propertyId: PropertyId;
  name: string;
}

export interface PhysicalRoom {
  id: PhysicalRoomId;
  roomTypeId: RoomTypeId;
  code: string;
}

export interface BookingSource {
  id: BookingSourceId;
  label: string;
}

interface TimelineItemBase {
  id: string;
  propertyId: PropertyId;
  startDate: IsoDate; // check-in, inclusive
  endDate: IsoDate; // check-out, exclusive grid line
}

export interface AssignedReservationItem extends TimelineItemBase {
  kind: "assigned-reservation";
  roomId: PhysicalRoomId;
  guestName: string;
  sourceId: BookingSourceId;
}

export interface UnassignedReservationItem extends TimelineItemBase {
  kind: "unassigned-reservation";
  roomTypeId: RoomTypeId;
  guestName: string;
  sourceId: BookingSourceId;
}

export interface OperationalBlockItem extends TimelineItemBase {
  kind: "operational-block";
  roomId: PhysicalRoomId;
  reason: string;
}

export type TimelineItem =
  | AssignedReservationItem
  | UnassignedReservationItem
  | OperationalBlockItem;

export type ReservationBoardRangeLength = 7 | 14 | 21;

export interface ReservationBoardFilters {
  showAssigned: boolean;
  showUnassigned: boolean;
  showOperationalBlocks: boolean;
}

/**
 * Demo-only, in-memory description of a proposed room reassignment for an
 * assigned reservation, pending Owner confirmation in
 * ReservationMoveConfirmDialog. Never persisted — see ADMIN-002.1-C1.
 */
export interface ReservationMoveIntent {
  reservationId: string;
  propertyId: PropertyId;
  guestName: string;
  sourceId: BookingSourceId;
  sourceLabel: string;
  startDate: IsoDate;
  endDate: IsoDate;
  fromRoomId: PhysicalRoomId;
  fromRoomCode: string;
  fromRoomTypeId: RoomTypeId;
  fromRoomTypeName: string;
  toRoomId: PhysicalRoomId;
  toRoomCode: string;
  toRoomTypeId: RoomTypeId;
  toRoomTypeName: string;
  crossesRoomType: boolean;
}

/** A rejected move target and the accessible reason it was rejected. */
export interface ReservationMoveConflict {
  targetRoomId: PhysicalRoomId;
  message: string;
}

/** Outcome of validating a proposed reservationId -> targetRoomId move. */
export type ReservationMoveValidation =
  | { status: "valid" }
  | { status: "same-room" }
  | { status: "conflict"; conflict: ReservationMoveConflict };

/** Summary of a locally-applied move, used to build the demo-only status announcement. */
export interface ReservationMoveResult {
  reservationId: string;
  guestName: string;
  fromRoomCode: string;
  toRoomCode: string;
}
