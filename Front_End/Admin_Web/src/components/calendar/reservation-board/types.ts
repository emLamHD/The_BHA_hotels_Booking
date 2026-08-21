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

/** A compact, in-app text/brand mark for a booking source — never a third-party logo asset. */
export interface BookingSource {
  id: BookingSourceId;
  label: string;
  markLabel: string;
  markClassName: string;
}

/** Fictional guest nationality shown in the reservation hover card. */
export interface GuestNationality {
  code: string;
  label: string;
  flag: string;
}

export type PaymentCollectionStatus = "unpaid" | "deposit" | "paid";

/** Presentation-only mock payment status. No payment behavior, mutation, or API. */
export interface ReservationPaymentDisplay {
  status: PaymentCollectionStatus;
  amountDue: number;
  currency: "VND";
}

export interface ReservationOccupancy {
  adults: number;
  children: number;
}

interface TimelineItemBase {
  id: string;
  propertyId: PropertyId;
  startDate: IsoDate; // check-in, inclusive
  endDate: IsoDate; // check-out, exclusive grid line
}

/**
 * Fields shared by assigned and unassigned reservations. `soldRoomTypeId` is
 * the RoomType the guest booked and is preserved independently of whichever
 * PhysicalRoom the reservation is currently assigned to — it must never be
 * overwritten by a PhysicalRoom move.
 */
interface ReservationTimelineItemBase extends TimelineItemBase {
  soldRoomTypeId: RoomTypeId;
  guestName: string;
  nationality: GuestNationality;
  sourceId: BookingSourceId;
  occupancy: ReservationOccupancy;
  paymentDisplay: ReservationPaymentDisplay;
}

export interface AssignedReservationItem extends ReservationTimelineItemBase {
  kind: "assigned-reservation";
  roomId: PhysicalRoomId;
}

export interface UnassignedReservationItem extends ReservationTimelineItemBase {
  kind: "unassigned-reservation";
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

/** A PhysicalRoom move/assignment destination choice, grouped by RoomType, for the confirmation dialog. */
export interface ReservationMoveTargetGroup {
  roomType: RoomType;
  rooms: PhysicalRoom[];
}

export type ReservationMoveOperation =
  | "assigned-move"
  | "unassigned-assign"
  | "block-move";

interface ReservationMoveIntentBase {
  propertyId: PropertyId;
  startDate: IsoDate;
  endDate: IsoDate;
  toRoomId: PhysicalRoomId;
  toRoomCode: string;
  toRoomTypeId: RoomTypeId;
  toRoomTypeName: string;
}

/** Demo-only, in-memory description of a proposed PhysicalRoom move for an assigned reservation. */
export interface AssignedMoveIntent extends ReservationMoveIntentBase {
  operation: "assigned-move";
  reservationId: string;
  guestName: string;
  sourceId: BookingSourceId;
  sourceLabel: string;
  soldRoomTypeId: RoomTypeId;
  soldRoomTypeName: string;
  fromRoomId: PhysicalRoomId;
  fromRoomCode: string;
  fromRoomTypeId: RoomTypeId;
  fromRoomTypeName: string;
  crossesRoomType: boolean;
}

/** Demo-only, in-memory description of a proposed first-time PhysicalRoom assignment for an unassigned reservation. */
export interface UnassignedAssignIntent extends ReservationMoveIntentBase {
  operation: "unassigned-assign";
  reservationId: string;
  guestName: string;
  sourceId: BookingSourceId;
  sourceLabel: string;
  soldRoomTypeId: RoomTypeId;
  soldRoomTypeName: string;
  crossesRoomType: boolean;
}

/** Demo-only, in-memory description of a proposed PhysicalRoom move for an operational block. */
export interface BlockMoveIntent extends ReservationMoveIntentBase {
  operation: "block-move";
  blockId: string;
  reason: string;
  fromRoomId: PhysicalRoomId;
  fromRoomCode: string;
  fromRoomTypeId: RoomTypeId;
  fromRoomTypeName: string;
}

/** Never persisted — pending Owner confirmation in ReservationMoveConfirmDialog. See ADMIN-002.1-C1/C2. */
export type ReservationMoveIntent =
  | AssignedMoveIntent
  | UnassignedAssignIntent
  | BlockMoveIntent;

/** A rejected move target and the accessible reason it was rejected. */
export interface ReservationMoveConflict {
  targetRoomId: PhysicalRoomId;
  message: string;
}

/** Outcome of validating a proposed timeline-item-id -> targetRoomId move. */
export type ReservationMoveValidation =
  | { status: "valid" }
  | { status: "same-room" }
  | { status: "conflict"; conflict: ReservationMoveConflict };
