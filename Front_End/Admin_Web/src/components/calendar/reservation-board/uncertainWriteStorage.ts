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
 * PMS-CAL-001.5-CP03-C1: an intent is dropped only once the unconfirmed
 * record that replaces it has been written *and read back* — never after a
 * write that storage refused — so a write that may have reached the server
 * always has at least one record in this tab. Each entry carries its intent's
 * token (`intent`) as its identity: when both records describe the same write
 * (the record was saved but dropping the intent failed), it is restored once.
 *
 * PMS-CAL-001.5-CP03-C2: three ways storage misbehaving could still turn a
 * known outcome into a false warning, or an unknown one into no record:
 * - An intent whose write is known *not* to be unconfirmed (never sent, refused,
 *   answered) but which storage would not delete is remembered
 *   (`discardPendingWrite`) and deleted at the next chance
 *   (`retryPendingCleanup`) — never restored as an unknown write while this
 *   document lives. A full reload forgets that memory, so a deletion storage
 *   refused until then comes back as a warning: the safe direction.
 * - The page persists the unconfirmed record for both lists at once before it
 *   lets go of any intent (see the board's `persistTracked`).
 * - A pending record is only ever built upon when every entry in it is valid
 *   (`beginPendingWrite`); one that is damaged, unreadable or unavailable
 *   refuses the new write instead of being replaced, because it cannot prove no
 *   write is in flight.
 *
 * PMS-CAL-001.5-CP03-C3: a *read* that throws is not "nothing was recorded".
 * `restoreUncertainWrites` reports it as `incomplete`; the board keeps writes
 * closed, does not persist over a record it could not read, and restores again
 * when storage answers (see the board's `restoreStoredWrites`).
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
  /**
   * PMS-CAL-001.5-CP03-C3: a read *threw* (or the tab's storage could not be
   * reached at all), so what a previous page left behind is not known — which is
   * not the same as nothing having been left. Distinct from `unreadable`
   * (something was read and is damaged) and from a verified-empty result. The
   * entries above are whatever the other record still yielded; the caller keeps
   * writes closed and restores again until this is `false`.
   */
  incomplete: boolean;
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
    ...(entry.intent !== undefined ? { intent: entry.intent } : {}),
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
    ...(entry.intent !== undefined ? { intent: entry.intent } : {}),
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
 * privacy mode) leaves this tab without reload continuity for writes that have
 * no intent left — which is why the result matters.
 *
 * CP03-C1: returns `true` only when the record now in storage, read back, is
 * exactly what was written. Until then an intent it replaces must be kept.
 */
export function persistUncertainWrites(
  storage: Storage | null,
  assignments: Reconciliation[],
  blocks: BlockCreateReconciliation[]
): boolean {
  if (!storage) return false;
  try {
    const kept = {
      v: FORMAT_VERSION,
      assignments: assignments.filter(isUnresolved).map(assignmentRecord),
      blocks: blocks.filter(isUnresolved).map(blockRecord),
    };
    if (kept.assignments.length === 0 && kept.blocks.length === 0) {
      storage.removeItem(UNCERTAIN_WRITES_STORAGE_KEY);
      return storage.getItem(UNCERTAIN_WRITES_STORAGE_KEY) === null;
    }
    const text = JSON.stringify(kept);
    storage.setItem(UNCERTAIN_WRITES_STORAGE_KEY, text);
    return storage.getItem(UNCERTAIN_WRITES_STORAGE_KEY) === text;
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isOptionalText = (value: unknown) => value === undefined || isText(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isNights = (start: unknown, end: unknown) =>
  typeof start === "string" && typeof end === "string" && ISO_DATE.test(start) && ISO_DATE.test(end) && start < end;

function readBoard(record: Record<string, unknown>) {
  const { key, propertyId, from, to, intent } = record;
  if (!isText(key) || !isText(propertyId) || !isNights(from, to) || !isOptionalText(intent)) return null;
  return { key, propertyId, from: from as string, to: to as string, ...(intent !== undefined ? { intent: intent as string } : {}) };
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
  // Back from the back/forward cache: the page is alive again. What it recorded
  // while unloading is taken back in by the mounted board's own `pageshow` (CP03-C1).
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

/**
 * CP03-C1: one write, whichever record it was restored from. Its intent's
 * token when it has one; otherwise (a record written before intents carried
 * one) everything the record keeps about it.
 */
export function uncertainWriteIdentity(kind: "assignment" | "block", entry: Reconciliation | BlockCreateReconciliation): string {
  if (entry.intent !== undefined) return entry.intent;
  const record = kind === "assignment" ? assignmentRecord(entry as Reconciliation) : blockRecord(entry as BlockCreateReconciliation);
  return `${kind}:${JSON.stringify({ ...record, inFlight: undefined })}`;
}

let pendingCounter = 0;

/** The stored pending entries, exactly as stored. Throws when the record is unreadable or of another format. */
function readPendingEntries(storage: Storage): unknown[] {
  return parsePendingEntries(storage.getItem(PENDING_WRITES_STORAGE_KEY));
}

/**
 * The entries of a pending record already read (`null` = no record). Throws only
 * on a payload that is not this format — never on storage, so a caller that has
 * read the text once (restore, C4) can tell a damaged record from a failed read.
 */
function parsePendingEntries(text: string | null): unknown[] {
  if (text === null) return [];
  const parsed = JSON.parse(text) as { v?: unknown; writes?: unknown } | null;
  if (parsed?.v !== FORMAT_VERSION || !Array.isArray(parsed.writes)) throw new Error("unreadable pending writes");
  return parsed.writes;
}

const tokenOf = (entry: unknown): unknown => (typeof entry === "object" && entry !== null ? (entry as { token?: unknown }).token : undefined);

/** CP03-C2: an entry restore could turn into a write: a token, a known kind, and a write that passes the same validation as a restored one. */
function isPendingRecord(entry: unknown): entry is PendingRecord {
  if (typeof entry !== "object" || entry === null) return false;
  const { token, kind, write } = entry as Record<string, unknown>;
  if (!isText(token)) return false;
  return kind === "assignment" ? readAssignment(write, 0) !== null : kind === "block" ? readBlock(write, 0) !== null : false;
}

/**
 * CP03-C2: tokens of intents whose write is known not to be unconfirmed but
 * which storage would not delete yet. Module-level, not the board's: the answer
 * may arrive after the board unmounted, and a board mounting again in this
 * document (or a page coming back from the back/forward cache) must neither
 * forget them nor restore them as unknown writes.
 */
const undeletedIntents = new Set<string>();

/**
 * CP03: records a write that is about to be sent, and returns its token — or
 * `null` when the record could not be written, in which case the caller must
 * not send: a reload could then no longer show that the write may have
 * happened. The write reaching storage is checked by reading it back.
 *
 * CP03-C2: nothing is written unless the record already in storage is readable
 * and every entry in it is valid — it is never replaced or cut down, so the
 * intents beside a damaged entry survive. An intent that reached storage but
 * cannot be confirmed is removed again (or remembered for `retryPendingCleanup`)
 * because the write it names is never sent.
 */
export function beginPendingWrite(storage: Storage | null, pending: PendingWrite): string | null {
  if (!storage) return null;
  retryPendingCleanup(storage);
  let token: string | null = null;
  try {
    const entries = readPendingEntries(storage);
    if (!entries.every(isPendingRecord)) return null;
    pendingCounter += 1;
    const candidate = `${pageToken}-${pendingCounter}`;
    token = candidate;
    const write = pending.kind === "assignment" ? assignmentRecord(pending.entry) : blockRecord(pending.entry);
    const record: PendingRecord = { token: candidate, kind: pending.kind, write: { ...write, inFlight: true } };
    storage.setItem(PENDING_WRITES_STORAGE_KEY, JSON.stringify({ v: FORMAT_VERSION, writes: [...entries, record] }));
    if (readPendingEntries(storage).some((entry) => tokenOf(entry) === candidate)) return candidate;
  } catch {
    // Handled below like a failed read-back.
  }
  if (token !== null) discardPendingWrite(storage, token);
  return null;
}

/**
 * CP03: removes exactly this write's intent — never another one, so a late
 * completion from an old page cannot remove what a newer page is tracking.
 * Never throws: an intent left behind only ever errs toward a lock.
 *
 * CP03-C1: returns whether the intent is verifiably gone (already absent
 * counts), so a caller can try again later.
 *
 * CP03-C2: entries that are not this write's are kept exactly as stored, damaged
 * ones included.
 */
export function endPendingWrite(storage: Storage | null, token: string): boolean {
  if (!storage) return false;
  try {
    const entries = readPendingEntries(storage);
    const kept = entries.filter((entry) => tokenOf(entry) !== token);
    if (kept.length === entries.length) return true;
    if (kept.length === 0) storage.removeItem(PENDING_WRITES_STORAGE_KEY);
    else storage.setItem(PENDING_WRITES_STORAGE_KEY, JSON.stringify({ v: FORMAT_VERSION, writes: kept }));
    return !readPendingEntries(storage).some((entry) => tokenOf(entry) === token);
  } catch {
    return false;
  }
}

/**
 * CP03-C2: lets go of an intent whose write is known *not* to be unconfirmed —
 * it was never sent, was refused, or was answered. If storage will not delete it
 * now, the token is remembered and deleted by `retryPendingCleanup` instead of
 * being forgotten; it is not an unconfirmed write, so it is never warned about
 * or locked. Returns whether the intent is verifiably gone.
 */
export function discardPendingWrite(storage: Storage | null, token: string): boolean {
  if (endPendingWrite(storage, token)) {
    undeletedIntents.delete(token);
    return true;
  }
  undeletedIntents.add(token);
  return false;
}

/** CP03-C2: another try at every deletion storage refused. Only removes tokens; sends nothing. */
export function retryPendingCleanup(storage: Storage | null): void {
  if (undeletedIntents.size === 0) return;
  for (const token of [...undeletedIntents]) {
    if (endPendingWrite(storage, token)) undeletedIntents.delete(token);
  }
}

/**
 * Reads what a previous page in this tab left behind — unconfirmed outcomes and
 * CP03's in-flight intents — numbering the restored entries from `firstId`.
 * Never throws. An entry that fails validation is dropped and flagged as
 * `unreadable`, never guessed at.
 *
 * CP03-C1: an intent whose token an unconfirmed entry already carries is the
 * same write; only the unconfirmed entry (the later knowledge) is restored,
 * while the intent's token is still reported so the page can drop it.
 */
export function restoreUncertainWrites(storage: Storage | null, firstId: number): RestoredUncertainWrites {
  const empty: RestoredUncertainWrites = { assignments: [], blocks: [], unreadable: false, incomplete: false, pendingTokens: [] };
  // No `window` is a server render, which has nothing to restore; a client whose storage cannot be reached has not looked.
  if (!storage) return { ...empty, incomplete: typeof window !== "undefined" };
  retryPendingCleanup(storage);
  const outcomes = restoreOutcomes(storage, firstId);
  let nextId = firstId + outcomes.assignments.length + outcomes.blocks.length;
  const pendingTokens: string[] = [];
  const recorded = new Set([...outcomes.assignments, ...outcomes.blocks].map((entry) => entry.intent));
  let unreadable = outcomes.unreadable;
  let records: unknown[] = [];
  let pendingText: string | null = null;
  let incomplete = outcomes.incomplete;
  try {
    pendingText = storage.getItem(PENDING_WRITES_STORAGE_KEY);
  } catch {
    // Refused storage says nothing about what was recorded (C3).
    incomplete = true;
  }
  if (pendingText !== null) {
    try {
      records = parsePendingEntries(pendingText);
    } catch {
      unreadable = true;
    }
  }
  for (const record of records) {
    if (!isPendingRecord(record)) {
      unreadable = true;
      continue;
    }
    // CP03-C2: its outcome is known and only its deletion is owed.
    if (undeletedIntents.has(record.token)) continue;
    const entry = record.kind === "assignment" ? readAssignment(record.write, nextId) : readBlock(record.write, nextId);
    if (!entry) {
      unreadable = true;
      continue;
    }
    pendingTokens.push(record.token);
    if (recorded.has(record.token)) continue;
    entry.intent = record.token;
    nextId += 1;
    if (record.kind === "assignment") outcomes.assignments.push(entry as Reconciliation);
    else outcomes.blocks.push(entry as BlockCreateReconciliation);
  }
  return { ...outcomes, unreadable, incomplete, pendingTokens };
}

function restoreOutcomes(storage: Storage, firstId: number): Omit<RestoredUncertainWrites, "pendingTokens"> {
  const empty = { assignments: [] as Reconciliation[], blocks: [] as BlockCreateReconciliation[], unreadable: false, incomplete: false };
  let text: string | null;
  try {
    text = storage.getItem(UNCERTAIN_WRITES_STORAGE_KEY);
  } catch {
    return { ...empty, incomplete: true };
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
  return { assignments, blocks, unreadable, incomplete: false };
}
