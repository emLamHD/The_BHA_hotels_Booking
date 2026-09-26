/**
 * PMS-CAL-001.5-CP02: keeps the board's *unconfirmed* writes — a lost response
 * whose effect the server has not yet shown — across a reload of the same tab.
 *
 * Without it, a reload dropped both the warning and the room/night lock, so an
 * operator could send a second write for a room whose first write may already
 * have committed. `sessionStorage` is used because it belongs to the tab: it
 * survives a reload, and is gone when the tab closes.
 *
 * What this is not: an idempotency guarantee, nor protection across tabs,
 * devices, or a closed browser session. A request still in flight when the page
 * unloads is not recorded at all — only an outcome the page actually received
 * as `unknown` is. The server remains the only authority on what happened.
 *
 * Only the fields the reconciliation rules need to lock and to judge are kept:
 * identity, Property, room(s), the half-open night range, the operation and the
 * segment/version. Guest names, confirmation numbers and block reasons are not
 * stored; a restored entry is marked `restored` so its notice can say neutrally
 * what it can no longer name.
 *
 * A restored entry is treated as new to this page: `afterSeq` is 0 and `status`
 * is `pending`, because the previous page's board request sequence restarted
 * with the page, and none of this page's reads has seen that board yet.
 * `resolution` stays `unresolved` — only a later authoritative read, through the
 * unchanged rules in `reconciliation.ts`/`blockCreateReconciliation.ts`, may
 * resolve it.
 */

import type { BlockCreateReconciliation, BlockWriteTarget } from "./blockCreateReconciliation";
import type { Reconciliation, ReconciliationTarget } from "./reconciliation";

export const UNCERTAIN_WRITES_STORAGE_KEY = "thebha.adminCalendar.uncertainWrites";
const FORMAT_VERSION = 1;

export interface RestoredUncertainWrites {
  assignments: Reconciliation[];
  blocks: BlockCreateReconciliation[];
  /**
   * True when something was stored but could not be read back safely (bad
   * format or version). Its rooms and nights are unknown, so no lock can be
   * rebuilt; the board says so instead of implying nothing was pending.
   */
  unreadable: boolean;
}

/** `sessionStorage`, or `null` where it does not exist or access to it is refused. */
export function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const isUnresolved = (entry: { certainty: string; resolution: string }) =>
  entry.certainty === "uncertain" && entry.resolution === "unresolved";

function assignmentRecord(entry: Reconciliation) {
  const { target } = entry;
  return {
    key: entry.key,
    propertyId: entry.propertyId,
    from: entry.from,
    to: entry.to,
    target: {
      operation: target.operation,
      reservationUnitId: target.reservationUnitId,
      startDate: target.startDate,
      endDate: target.endDate,
      roomNumber: target.roomNumber,
      ...(target.operation !== "unassign" ? { physicalRoomId: target.physicalRoomId } : {}),
      ...(target.operation !== "create"
        ? {
            segmentId: target.segmentId,
            expectedVersion: target.expectedVersion,
            sourcePhysicalRoomId: target.sourcePhysicalRoomId,
          }
        : {}),
    },
  };
}

function blockRecord(entry: BlockCreateReconciliation) {
  const { target } = entry;
  return {
    key: entry.key,
    propertyId: entry.propertyId,
    from: entry.from,
    to: entry.to,
    target: {
      operation: target.operation,
      physicalRoomId: target.physicalRoomId,
      roomNumber: target.roomNumber,
      startDate: target.startDate,
      endDate: target.endDate,
      ...(target.operation === "cancel"
        ? { segmentId: target.segmentId, expectedVersion: target.expectedVersion }
        : {}),
    },
  };
}

/**
 * Writes the current unresolved entries of both lists, or removes the record
 * when there are none. Never throws: storage that refuses the write (quota,
 * privacy mode) simply leaves this tab without reload continuity.
 */
