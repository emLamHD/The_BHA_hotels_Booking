/**
 * PMS-CAL-003-CP03: the pure seam between an authoritative `BlockMoveTarget` (CP02), the dialog's
 * `BlockMoveIntent` and the one block-move request the board may send. `ReservationBoard.tsx` owns the
 * pending-write record, the activity tracking and the reconciliation entry; this module owns every decision
 * that can be made from data alone, so each is testable without a browser:
 *
 * 1. `evaluateBlockMoveOffer` — whether the popover may offer the action for a clicked block right now, and
 *    why not. It also builds the target, so a selection that no longer matches the board offers nothing.
 * 2. `planBlockMoveSend` — everything re-checked immediately before the wire, against the board as it is
 *    *now* (never the opener's snapshot): the view is still the board the dialog was opened from, the exact
 *    source segment is still there (header, id, version, room, full range), the destination is still one of
 *    the board's Active rooms other than the source, and the reason fits the server's limit. The request body
 *    is built field by field from the verified target — never from the form — and carries no actor, evidence,
 *    role, dates, header or confirmation.
 * 3. `checkBlockMoveLocks` — the unresolved-write locks that refuse an offer or a send.
 *
 * Pure: no API call, no state, no clock. Nothing here guesses whether a room is free, whether its room type
 * has capacity left or what the server will answer; overlap, final capacity (a different RoomType included)
 * and the version are the server's decisions, so a refusal for any of them is a `409`, never an inference.
 * Permissions are not decided here either: the board reads them live (`capabilitiesAt`) before it calls this.
 */

import type { MoveOperationalBlockRequest, ReservationBoardResponse } from "@/lib/api/types";
import { boardIdentityKey } from "./assignmentTarget";
import {
  isBlockSegmentWriteUnresolved,
  isBoardAwaitingBlockReconciliation,
  type BlockCreateReconciliation,
  type BlockMoveReconciliationTarget,
} from "./blockCreateReconciliation";
import {
  MAX_BLOCK_MOVE_NIGHTS,
  buildBlockMoveTarget,
  type BlockMoveRoomCandidate,
  type BlockMoveTarget,
} from "./blockMoveTarget";
import { isBoardAwaitingReconciliation, isRoomRangeUnresolved, type Reconciliation } from "./reconciliation";
import type { BlockSelection } from "./ReservationBoardServerTimeline";
import { gregorianDayNumber } from "./splitMoveTarget";

/** The backend's limit on a reason (`SchedulingFieldLimits.Reason`), counted in UTF-16 code units like .NET. */
export const BLOCK_MOVE_REASON_MAX_LENGTH = 500;

/**
 * What the operator chose, already validated. The parent builds the request from the target and live state;
 * nothing here names a Property, segment, version, header, dates, actor, role or evidence.
 */
export interface BlockMoveIntent {
  destinationPhysicalRoomId: string;
  /** Trimmed by the dialog and again by the plan; absent when blank. */
  reason?: string;
}

/** A block-move dialog outlived the board (Property or range) it was opened from. */
export const STALE_BLOCK_MOVE_DIALOG_MESSAGE =
  "The board changed after this move was opened. Nothing was sent; start the block move again from the board on screen.";

/** The last request was refused by the server without changing anything, and the board has since changed. */
export const REJECTED_BLOCK_MOVE_THEN_BOARD_CHANGED_MESSAGE =
  "The server did not accept the last block-move request, so nothing was changed. The board has changed; start the move again from the board on screen.";

/** The block or the destination room is no longer what the dialog was built from. */
export const BLOCK_MOVE_SOURCE_CHANGED_MESSAGE =
  "This block has changed on the server since the move was opened. Nothing was sent; reload the board and start again.";

export const BLOCK_WRITE_LOCKED_MESSAGE =
  "An earlier request for this block, or for these rooms on overlapping nights, is still unconfirmed. Nothing was sent; check the board again before sending another.";

export const BLOCK_MOVE_AWAITING_REREAD_MESSAGE =
  "The board is waiting to be re-read after an earlier change. Nothing was sent; try again once it has been reloaded.";

export const BLOCK_MOVE_ALREADY_SENDING_MESSAGE =
  "A block-move request is already waiting for the server. Nothing new was sent.";

export const BLOCK_MOVE_NO_ROOM_MESSAGE = "Choose one of the listed rooms. Nothing was sent.";

const BLOCK_MOVE_NO_CANDIDATES_REASON = "No other Active room is available on this Property to take this block.";

