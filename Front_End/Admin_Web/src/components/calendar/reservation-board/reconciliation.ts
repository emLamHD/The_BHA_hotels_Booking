/**
 * PMS-CAL-001.2-CP03A-C1/C2: tracking what the board may conclude after a
 * write, from authoritative reads only.
 *
 * Two independent questions are answered here, and they must never be merged:
 *
 * 1. Is the board current? (`status`) — has a read of the written board's
 *    identity (Property + visible `[from, to)`, `key`) that was issued after
 *    the write resolved (`seq > afterSeq`) completed? A request already in
 *    flight may have been answered from pre-write data, and a read of any
 *    other Property or range says nothing about that board.
 *
 * 2. Is the write's effect known? (`resolution`, C2) — for a `201`/`200` or a
 *    `409` the server decided before it answered: the store commits or rolls
 *    back inside its transaction and only then responds, so a later read
 *    observes the settled outcome and question 1 is enough
 *    (`certainty: "settled"`). For a lost response — timeout, network
 *    failure, abort, `5xx` — the transaction may still be running when the
 *    next read executes, so a read that does not show the destination is
 *    *not* evidence of rollback (`certainty: "uncertain"`). Such a write
 *    resolves only on evidence in an authoritative board, destination checked
 *    before source:
 *    - `observed`: the intended destination is on the server — same
 *      ReservationUnit, same destination PhysicalRoom, exactly
 *      `[startDate, endDate)`. This says the assignment exists, not that the
 *      lost request was the one that produced it.
 *    - `changed`: PMS-CAL-001.2-CP04C.3 — for a **create**, the
 *      ReservationUnit no longer has those exact nights uncovered (another
 *      committed assignment covers some of them, or the Unit is no longer a
 *      committed stay); for a **move**, the source segment's own identity —
 *      `segmentId`, `expectedVersion`, its current room, its own range — no
 *      longer matches exactly (superseded, unassigned, or moved by something
 *      else). Either way the lost write can then never take effect: a create
 *      is refused by the database's overlap rule or the store's
 *      non-committed-Unit check, and a move's optimistic-concurrency check
 *      refuses a stale `expectedVersion` — so the write is no longer a
 *      candidate for a duplicate.
 *    Otherwise it stays `unresolved`, however many reads follow.
 */

import type { ReservationBoardResponse, ReservationBoardUnassignedRange } from "@/lib/api/types";

interface ReconciliationTargetBase {
  reservationUnitId: string;
  /** Destination PhysicalRoom: the room being assigned (create) or moved to (move). */
  physicalRoomId: string;
  startDate: string;
  endDate: string;
  roomNumber: string;
  guestDisplayName: string;
  confirmationNumber: string;
}

export interface CreateReconciliationTarget extends ReconciliationTargetBase {
  operation: "create";
}

/**
 * PMS-CAL-001.2-CP04C.3: a move never changes dates (CP04B's contract
 * requires the replacement to occupy exactly the source segment's own
 * current range), so `startDate`/`endDate` above already describe both the
 * source and destination range — only the room differs between them.
 */
export interface MoveReconciliationTarget extends ReconciliationTargetBase {
  operation: "move";
  /** Source segment identity/version exactly as clicked — what "changed" is judged against. */
  segmentId: string;
  expectedVersion: number;
  /** Source segment's own current room before the move. */
  sourcePhysicalRoomId: string;
}

export type ReconciliationTarget = CreateReconciliationTarget | MoveReconciliationTarget;

export interface Reconciliation {
  id: number;
  /** Board identity the write was made from: `propertyId|from|to`. */
  key: string;
  propertyId: string;
  from: string;
  to: string;
  /** The last board request sequence number issued before the write resolved. */
  afterSeq: number;
  certainty: "settled" | "uncertain";
  target: ReconciliationTarget;
  /** Whether the written board has been re-read since the write. */
  status: "pending" | "done" | "failed";
  /** Settled writes are always `settled`; uncertain writes start `unresolved`. */
  resolution: "settled" | "unresolved" | "observed" | "changed";
}

function containsRange(outer: { startDate: string; endDate: string }, inner: { startDate: string; endDate: string }) {
  return outer.startDate <= inner.startDate && outer.endDate >= inner.endDate;
}

function overlapsRange(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  return a.startDate < b.endDate && b.startDate < a.endDate;
}

/**
 * What one authoritative board says about an uncertain write, or `null` when
 * that board cannot say anything (another Property, or a window that does not
 * include every night of the write — for a move this is the same window test
 * as create's, since source and destination share one range).
 */
