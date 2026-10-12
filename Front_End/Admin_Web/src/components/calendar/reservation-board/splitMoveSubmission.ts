/**
 * PMS-CAL-002-CP05: the pure seam between an authoritative `SplitMoveTarget`
 * (CP03), the dialog's `SplitMoveIntent` (CP04) and the one split-move request
 * the board may send. `ReservationBoard.tsx` owns the pending-write record, the
 * activity tracking and the reconciliation entry; this module owns every decision
 * that can be made from data alone, so each is testable without a browser:
 *
 * 1. `evaluateSplitMoveOffer` — whether the popover may offer the action for a
 *    clicked segment right now, and why not. It also builds the target, so a
 *    selection that no longer matches the board offers nothing.
 * 2. `planSplitMoveSend` — everything re-checked immediately before the wire,
 *    against the board as it is *now* (never the opener's snapshot): the board is
 *    the one the dialog was opened from, the exact source segment is still there
 *    (id, version, room, full range), the date is a real Gregorian date strictly
 *    inside it, the destination is still one of the board's Active rooms other
 *    than the source (D2), the cross-RoomType need is re-derived for the prefix
 *    AND the suffix from the board's own RoomTypes (D1), and the past-date
 *    acknowledgement is judged against the Property's *current* `localToday` (D4).
 *    The request body is built field by field from the verified target — never
 *    from the form — and carries no actor, evidence, role or acknowledgement.
 * 3. `checkSplitMoveLocks` — the unresolved-write locks that refuse a send.
 *
 * Pure: no API call, no state, no clock. Nothing here guesses whether a room is
 * free, how many nights fit, or what a past date means for the stay (D6); the
 * server decides capacity and overlap.
 */

import type { ReservationBoardResponse, SplitMoveReservationAssignmentRequest } from "@/lib/api/types";
import { boardIdentityKey, type AssignmentRoomCandidate } from "./assignmentTarget";
import {
  isBoardAwaitingBlockReconciliation,
  type BlockCreateReconciliation,
} from "./blockCreateReconciliation";
import {
  isBoardAwaitingReconciliation,
  isRoomRangeUnresolved,
  isSegmentAssignmentWriteUnresolved,
  isUnassignedRangeUnresolved,
  type Reconciliation,
  type SplitMoveReconciliationTarget,
} from "./reconciliation";
import { SPLIT_MOVE_REASON_MAX_LENGTH, type SplitMoveIntent } from "./ReservationSplitMoveDialog";
import type { AssignedSegmentSelection } from "./ReservationBoardServerTimeline";
import { checkSplitDate, compareSplitDateToToday, splitDateBounds } from "./splitMoveDates";
import { buildSplitMoveTarget, type SplitMoveTarget } from "./splitMoveTarget";

/** A split-move dialog outlived the board (Property or range) it was opened from. */
export const STALE_SPLIT_MOVE_DIALOG_MESSAGE =
  "The board changed after this split-move was opened. Nothing was sent; start the split-move again from the board on screen.";

/** The last request was rejected by the server, so nothing changed, and the board has since changed. */
export const REJECTED_SPLIT_MOVE_THEN_BOARD_CHANGED_MESSAGE =
  "The server rejected the last split-move request, so nothing was changed. The board has changed; start the split-move again from the board on screen.";

/** The source segment, the stay or a destination room is no longer what the dialog was built from. */
export const SPLIT_MOVE_SOURCE_CHANGED_MESSAGE =
  "This stay has changed on the server since the split-move was opened. Nothing was sent; reload the board and start again.";

export const SPLIT_MOVE_ROOM_LOCKED_MESSAGE =
  "An earlier request for this stay or for these rooms on overlapping nights is still unconfirmed. Nothing was sent; check the board again before sending another.";

export const SPLIT_MOVE_AWAITING_REREAD_MESSAGE =
  "The board is waiting to be re-read after an earlier change. Nothing was sent; try again once it has been reloaded.";

export const SPLIT_MOVE_CROSS_NOT_PERMITTED_MESSAGE =
  "Splitting a stay so that a part is in a different room type than sold needs a Manager at this Property. Nothing was sent.";

export const SPLIT_MOVE_ALREADY_SENDING_MESSAGE =
  "A split-move request is already waiting for the server. Nothing new was sent.";

/** Why the action is unavailable for a clicked segment, or `null` when it is offered. */
export interface SplitMoveOffer {
  /** Built only when the selection still matches the board exactly; also built when only a lock refuses it. */
  target: SplitMoveTarget | null;
  unavailableReason: string | null;
}

export interface SplitMoveLists {
  assignments: Reconciliation[];
  blocks: BlockCreateReconciliation[];
}

