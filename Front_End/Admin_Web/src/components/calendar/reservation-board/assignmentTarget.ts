/**
 * PMS-CAL-001.2-CP03A/B: turns one clicked unassigned bar into the exact thing
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
  ReservationBoardRoomType,
  ReservationBoardStay,
  ReservationBoardUnassignedRange,
} from "@/lib/api/types";
import type { UnassignedRangeSelection } from "./ReservationBoardServerTimeline";

/**
 * Identity of one board read: the Property and the visible half-open
 * `[from, to)`. Reconciliation after a write is only ever satisfied by a read
 * of this exact identity (PMS-CAL-001.2-CP03A-C1).
 */
export function boardIdentityKey(propertyId: string, from: string, to: string): string {
  return `${propertyId}|${from}|${to}`;
}

/**
 * PMS-CAL-001.2-CP03B: one Active PhysicalRoom the dialog may offer, with its
 * RoomType resolved to a display name and tagged against the Unit's own sold
 * RoomType. `isSameSoldType` is what the dialog uses to decide whether a
 * cross-RoomType confirmation and reason are required — never the room's
 * position in the list.
 */
export interface AssignmentRoomCandidate {
  id: string;
  roomNumber: string;
  floor: number;
  roomTypeId: string;
  roomTypeName: string;
  isSameSoldType: boolean;
}

export interface AssignmentTarget {
  propertyId: string;
  /** The board read this target was built from. */
  boardKey: string;
  boardFrom: string;
  boardTo: string;
  propertyName: string;
  stay: ReservationBoardStay;
  unassignedRange: ReservationBoardUnassignedRange;
  soldRoomTypeName: string;
  /**
   * Every Active PhysicalRoom of this Property: candidates whose RoomType
   * matches the Unit's sold RoomType first (in board order), then every other
   * Active RoomType's rooms (also in board order). CP03B offers both; CP03A's
   * dialog rendered only the first group.
   */
  candidateRooms: AssignmentRoomCandidate[];
}

/**
 * Every Active PhysicalRoom of this Property, tagged and grouped: same sold
 * RoomType first, then cross-RoomType, each group in board order. The board
 * already returns only this Property's Active rooms; the status is re-checked
 * so a future widening of that projection cannot silently offer an inactive
 * room.
 */
export function selectAssignableRoomCandidates(
  physicalRooms: ReservationBoardPhysicalRoom[],
  roomTypes: ReservationBoardRoomType[],
  soldRoomTypeId: string
): AssignmentRoomCandidate[] {
  const roomTypeNameById = new Map(roomTypes.map((roomType) => [roomType.id, roomType.name]));
  const toCandidate = (room: ReservationBoardPhysicalRoom): AssignmentRoomCandidate => ({
    id: room.id,
    roomNumber: room.roomNumber,
    floor: room.floor,
    roomTypeId: room.roomTypeId,
    roomTypeName: roomTypeNameById.get(room.roomTypeId) ?? "Unknown room type",
    isSameSoldType: room.roomTypeId === soldRoomTypeId,
  });
  const active = physicalRooms.filter((room) => room.operationalStatus === "Active");
  const sameType = active.filter((room) => room.roomTypeId === soldRoomTypeId).map(toCandidate);
  const crossType = active.filter((room) => room.roomTypeId !== soldRoomTypeId).map(toCandidate);
  return [...sameType, ...crossType];
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
    boardKey: boardIdentityKey(board.property.id, board.from, board.to),
    boardFrom: board.from,
    boardTo: board.to,
    propertyName: board.property.name,
    stay,
    unassignedRange,
    soldRoomTypeName:
      board.roomTypes.find((roomType) => roomType.id === stay.soldRoomTypeId)?.name ?? "Unknown room type",
    candidateRooms: selectAssignableRoomCandidates(board.physicalRooms, board.roomTypes, stay.soldRoomTypeId),
  };
}
