/**
 * PMS-CAL-001.3-CP04: turns one clicked operational-block bar into the exact
 * segment a cancel may act on, or refuses to produce a target at all. Pure and
 * read-only, exactly like `unassignTarget.ts`: no API call, no mutation of its
 * inputs, and no inference about whether lifting the block is a good idea —
 * capacity and overlap stay the server's decisions.
 *
 * Everything comes from the authoritative board snapshot the bar was rendered
 * from, never from the rendered grid: `ReservationBoardOperationalBlock` already
 * carries the segment's own full `[startDate, endDate)`, so a block that runs
 * past the visible window is reported verbatim rather than clipped to the part
 * that happened to be on screen. That matters more here than anywhere else —
 * the operator is confirming the destruction of a whole segment, and must see
 * all of the nights it covers, not the slice the current date range shows.
 *
 * The exact-match check against the clicked selection (segment identity,
 * version, room and range all at once) is what makes a stale selection refuse:
 * if the board reloaded and this block was already cancelled, re-versioned or
 * reshaped, no target is produced and no dialog opens, rather than silently
 * cancelling a look-alike segment.
 */

import type { ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";
import { boardIdentityKey } from "./assignmentTarget";
import type { BlockSelection } from "./ReservationBoardServerTimeline";

export interface BlockCancelTarget {
  propertyId: string;
  propertyName: string;
  /** The board read this target was built from: `propertyId|from|to`. */
  boardKey: string;
  boardFrom: string;
  boardTo: string;
  /** The exact segment to cancel, with its own full un-clipped range. */
  block: ReservationBoardOperationalBlock;
  roomNumber: string;
}

/**
 * Returns `null` — and no cancel may be offered — unless the board is for the
 * Property currently selected and still shows this exact segment: same
 * `segmentId`, same `segmentVersion`, same room and the same `[startDate,
 * endDate)` that were clicked.
 */
export function buildBlockCancelTarget(
  board: ReservationBoardResponse,
  selectedPropertyId: string | null,
  selection: BlockSelection
): BlockCancelTarget | null {
  if (selectedPropertyId === null || board.property.id !== selectedPropertyId) return null;

  const clicked = selection.block;
  const block = board.operationalBlocks.find(
    (candidate) =>
      candidate.segmentId === clicked.segmentId &&
      candidate.segmentVersion === clicked.segmentVersion &&
      candidate.physicalRoomId === clicked.physicalRoomId &&
      candidate.startDate === clicked.startDate &&
      candidate.endDate === clicked.endDate
  );
  if (!block) return null;

  const room = board.physicalRooms.find((candidate) => candidate.id === block.physicalRoomId);
  // A room going out of service must never strand a block that already exists,
  // so the room's operationalStatus is deliberately not checked here.
  if (!room) return null;

  return {
    propertyId: board.property.id,
    propertyName: board.property.name,
    boardKey: boardIdentityKey(board.property.id, board.from, board.to),
    boardFrom: board.from,
    boardTo: board.to,
    block,
    roomNumber: room.roomNumber,
  };
}