export function persistUncertainWrites(
  storage: Storage | null,
  assignments: Reconciliation[],
  blocks: BlockCreateReconciliation[]
): void {
  if (!storage) return;
  try {
    const kept = {
      v: FORMAT_VERSION,
      assignments: assignments.filter(isUnresolved).map(assignmentRecord),
      blocks: blocks.filter(isUnresolved).map(blockRecord),
    };
    if (kept.assignments.length === 0 && kept.blocks.length === 0) {
      storage.removeItem(UNCERTAIN_WRITES_STORAGE_KEY);
    } else {
      storage.setItem(UNCERTAIN_WRITES_STORAGE_KEY, JSON.stringify(kept));
    }
  } catch {
    // Deliberately silent: see this function's comment.
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isNights = (start: unknown, end: unknown) =>
  typeof start === "string" && typeof end === "string" && ISO_DATE.test(start) && ISO_DATE.test(end) && start < end;

function readBoard(record: Record<string, unknown>) {
  const { key, propertyId, from, to } = record;
  if (!isText(key) || !isText(propertyId) || !isNights(from, to)) return null;
  return { key, propertyId, from: from as string, to: to as string };
}

function readAssignment(value: unknown, id: number): Reconciliation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const board = readBoard(record);
  const raw = record.target as Record<string, unknown> | undefined;
  if (!board || typeof raw !== "object" || raw === null) return null;
  if (!isText(raw.reservationUnitId) || !isText(raw.roomNumber) || !isNights(raw.startDate, raw.endDate)) return null;
  const base = {
    reservationUnitId: raw.reservationUnitId,
    startDate: raw.startDate as string,
    endDate: raw.endDate as string,
    roomNumber: raw.roomNumber,
    guestDisplayName: "",
    confirmationNumber: "",
  };
  let target: ReconciliationTarget;
  if (raw.operation === "create") {
    if (!isText(raw.physicalRoomId)) return null;
    target = { ...base, operation: "create", physicalRoomId: raw.physicalRoomId };
  } else if (raw.operation === "move" || raw.operation === "unassign") {
    if (!isText(raw.segmentId) || !isVersion(raw.expectedVersion) || !isText(raw.sourcePhysicalRoomId)) return null;
    const source = { segmentId: raw.segmentId, expectedVersion: raw.expectedVersion, sourcePhysicalRoomId: raw.sourcePhysicalRoomId };
    if (raw.operation === "move") {
      if (!isText(raw.physicalRoomId)) return null;
      target = { ...base, ...source, operation: "move", physicalRoomId: raw.physicalRoomId };
    } else {
      target = { ...base, ...source, operation: "unassign" };
    }
  } else {
    return null;
  }
  return { id, ...board, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved", restored: true, target };
}

function readBlock(value: unknown, id: number): BlockCreateReconciliation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const board = readBoard(record);
  const raw = record.target as Record<string, unknown> | undefined;
  if (!board || typeof raw !== "object" || raw === null) return null;
  if (!isText(raw.physicalRoomId) || !isText(raw.roomNumber) || !isNights(raw.startDate, raw.endDate)) return null;
  const base = {
    physicalRoomId: raw.physicalRoomId,
    roomNumber: raw.roomNumber,
    startDate: raw.startDate as string,
    endDate: raw.endDate as string,
    reason: "",
  };
  let target: BlockWriteTarget;
  if (raw.operation === "create") {
    target = { ...base, operation: "create" };
  } else if (raw.operation === "cancel") {
    if (!isText(raw.segmentId) || !isVersion(raw.expectedVersion)) return null;
    target = { ...base, operation: "cancel", segmentId: raw.segmentId, expectedVersion: raw.expectedVersion };
  } else {
    return null;
  }
  return { id, ...board, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved", restored: true, target };
}

/**
 * Reads what a previous page in this tab left behind, numbering the restored
 * entries from `firstId`. Never throws. An entry that fails validation is
 * dropped and flagged as `unreadable`, never guessed at.
 */
export function restoreUncertainWrites(storage: Storage | null, firstId: number): RestoredUncertainWrites {
  const empty: RestoredUncertainWrites = { assignments: [], blocks: [], unreadable: false };
  if (!storage) return empty;
  let text: string | null;
  try {
    text = storage.getItem(UNCERTAIN_WRITES_STORAGE_KEY);
  } catch {
    return empty;
  }
  if (text === null) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, unreadable: true };
  }
  const record = parsed as { v?: unknown; assignments?: unknown; blocks?: unknown } | null;
  if (
    typeof record !== "object" ||
    record === null ||
    record.v !== FORMAT_VERSION ||
    !Array.isArray(record.assignments) ||
    !Array.isArray(record.blocks)
  ) {
    return { ...empty, unreadable: true };
  }

  let nextId = firstId;
  let unreadable = false;
  const assignments: Reconciliation[] = [];
  for (const value of record.assignments) {
    const entry = readAssignment(value, nextId);
    if (entry) {
      assignments.push(entry);
      nextId += 1;
    } else {
      unreadable = true;
    }
  }
  const blocks: BlockCreateReconciliation[] = [];
  for (const value of record.blocks) {
    const entry = readBlock(value, nextId);
    if (entry) {
      blocks.push(entry);
      nextId += 1;
    } else {
      unreadable = true;
    }
  }
  return { assignments, blocks, unreadable };
}
