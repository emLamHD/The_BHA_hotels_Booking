/**
 * PMS-CAL-001.3-CP03: what the board may conclude after one operational-block
 * write — a create, or since CP04 a cancel (`target.operation`) — from
 * authoritative board reads only. Kept separate from
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

/** One tracked operational-block write of either direction. */
export type BlockWriteTarget = BlockCreateTarget | BlockCancelTarget;

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
  resolution: "settled" | "unresolved" | "observed";
  /**
   * PMS-CAL-001.5-CP02: brought back from this tab's storage after a reload
   * (`uncertainWriteStorage.ts`). Such an entry no longer carries guest,
   * confirmation or reason text, so its notice describes it neutrally.
   */
  restored?: true;
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

function isTargetObserved(entry: BlockCreateReconciliation, board: ReservationBoardResponse): boolean {
  if (!boardCanEvaluateBlock(entry, { propertyId: board.property.id, from: board.from, to: board.to })) return false;
  const { target } = entry;
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
    if (result.kind === "loaded" && updated.resolution === "unresolved" && isTargetObserved(updated, result.board)) {
      updated = { ...updated, resolution: "observed" };
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
