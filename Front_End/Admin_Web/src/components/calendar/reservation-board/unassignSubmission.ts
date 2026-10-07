/**
 * PMS-CAL-001.2-CP04D.4C.2A: the pure seam between an authoritative
 * `UnassignTarget` and the two things a board must do around one unassign
 * attempt, so `ReservationBoard.tsx` (a later checkpoint) does not have to
 * rebuild these invariants inline the way `submitMove` does for move:
 *
 * 1. `buildUnassignRequest` — the exact arguments of
 *    `unassignReservationAssignment`: Property and segment from the target,
 *    the target's own `segmentVersion` as `expectedVersion`, and `reason`
 *    only when there is a real one. Nothing else — no actor, no authorization
 *    evidence, no dates (an unassign carries none).
 * 2. `planUnassignReconciliation` — whether the outcome needs the board to
 *    re-read and be tracked, and if so the exact entry to track. Whether a
 *    re-read is needed is `describeUnassignOutcome`'s decision (`reloadBoard`),
 *    never a second HTTP table here. A lost response (`unknown`) is
 *    `uncertain`/`unresolved` — the write may or may not have committed, so it
 *    is never claimed to have succeeded or rolled back — while a `200` or a
 *    `409` was decided before the response and is `settled`.
 *
 * Pure: no API call, no retry, no state, and neither the target nor the
 * outcome is mutated. The only runtime facts the caller must supply are the
 * entry `id` and `afterSeq` (the last board request issued before the write
 * resolved) — both live in `ReservationBoard.tsx`'s refs, not here.
 */

import type { UnassignAssignmentOutcome } from "@/lib/api/client";
import type { UnassignReservationAssignmentRequest } from "@/lib/api/types";
import { describeUnassignOutcome } from "./assignmentOutcome";
import type { Reconciliation } from "./reconciliation";
import type { UnassignTarget } from "./unassignTarget";

export interface UnassignRequestPlan {
  propertyId: string;
  segmentId: string;
  request: UnassignReservationAssignmentRequest;
}

/** `reason` is trimmed, and omitted entirely when blank, so an empty string never reaches the wire. */
export function buildUnassignRequest(target: UnassignTarget, reason?: string): UnassignRequestPlan {
  const trimmedReason = reason?.trim();
  return {
    propertyId: target.propertyId,
    segmentId: target.segment.segmentId,
    request: {
      expectedVersion: target.segment.segmentVersion,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    },
  };
}

/**
 * Returns the reconciliation entry to track for this outcome, or `null` when
 * the outcome needs none (not sent, validation, gate refusal, any other
 * refusal — nothing was, or may have been, written).
 */
export function planUnassignReconciliation(
  target: UnassignTarget,
  outcome: UnassignAssignmentOutcome,
  runtime: { id: number; afterSeq: number }
): Reconciliation | null {
  if (!describeUnassignOutcome(outcome).reloadBoard) return null;

  const uncertain = outcome.kind === "unknown";
  return {
    id: runtime.id,
    key: target.boardKey,
    propertyId: target.propertyId,
    from: target.boardFrom,
    to: target.boardTo,
    afterSeq: runtime.afterSeq,
    certainty: uncertain ? "uncertain" : "settled",
    target: {
      operation: "unassign",
      reservationUnitId: target.stay.reservationUnitId,
      // The segment's own full, un-clipped range — never the board window.
      startDate: target.segment.startDate,
      endDate: target.segment.endDate,
      roomNumber: target.currentRoomNumber,
      guestDisplayName: target.stay.guestDisplayName,
      confirmationNumber: target.stay.confirmationNumber,
      segmentId: target.segment.segmentId,
      expectedVersion: target.segment.segmentVersion,
      sourcePhysicalRoomId: target.segment.physicalRoomId,
    },
    status: "pending",
    resolution: uncertain ? "unresolved" : "settled",
  };
}
