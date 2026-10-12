/**
 * PMS-CAL-003-CP02: turns one clicked operational-block bar into the exact segment a block move may act
 * on, or refuses to produce a target at all. Pure and read-only, like `blockCancelTarget.ts`: no API
 * call, no mutation of its inputs, and it reads no permission, session, clock or storage — a later
 * dialog (CP03) re-validates against the live board at send time. Nothing here infers whether a move is
 * a good idea or whether it will fit: overlap, final capacity (a different RoomType included) and the
 * version are the server's decisions, so a candidate list is a list of Active rooms, never a promise
 * that any of them is free or has capacity.
 *
 * Everything comes from the authoritative board snapshot the bar was rendered from, never from the
 * rendered grid: `ReservationBoardOperationalBlock` already carries the segment's own full
 * `[startDate, endDate)`, so a block that runs past the visible window is reported verbatim rather than
 * clipped. The move keeps those exact nights and the block's RoomBlock header; only the room changes.
 *
 * The exact-match check against the clicked selection (header, segment identity, version, room and range
 * at once) is what makes a stale selection refuse to produce a target instead of silently substituting
 * a look-alike segment. The dates are checked as real Gregorian days 0001–9999 with integer arithmetic
 * (`gregorianDayNumber`), not with `dateMath.ts`, whose `Date.UTC` maps years 0–99 onto 1900–1999; the
 * server's strings are carried unchanged. The server moves at most 366 nights in one request
 * (PMS-CAL-003-CP01), so a longer segment produces no target.
 */

import type { ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";
import { boardIdentityKey } from "./assignmentTarget";
import type { BlockSelection } from "./ReservationBoardServerTimeline";
import { gregorianDayNumber } from "./splitMoveTarget";

/** The backend refuses a source longer than this in one move; mirrored so no dialog offers an impossible one. */
export const MAX_BLOCK_MOVE_NIGHTS = 366;
const MAX_UINT32 = 4_294_967_295;

export interface BlockMoveRoomCandidate {
  id: string;
  roomNumber: string;
  floor: number;
  roomTypeId: string;
  roomTypeName: string;
  /** A fact about the room, not a verdict: the destination may still be refused for capacity either way. */
  sameRoomTypeAsSource: boolean;
}

export interface BlockMoveTarget {
  propertyId: string;
  propertyName: string;
  /** The board read this target was built from: `propertyId|from|to`. */
  boardKey: string;
  boardFrom: string;
  boardTo: string;
  /** The exact segment to move, with its own full un-clipped range and its RoomBlock header id and reason. */
  block: ReservationBoardOperationalBlock;
  /** The segment's nights, `end − start`, 1…{@link MAX_BLOCK_MOVE_NIGHTS}. */
  nights: number;
  sourceRoomNumber: string;
  /** The source room's `operationalStatus` as the board says it — it may no longer be Active, and that is fine. */
  sourceRoomOperationalStatus: string;
  sourceRoomTypeId: string;
  sourceRoomTypeName: string;
  /** Every Active room of this Property except the source room, in board order. Free-ness is never inferred. */
  candidateRooms: BlockMoveRoomCandidate[];
}

/** True for an integer version in the backend's `uint` range. */
function isUintVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

/**
 * Returns `null` — and no block move may be offered — unless the board is for the Property currently
 * selected and still shows this exact segment: same `roomBlockId`, `segmentId`, `segmentVersion`, room and
 * `[startDate, endDate)` that were clicked, once; its version a `uint`; its dates real Gregorian days; its
 * range 1…366 nights; and its room present on the board.
 */
export function buildBlockMoveTarget(
  board: ReservationBoardResponse,
  selectedPropertyId: string | null,
  selection: BlockSelection
): BlockMoveTarget | null {
  if (selectedPropertyId === null || board.property.id !== selectedPropertyId) return null;

  const clicked = selection.block;
  const matches = board.operationalBlocks.filter((candidate) => candidate.segmentId === clicked.segmentId);
  // One segment id is one segment; two rows claiming it is a board this code cannot trust.
  if (matches.length !== 1) return null;
  const block = matches[0];
  if (
    block.roomBlockId !== clicked.roomBlockId ||
    block.segmentVersion !== clicked.segmentVersion ||
    block.physicalRoomId !== clicked.physicalRoomId ||
    block.startDate !== clicked.startDate ||
    block.endDate !== clicked.endDate
  ) {
    return null;
  }

  if (!isUintVersion(block.segmentVersion)) return null;
  const start = gregorianDayNumber(block.startDate);
  const end = gregorianDayNumber(block.endDate);
  if (start === null || end === null) return null;
  const nights = end - start;
  if (nights < 1 || nights > MAX_BLOCK_MOVE_NIGHTS) return null;

  // A room going out of service must never strand a block that already exists, so the source room's
  // operationalStatus is deliberately not required to be Active — only its presence on the board is.
  const sourceRoom = board.physicalRooms.find((room) => room.id === block.physicalRoomId);
  if (!sourceRoom) return null;

  const roomTypeName = (roomTypeId: string) =>
    board.roomTypes.find((roomType) => roomType.id === roomTypeId)?.name ?? "Unknown room type";

  return {
    propertyId: board.property.id,
    propertyName: board.property.name,
    boardKey: boardIdentityKey(board.property.id, board.from, board.to),
    boardFrom: board.from,
    boardTo: board.to,
    block,
    nights,
    sourceRoomNumber: sourceRoom.roomNumber,
    sourceRoomOperationalStatus: sourceRoom.operationalStatus,
    sourceRoomTypeId: sourceRoom.roomTypeId,
    sourceRoomTypeName: roomTypeName(sourceRoom.roomTypeId),
    candidateRooms: board.physicalRooms
      .filter((room) => room.operationalStatus === "Active" && room.id !== sourceRoom.id)
      .map((room) => ({
        id: room.id,
        roomNumber: room.roomNumber,
        floor: room.floor,
        roomTypeId: room.roomTypeId,
        roomTypeName: roomTypeName(room.roomTypeId),
        sameRoomTypeAsSource: room.roomTypeId === sourceRoom.roomTypeId,
      })),
  };
}
