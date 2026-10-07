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

/**
 * PMS-CAL-001.2-CP04C.1: body of
 * `POST /api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/move`,
 * mirroring the backend's `MoveReservationAssignmentRequest`. Moves the
 * segment named in the URL to a different PhysicalRoom over exactly the
 * `[startDate, endDate)` it already occupies — a room change, never a date
 * change, split or partial move; the store's exact-partition check rejects
 * any other range as `400`. `confirmCrossRoomType`/`reason` carry the same
 * meaning as `CreateReservationAssignmentRequest`'s.
 */
export interface MoveReservationAssignmentRequest {
  /** Optimistic-concurrency token last observed for this segment. */
  expectedVersion: number;
  physicalRoomId: string;
  /** Must equal the source segment's own current start date (`YYYY-MM-DD`). */
  startDate: string;
  /** Must equal the source segment's own current end date (`YYYY-MM-DD`), exclusive. */
  endDate: string;
  confirmCrossRoomType: boolean;
  /** Required, already-trimmed, non-empty when `confirmCrossRoomType` is `true`; absent otherwise. */
  reason?: string;
}

/**
 * PMS-CAL-001.2-CP04D.1: body of
 * `POST /api/admin/v1/properties/{propertyId}/reservation-assignments/{segmentId}/unassign`,
 * mirroring the backend's `UnassignReservationAssignmentRequest`. Supersedes
 * the segment named in the URL with zero replacements — there is no target
 * room or date range to carry, and an empty replacement list can never be
 * cross-RoomType, so this never sends `confirmCrossRoomType`.
 */
export interface UnassignReservationAssignmentRequest {
  /** Optimistic-concurrency token last observed for this segment. */
  expectedVersion: number;
  /** Optional; already-trimmed when present. Never required. */
  reason?: string;
}

/**
 * PMS-CAL-001.3-CP03: body of
 * `POST /api/admin/v1/properties/{propertyId}/operational-blocks`, mirroring the
 * backend's `CreateOperationalBlockRequest`: exactly one room and one half-open
 * night range per request, all four fields required. Like the assignment
 * requests it carries no actor or authorization evidence.
 */
export interface CreateOperationalBlockRequest {
  physicalRoomId: string;
  /** First blocked night, inclusive (`YYYY-MM-DD`). */
  startDate: string;
  /** Night after the last blocked one, exclusive (`YYYY-MM-DD`). At most 366 nights after `startDate`. */
  endDate: string;
  /** Already trimmed and non-empty. */
  reason: string;
}

/** The `201 Created` body: the new RoomBlock header's id and its one Effective segment. */
export interface CreateOperationalBlockResponse {
  roomBlockId: string;
  segment: RoomOccupancySegment;
}

/**
 * PMS-CAL-001.3-CP04: body of
 * `POST /api/admin/v1/properties/{propertyId}/operational-blocks/{segmentId}/cancel`,
 * mirroring the backend's `CancelOperationalBlockRequest`. Supersedes the one
 * segment named in the URL with zero replacements: there is no room and no
 * date range to carry, because a cancel never moves or reshapes a block, and —
 * like every other Admin Calendar write request — it carries no actor and no
 * authorization evidence.
 */
export interface CancelOperationalBlockRequest {
  /** The segment's `Version` as last read from the board projection. */
  expectedVersion: number;
  /** Optional; already-trimmed when present. Never required. */
  reason?: string;
}
