/**
 * PMS-CAL-001.2-CP04C.2: turns one clicked assigned bar into the exact thing
 * a future move dialog would be allowed to act on, or refuses to. Read-only
 * and pure — no API call, no mutation of its inputs, no night/overlap/
 * capacity inference. That is left to the backend, exactly as
 * `assignmentTarget.ts` leaves it for create.
 *
 * Everything comes from the authoritative board snapshot the bar was
 * rendered from, never from rendered grid columns: a stay's `assignments`
 * already carry each segment's own full `[startDate, endDate)`, so a segment
 * that runs past the visible window is still sent verbatim rather than
 * clipped to what was on screen.
 *
 * The exact-match check against `selection.segment` (identity, version,
 * room and range all at once) is deliberate: it is what makes a stale
 * selection — the board reloaded and this segment moved, was superseded, or
 * no longer exists — refuse to produce a target, rather than silently
 * substituting whatever the board now says. A future dialog built from a
 * `null` target has nothing to act on and must be re-opened from a fresh
 * click.
 */

import type { ReservationBoardResponse } from "@/lib/api/types";
import { boardIdentityKey, selectAssignableRoomCandidates, type AssignmentRoomCandidate } from "./assignmentTarget";
import type { AssignedSegmentSelection } from "./ReservationBoardServerTimeline";

export interface MoveTarget {
  propertyId: string;
  /** The board read this target was built from. */
  boardKey: string;
  boardFrom: string;
  boardTo: string;
  propertyName: string;
  stay: AssignedSegmentSelection["stay"];
  /** The exact source segment: `segmentId`, `segmentVersion`, current room and its own full range. */
  segment: AssignedSegmentSelection["segment"];
  soldRoomTypeName: string;
  currentRoomNumber: string;
  currentRoomTypeName: string;
  /**
   * Every Active PhysicalRoom of this Property except the segment's own
   * current room (a move to the same room is a no-op and has no endpoint):
   * same sold RoomType first, in board order, then every other Active
   * RoomType's rooms, also in board order — identical grouping to
   * `AssignmentTarget.candidateRooms`.
   */
  candidateRooms: AssignmentRoomCandidate[];
}

/**
 * Returns `null` — and no move may be offered — unless every part of the
 * clicked selection still matches the authoritative board: the board is for
 * the Property currently selected, the Unit is on it, and the segment is
 * still present with exactly the same id, version, room and range that were
 * clicked.
 */
export function buildMoveTarget(
  board: ReservationBoardResponse,
  selectedPropertyId: string | null,
  selection: AssignedSegmentSelection
): MoveTarget | null {
  if (selectedPropertyId === null || board.property.id !== selectedPropertyId) return null;

  const stay = board.stays.find(
    (candidate) => candidate.reservationUnitId === selection.stay.reservationUnitId
  );
  if (!stay) return null;

  const segment = stay.assignments.find(
    (assignment) =>
      assignment.segmentId === selection.segment.segmentId &&
      assignment.segmentVersion === selection.segment.segmentVersion &&
      assignment.physicalRoomId === selection.segment.physicalRoomId &&
      assignment.startDate === selection.segment.startDate &&
      assignment.endDate === selection.segment.endDate
  );
  if (!segment) return null;

  const currentRoom = board.physicalRooms.find((room) => room.id === segment.physicalRoomId);
  if (!currentRoom) return null;

  const candidateRooms = selectAssignableRoomCandidates(
    board.physicalRooms,
    board.roomTypes,
    stay.soldRoomTypeId
  ).filter((room) => room.id !== segment.physicalRoomId);

  return {
    propertyId: board.property.id,
    boardKey: boardIdentityKey(board.property.id, board.from, board.to),
    boardFrom: board.from,
    boardTo: board.to,
    propertyName: board.property.name,
    stay,
    segment,
    soldRoomTypeName:
      board.roomTypes.find((roomType) => roomType.id === stay.soldRoomTypeId)?.name ?? "Unknown room type",
    currentRoomNumber: currentRoom.roomNumber,
    currentRoomTypeName:
      board.roomTypes.find((roomType) => roomType.id === currentRoom.roomTypeId)?.name ?? "Unknown room type",
    candidateRooms,
  };
}
