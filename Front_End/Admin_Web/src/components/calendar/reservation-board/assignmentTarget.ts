/**
 * PMS-CAL-001.2-CP03A: turns one clicked unassigned bar into the exact thing
 * the assignment dialog is allowed to act on, or refuses to.
 *
 * Everything comes from the authoritative board snapshot the bar was rendered
 * from — never from rendered grid columns. The board already returns each
 * `UnassignedRange` clipped to its own `[from, to)` window, so a Unit whose
 * stay runs past the window yields a partial range that is still, by
 * construction, a subset of its uncovered booked nights; that range is sent
 * verbatim. No night, capacity or overlap rule is evaluated here: the backend
 * decides those, and a room that looks free on screen is still only a
 * candidate.
 */

import type {
  ReservationBoardPhysicalRoom,
  ReservationBoardResponse,
  ReservationBoardStay,
  ReservationBoardUnassignedRange,
} from "@/lib/api/types";
import type { UnassignedRangeSelection } from "./ReservationBoardServerTimeline";

export interface AssignmentTarget {
  propertyId: string;
  propertyName: string;
  stay: ReservationBoardStay;
  unassignedRange: ReservationBoardUnassignedRange;
  soldRoomTypeName: string;
  /** Active PhysicalRooms of this Property whose RoomType is the Unit's sold RoomType, in board order. */
  candidateRooms: ReservationBoardPhysicalRoom[];
}

/**
 * Same-RoomType candidates only (CP03A). Cross-RoomType placement belongs to
 * CP03B, so a room of any other RoomType is never offered — not even disabled.
 * The board already returns only this Property's Active rooms; the status is
 * re-checked so a future widening of that projection cannot silently offer an
 * inactive room.
 */
export function selectSameRoomTypeCandidates(
  physicalRooms: ReservationBoardPhysicalRoom[],
  soldRoomTypeId: string
): ReservationBoardPhysicalRoom[] {
  return physicalRooms.filter(
    (room) => room.roomTypeId === soldRoomTypeId && room.operationalStatus === "Active"
  );
}

/**
 * Returns `null` — and the dialog does not open — unless the selection belongs
 * to this board: the board is for the Property the operator currently has
 * selected, the Unit is on it, and the range is one of that Unit's own
 * server-returned unassigned ranges.
 */
export function buildAssignmentTarget(
  board: ReservationBoardResponse,
  selectedPropertyId: string | null,
  selection: UnassignedRangeSelection
): AssignmentTarget | null {
  if (selectedPropertyId === null || board.property.id !== selectedPropertyId) return null;

  const stay = board.stays.find(
    (candidate) => candidate.reservationUnitId === selection.stay.reservationUnitId
  );
  if (!stay) return null;

  const unassignedRange = stay.unassignedRanges.find(
    (range) =>
      range.startDate === selection.unassignedRange.startDate &&
      range.endDate === selection.unassignedRange.endDate
  );
  if (!unassignedRange) return null;

  return {
    propertyId: board.property.id,
    propertyName: board.property.name,
    stay,
    unassignedRange,
    soldRoomTypeName:
      board.roomTypes.find((roomType) => roomType.id === stay.soldRoomTypeId)?.name ?? "Unknown room type",
    candidateRooms: selectSameRoomTypeCandidates(board.physicalRooms, stay.soldRoomTypeId),
  };
}
