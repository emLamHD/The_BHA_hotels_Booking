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