export interface BlockMoveLists {
  assignments: Reconciliation[];
  blocks: BlockCreateReconciliation[];
}

/** Why the action is unavailable for a clicked block, or `null` when it is offered. */
export interface BlockMoveOffer {
  /** Built only when the selection still matches the board exactly; also built when only a lock refuses it. */
  target: BlockMoveTarget | null;
  unavailableReason: string | null;
}

export interface BlockMoveOfferInput extends BlockMoveLists {
  board: ReservationBoardResponse | null;
  selectedPropertyId: string | null;
  /** The identity the view shows right now (`currentBoardKeyRef`); the board on screen must be that one. */
  currentBoardKey: string | null;
  selection: BlockSelection;
}

/**
 * The locks a send is refused for, in one place so the popover and the handler cannot disagree. Cancel and move
 * of one block segment consume the same version, so an unresolved write on that segment id blocks both —
 * whatever rooms or nights it names. The source room keeps (or, if the request did not commit, still holds)
 * every night of its own range, and the destination — once chosen — receives that same range.
 *
 * An unresolved write is answered before a board that merely awaits its re-read: it is the more precise
 * reason ("an earlier request is still unconfirmed"), and a re-read alone may not lift it.
 */
export function checkBlockMoveLocks(lists: BlockMoveLists, target: BlockMoveTarget, destinationId?: string): string | null {
  const { propertyId, block } = target;
  const fullRange = { startDate: block.startDate, endDate: block.endDate };
  if (isBlockSegmentWriteUnresolved(lists.blocks, propertyId, block.segmentId)) return BLOCK_WRITE_LOCKED_MESSAGE;
  const rooms = destinationId === undefined ? [block.physicalRoomId] : [block.physicalRoomId, destinationId];
  if (isRoomRangeUnresolved(lists.assignments, lists.blocks, propertyId, rooms, fullRange)) return BLOCK_WRITE_LOCKED_MESSAGE;
  if (
    isBoardAwaitingReconciliation(lists.assignments, target.boardKey) ||
    isBoardAwaitingBlockReconciliation(lists.blocks, target.boardKey)
  ) {
    return BLOCK_MOVE_AWAITING_REREAD_MESSAGE;
  }
  return null;
}

/** Why `buildBlockMoveTarget` produced nothing, in words an operator can act on. */
function whyNoTarget(board: ReservationBoardResponse, selection: BlockSelection): string {
  const clicked = selection.block;
  const matches = board.operationalBlocks.filter((candidate) => candidate.segmentId === clicked.segmentId);
  const block = matches.length === 1 ? matches[0] : undefined;
  if (
    block === undefined ||
    block.roomBlockId !== clicked.roomBlockId ||
    block.segmentVersion !== clicked.segmentVersion ||
    block.physicalRoomId !== clicked.physicalRoomId ||
    block.startDate !== clicked.startDate ||
    block.endDate !== clicked.endDate
  ) {
    return BLOCK_MOVE_SOURCE_CHANGED_MESSAGE;
  }
  const start = gregorianDayNumber(block.startDate);
  const end = gregorianDayNumber(block.endDate);
  if (start === null || end === null || end - start < 1) {
    return "This block's date range is not valid, so it cannot be moved. It can still be cancelled.";
  }
  if (end - start > MAX_BLOCK_MOVE_NIGHTS) {
    return `This block is longer than ${MAX_BLOCK_MOVE_NIGHTS} nights, so it cannot be moved in one step. It can still be cancelled.`;
  }
  return BLOCK_MOVE_SOURCE_CHANGED_MESSAGE;
}

/**
 * Whether the popover may offer a block move for this clicked block, built from the board on screen. The
 * caller does not offer the action at all for a role without `BlockWrite`; that is "absent", not
 * "unavailable". Everything else that refuses it right now is a reason here.
 */
export function evaluateBlockMoveOffer(input: BlockMoveOfferInput): BlockMoveOffer {
  const { board, selection } = input;
  if (board === null) return { target: null, unavailableReason: "The board is not loaded." };
  if (input.currentBoardKey !== boardIdentityKey(board.property.id, board.from, board.to)) {
    return { target: null, unavailableReason: "The board on screen is out of date. Wait for it to finish loading." };
  }
  const target = buildBlockMoveTarget(board, input.selectedPropertyId, selection);
  if (target === null) return { target: null, unavailableReason: whyNoTarget(board, selection) };
  const locked = checkBlockMoveLocks(input, target);
  if (locked !== null) {
    return {
      target,
      unavailableReason:
        locked === BLOCK_MOVE_AWAITING_REREAD_MESSAGE
          ? "Unavailable until the board has been re-read after the last change."
          : "An earlier move or cancel of this block, or of its room on overlapping nights, is still unconfirmed — try again once it settles.",
    };
  }
  if (target.candidateRooms.length === 0) return { target, unavailableReason: BLOCK_MOVE_NO_CANDIDATES_REASON };
  return { target, unavailableReason: null };
}

