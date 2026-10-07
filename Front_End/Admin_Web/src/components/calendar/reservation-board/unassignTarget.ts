/**
 * PMS-CAL-001.2-CP04D.2: turns one clicked assigned bar into the exact thing
 * a future unassign dialog would be allowed to act on, or refuses to.
 * Read-only and pure — no API call, no mutation of its inputs, and no
 * night/overlap/capacity/coverage inference. That is left to the backend,
 * exactly as `moveTarget.ts` leaves it for move.
 *
 * Everything comes from the authoritative board snapshot the bar was
 * rendered from, never from rendered grid columns: a stay's `assignments`
 * already carry each segment's own full `[startDate, endDate)`, so a segment
 * that runs past the visible window is still reported verbatim rather than
 * clipped to what was on screen.
 *
 * The exact-match check against `selection.segment` (identity, version,
 * room and range all at once) is deliberate: it is what makes a stale
 * selection — the board reloaded and this segment moved, was superseded, or
 * no longer exists — refuse to produce a target, rather than silently
 * substituting a look-alike or the newest segment of the same Unit.
 *
 * Unassign has no destination, so there is no candidate room list, and the
 * segment's current room is not required to be `Active`: a room going
 * out of service must never stop an operator releasing an assignment that
 * already exists.
 */

import type { ReservationBoardResponse } from "@/lib/api/types";
import { boardIdentityKey } from "./assignmentTarget";
import type { AssignedSegmentSelection } from "./ReservationBoardServerTimeline";

export interface UnassignTarget {
  propertyId: string;
  /** The board read this target was built from. */
  boardKey: string;
  boardFrom: string;
  boardTo: string;
  propertyName: string;
  /** The ReservationUnit (one stay), not the whole Reservation. */
  stay: AssignedSegmentSelection["stay"];
  /** The exact segment to unassign: `segmentId`, `segmentVersion`, current room and its own full range. */
  segment: AssignedSegmentSelection["segment"];
  soldRoomTypeName: string;
  currentRoomNumber: string;
  currentRoomTypeName: string;
}

/**
 * Returns `null` — and no unassign may be offered — unless every part of the
 * clicked selection still matches the authoritative board: the board is for
 * the Property currently selected, the Unit is on it, and the segment is
 * still present on that Unit with exactly the same id, version, room and
 * range that were clicked.
 */
export function buildUnassignTarget(
  board: ReservationBoardResponse,
  selectedPropertyId: string | null,
  selection: AssignedSegmentSelection
): UnassignTarget | null {
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
  };
}
