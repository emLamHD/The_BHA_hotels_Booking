/**
 * PMS-CAL-001.5-CP02: what the tab keeps across a reload, and what it refuses
 * to guess. The board-level behaviour is proven in
 * `ReservationBoardCrossWriteLock.test.tsx`; these pin down the record itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";
import type { Reconciliation } from "./reconciliation";
import {
  PENDING_WRITES_STORAGE_KEY,
  UNCERTAIN_WRITES_STORAGE_KEY,
  beginPendingWrite,
  discardPendingWrite,
  endPendingWrite,
  persistUncertainWrites,
  restoreUncertainWrites,
  retryPendingCleanup,
  tabStorage,
} from "./uncertainWriteStorage";

const board = { key: "prop-a|2026-09-01|2026-09-15", propertyId: "prop-a", from: "2026-09-01", to: "2026-09-15" };

function assignment(overrides: Partial<Reconciliation> = {}): Reconciliation {
  return {
    id: 9,
    ...board,
    afterSeq: 42,
    certainty: "uncertain",
    status: "done",
    resolution: "unresolved",
    target: {
      operation: "move",
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102",
      startDate: "2026-09-03",
      endDate: "2026-09-05",
      roomNumber: "102",
      guestDisplayName: "Nguyen Van A",
      confirmationNumber: "CNF-100",
      segmentId: "seg-1",
      expectedVersion: 7,
      sourcePhysicalRoomId: "room-101",
    },
    ...overrides,
  };
}

function block(overrides: Partial<BlockCreateReconciliation> = {}): BlockCreateReconciliation {
  return {
    id: 10,
    ...board,
    afterSeq: 42,
    certainty: "uncertain",
    status: "done",
    resolution: "unresolved",
    target: {
      operation: "cancel",
      physicalRoomId: "room-201",
      roomNumber: "201",
      startDate: "2026-09-06",
      endDate: "2026-09-07",
      reason: "Paint",
      segmentId: "seg-b",
      expectedVersion: 3,
    },
    ...overrides,
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("uncertainWriteStorage (PMS-CAL-001.5-CP02)", () => {
  it("keeps only unconfirmed, unresolved writes — never settled or already-resolved ones", () => {
    persistUncertainWrites(
      sessionStorage,
      [
        assignment(),
        assignment({ id: 2, certainty: "settled", resolution: "settled" }),
        assignment({ id: 3, resolution: "observed" }),
        assignment({ id: 4, resolution: "changed" }),
      ],
      [block(), block({ id: 5, certainty: "settled", resolution: "settled" }), block({ id: 6, resolution: "observed" })]
    );
    const stored = JSON.parse(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)!);
    expect(stored.assignments).toHaveLength(1);
    expect(stored.blocks).toHaveLength(1);
  });

  it("stores no guest name, confirmation number or block reason, and no stale request sequence or status", () => {
    persistUncertainWrites(sessionStorage, [assignment()], [block()]);
    const text = sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)!;
    for (const sensitive of ["Nguyen Van A", "CNF-100", "Paint", "guestDisplayName", "confirmationNumber", "reason"]) {
      expect(text).not.toContain(sensitive);
    }
    for (const pageLocal of ["afterSeq", "status", "\"id\""]) {
      expect(text).not.toContain(pageLocal);
    }
  });

  it("removes the record once nothing is unresolved", () => {
    persistUncertainWrites(sessionStorage, [assignment()], []);
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).not.toBeNull();
    persistUncertainWrites(sessionStorage, [assignment({ resolution: "changed" })], []);
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).toBeNull();
  });

  it("restores every operation as new to the page: afterSeq 0, pending, unresolved, marked restored, numbered from firstId", () => {
    const create = assignment({
      target: { operation: "create", reservationUnitId: "unit-2", physicalRoomId: "room-101", startDate: "2026-09-01", endDate: "2026-09-02", roomNumber: "101", guestDisplayName: "x", confirmationNumber: "y" },
    });
    const unassign = assignment({
      target: { operation: "unassign", reservationUnitId: "unit-3", startDate: "2026-09-08", endDate: "2026-09-09", roomNumber: "101", guestDisplayName: "x", confirmationNumber: "y", segmentId: "seg-3", expectedVersion: 2, sourcePhysicalRoomId: "room-101" },
    });
    const blockCreate = block({
      target: { operation: "create", physicalRoomId: "room-102", roomNumber: "102", startDate: "2026-09-10", endDate: "2026-09-11", reason: "Leak" },
    });
    persistUncertainWrites(sessionStorage, [create, assignment(), unassign], [blockCreate, block()]);

    const restored = restoreUncertainWrites(sessionStorage, 5);

    expect(restored.unreadable).toBe(false);
    expect(restored.assignments.map((entry) => entry.target.operation)).toEqual(["create", "move", "unassign"]);
    expect(restored.blocks.map((entry) => entry.target.operation)).toEqual(["create", "cancel"]);
    expect([...restored.assignments, ...restored.blocks].map((entry) => entry.id)).toEqual([5, 6, 7, 8, 9]);
    for (const entry of [...restored.assignments, ...restored.blocks]) {
      expect(entry).toMatchObject({ ...board, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved", restored: "unknown-outcome" });
    }
    // Everything the lock and the reconciliation rules read comes back exactly.
    expect(restored.assignments[1].target).toMatchObject({
      operation: "move",
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102",
      sourcePhysicalRoomId: "room-101",
      segmentId: "seg-1",
      expectedVersion: 7,
      startDate: "2026-09-03",
      endDate: "2026-09-05",
      guestDisplayName: "",
      confirmationNumber: "",
    });
    expect(restored.blocks[1].target).toMatchObject({ operation: "cancel", physicalRoomId: "room-201", segmentId: "seg-b", expectedVersion: 3, reason: "" });
  });

  it.each([
    ["not JSON", "{not json"],
    ["another format version", JSON.stringify({ v: 2, assignments: [], blocks: [] })],
    ["the wrong shape", JSON.stringify({ v: 1, assignments: "nope", blocks: [] })],
  ])("reports %s as unreadable and restores nothing", (_label, text) => {
    sessionStorage.setItem(UNCERTAIN_WRITES_STORAGE_KEY, text);
    expect(restoreUncertainWrites(sessionStorage, 1)).toEqual({ assignments: [], blocks: [], unreadable: true, incomplete: false, pendingTokens: [] });
  });

  it("drops only the entries that fail validation, keeps the valid ones, and reports the loss", () => {
    persistUncertainWrites(sessionStorage, [assignment()], [block()]);
    const stored = JSON.parse(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)!);
    stored.assignments.push({ ...stored.assignments[0], target: { ...stored.assignments[0].target, startDate: "2026-09-09", endDate: "2026-09-01" } });
    stored.blocks.push({ ...stored.blocks[0], target: { ...stored.blocks[0].target, operation: "delete" } });
    sessionStorage.setItem(UNCERTAIN_WRITES_STORAGE_KEY, JSON.stringify(stored));

    const restored = restoreUncertainWrites(sessionStorage, 1);

    expect(restored.unreadable).toBe(true);
    expect(restored.assignments).toHaveLength(1);
    expect(restored.blocks).toHaveLength(1);
  });

  it("never throws when storage refuses reads or writes, restores nothing it could not read, and says the restoration is incomplete", () => {
    const refusing = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as Storage;
    expect(() => persistUncertainWrites(refusing, [assignment()], [])).not.toThrow();
    // PMS-CAL-001.5-CP03-C3: a read that throws is not "nothing was recorded".
    expect(restoreUncertainWrites(refusing, 1)).toEqual({ assignments: [], blocks: [], unreadable: false, incomplete: true, pendingTokens: [] });
    expect(restoreUncertainWrites(null, 1)).toEqual({ assignments: [], blocks: [], unreadable: false, incomplete: true, pendingTokens: [] });
  });

  it("tabStorage is null where sessionStorage cannot be reached", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(tabStorage()).toBeNull();
  });
});

describe("uncertainWriteStorage — in-flight intents (PMS-CAL-001.5-CP03)", () => {
  it("records a minimal intent, readable back, with no guest, confirmation or reason text", () => {
    const token = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() });
    expect(token).toEqual(expect.any(String));
    const text = sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!;
    for (const sensitive of ["Nguyen Van A", "CNF-100", "guestDisplayName", "confirmationNumber"]) {
      expect(text).not.toContain(sensitive);
    }
    const blockToken = beginPendingWrite(sessionStorage, { kind: "block", entry: block() });
    expect(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)).not.toContain("Paint");
    expect(blockToken).not.toBe(token);
  });

  it("removes only its own intent, and removing an unknown token changes nothing", () => {
    const first = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })!;
    const second = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;
    endPendingWrite(sessionStorage, "not-a-token");
    expect(JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!).writes).toHaveLength(2);
    endPendingWrite(sessionStorage, first);
    const left = JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!).writes;
    expect(left.map((record: { token: string }) => record.token)).toEqual([second]);
    endPendingWrite(sessionStorage, second);
    expect(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)).toBeNull();
  });

  it("returns null — so the write must not be sent — when the intent cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })).toBeNull();
    expect(beginPendingWrite(null, { kind: "assignment", entry: assignment() })).toBeNull();
  });

  it("restores intents as in-flight entries, after the unconfirmed ones, and reports their tokens", () => {
    persistUncertainWrites(sessionStorage, [assignment()], []);
    const token = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;

    const restored = restoreUncertainWrites(sessionStorage, 1);

    expect(restored.assignments.map((entry) => [entry.id, entry.restored])).toEqual([[1, "unknown-outcome"]]);
    expect(restored.blocks.map((entry) => [entry.id, entry.restored])).toEqual([[2, "in-flight"]]);
    expect(restored.blocks[0]).toMatchObject({ afterSeq: 0, status: "pending", resolution: "unresolved" });
    expect(restored.pendingTokens).toEqual([token]);
  });

  it("keeps an in-flight origin once the page has moved the intent into the unconfirmed record", () => {
    beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() });
    const restored = restoreUncertainWrites(sessionStorage, 1);
    persistUncertainWrites(sessionStorage, restored.assignments, restored.blocks);
    for (const token of restored.pendingTokens) endPendingWrite(sessionStorage, token);

    expect(restoreUncertainWrites(sessionStorage, 1).assignments[0].restored).toBe("in-flight");
  });

  it("reports an unreadable intent record without losing the readable unconfirmed ones", () => {
    persistUncertainWrites(sessionStorage, [assignment()], []);
    sessionStorage.setItem(PENDING_WRITES_STORAGE_KEY, "{broken");
    const restored = restoreUncertainWrites(sessionStorage, 1);
    expect(restored.unreadable).toBe(true);
    expect(restored.assignments).toHaveLength(1);
    expect(restored.pendingTokens).toEqual([]);
  });
});

describe("uncertainWriteStorage — durable hand-over from intent to unconfirmed record (PMS-CAL-001.5-CP03-C1)", () => {
  /** Storage that refuses only the unconfirmed record — the intent key keeps working. */
  function refuseUnconfirmedRecord() {
    const realSet = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === UNCERTAIN_WRITES_STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      realSet.call(this, key, value);
    });
  }

  it("reports whether the unconfirmed record really reached storage, so an intent is only dropped once it has", () => {
    expect(persistUncertainWrites(sessionStorage, [assignment()], [])).toBe(true);
    const spy = refuseUnconfirmedRecord();
    expect(persistUncertainWrites(sessionStorage, [assignment(), assignment({ id: 11 })], [block()])).toBe(false);
    spy.mockRestore();
    expect(persistUncertainWrites(null, [assignment()], [])).toBe(false);
    // Removing the record once nothing is unresolved is a success too.
    expect(persistUncertainWrites(sessionStorage, [], [])).toBe(true);
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).toBeNull();
  });

  it("reports whether an intent is really gone", () => {
    const token = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })!;
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(endPendingWrite(sessionStorage, token)).toBe(false);
    spy.mockRestore();
    expect(endPendingWrite(sessionStorage, token)).toBe(true);
    // Already gone counts as gone.
    expect(endPendingWrite(sessionStorage, token)).toBe(true);
  });

  it("restores one entry, not two, when the intent and the unconfirmed record describe the same write", () => {
    const token = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })!;
    const blockToken = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;
    // The page took both in (`intent`) and wrote them into the record, but could not drop the intents.
    persistUncertainWrites(sessionStorage, [assignment({ intent: token })], [block({ intent: blockToken })]);

    const restored = restoreUncertainWrites(sessionStorage, 1);

    expect(restored.assignments).toHaveLength(1);
    expect(restored.blocks).toHaveLength(1);
    // The record is the later knowledge: an unknown answer was received.
    expect(restored.assignments[0]).toMatchObject({ restored: "unknown-outcome", intent: token });
    expect(restored.blocks[0]).toMatchObject({ restored: "unknown-outcome", intent: blockToken });
    // Both intents are still handed to the page, so it drops them once the record is safe.
    expect(restored.pendingTokens).toEqual([token, blockToken]);
  });

  it("an intent restored on its own keeps its token as the entry's identity", () => {
    const token = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;
    expect(restoreUncertainWrites(sessionStorage, 1).blocks[0]).toMatchObject({ restored: "in-flight", intent: token });
  });
});

