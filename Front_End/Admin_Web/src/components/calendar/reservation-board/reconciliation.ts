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
 *    PMS-CAL-001.2-CP04D.3: an **unassign** has no destination, so there is
 *    nothing to `observe` — an assignment elsewhere over the same range is
 *    never evidence of it. It is judged on the source segment alone, exactly
 *    like a move's source: `unresolved` while the segment still matches
 *    exactly, `changed` once it does not. `changed` then only says the stale
 *    `expectedVersion` can never commit again — not that the lost request
 *    succeeded, rolled back or caused the change.
 *    Otherwise it stays `unresolved`, however many reads follow.
 */

import type { ReservationBoardResponse, ReservationBoardUnassignedRange } from "@/lib/api/types";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";

interface ReconciliationTargetBase {
  reservationUnitId: string;
  startDate: string;
  endDate: string;
  roomNumber: string;
  guestDisplayName: string;
  confirmationNumber: string;
}

export interface CreateReconciliationTarget extends ReconciliationTargetBase {
  operation: "create";
  /** Destination PhysicalRoom: the room being assigned. */
  physicalRoomId: string;
}

/**
 * PMS-CAL-001.2-CP04C.3: a move never changes dates (CP04B's contract
 * requires the replacement to occupy exactly the source segment's own
 * current range), so `startDate`/`endDate` above already describe both the
 * source and destination range — only the room differs between them.
 */
export interface MoveReconciliationTarget extends ReconciliationTargetBase {
  operation: "move";
  /** Destination PhysicalRoom: the room being moved to. */
  physicalRoomId: string;
  /** Source segment identity/version exactly as clicked — what "changed" is judged against. */
  segmentId: string;
  expectedVersion: number;
  /** Source segment's own current room before the move. */
  sourcePhysicalRoomId: string;
}

/**
 * PMS-CAL-001.2-CP04D.3: a single-segment unassign. Like a move it carries the
 * segment's own full, un-clipped `[startDate, endDate)` and is judged against
 * its source identity — but it has no destination room (it is not a move to
 * an "unassigned room"), so `roomNumber` is the source room's.
 */
export interface UnassignReconciliationTarget extends ReconciliationTargetBase {
  operation: "unassign";
  /** Source segment identity/version exactly as clicked — what "changed" is judged against. */
  segmentId: string;
  expectedVersion: number;
  /** The segment's current room, the one being released. */
  sourcePhysicalRoomId: string;
}

export type ReconciliationTarget = CreateReconciliationTarget | MoveReconciliationTarget | UnassignReconciliationTarget;

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
 * PMS-CAL-001.2-CP04C.3-C2: the single authority for whether a board's own
 * Property + visible `[from, to)` may say anything at all about one
 * reconciliation's target — the same question `evaluateUncertainWrite` asks
 * before judging a write, and `ReservationBoard.tsx`'s retry-gate
 * (`Check again`) asks before offering to re-read. Both must use this one
 * function: a board window that this says cannot evaluate the target must
 * never be judged by one caller and silently skipped by the other, and vice
 * versa (C1's bug — the evaluator was fixed but the retry gate still
 * inlined the old full-containment check, so a long move segment resolved
 * correctly on a re-read yet the UI never offered that re-read at all).
 *
 * PMS-CAL-001.2-CP04C.3-C1: the two operations need different tests here,
 * not the same one. A create's `UnassignedRanges` are the board's own
 * *clipped* view of a Unit's uncovered nights (`assignmentTarget.ts`'s doc
 * comment), so a window that only overlaps the write's range could show a
 * clipped, partial "still uncovered" fragment and wrongly read as `changed`
 * once the actual (fuller) range is covered elsewhere — full containment is
 * what keeps that judgement correct. A move's target, by contrast, is never
 * clipped (`moveTarget.ts` deliberately carries the segment's own full,
 * un-clipped `[startDate, endDate)`), and `assignments` on a board are
 * returned complete for any Unit the board includes at all — so a window
 * that merely *overlaps* that range already returns the exact full source or
 * destination assignment, whichever is on the server. Requiring full
 * containment for a move would leave any segment longer than the UI's
 * maximum visible window (`ReservationBoardRangeLength`, capped at 31 nights)
 * permanently unresolved (and, for the retry gate specifically, permanently
 * un-checkable) despite unambiguous overlapping evidence. Half-open
 * adjacency (a window ending exactly where the target starts, or vice versa)
 * is never overlap — `overlapsRange` already excludes it.
 */
