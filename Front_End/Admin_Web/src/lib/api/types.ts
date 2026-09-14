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

/**
 * PMS-CAL-001.2-CP03A: body of
 * `POST /api/admin/v1/properties/{propertyId}/reservation-assignments`,
 * mirroring the backend's `CreateReservationAssignmentRequest`.
 *
 * Deliberately closed: there is no `actorReference` and no
 * `authorizationEvidence` — the backend owns both as server-side constants and
 * a browser-supplied identity would be a claim, not proof. This slice only
 * places a Unit in a room of its own sold RoomType, so `confirmCrossRoomType`
 * is the literal `false` and `reason` is not part of the type at all.
 */
export interface CreateReservationAssignmentRequest {
  reservationUnitId: string;
  physicalRoomId: string;
  /** First night, inclusive (`YYYY-MM-DD`). */
  startDate: string;
  /** Night after the last one, exclusive (`YYYY-MM-DD`) — half-open `[startDate, endDate)`. */
  endDate: string;
  confirmCrossRoomType: false;
}

/** The `201 Created` body: the backend's `RoomOccupancySegmentDto`. */
export interface RoomOccupancySegment {
  id: string;
  propertyId: string;
  physicalRoomId: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reservationUnitId: string | null;
  roomBlockId: string | null;
  version: number;
}