describe("uncertainWriteStorage — a damaged pending record is never built upon (PMS-CAL-001.5-CP03-C2 F3)", () => {
  /** A valid stored record for `entry`, taken out of storage so a test can damage it. */
  function validRecord(kind: "assignment" | "block", entry: Reconciliation | BlockCreateReconciliation) {
    const token = beginPendingWrite(sessionStorage, { kind, entry } as never)!;
    const record = JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!).writes.find((r: { token: string }) => r.token === token);
    sessionStorage.clear();
    return record as { token: string; kind: string; write: { target: Record<string, unknown> } };
  }

  const store = (writes: unknown[]) => sessionStorage.setItem(PENDING_WRITES_STORAGE_KEY, JSON.stringify({ v: 1, writes }));

  it.each([
    ["a null entry", () => [null]],
    ["a non-object entry", () => ["token"]],
    ["a null entry beside a valid intent", () => [null, validRecord("assignment", assignment())]],
    ["an unknown kind", () => [{ ...validRecord("assignment", assignment()), kind: "other" }]],
    ["a missing token", () => [{ ...validRecord("assignment", assignment()), token: undefined }]],
    ["an empty token", () => [{ ...validRecord("block", block()), token: "" }]],
    ["a missing write", () => [{ ...validRecord("assignment", assignment()), write: undefined }]],
    [
      "a move without its segment",
      () => {
        const record = validRecord("assignment", assignment());
        delete record.write.target.segmentId;
        return [record];
      },
    ],
    [
      "a move without its expected version",
      () => {
        const record = validRecord("assignment", assignment());
        record.write.target.expectedVersion = "7";
        return [record];
      },
    ],
    [
      "a block cancel without its expected version",
      () => {
        const record = validRecord("block", block());
        delete record.write.target.expectedVersion;
        return [record];
      },
    ],
    [
      "a range that does not run forward",
      () => {
        const record = validRecord("block", block());
        record.write.target.endDate = record.write.target.startDate;
        return [record];
      },
    ],
  ])("refuses to begin a write beside %s, and changes nothing in storage", (_label, damaged) => {
    store(damaged());
    const before = sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY);
    expect(beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })).toBeNull();
    expect(beginPendingWrite(sessionStorage, { kind: "block", entry: block() })).toBeNull();
    expect(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)).toBe(before);
  });

  it("restores the valid entries beside a damaged one and reports the damage", () => {
    const good = validRecord("assignment", assignment());
    const goodBlock = validRecord("block", block());
    store([null, good, { ...goodBlock, kind: "other" }, goodBlock]);
    const restored = restoreUncertainWrites(sessionStorage, 1);
    expect(restored.unreadable).toBe(true);
    expect(restored.assignments.map((entry) => entry.intent)).toEqual([good.token]);
    expect(restored.blocks.map((entry) => entry.intent)).toEqual([goodBlock.token]);
    expect(restored.pendingTokens).toEqual([good.token, goodBlock.token]);
  });

  it("removes its own token from beside a damaged entry and leaves the damaged one exactly as it was", () => {
    const good = validRecord("assignment", assignment());
    store([null, good]);
    expect(endPendingWrite(sessionStorage, good.token)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!)).toEqual({ v: 1, writes: [null] });
  });

  it("a storage that stored the intent but cannot read it back gets no send, and the unsent intent is removed when it can", () => {
    const other = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;
    let stored = false;
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      realSet.call(this, key, value);
      if (key === PENDING_WRITES_STORAGE_KEY) stored = true;
    });
    const realGet = Storage.prototype.getItem;
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (stored && key === PENDING_WRITES_STORAGE_KEY) throw new DOMException("denied", "SecurityError");
      return realGet.call(this, key);
    });

    expect(beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })).toBeNull();
    getSpy.mockRestore();
    expect(JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!).writes).toHaveLength(2);

    retryPendingCleanup(sessionStorage);
    const left = JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!).writes;
    expect(left.map((record: { token: string }) => record.token)).toEqual([other]);
  });
});

