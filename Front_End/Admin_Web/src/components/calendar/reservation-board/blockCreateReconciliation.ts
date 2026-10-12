/**
 * PMS-CAL-001.3-CP03: what the board may conclude after one operational-block
 * write — a create, since CP04 a cancel, and since PMS-CAL-003-CP02 a move
 * (`target.operation`) — from authoritative board reads only. Kept separate from
 * `reconciliation.ts`, whose targets are all about a ReservationUnit; a block
 * has none, and forcing one in would make every assignment rule there lie.
 *
 * The same two questions as `reconciliation.ts`, never merged:
 *
 * 1. Has the board the write was made from been re-read since (`status`)? Only
 *    a read of that exact identity (`key` = Property + `[from, to)`), issued
 *    after the write resolved (`seq > afterSeq`), counts.
 * 2. Is the write's effect known (`resolution`)? A `201`/`200` or `409` is decided
 *    before the server answers (`settled`). A lost response is not: the
 *    transaction may still be running when the next read executes, so it
 *    starts `unresolved` and resolves only to `observed`. For a create, that is
 *    a block for the same room over exactly the same nights on the server; for
 *    a cancel, the targeted segment no longer shown at the version that was
 *    sent (gone, or re-versioned). Either shows the schedule, not that this
 *    request caused it. A read that does not show that change proves nothing,
 *    so there is no "not written" verdict: the entry stays `unresolved` and
 *    keeps that room's nights locked on this Property.
 *
 *    PMS-CAL-003-CP02: a **move** keeps the block's nights and its RoomBlock
 *    header and changes only the room, so it is judged on three things (see
 *    `evaluateBlockMove`): `observed` only when the source segment is no longer
 *    shown and a *different* segment of the *same header* holds exactly the
 *    source's nights in the destination room; `unresolved` while the source is
 *    still shown exactly as it was (a look-alike block in the destination does not
 *    change that); `changed` for everything else — the source is gone or reshaped
 *    but not in the way this request would have done it, so its stale
 *    `expectedVersion` can no longer commit. `changed` says nothing about whether
 *    the request succeeded, failed or caused the change; `observed` says the
 *    schedule matches, not that this request produced it. Only create and cancel
 *    keep their two-valued rule and never produce `changed`.
 */

import type { ReservationBoardResponse } from "@/lib/api/types";

export interface BlockCreateTarget {
  operation: "create";
  physicalRoomId: string;
  roomNumber: string;
  startDate: string;
  endDate: string;
  reason: string;
}

/**
 * PMS-CAL-001.3-CP04: the cancel counterpart. It names one existing segment
 * rather than describing a block to bring into being, so it carries the
 * `segmentId` and the `expectedVersion` that was sent — those, not the room and
 * nights, are what a later board read is compared against. The room and the
 * segment's own full nights are still carried, because the cross-write-type
 * lock in `reconciliation.ts` is expressed in rooms and nights for every kind
 * of write.
 */
export interface BlockCancelTarget {
  operation: "cancel";
  physicalRoomId: string;
  roomNumber: string;
  startDate: string;
  endDate: string;
  reason: string;
  segmentId: string;
  expectedVersion: number;
}

/**
 * PMS-CAL-003-CP02: a move of one block segment to another room over its own full range. It names the
 * RoomBlock header, the source segment (id, the version that was sent, its room) and the destination, and
 * carries neither the block's reason nor the move's reason: nothing free-text is ever stored for it.
 * `physicalRoomId`/`roomNumber` are the DESTINATION's (the room the write would have changed first), and
 * `startDate`/`endDate` are the source's own full range, which the successor must share.
 */
export interface BlockMoveReconciliationTarget {
  operation: "move";
  roomBlockId: string;
  segmentId: string;
  expectedVersion: number;
  sourcePhysicalRoomId: string;
  sourceRoomNumber: string;
  /** Destination PhysicalRoom. */
  physicalRoomId: string;
  roomNumber: string;
  startDate: string;
  endDate: string;
}