export interface BlockMoveSendInput extends BlockMoveLists {
  /** The target the dialog was opened with; only its identity is used, never its room list or dates. */
  opened: BlockMoveTarget;
  intent: BlockMoveIntent;
  /** The board on screen right now, or `null` while none is loaded. */
  board: ReservationBoardResponse | null;
  /** The identity the view shows right now, read live (`currentBoardKeyRef`). */
  currentBoardKey: string | null;
}

export interface BlockMoveSendPlan {
  propertyId: string;
  segmentId: string;
  /** Exactly the contract fields; `reason` only when there is one. */
  request: MoveOperationalBlockRequest;
  /** Rebuilt from the board at send time. */
  target: BlockMoveTarget;
  destination: BlockMoveRoomCandidate;
  writeTarget: BlockMoveReconciliationTarget;
}

export type BlockMoveSendResult =
  | { ok: true; plan: BlockMoveSendPlan }
  | { ok: false; message: string; /** The dialog can no longer be confirmed against the screen and should close. */ stale: boolean };

const refuse = (message: string, stale = false): BlockMoveSendResult => ({ ok: false, message, stale });

/**
 * Re-checks, against the board as it is now, everything the dialog decided when it was open, and builds the
 * request. Returns a refusal — which means nothing may be recorded or sent — or the plan.
 */
export function planBlockMoveSend(input: BlockMoveSendInput): BlockMoveSendResult {
  const { opened, intent, board } = input;

  // The view must still be the board the dialog was opened from, and that board must be loaded.
  if (
    input.currentBoardKey !== opened.boardKey ||
    board === null ||
    boardIdentityKey(board.property.id, board.from, board.to) !== opened.boardKey
  ) {
    return refuse(STALE_BLOCK_MOVE_DIALOG_MESSAGE, true);
  }

  // The exact source segment must still be on that board with the clicked header, id, version, room and
  // range. Anything else means the dialog's choices were made for a block that is no longer there.
  const target = buildBlockMoveTarget(board, opened.propertyId, { block: opened.block, roomNumber: opened.sourceRoomNumber });
  if (target === null) return refuse(BLOCK_MOVE_SOURCE_CHANGED_MESSAGE, true);

  // Only a room the board still offers — Active and not the source — can take the block.
  const destination =
    typeof intent.destinationPhysicalRoomId === "string"
      ? target.candidateRooms.find((room) => room.id === intent.destinationPhysicalRoomId)
      : undefined;
  if (!destination) return refuse(BLOCK_MOVE_NO_ROOM_MESSAGE);

  if (intent.reason !== undefined && typeof intent.reason !== "string") return refuse("The reason must be text. Nothing was sent.");
  const reason = intent.reason?.trim() ?? "";
  if (reason.length > BLOCK_MOVE_REASON_MAX_LENGTH) {
    return refuse(`The reason can be at most ${BLOCK_MOVE_REASON_MAX_LENGTH} characters. Nothing was sent.`);
  }

  const locked = checkBlockMoveLocks({ assignments: input.assignments, blocks: input.blocks }, target, destination.id);
  if (locked !== null) return refuse(locked);

  const { block } = target;
  return {
    ok: true,
    plan: {
      propertyId: target.propertyId,
      segmentId: block.segmentId,
      request: {
        expectedVersion: block.segmentVersion,
        destinationPhysicalRoomId: destination.id,
        ...(reason !== "" ? { reason } : {}),
      },
      target,
      destination,
      writeTarget: {
        operation: "move",
        roomBlockId: block.roomBlockId,
        segmentId: block.segmentId,
        expectedVersion: block.segmentVersion,
        sourcePhysicalRoomId: block.physicalRoomId,
        sourceRoomNumber: target.sourceRoomNumber,
        physicalRoomId: destination.id,
        roomNumber: destination.roomNumber,
        // The source's own full, un-clipped range — never the visible window.
        startDate: block.startDate,
        endDate: block.endDate,
      },
    },
  };
}