describe("uncertainWriteStorage — a known outcome's intent is deleted later, never restored as unknown (PMS-CAL-001.5-CP03-C2 F1)", () => {
  it("keeps the token owed a deletion while storage refuses, skips it on restore, and deletes only it once storage works", () => {
    const answered = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })!;
    const other = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(discardPendingWrite(sessionStorage, answered)).toBe(false);
    // Not a warning and not a lock: the outcome is known. The other write's intent is untouched.
    const restored = restoreUncertainWrites(sessionStorage, 1);
    expect(restored.assignments).toEqual([]);
    expect(restored.blocks.map((entry) => entry.intent)).toEqual([other]);
    expect(restored.pendingTokens).toEqual([other]);
    expect(restored.unreadable).toBe(false);

    spy.mockRestore();
    retryPendingCleanup(sessionStorage);
    const left = JSON.parse(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)!).writes;
    expect(left.map((record: { token: string }) => record.token)).toEqual([other]);
    // Forgotten only now: a later restore treats nothing about it specially.
    expect(restoreUncertainWrites(sessionStorage, 1).pendingTokens).toEqual([other]);
  });

  it("restoring is itself a chance to finish the deletion", () => {
    const answered = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })!;
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(discardPendingWrite(sessionStorage, answered)).toBe(false);
    spy.mockRestore();

    expect(restoreUncertainWrites(sessionStorage, 1)).toEqual({ assignments: [], blocks: [], unreadable: false, incomplete: false, pendingTokens: [] });
    expect(sessionStorage.getItem(PENDING_WRITES_STORAGE_KEY)).toBeNull();
  });

  it("an answered token that is already gone counts as deleted and is not remembered", () => {
    const answered = beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment() })!;
    endPendingWrite(sessionStorage, answered);
    expect(discardPendingWrite(sessionStorage, answered)).toBe(true);
  });
});