export interface SplitMoveOfferInput extends SplitMoveLists {
  board: ReservationBoardResponse | null;
  selectedPropertyId: string | null;
  selection: AssignedSegmentSelection;
  /** The caller may confirm a cross-RoomType placement (Manager). */
  canConfirmCrossRoomType: boolean;
}

/** True when a segment's own range leaves one night on each side of some date. */
export function segmentCanBeSplit(segment: { startDate: string; endDate: string }): boolean {
  return splitDateBounds(segment.startDate, segment.endDate) !== null;
}

/** The locks a send is refused for, in one place so the popover and the handler cannot disagree. */
export function checkSplitMoveLocks(lists: SplitMoveLists, target: SplitMoveTarget): string | null {
  const { propertyId, segment, stay } = target;
  const fullRange = { startDate: segment.startDate, endDate: segment.endDate };
  if (
    isBoardAwaitingReconciliation(lists.assignments, target.boardKey) ||
    isBoardAwaitingBlockReconciliation(lists.blocks, target.boardKey)
  ) {
    return SPLIT_MOVE_AWAITING_REREAD_MESSAGE;
  }
  // A move, an unassign or a split-move in doubt on this segment: all three consume the same version.
  if (isSegmentAssignmentWriteUnresolved(lists.assignments, propertyId, segment.segmentId)) {
    return SPLIT_MOVE_ROOM_LOCKED_MESSAGE;
  }
  // The source room keeps (or, if the request did not commit, still holds) every night of its range.
  if (isRoomRangeUnresolved(lists.assignments, lists.blocks, propertyId, [segment.physicalRoomId], fullRange)) {
    return SPLIT_MOVE_ROOM_LOCKED_MESSAGE;
  }
  // Any unresolved write for this Unit over these nights.
  if (isUnassignedRangeUnresolved(lists.assignments, propertyId, stay.reservationUnitId, fullRange)) {
    return SPLIT_MOVE_ROOM_LOCKED_MESSAGE;
  }
  return null;
}

/** The destination takes `[splitDate, end)` only: the prefix nights never touch it. */
function destinationLock(lists: SplitMoveLists, target: SplitMoveTarget, destinationId: string, splitDate: string): string | null {
  return isRoomRangeUnresolved(lists.assignments, lists.blocks, target.propertyId, [destinationId], {
    startDate: splitDate,
    endDate: target.segment.endDate,
  })
    ? SPLIT_MOVE_ROOM_LOCKED_MESSAGE
    : null;
}

/**
 * Whether the popover may offer a split-move for this clicked segment, built from the board on
 * screen. The caller must not offer the action at all for a segment of fewer than two nights
 * (`segmentCanBeSplit`) or for a role that cannot change assignments; those are not "unavailable",
 * they are absent.
 */
export function evaluateSplitMoveOffer(input: SplitMoveOfferInput): SplitMoveOffer {
  const { board, selection } = input;
  if (board === null) return { target: null, unavailableReason: "The board is not loaded." };
  const target = buildSplitMoveTarget(board, input.selectedPropertyId, selection);
  if (target === null) return { target: null, unavailableReason: SPLIT_MOVE_SOURCE_CHANGED_MESSAGE };
  const locked = checkSplitMoveLocks(input, target);
  if (locked !== null) {
    return {
      target,
      unavailableReason:
        locked === SPLIT_MOVE_AWAITING_REREAD_MESSAGE
          ? "Unavailable until the board has been re-read after the last change."
          : "An earlier move, unassign or split-move of this stay or its room is still unconfirmed — try again once it settles.",
    };
  }
  if (target.currentRoomTypeId !== target.stay.soldRoomTypeId && !input.canConfirmCrossRoomType) {
    return {
      target,
      unavailableReason: "This stay is in a different room type than sold; splitting it needs a Manager.",
    };
  }
  return { target, unavailableReason: null };
}

export interface SplitMoveSendInput extends SplitMoveLists {
  /** The target the dialog was opened with; only its identity is used, never its room list or dates. */
  opened: SplitMoveTarget;
  intent: SplitMoveIntent;
  /** The board on screen right now, or `null` while none is loaded. */
  board: ReservationBoardResponse | null;
  /** The identity the view shows right now, read live (`currentBoardKeyRef`). */
  currentBoardKey: string | null;
  /** The caller's live permission to confirm a cross-RoomType placement. */
  canConfirmCrossRoomType: boolean;
}

export interface SplitMoveSendPlan {
  propertyId: string;
  segmentId: string;
  /** Exactly the five contract fields; `reason` only when there is one. */
  request: SplitMoveReservationAssignmentRequest;
  /** Rebuilt from the board at send time. */
  target: SplitMoveTarget;
  destination: AssignmentRoomCandidate;
  crossRoomType: boolean;
  writeTarget: SplitMoveReconciliationTarget;
}