/** One tracked operational-block write: a create, a cancel or a move. */
export type BlockWriteTarget = BlockCreateTarget | BlockCancelTarget | BlockMoveReconciliationTarget;

/**
 * The rooms whose nights one unresolved block write may still change: a create's and a cancel's own room, and
 * both rooms of a move — the source (if the request did not commit it still holds every night) and the
 * destination (if it did, it holds them) — each over the target's full range.
 */
export function blockRoomsTouchedBy(target: BlockWriteTarget): string[] {
  return target.operation === "move" ? [target.sourcePhysicalRoomId, target.physicalRoomId] : [target.physicalRoomId];
}

export interface BlockCreateReconciliation {
  id: number;
  /** Board identity the write was made from: `propertyId|from|to`. */
  key: string;
  propertyId: string;
  from: string;
  to: string;
  /** The last board request sequence number issued before the write resolved. */
  afterSeq: number;
  certainty: "settled" | "uncertain";
  target: BlockWriteTarget;
  status: "pending" | "done" | "failed";
  /** `changed` is only ever the verdict of a move; a create or a cancel resolves to `observed` or stays `unresolved`. */
  resolution: "settled" | "unresolved" | "observed" | "changed";
  /**
   * PMS-CAL-001.5-CP02: brought back from this tab's storage after a reload
   * (`uncertainWriteStorage.ts`). Such an entry no longer carries guest,
   * confirmation or reason text, so its notice describes it neutrally.
   * PMS-CAL-001.5-CP03: `"in-flight"` when the page unloaded before any
   * outcome arrived, `"unknown-outcome"` when it received `unknown`.
   */
  restored?: "unknown-outcome" | "in-flight";
  /**
   * PMS-CAL-001.5-CP03-C1: the token of the in-flight intent this write was
   * recorded under before it was sent (`uncertainWriteStorage.ts`). It is the
   * write's identity across the tab's two records, so one write is never
   * restored — or warned about — twice. Not read by the reconciliation rules.
   */
  intent?: string;
}

function overlaps(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  return a.startDate < b.endDate && b.startDate < a.endDate;
}

/**
 * The board projection returns every Effective block overlapping its window,
 * un-clipped, so a board of the same Property whose window overlaps the
 * target's nights is enough to see the target block if it exists.
 */
export function boardCanEvaluateBlock(
  entry: BlockCreateReconciliation,
  board: { propertyId: string; from: string; to: string }
): boolean {
  return board.propertyId === entry.propertyId && overlaps({ startDate: board.from, endDate: board.to }, entry.target);
}

/**
 * PMS-CAL-003-CP02: the verdict of one authoritative board on one move, or `null` when this board cannot say
 * anything about it (another Property, or a window that does not overlap the source's nights — an
 * un-clipped projection returns every block overlapping its window, so an overlapping window is enough to see
 * the source and any successor).
 */
export function evaluateBlockMove(
  entry: BlockCreateReconciliation,
  board: ReservationBoardResponse
): "unresolved" | "observed" | "changed" | null {
  const { target } = entry;
  if (target.operation !== "move") return null;
  if (!boardCanEvaluateBlock(entry, { propertyId: board.property.id, from: board.from, to: board.to })) return null;

  const source = board.operationalBlocks.find((block) => block.segmentId === target.segmentId);
  // Observed requires the source to be gone *and* a different segment of the same header to hold exactly the
  // source's nights in the destination: one without the other, or the same dates under another header, is not
  // this move's effect.
  if (
    source === undefined &&
    board.operationalBlocks.some(
      (block) =>
        block.segmentId !== target.segmentId &&
        block.roomBlockId === target.roomBlockId &&
        block.physicalRoomId === target.physicalRoomId &&
        block.startDate === target.startDate &&
        block.endDate === target.endDate
    )
  ) {
    return "observed";
  }

  // Still exactly as it was — id, version, header, room and range — so the stale version may still commit, whatever
  // else the board shows (a look-alike sibling in the destination included).
  const intact =
    source !== undefined &&
    source.segmentVersion === target.expectedVersion &&
    source.roomBlockId === target.roomBlockId &&
    source.physicalRoomId === target.sourcePhysicalRoomId &&
    source.startDate === target.startDate &&
    source.endDate === target.endDate;
  return intact ? "unresolved" : "changed";
}

