import { describe, expect, it } from "vitest";
import {
  evaluateUncertainWrite,
  isBoardAwaitingReconciliation,
  isUnassignedRangeUnresolved,
  settleReconciliations,
  type Reconciliation,
} from "./reconciliation";
import type { ReservationBoardResponse, ReservationBoardStay } from "@/lib/api/types";

const A = "prop-a|2026-09-07|2026-09-21";
const B = "prop-a|2026-09-21|2026-10-05";
const TARGET = { startDate: "2026-09-10", endDate: "2026-09-13" };

function entry(overrides: Partial<Reconciliation> = {}): Reconciliation {
  return {
    id: 1,
    key: A,
    propertyId: "prop-a",
    from: "2026-09-07",
    to: "2026-09-21",
    afterSeq: 5,
    certainty: "settled",
    target: {
      reservationUnitId: "unit-1",
      physicalRoomId: "room-101",
      ...TARGET,
      roomNumber: "101",
      guestDisplayName: "Guest",
      confirmationNumber: "CNF-1",
    },
    status: "pending",
    resolution: "settled",
    ...overrides,
  };
}

const uncertain = (overrides: Partial<Reconciliation> = {}) =>
  entry({ certainty: "uncertain", resolution: "unresolved", ...overrides });

type StayShape = Pick<ReservationBoardStay, "assignments" | "unassignedRanges">;