export function evaluateUncertainWrite(
  entry: Reconciliation,
  board: ReservationBoardResponse
): "unresolved" | "observed" | "changed" | null {
  const { target } = entry;
  if (board.property.id !== entry.propertyId) return null;
  if (!containsRange({ startDate: board.from, endDate: board.to }, target)) return null;

  const stay = board.stays.find((candidate) => candidate.reservationUnitId === target.reservationUnitId);

  // Destination checked first, regardless of operation: if the intended
  // placement itself is on the server, the write's effect is known.
  const observed =
    stay?.assignments.some(
      (assignment) =>
        assignment.physicalRoomId === target.physicalRoomId &&
        assignment.startDate === target.startDate &&
        assignment.endDate === target.endDate
    ) ?? false;
  if (observed) return "observed";

  if (target.operation === "move") {
    // PMS-CAL-001.2-CP04C.3: the source segment is still a candidate to
    // commit only while every part of its clicked identity — id, version,
    // room, range — still matches exactly. Any mismatch (superseded,
    // unassigned, or moved by something else) means the stale
    // `expectedVersion` this write carries can never take effect again.
    const sourceIntact =
      stay?.assignments.some(
        (assignment) =>
          assignment.segmentId === target.segmentId &&
          assignment.segmentVersion === target.expectedVersion &&
          assignment.physicalRoomId === target.sourcePhysicalRoomId &&
          assignment.startDate === target.startDate &&
          assignment.endDate === target.endDate
      ) ?? false;
    return sourceIntact ? "unresolved" : "changed";
  }

  // create: still a candidate only while every night of the write is still uncovered.
  const stillUncovered = stay?.unassignedRanges.some((range) => containsRange(range, target)) ?? false;
  return stillUncovered ? "unresolved" : "changed";
}

/**
 * Applies one committed board read (request `seq` for board `key`) to the
 * tracked reconciliations. A `loaded` read carries its board so uncertain
 * writes can be judged on evidence; a failed read carries none and can never
 * resolve anything. Returns the same array when nothing changes.
 */
export function settleReconciliations(
  list: Reconciliation[],
  key: string,
  seq: number,
  result: { kind: "loaded"; board: ReservationBoardResponse } | { kind: "failed" }
): Reconciliation[] {
  let changed = false;
  const next = list.map((entry) => {
    if (entry.afterSeq >= seq) return entry;
    let updated = entry;

    if (entry.key === key) {
      if (result.kind === "loaded" && entry.status !== "done") {
        updated = { ...updated, status: "done" };
      } else if (result.kind === "failed" && entry.status === "pending") {
        updated = { ...updated, status: "failed" };
      }
    }

    if (result.kind === "loaded" && updated.resolution === "unresolved") {
      const verdict = evaluateUncertainWrite(updated, result.board);
      if (verdict && verdict !== "unresolved") {
        updated = { ...updated, resolution: verdict };
      }
    }

    if (updated !== entry) changed = true;
    return updated;
  });
  return changed ? next : list;
}

/** True while any write concerning exactly this board has not been re-read. */
export function isBoardAwaitingReconciliation(list: Reconciliation[], key: string): boolean {
  return list.some((entry) => entry.key === key && entry.status !== "done");
}

/**
 * True while an uncertain write for this ReservationUnit on this Property,
 * overlapping these nights, is unresolved — on any board, whatever its range.
 */
export function isUnassignedRangeUnresolved(
  list: Reconciliation[],
  propertyId: string,
  reservationUnitId: string,
  range: ReservationBoardUnassignedRange
): boolean {
  return list.some(
    (entry) =>
      entry.resolution === "unresolved" &&
      entry.propertyId === propertyId &&
      entry.target.reservationUnitId === reservationUnitId &&
      overlapsRange(entry.target, range)
  );
}

/**
 * PMS-CAL-001.2-CP04C.3: true while an uncertain move whose source is
 * exactly this segment is unresolved — on any board, whatever its range.
 * Matches on `segmentId` alone (not version/room/range): once a segment has
 * an unresolved move in flight for it, re-opening a move dialog for that
 * same segment id is refused outright rather than left to a version/range
 * comparison, since a fresh click could otherwise build a second target from
 * whatever the board currently (and possibly still pre-write) shows.
 *
 * Never locks a create reconciliation, a different segment (even one on the
 * same ReservationUnit), or an unrelated unassigned range — `operation` and
 * `segmentId` alone decide the match, independent of everything
 * `isUnassignedRangeUnresolved` above checks.
 */
export function isSegmentMoveUnresolved(list: Reconciliation[], propertyId: string, segmentId: string): boolean {
  return list.some(
    (entry) =>
      entry.resolution === "unresolved" &&
      entry.propertyId === propertyId &&
      entry.target.operation === "move" &&
      entry.target.segmentId === segmentId
  );
}
