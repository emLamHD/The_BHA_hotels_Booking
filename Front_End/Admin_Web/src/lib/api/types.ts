/**
 * PMS-CAL-001.1: typed mirror of the backend's frozen public/admin JSON
 * contracts consumed by the Admin Reservation Board. Field names and shapes
 * intentionally match the backend response byte-for-byte — no client-side
 * renaming or reshaping happens here.
 */

export interface ApiProperty {
  id: string;
  name: string;
  timeZone: string;
}

export type CoverageStatus = "FullyAssigned" | "PartiallyAssigned" | "FullyUnassigned";

export interface ReservationBoardProperty {
  id: string;
  name: string;
  timeZone: string;
  localToday: string;
  checkInTime: string;
  checkOutTime: string;
}

export interface ReservationBoardRoomType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ReservationBoardPhysicalRoom {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  floor: number;
  operationalStatus: string;
}

export interface ReservationBoardAssignment {
  segmentId: string;
  segmentVersion: number;
  physicalRoomId: string;
  actualRoomTypeId: string;
  startDate: string;
  endDate: string;
}

export interface ReservationBoardUnassignedRange {
  startDate: string;
  endDate: string;
}

export interface ReservationBoardStay {
  reservationId: string;
  reservationUnitId: string;
  confirmationNumber: string;
  guestDisplayName: string;
  soldRoomTypeId: string;
  checkIn: string;
  checkOut: string;
  coverageStatus: CoverageStatus;
  assignments: ReservationBoardAssignment[];
  unassignedRanges: ReservationBoardUnassignedRange[];
}

export interface ReservationBoardOperationalBlock {
  roomBlockId: string;
  segmentId: string;
  segmentVersion: number;
  physicalRoomId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface ReservationBoardResponse {
  property: ReservationBoardProperty;
  from: string;
  to: string;
  roomTypes: ReservationBoardRoomType[];
  physicalRooms: ReservationBoardPhysicalRoom[];
  stays: ReservationBoardStay[];
  operationalBlocks: ReservationBoardOperationalBlock[];
}