function board(
  stay: StayShape | null,
  { propertyId = "prop-a", from = "2026-09-07", to = "2026-09-21" } = {}
): ReservationBoardResponse {
  return {
    property: { id: propertyId, name: "P", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: [],
    physicalRooms: [],
    stays: stay
      ? [
          {
            reservationId: "res-1",
            reservationUnitId: "unit-1",
            confirmationNumber: "CNF-1",
            guestDisplayName: "Guest",
            soldRoomTypeId: "type-std",
            checkIn: "2026-09-10",
            checkOut: "2026-09-13",
            coverageStatus: stay.assignments.length ? "FullyAssigned" : "FullyUnassigned",
            ...stay,
          },
        ]
      : [],
    operationalBlocks: [],
  };
}

const unchanged = board({ assignments: [], unassignedRanges: [TARGET] });
const withIntended = board({
  assignments: [{ segmentId: "s", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-std", ...TARGET }],
  unassignedRanges: [],
});
const loaded = (b: ReservationBoardResponse) => ({ kind: "loaded" as const, board: b });

describe("settleReconciliations — settled writes (201/409, C1 semantics)", () => {
  it("is confirmed by a read of the same board issued after the write", () => {
    expect(settleReconciliations([entry()], A, 6, loaded(unchanged))[0].status).toBe("done");
  });

  it("is never confirmed by a read that was already in flight when the write resolved", () => {
    const list = [entry()];
    expect(settleReconciliations(list, A, 5, loaded(unchanged))).toBe(list);
    expect(settleReconciliations(list, A, 4, loaded(unchanged))).toBe(list);
  });

  it("is never confirmed by a read of another Property or date range", () => {
    const list = [entry()];
    expect(settleReconciliations(list, B, 99, loaded(board(null, { from: "2026-09-21", to: "2026-10-05" })))).toBe(list);
    expect(
      settleReconciliations(list, "prop-b|2026-09-07|2026-09-21", 99, loaded(board(null, { propertyId: "prop-b" })))
    ).toBe(list);
  });

  it("marks a failed re-read, and a later successful re-read of the same board still confirms it", () => {
    const failed = settleReconciliations([entry()], A, 6, { kind: "failed" });
    expect(failed[0].status).toBe("failed");
    expect(settleReconciliations(failed, A, 7, loaded(unchanged))[0].status).toBe("done");
  });

  it("never downgrades a confirmed write when a later read fails", () => {
    const done = [entry({ status: "done" })];
    expect(settleReconciliations(done, A, 9, { kind: "failed" })).toBe(done);
  });
});

describe("settleReconciliations — uncertain writes (lost response, C2)", () => {
  it("keeps the write unresolved when the first same-board read after it shows the nights still uncovered", () => {
    const [after] = settleReconciliations([uncertain()], A, 6, loaded(unchanged));
    expect(after.status).toBe("done"); // the board itself is current…
    expect(after.resolution).toBe("unresolved"); // …but the write is still unknown
  });

  it("stays unresolved across any number of later reads that still show the nights uncovered", () => {
    let list = [uncertain()];
    for (let seq = 6; seq < 12; seq += 1) list = settleReconciliations(list, A, seq, loaded(unchanged));
    expect(list[0].resolution).toBe("unresolved");
  });

  it("resolves as observed when a later read shows exactly the intended assignment", () => {
    let list = settleReconciliations([uncertain()], A, 6, loaded(unchanged));
    list = settleReconciliations(list, A, 7, loaded(withIntended));
    expect(list[0].resolution).toBe("observed");
  });

  it("resolves as changed — not observed — when the nights are covered by something other than the intended assignment", () => {
    const otherRoom = board({
      assignments: [{ segmentId: "s", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-std", ...TARGET }],
      unassignedRanges: [],
    });
    const partlyCovered = board({
      assignments: [
        { segmentId: "s", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-std", startDate: "2026-09-10", endDate: "2026-09-11" },
      ],
      unassignedRanges: [{ startDate: "2026-09-11", endDate: "2026-09-13" }],
    });
    expect(settleReconciliations([uncertain()], A, 6, loaded(otherRoom))[0].resolution).toBe("changed");
    expect(settleReconciliations([uncertain()], A, 6, loaded(partlyCovered))[0].resolution).toBe("changed");
    expect(settleReconciliations([uncertain()], A, 6, loaded(board(null)))[0].resolution).toBe("changed");
  });

  it("stays unresolved while a wider uncovered range still contains every night of the write", () => {
    const widerUncovered = board({ assignments: [], unassignedRanges: [{ startDate: "2026-09-08", endDate: "2026-09-15" }] });
    expect(settleReconciliations([uncertain()], A, 6, loaded(widerUncovered))[0].resolution).toBe("unresolved");
  });

  it("is never resolved by a failed read, a read issued before the write, another Property, or a window that does not include every night", () => {
    const list = [uncertain({ status: "done" })];
    expect(settleReconciliations(list, A, 6, { kind: "failed" })).toBe(list);
    expect(settleReconciliations(list, A, 5, loaded(withIntended))).toBe(list);
    expect(settleReconciliations(list, "prop-b|2026-09-07|2026-09-21", 9, loaded({ ...withIntended, property: { ...withIntended.property, id: "prop-b" } }))).toBe(list);
    const clipped = board(null, { from: "2026-09-11", to: "2026-09-25" });
    expect(settleReconciliations(list, "prop-a|2026-09-11|2026-09-25", 9, loaded(clipped))).toBe(list);
  });

  it("can be resolved by an authoritative read of another board of the same Property that includes every night", () => {
    const wide = { ...withIntended, from: "2026-09-01", to: "2026-10-01" };
    const [after] = settleReconciliations([uncertain({ status: "done" })], "prop-a|2026-09-01|2026-10-01", 9, loaded(wide));
    expect(after.resolution).toBe("observed");
  });

  it("evaluateUncertainWrite reports nothing for boards that cannot see the write", () => {
    expect(evaluateUncertainWrite(uncertain(), board(null, { propertyId: "prop-b" }))).toBeNull();
    expect(evaluateUncertainWrite(uncertain(), board(null, { from: "2026-09-12", to: "2026-09-26" }))).toBeNull();
  });
});

describe("blocking predicates", () => {
  it("isBoardAwaitingReconciliation blocks only the board a write has not been re-read on", () => {
    expect(isBoardAwaitingReconciliation([entry()], A)).toBe(true);
    expect(isBoardAwaitingReconciliation([entry({ status: "failed" })], A)).toBe(true);
    expect(isBoardAwaitingReconciliation([entry({ status: "done" })], A)).toBe(false);
    expect(isBoardAwaitingReconciliation([entry()], B)).toBe(false);
  });

  it("isUnassignedRangeUnresolved locks overlapping nights of that Unit on that Property, on any board, only while unresolved", () => {
    const list = [uncertain({ status: "done" })];
    expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-1", TARGET)).toBe(true);
    expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-1", { startDate: "2026-09-12", endDate: "2026-09-20" })).toBe(true);
    expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-1", { startDate: "2026-09-13", endDate: "2026-09-20" })).toBe(false);
    expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-2", TARGET)).toBe(false);
    expect(isUnassignedRangeUnresolved(list, "prop-b", "unit-1", TARGET)).toBe(false);
    expect(isUnassignedRangeUnresolved([uncertain({ resolution: "observed" })], "prop-a", "unit-1", TARGET)).toBe(false);
    expect(isUnassignedRangeUnresolved([entry({ status: "done" })], "prop-a", "unit-1", TARGET)).toBe(false);
  });
});
