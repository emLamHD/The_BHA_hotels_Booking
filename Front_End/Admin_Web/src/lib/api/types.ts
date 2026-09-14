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
 * PMS-CAL-001.2-CP03A/B: body of
 * `POST /api/admin/v1/properties/{propertyId}/reservation-assignments`,
 * mirroring the backend's `CreateReservationAssignmentRequest`.
 *
 * Deliberately closed: there is no `actorReference` and no
 * `authorizationEvidence` — the backend owns both as server-side constants and
 * a browser-supplied identity would be a claim, not proof.
 *
 * `confirmCrossRoomType`/`reason` are CP03B's controlled cross-RoomType path:
 * `confirmCrossRoomType: true` is only an operational acknowledgement that the
 * placement was deliberate, never authentication or a staff permission, and
 * the backend requires a non-empty (post-trim) `reason` whenever it is `true`.
 * Same-RoomType assignment (CP03A) sends `confirmCrossRoomType: false` and
 * omits `reason` entirely — `client.ts` drops the key rather than sending an
 * empty string, so the two flows stay indistinguishable from CP03A's own
 * request shape at the wire level.
 */
export interface CreateReservationAssignmentRequest {
  reservationUnitId: string;
  physicalRoomId: string;
  /** First night, inclusive (`YYYY-MM-DD`). */
  startDate: string;
  /** Night after the last one, exclusive (`YYYY-MM-DD`) — half-open `[startDate, endDate)`. */
  endDate: string;
  confirmCrossRoomType: boolean;
  /** Required, already-trimmed, non-empty when `confirmCrossRoomType` is `true`; absent otherwise. */
  reason?: string;
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
