/**
 * PMS-CAL-001.3-CP03: what the board may conclude after one operational-block
 * create, from authoritative board reads only. Kept separate from
 * `reconciliation.ts`, whose targets are all about a ReservationUnit; a block
 * has none, and forcing one in would make every assignment rule there lie.
 *
 * The same two questions as `reconciliation.ts`, never merged:
 *
 * 1. Has the board the write was made from been re-read since (`status`)? Only
 *    a read of that exact identity (`key` = Property + `[from, to)`), issued
 *    after the write resolved (`seq > afterSeq`), counts.
 * 2. Is the write's effect known (`resolution`)? A `201` or `409` is decided
 *    before the server answers (`settled`). A lost response is not: the
 *    transaction may still be running when the next read executes, so it
 *    starts `unresolved` and resolves only to `observed` — a block for the same
 *    room over exactly the same nights is on the server. That shows the
 *    schedule, not that this request created it. A read that shows no such
 *    block proves nothing, so there is no "not written" verdict: the entry
 *    stays `unresolved` and keeps that room's nights locked on this Property.
 */

import type { ReservationBoardResponse } from "@/lib/api/types";

export interface BlockCreateTarget {
  physicalRoomId: string;
  roomNumber: string;
  startDate: string;
  endDate: string;
  reason: string;
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
  target: BlockCreateTarget;
  status: "pending" | "done" | "failed";
  resolution: "settled" | "unresolved" | "observed";
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
  return board.operationalBlocks.some(
    (block) =>
      block.physicalRoomId === entry.target.physicalRoomId &&
      block.startDate === entry.target.startDate &&
      block.endDate === entry.target.endDate
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