export type SplitMoveSendResult =
  | { ok: true; plan: SplitMoveSendPlan }
  | { ok: false; message: string; /** The dialog can no longer be confirmed against the screen and should close. */ stale: boolean };

const refuse = (message: string, stale = false): SplitMoveSendResult => ({ ok: false, message, stale });

/**
 * Re-checks, against the board as it is now, everything the dialog decided when it was open, and
 * builds the request. Returns a refusal — which means nothing may be recorded or sent — or the plan.
 */
export function planSplitMoveSend(input: SplitMoveSendInput): SplitMoveSendResult {
  const { opened, intent, board } = input;

  // The view must still be the board the dialog was opened from, and that board must be loaded.
  if (
    input.currentBoardKey !== opened.boardKey ||
    board === null ||
    boardIdentityKey(board.property.id, board.from, board.to) !== opened.boardKey
  ) {
    return refuse(STALE_SPLIT_MOVE_DIALOG_MESSAGE, true);
  }

  // The exact source segment must still be on that board with the clicked id, version, room and range.
  const target = buildSplitMoveTarget(board, opened.propertyId, { stay: opened.stay, segment: opened.segment });
  if (target === null) return refuse(SPLIT_MOVE_SOURCE_CHANGED_MESSAGE);

  const check = checkSplitDate(target.segment.startDate, target.segment.endDate, intent.splitDate);
  if (check.kind !== "ok") {
    return refuse(
      check.kind === "out-of-range"
        ? `Choose a split date from ${check.min} to ${check.max}. Nothing was sent.`
        : "Choose a valid split date inside the stay's nights. Nothing was sent."
    );
  }

  // Only a room the board still offers — Active and not the source (D2) — can take the later nights.
  const destination = target.candidateRooms.find((room) => room.id === intent.destinationPhysicalRoomId);
  if (!destination) return refuse("Choose one of the listed rooms. Nothing was sent.");

  // D1: both parts are judged against the SOLD RoomType, from the board's own data.
  const sold = target.stay.soldRoomTypeId;
  const crossRoomType = target.currentRoomTypeId !== sold || destination.roomTypeId !== sold;
  const reason = intent.reason?.trim() ?? "";
  if (crossRoomType) {
    if (!input.canConfirmCrossRoomType) return refuse(SPLIT_MOVE_CROSS_NOT_PERMITTED_MESSAGE);
    if (!intent.confirmCrossRoomType) {
      return refuse("Confirm the placement in a different room type than sold before sending. Nothing was sent.");
    }
    if (reason === "") return refuse("Enter a reason for placing a part in a different room type. Nothing was sent.");
  }
  // D3: the reason is optional otherwise, but never over the server's limit.
  if (reason.length > SPLIT_MOVE_REASON_MAX_LENGTH) {
    return refuse(`The reason can be at most ${SPLIT_MOVE_REASON_MAX_LENGTH} characters. Nothing was sent.`);
  }

  // D4: against the Property's date as the board reports it now, never the browser's. A date that
  // cannot be compared is never treated as "not in the past".
  const against = compareSplitDateToToday(intent.splitDate, board.property.localToday);
  if (against === null) {
    return refuse("The Property's date is not valid, so the split date cannot be checked. Nothing was sent.");
  }
  if (against === "before" && !intent.pastDateAcknowledged) {
    return refuse("This split date is before the Property's current date. Acknowledge that before sending. Nothing was sent.");
  }

  const lists: SplitMoveLists = { assignments: input.assignments, blocks: input.blocks };
  const locked = checkSplitMoveLocks(lists, target) ?? destinationLock(lists, target, destination.id, intent.splitDate);
  if (locked !== null) return refuse(locked);

  return {
    ok: true,
    plan: {
      propertyId: target.propertyId,
      segmentId: target.segment.segmentId,
      request: {
        expectedVersion: target.segment.segmentVersion,
        splitDate: intent.splitDate,
        destinationPhysicalRoomId: destination.id,
        confirmCrossRoomType: crossRoomType,
        ...(reason !== "" ? { reason } : {}),
      },
      target,
      destination,
      crossRoomType,
      writeTarget: {
        operation: "split-move",
        reservationUnitId: target.stay.reservationUnitId,
        // The source's own full, un-clipped range — never the visible window and never the suffix.
        startDate: target.segment.startDate,
        endDate: target.segment.endDate,
        roomNumber: destination.roomNumber,
        guestDisplayName: target.stay.guestDisplayName,
        confirmationNumber: target.stay.confirmationNumber,
        physicalRoomId: destination.id,
        segmentId: target.segment.segmentId,
        expectedVersion: target.segment.segmentVersion,
        sourcePhysicalRoomId: target.segment.physicalRoomId,
        splitDate: intent.splitDate,
      },
    },
  };
}
