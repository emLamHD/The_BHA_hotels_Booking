/**
 * PMS-CAL-001.2-CP03A-C1: tracking whether a write's effect on one board has
 * been confirmed by an authoritative re-read.
 *
 * A reconciliation is satisfied only by a read that is both
 * - of the same board identity — the Property and visible `[from, to)` the
 *   write was made from (`key`), and
 * - issued after the write resolved (`seq > afterSeq`): a request already in
 *   flight may have been answered from pre-write data.
 * A read of any other Property or range never confirms it, however recent.
 */

export interface Reconciliation {
  id: number;
  key: string;
  from: string;
  to: string;
  /** The last board request sequence number issued before the write resolved. */
  afterSeq: number;
  status: "pending" | "done" | "failed";
}

/**
 * Applies one committed board read (request `seq` for board `key`) to the
 * tracked reconciliations. Returns the same array when nothing changes, so a
 * caller can skip a state update.
 */
export function settleReconciliations(
  list: Reconciliation[],
  key: string,
  seq: number,
  result: "loaded" | "failed"
): Reconciliation[] {
  const applies = (entry: Reconciliation) =>
    entry.key === key &&
    entry.afterSeq < seq &&
    (result === "loaded" ? entry.status !== "done" : entry.status === "pending");
  if (!list.some(applies)) return list;
  return list.map((entry) => (applies(entry) ? { ...entry, status: result === "loaded" ? "done" : "failed" } : entry));
}

/** True while any unconfirmed write concerns exactly this board. */
export function isBoardAwaitingReconciliation(list: Reconciliation[], key: string): boolean {
  return list.some((entry) => entry.key === key && entry.status !== "done");
}