describe("uncertainWriteStorage — a read that throws is an unfinished restoration, never confirmed-empty (PMS-CAL-001.5-CP03-C3)", () => {
  /** Real storage, except that reading `keys` throws like a temporarily denied store. */
  function refuseReads(...keys: string[]) {
    const realGet = Storage.prototype.getItem;
    return vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (keys.includes(key)) throw new DOMException("denied", "SecurityError");
      return realGet.call(this, key);
    });
  }

  it.each([
    ["the unconfirmed record", UNCERTAIN_WRITES_STORAGE_KEY],
    ["the intent record", PENDING_WRITES_STORAGE_KEY],
  ])("%s unreadable: incomplete, not unreadable, and the other record is still restored", (_label, key) => {
    persistUncertainWrites(sessionStorage, [assignment()], []);
    const token = beginPendingWrite(sessionStorage, { kind: "block", entry: block() })!;
    const spy = refuseReads(key);

    const restored = restoreUncertainWrites(sessionStorage, 1);

    expect(restored.incomplete).toBe(true);
    expect(restored.unreadable).toBe(false);
    if (key === UNCERTAIN_WRITES_STORAGE_KEY) {
      expect(restored.assignments).toEqual([]);
      expect(restored.blocks.map((entry) => entry.intent)).toEqual([token]);
    } else {
      expect(restored.assignments).toHaveLength(1);
      expect(restored.blocks).toEqual([]);
    }
    // Once readable again, everything comes back and the restoration is complete.
    spy.mockRestore();
    const recovered = restoreUncertainWrites(sessionStorage, 1);
    expect(recovered.incomplete).toBe(false);
    expect([recovered.assignments.length, recovered.blocks.length]).toEqual([1, 1]);
  });

  it("both records unreadable is incomplete too", () => {
    beginPendingWrite(sessionStorage, { kind: "block", entry: block() });
    refuseReads(UNCERTAIN_WRITES_STORAGE_KEY, PENDING_WRITES_STORAGE_KEY);
    expect(restoreUncertainWrites(sessionStorage, 1)).toMatchObject({ assignments: [], blocks: [], incomplete: true, unreadable: false });
  });

  it("keeps the three states apart: corrupt (unreadable), verified empty, and unfinished", () => {
    expect(restoreUncertainWrites(sessionStorage, 1)).toMatchObject({ incomplete: false, unreadable: false });
    sessionStorage.setItem(PENDING_WRITES_STORAGE_KEY, "{broken");
    expect(restoreUncertainWrites(sessionStorage, 1)).toMatchObject({ incomplete: false, unreadable: true });
  });

  it("no window at all (server render) is not a storage failure", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(restoreUncertainWrites(null, 1)).toEqual({ assignments: [], blocks: [], unreadable: false, incomplete: false, pendingTokens: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
