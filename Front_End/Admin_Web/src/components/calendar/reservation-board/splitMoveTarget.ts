/**
 * PMS-CAL-002-CP03: turns one clicked assigned bar into the exact thing a future
 * split-move dialog would be allowed to act on, or refuses to. Read-only and
 * pure — no API call, no mutation of its inputs, and no night, overlap or
 * capacity inference; the backend decides those, exactly as for `moveTarget.ts`.
 *
 * Differences from a move, all deliberate:
 * - The target carries the segment's own full `[startDate, endDate)`, never the
 *   visible window and never the booked stay: the server reads the same range
 *   and the split date is only meaningful inside it.
 * - The source needs at least two nights, because both successors need one. The
 *   count is taken on real Gregorian dates 0001–9999 with the arithmetic below, not
 *   with `dateMath.diffDaysIso`: that helper goes through `Date.UTC`, which maps
 *   years 0–99 onto 1900–1999. The server's strings are carried unchanged.
 * - `localToday` is carried as a fact of the board and nothing more. This module
 *   has no default split date, no past-date rule and no acknowledgement; those
 *   are Owner decision D4 and are not made here.
 * - The current room's RoomType comes from the board's PhysicalRoom, not from
 *   `selection.segment.actualRoomTypeId`, so a stale selection cannot name it.
 *
 * Exact match on identity, version, room and range at once is what makes a stale
 * selection refuse to produce a target instead of silently substituting
 * whatever the board now says about that segment.
 */

import type { ReservationBoardResponse } from "@/lib/api/types";
import { boardIdentityKey, selectAssignableRoomCandidates, type AssignmentRoomCandidate } from "./assignmentTarget";
import type { AssignedSegmentSelection } from "./ReservationBoardServerTimeline";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Proleptic-Gregorian day number of a zero-padded `YYYY-MM-DD` string (0001-01-01 is day 1), or
 * `null` for anything that is not an existing calendar day of years 0001–9999. Pure integer
 * arithmetic: no `Date`, no clock, no timezone.
 *
 * Exported (PMS-CAL-002-CP04) so `splitMoveDates.ts` counts and bounds split dates with this one
 * implementation; the target guard above is unchanged.
 */
export function gregorianDayNumber(iso: string): number | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = isLeapYear(year);
  if (day > DAYS_IN_MONTH[month - 1] + (month === 2 && leap ? 1 : 0)) return null;
  const priorYears = year - 1;
  let dayNumber = priorYears * 365 + Math.floor(priorYears / 4) - Math.floor(priorYears / 100) + Math.floor(priorYears / 400);
  for (let earlier = 0; earlier < month - 1; earlier += 1) dayNumber += DAYS_IN_MONTH[earlier];
  return dayNumber + (month > 2 && leap ? 1 : 0) + day;
}

/** True only when both dates exist and `endDate` is at least two days after `startDate`. */
function spansAtLeastTwoNights(startDate: string, endDate: string): boolean {
  const start = gregorianDayNumber(startDate);
  const end = gregorianDayNumber(endDate);
  return start !== null && end !== null && end - start >= 2;
}

export interface SplitMoveTarget {
  propertyId: string;
  /** The board read this target was built from. */
  boardKey: string;
  boardFrom: string;
  boardTo: string;
  propertyName: string;
  /** The Property's local today as the board reported it. A fact only; no rule is derived from it here. */
  localToday: string;
  stay: AssignedSegmentSelection["stay"];
  /** The exact source segment: `segmentId`, `segmentVersion`, current room and its own full range. */
  segment: AssignedSegmentSelection["segment"];
  soldRoomTypeName: string;
  currentRoomNumber: string;
  /** The source room's RoomType as the board's PhysicalRoom says it. */
  currentRoomTypeId: string;
  currentRoomTypeName: string;
  /**
   * Every Active PhysicalRoom of this Property except the segment's own room
   * (D2): same sold RoomType first, then the others, each in board order —
   * the grouping `AssignmentTarget.candidateRooms` uses. Whether a room is free
   * is never inferred.
   */
  candidateRooms: AssignmentRoomCandidate[];
}

/**
 * Returns `null` — and no split-move may be offered — unless the board is for
 * the selected Property, the Unit is on it, the segment is still present with
 * exactly the clicked id, version, room and range, its room is on the board,
 * and it spans at least two nights.
 */
export function buildSplitMoveTarget(
  board: ReservationBoardResponse,
  selectedPropertyId: string | null,
  selection: AssignedSegmentSelection
): SplitMoveTarget | null {
  if (selectedPropertyId === null || board.property.id !== selectedPropertyId) return null;

  const stay = board.stays.find((candidate) => candidate.reservationUnitId === selection.stay.reservationUnitId);
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

  if (!spansAtLeastTwoNights(segment.startDate, segment.endDate)) return null;

  const currentRoom = board.physicalRooms.find((room) => room.id === segment.physicalRoomId);
  if (!currentRoom) return null;

  return {
    propertyId: board.property.id,
    boardKey: boardIdentityKey(board.property.id, board.from, board.to),
    boardFrom: board.from,
    boardTo: board.to,
    propertyName: board.property.name,
    localToday: board.property.localToday,
    stay,
    segment,
    soldRoomTypeName:
      board.roomTypes.find((roomType) => roomType.id === stay.soldRoomTypeId)?.name ?? "Unknown room type",
    currentRoomNumber: currentRoom.roomNumber,
    currentRoomTypeId: currentRoom.roomTypeId,
    currentRoomTypeName:
      board.roomTypes.find((roomType) => roomType.id === currentRoom.roomTypeId)?.name ?? "Unknown room type",
    candidateRooms: selectAssignableRoomCandidates(board.physicalRooms, board.roomTypes, stay.soldRoomTypeId).filter(
      (room) => room.id !== segment.physicalRoomId
    ),
  };
}