function isTargetObserved(entry: BlockCreateReconciliation, board: ReservationBoardResponse): boolean {
  if (!boardCanEvaluateBlock(entry, { propertyId: board.property.id, from: board.from, to: board.to })) return false;
  const { target } = entry;
  if (target.operation === "move") return evaluateBlockMove(entry, board) === "observed";
  if (target.operation === "cancel") {
    // PMS-CAL-001.3-CP04: the cancel direction, and deliberately not the
    // mirror image of the create rule. A board that still shows this exact
    // segment at the version that was sent tells us nothing — the transaction
    // may simply not have committed before the read executed — so the entry
    // stays `unresolved` and the room's nights stay locked.
    //
    // A board that no longer shows it, or shows it at a different version, is
    // evidence that the schedule changed; it is *not* evidence that this
    // request is what changed it (another operator, or an earlier write of
    // our own, could have). `observed` carries exactly that weaker meaning
    // here, as it does for create.
    return !board.operationalBlocks.some(
      (block) => block.segmentId === target.segmentId && block.segmentVersion === target.expectedVersion
    );
  }
  return board.operationalBlocks.some(
    (block) =>
      block.physicalRoomId === target.physicalRoomId &&
      block.startDate === target.startDate &&
      block.endDate === target.endDate
  );
}

/**
 * Applies one committed board read (request `seq` for board `key`). Returns the
 * same array when nothing changes, like `settleReconciliations`.
 */
export function settleBlockReconciliations(
  list: BlockCreateReconciliation[],
  key: string,
  seq: number,
  result: { kind: "loaded"; board: ReservationBoardResponse } | { kind: "failed" }
): BlockCreateReconciliation[] {
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
      if (updated.target.operation === "move") {
        // PMS-CAL-003-CP02: three-valued; `null` (a board that cannot say) and `unresolved` change nothing.
        const verdict = evaluateBlockMove(updated, result.board);
        if (verdict === "observed" || verdict === "changed") updated = { ...updated, resolution: verdict };
      } else if (isTargetObserved(updated, result.board)) {
        updated = { ...updated, resolution: "observed" };
      }
    }
    if (updated !== entry) changed = true;
    return updated;
  });
  return changed ? next : list;
}

/** True while a block write made from exactly this board has not been re-read. */
export function isBoardAwaitingBlockReconciliation(list: BlockCreateReconciliation[], key: string): boolean {
  return list.some((entry) => entry.key === key && entry.status !== "done");
}

/**
 * PMS-CAL-003-CP02: true while an uncertain block cancel or block move whose source is exactly this segment is
 * unresolved on this Property — on any board, whatever its range. Both consume the same segment version, so
 * either in doubt must refuse another of either kind. Matches on the segment id alone, never version, room or
 * range, which a still-stale board could reopen. Nothing of another operation, Property or segment, and nothing
 * `observed`, `changed` or settled, is touched; the per-room predicate (`isRoomRangeUnresolved`) is unchanged and
 * independent of this one.
 */
export function isBlockSegmentWriteUnresolved(list: BlockCreateReconciliation[], propertyId: string, segmentId: string): boolean {
  return list.some(
    (entry) =>
      entry.resolution === "unresolved" &&
      entry.propertyId === propertyId &&
      (entry.target.operation === "cancel" || entry.target.operation === "move") &&
      entry.target.segmentId === segmentId
  );
}
