/**
 * PMS-CAL-001.5-CP02: what the tab keeps across a reload, and what it refuses
 * to guess. The board-level behaviour is proven in
 * `ReservationBoardCrossWriteLock.test.tsx`; these pin down the record itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";
import type { Reconciliation } from "./reconciliation";
import {
  UNCERTAIN_WRITES_STORAGE_KEY,
  persistUncertainWrites,
  restoreUncertainWrites,
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
      expect(entry).toMatchObject({ ...board, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved", restored: true });
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
    expect(restoreUncertainWrites(sessionStorage, 1)).toEqual({ assignments: [], blocks: [], unreadable: true });
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

  it("never throws when storage refuses reads or writes, and restores nothing it could not read", () => {
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
    expect(restoreUncertainWrites(refusing, 1)).toEqual({ assignments: [], blocks: [], unreadable: false });
    expect(restoreUncertainWrites(null, 1)).toEqual({ assignments: [], blocks: [], unreadable: false });
  });

  it("tabStorage is null where sessionStorage cannot be reached", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(tabStorage()).toBeNull();
  });
});