export function boardCanEvaluate(
  entry: Reconciliation,
  boardIdentity: { propertyId: string; from: string; to: string }
): boolean {
  if (boardIdentity.propertyId !== entry.propertyId) return false;
  const boardWindow = { startDate: boardIdentity.from, endDate: boardIdentity.to };
  // Only create needs full containment; move and unassign carry an un-clipped
  // segment range, so overlap already returns the exact full segment.
  return entry.target.operation === "create"
    ? containsRange(boardWindow, entry.target)
    : overlapsRange(boardWindow, entry.target);
}

/**
 * What one authoritative board says about an uncertain write, or `null` when
 * `boardCanEvaluate` says this board cannot say anything about it.
 */
export function evaluateUncertainWrite(
  entry: Reconciliation,
  board: ReservationBoardResponse
): "unresolved" | "observed" | "changed" | null {
  const { target } = entry;
  if (!boardCanEvaluate(entry, { propertyId: board.property.id, from: board.from, to: board.to })) return null;

  const stay = board.stays.find((candidate) => candidate.reservationUnitId === target.reservationUnitId);

  // Destination checked first for create/move: if the intended placement
  // itself is on the server, the write's effect is known. An unassign has no
  // destination, so nothing on the board can ever be "observed" for it.
  if (target.operation !== "unassign") {
    const observed =
      stay?.assignments.some(
        (assignment) =>
          assignment.physicalRoomId === target.physicalRoomId &&
          assignment.startDate === target.startDate &&
          assignment.endDate === target.endDate
      ) ?? false;
    if (observed) return "observed";
  }

  if (target.operation === "move" || target.operation === "unassign") {
    // PMS-CAL-001.2-CP04C.3 (move) / CP04D.3 (unassign): the source segment
    // is still a candidate to commit only while every part of its clicked identity — id, version,
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

/**
 * PMS-CAL-001.2-CP04D.3: true while an uncertain unassign whose source is
 * exactly this segment is unresolved — on any board, whatever its range.
 * Matches on `segmentId` alone, for the same reason as
 * `isSegmentMoveUnresolved`: a still-stale board must not let a second
 * unassign be opened for a segment whose first one is unconfirmed.
 *
 * Never locks a create or move entry, a different segment (even on the same
 * ReservationUnit), or an entry that is `observed`, `changed` or settled.
 */
export function isSegmentUnassignUnresolved(list: Reconciliation[], propertyId: string, segmentId: string): boolean {
  return list.some(
    (entry) =>
      entry.resolution === "unresolved" &&
      entry.propertyId === propertyId &&
      entry.target.operation === "unassign" &&
      entry.target.segmentId === segmentId
  );
}

/**
 * PMS-CAL-001.3-CP03-C1: the rooms an unresolved assignment-type write may
 * still change — a create's destination, both rooms of a move, an unassign's
 * source.
 */
function roomsTouchedBy(target: ReconciliationTarget): string[] {
  switch (target.operation) {
    case "create":
      return [target.physicalRoomId];
    case "move":
      return [target.physicalRoomId, target.sourcePhysicalRoomId];
    case "unassign":
      return [target.sourcePhysicalRoomId];
  }
}

/**
 * PMS-CAL-001.3-CP03-C1: true while any write whose response was lost — an
 * assignment create, move or unassign from `assignments`, or a block create
 * from `blocks` — is still `unresolved` and touches one of `physicalRoomIds`
 * on this Property over nights overlapping `range`. Keyed on `resolution`
 * alone, never on `status`: a re-read that could not settle the write (`done`
 * but still `unresolved`) leaves its transaction as unknown as before, and a
 * second write into the same room and nights could race it. This adds a lock
 * across write types; the per-Unit and per-segment locks above still apply.
 */
export function isRoomRangeUnresolved(
  assignments: Reconciliation[],
  blocks: BlockCreateReconciliation[],
  propertyId: string,
  physicalRoomIds: string[],
  range: { startDate: string; endDate: string }
): boolean {
  const touches = (rooms: string[], nights: { startDate: string; endDate: string }) =>
    rooms.some((room) => physicalRoomIds.includes(room)) && overlapsRange(nights, range);
  return (
    assignments.some(
      (entry) =>
        entry.resolution === "unresolved" && entry.propertyId === propertyId && touches(roomsTouchedBy(entry.target), entry.target)
    ) ||
    blocks.some(
      (entry) =>
        entry.resolution === "unresolved" && entry.propertyId === propertyId && touches([entry.target.physicalRoomId], entry.target)
    )
  );
}
