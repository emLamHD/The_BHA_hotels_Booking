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
 * devices, or a closed browser session. The server remains the only authority
 * on what happened.
 *
 * PMS-CAL-001.5-CP03: a request still *in flight* when the page unloads is now
 * covered too. Just before each write goes on the wire the board records a
 * minimal *intent* (`beginPendingWrite`) under its own key; the write's own
 * completion removes it (`endPendingWrite`) once the outcome is known — or, for
 * `unknown`, once that outcome is already in the record above, so there is no
 * moment without a lock. A page that unloads first leaves the intent behind,
 * and the next page restores it as "sent, result unknown": the request may
 * never have reached the server, or may already have been saved.
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
/** CP03: writes sent but not yet answered, kept apart so persisting the list above never touches them. */
export const PENDING_WRITES_STORAGE_KEY = "thebha.adminCalendar.pendingWrites";
const FORMAT_VERSION = 1;

/** How a restored entry came to be unconfirmed; decides only its wording. */
export type RestoredOrigin = "unknown-outcome" | "in-flight";

export interface RestoredUncertainWrites {
  assignments: Reconciliation[];
  blocks: BlockCreateReconciliation[];
  /**
   * True when something was stored but could not be read back safely (bad
   * format or version). Its rooms and nights are unknown, so no lock can be
   * rebuilt; the board says so instead of implying nothing was pending.
   */
  unreadable: boolean;
  /** CP03: the in-flight intents restored above, to hand over once the page has taken them in. */
  pendingTokens: string[];
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
    ...(entry.restored === "in-flight" ? { inFlight: true } : {}),
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
    ...(entry.restored === "in-flight" ? { inFlight: true } : {}),
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
  return { id, ...board, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved", restored: origin(record), target };
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
  return { id, ...board, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved", restored: origin(record), target };
}

const origin = (record: Record<string, unknown>): RestoredOrigin => (record.inFlight === true ? "in-flight" : "unknown-outcome");

/** One write about to go on the wire, described exactly as it would be tracked if its outcome were `unknown`. */
export type PendingWrite =
  | { kind: "assignment"; entry: Reconciliation }
  | { kind: "block"; entry: BlockCreateReconciliation };

interface PendingRecord {
  token: string;
  kind: "assignment" | "block";
  write: ReturnType<typeof assignmentRecord> | ReturnType<typeof blockRecord>;
}

const pageToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * CP03: verified live in Chrome — a reload aborts a pending fetch while the old
 * page is still mounted, so its client reports `unknown/aborted` to a board that
 * would otherwise record it as an ordinary unconfirmed outcome and clear the
 * intent. Once the page is unloading, such an outcome must leave the intent for
 * the next page instead, where it is restored as in flight.
 */
let pageUnloading = false;
if (typeof window !== "undefined") {
  const markUnloading = () => {
    pageUnloading = true;
  };
  window.addEventListener("beforeunload", markUnloading);
  window.addEventListener("pagehide", markUnloading);
  // Back from the back/forward cache: the page is alive again.
  window.addEventListener("pageshow", () => {
    pageUnloading = false;
  });
}

/** True from `beforeunload`/`pagehide` until the page is shown or a board mounts again. */
export function isPageUnloading(): boolean {
  return pageUnloading;
}

/** A board mounting is, by definition, a live page. */
export function markPageAlive(): void {
  pageUnloading = false;
}
let pendingCounter = 0;

function readPendingRecords(storage: Storage): PendingRecord[] {
  const text = storage.getItem(PENDING_WRITES_STORAGE_KEY);
  if (text === null) return [];
  const parsed = JSON.parse(text) as { v?: unknown; writes?: unknown };
  if (parsed?.v !== FORMAT_VERSION || !Array.isArray(parsed.writes)) throw new Error("unreadable pending writes");
  return parsed.writes as PendingRecord[];
}

/**
 * CP03: records a write that is about to be sent, and returns its token — or
 * `null` when the record could not be written, in which case the caller must
 * not send: a reload could then no longer show that the write may have
 * happened. The write reaching storage is checked by reading it back.
 */
export function beginPendingWrite(storage: Storage | null, pending: PendingWrite): string | null {
  if (!storage) return null;
  try {
    let records: PendingRecord[];
    try {
      records = readPendingRecords(storage);
    } catch {
      // An unreadable pending record is replaced; restoring it already reported it as unreadable.
      records = [];
    }
    pendingCounter += 1;
    const token = `${pageToken}-${pendingCounter}`;
    const write = pending.kind === "assignment" ? assignmentRecord(pending.entry) : blockRecord(pending.entry);
    records.push({ token, kind: pending.kind, write: { ...write, inFlight: true } });
    storage.setItem(PENDING_WRITES_STORAGE_KEY, JSON.stringify({ v: FORMAT_VERSION, writes: records }));
    return readPendingRecords(storage).some((record) => record.token === token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * CP03: removes exactly this write's intent — never another one, so a late
 * completion from an old page cannot remove what a newer page is tracking.
 * Never throws.
 */
export function endPendingWrite(storage: Storage | null, token: string): void {
  if (!storage) return;
  try {
    const records = readPendingRecords(storage);
    const kept = records.filter((record) => record.token !== token);
    if (kept.length === records.length) return;
    if (kept.length === 0) storage.removeItem(PENDING_WRITES_STORAGE_KEY);
    else storage.setItem(PENDING_WRITES_STORAGE_KEY, JSON.stringify({ v: FORMAT_VERSION, writes: kept }));
  } catch {
    // Deliberately silent: an intent left behind only ever errs toward a lock.
  }
}

/**
 * Reads what a previous page in this tab left behind — unconfirmed outcomes and
 * CP03's in-flight intents — numbering the restored entries from `firstId`.
 * Never throws. An entry that fails validation is dropped and flagged as
 * `unreadable`, never guessed at.
 */
export function restoreUncertainWrites(storage: Storage | null, firstId: number): RestoredUncertainWrites {
  const empty: RestoredUncertainWrites = { assignments: [], blocks: [], unreadable: false, pendingTokens: [] };
  if (!storage) return empty;
  const outcomes = restoreOutcomes(storage, firstId);
  let nextId = firstId + outcomes.assignments.length + outcomes.blocks.length;
  const pendingTokens: string[] = [];
  let unreadable = outcomes.unreadable;
  let records: PendingRecord[] = [];
  let pendingText: string | null = null;
  try {
    pendingText = storage.getItem(PENDING_WRITES_STORAGE_KEY);
  } catch {
    // Refused storage: nothing could have been recorded, so there is nothing to report.
  }
  if (pendingText !== null) {
    try {
      records = readPendingRecords(storage);
    } catch {
      unreadable = true;
    }
  }
  for (const record of records) {
    const entry =
      record?.kind === "assignment"
        ? readAssignment(record.write, nextId)
        : record?.kind === "block"
          ? readBlock(record.write, nextId)
          : null;
    if (!entry || typeof record.token !== "string") {
      unreadable = true;
      continue;
    }
    nextId += 1;
    pendingTokens.push(record.token);
    if (record.kind === "assignment") outcomes.assignments.push(entry as Reconciliation);
    else outcomes.blocks.push(entry as BlockCreateReconciliation);
  }
  return { ...outcomes, unreadable, pendingTokens };
}

function restoreOutcomes(storage: Storage, firstId: number): Omit<RestoredUncertainWrites, "pendingTokens"> {
  const empty = { assignments: [] as Reconciliation[], blocks: [] as BlockCreateReconciliation[], unreadable: false };
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
