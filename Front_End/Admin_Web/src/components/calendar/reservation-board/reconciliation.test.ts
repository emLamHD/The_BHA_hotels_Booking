import { describe, expect, it } from "vitest";
import {
  evaluateUncertainWrite,
  isBoardAwaitingReconciliation,
  isSegmentMoveUnresolved,
  isUnassignedRangeUnresolved,
  settleReconciliations,
  type CreateReconciliationTarget,
  type MoveReconciliationTarget,
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
      operation: "create",
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

/** A move reconciliation: source room-101 moving to destination room-102, same range as TARGET (moves never change dates). */
function moveEntry(overrides: Partial<Reconciliation> = {}): Reconciliation {
  const moveTarget: MoveReconciliationTarget = {
    operation: "move",
    reservationUnitId: "unit-1",
    physicalRoomId: "room-102", // destination
    ...TARGET,
    roomNumber: "102",
    guestDisplayName: "Guest",
    confirmationNumber: "CNF-1",
    segmentId: "seg-1",
    expectedVersion: 3,
    sourcePhysicalRoomId: "room-101",
  };
  return entry({
    certainty: "uncertain",
    resolution: "unresolved",
    target: moveTarget,
    ...overrides,
  });
}

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

  it("isSegmentMoveUnresolved locks only an unresolved move whose source is exactly this segment", () => {
    const list = [moveEntry({ status: "done" })];
    expect(isSegmentMoveUnresolved(list, "prop-a", "seg-1")).toBe(true);
    // A different segment id, even on the same ReservationUnit, is never locked.
    expect(isSegmentMoveUnresolved(list, "prop-a", "seg-other")).toBe(false);
    // A different Property is never locked.
    expect(isSegmentMoveUnresolved(list, "prop-b", "seg-1")).toBe(false);
    // An unresolved create reconciliation never locks — operation must be "move", and create has no segmentId at all.
    expect(isSegmentMoveUnresolved([uncertain({ status: "done" })], "prop-a", "room-101")).toBe(false);
    // Resolved (observed/changed) never locks.
    expect(isSegmentMoveUnresolved([moveEntry({ resolution: "observed" })], "prop-a", "seg-1")).toBe(false);
    expect(isSegmentMoveUnresolved([moveEntry({ resolution: "changed" })], "prop-a", "seg-1")).toBe(false);
    // A settled (never-uncertain) entry never locks.
    expect(isSegmentMoveUnresolved([entry({ status: "done" })], "prop-a", "room-101")).toBe(false);
  });
});

describe("move reconciliation (PMS-CAL-001.2-CP04C.3)", () => {
  const sourceIntact = board({
    assignments: [{ segmentId: "seg-1", segmentVersion: 3, physicalRoomId: "room-101", actualRoomTypeId: "type-std", ...TARGET }],
    unassignedRanges: [],
  });
  const movedToDestination = board({
    // A superseded segment gets a new id — "observed" never depends on the id matching.
    assignments: [{ segmentId: "seg-2", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-std", ...TARGET }],
    unassignedRanges: [],
  });
  const staleVersionSameRoom = board({
    assignments: [{ segmentId: "seg-1", segmentVersion: 4, physicalRoomId: "room-101", actualRoomTypeId: "type-std", ...TARGET }],
    unassignedRanges: [],
  });
  const staleRoomChangedElsewhere = board({
    assignments: [{ segmentId: "seg-1", segmentVersion: 3, physicalRoomId: "room-103", actualRoomTypeId: "type-std", ...TARGET }],
    unassignedRanges: [],
  });
  const segmentGone = board({ assignments: [], unassignedRanges: [TARGET] });

  it("resolves as observed when a later read shows the ReservationUnit at the destination room over the exact range", () => {
    let list = settleReconciliations([moveEntry()], A, 6, loaded(sourceIntact));
    list = settleReconciliations(list, A, 7, loaded(movedToDestination));
    expect(list[0].resolution).toBe("observed");
  });

  it("stays unresolved across any number of reads while the source segment's id/version/room/range are all still exactly intact", () => {
    let list = [moveEntry()];
    for (let seq = 6; seq < 12; seq += 1) list = settleReconciliations(list, A, seq, loaded(sourceIntact));
    expect(list[0].resolution).toBe("unresolved");
  });

  it("resolves as changed — never observed — when the source segment's version no longer matches, even in the same room", () => {
    expect(settleReconciliations([moveEntry()], A, 6, loaded(staleVersionSameRoom))[0].resolution).toBe("changed");
  });

  it("resolves as changed when the source segment's room no longer matches (moved by something else)", () => {
    expect(settleReconciliations([moveEntry()], A, 6, loaded(staleRoomChangedElsewhere))[0].resolution).toBe("changed");
  });

  it("resolves as changed when the source segment no longer exists at all", () => {
    expect(settleReconciliations([moveEntry()], A, 6, loaded(segmentGone))[0].resolution).toBe("changed");
  });

  it("checks the destination before the source: an intact-looking source on a board that also already shows the destination is observed, not unresolved", () => {
    // A board can only show one state per Unit at a time in these fixtures,
    // so this is exercised via the two-read sequence above; this test pins
    // the *priority* directly against evaluateUncertainWrite.
    expect(evaluateUncertainWrite(moveEntry(), movedToDestination)).toBe("observed");
  });

  it("is never resolved by a wrong Property or a board window that does not even overlap the range", () => {
    expect(evaluateUncertainWrite(moveEntry(), board(null, { propertyId: "prop-b" }))).toBeNull();
    // PMS-CAL-001.2-CP04C.3-C1: a window that overlaps TARGET (2026-09-10 to
    // 2026-09-13) is now sufficient evidence for a move — see the long-segment
    // suite below — so this uses a window with no overlap at all.
    expect(evaluateUncertainWrite(moveEntry(), board(null, { from: "2026-09-14", to: "2026-09-25" }))).toBeNull();
  });

  it("PMS-CAL-001.2-CP04C.3-C1: unlike create, resolves from a board window that only overlaps the range — never requires full containment", () => {
    // This window (from A) overlaps TARGET but does not fully contain it if
    // TARGET's start were, say, 2026-09-05 — exercised precisely below with a
    // segment far longer than any board window could ever contain.
    const partialOverlap = board(
      { assignments: [{ segmentId: "seg-1", segmentVersion: 3, physicalRoomId: "room-101", actualRoomTypeId: "type-std", startDate: "2026-09-05", endDate: "2026-09-13" }], unassignedRanges: [] },
      { from: "2026-09-07", to: "2026-09-21" }
    );
    const overlappingButNotContaining: MoveReconciliationTarget = {
      operation: "move",
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102",
      startDate: "2026-09-05",
      endDate: "2026-09-13",
      roomNumber: "102",
      guestDisplayName: "Guest",
      confirmationNumber: "CNF-1",
      segmentId: "seg-1",
      expectedVersion: 3,
      sourcePhysicalRoomId: "room-101",
    };
    expect(evaluateUncertainWrite(entry({ target: overlappingButNotContaining }), partialOverlap)).toBe("unresolved");
  });

  it("is never resolved by a read issued before the write attempt", () => {
    const list = [moveEntry({ afterSeq: 10 })];
    expect(settleReconciliations(list, A, 9, loaded(movedToDestination))).toBe(list);
    expect(settleReconciliations(list, A, 10, loaded(movedToDestination))).toBe(list);
  });
});

/**
 * PMS-CAL-001.2-CP04C.3-C1: a move segment longer than any board window the
 * UI can ever show (`ReservationBoardRangeLength` caps at 31 nights) — here
 * 2026-08-01 to 2026-10-15, 75 nights — reconciled from a board whose own
 * `[from, to)` only overlaps that range, never contains it. `moveTarget.ts`
 * carries this full, un-clipped range verbatim (never the visible window),
 * so a real segment this long is exactly what a live board would produce.
 */
describe("move reconciliation on a segment longer than the board's own window (PMS-CAL-001.2-CP04C.3-C1)", () => {
  const LONG_RANGE = { startDate: "2026-08-01", endDate: "2026-10-15" };
  const longMoveTarget = (extra: Partial<MoveReconciliationTarget> = {}): MoveReconciliationTarget => ({
    operation: "move",
    reservationUnitId: "unit-1",
    physicalRoomId: "room-102",
    ...LONG_RANGE,
    roomNumber: "102",
    guestDisplayName: "Guest",
    confirmationNumber: "CNF-1",
    segmentId: "seg-1",
    expectedVersion: 3,
    sourcePhysicalRoomId: "room-101",
    ...extra,
  });
  const longMoveEntry = (extra: Partial<MoveReconciliationTarget> = {}) =>
    entry({ certainty: "uncertain", resolution: "unresolved", target: longMoveTarget(extra) });

  // A 14-night board window fully inside LONG_RANGE: overlaps it, but is
  // nowhere near containing it — exactly the shape a real 31-night-max board
  // would have against a 75-night segment.
  const overlappingWindow = { from: "2026-09-07", to: "2026-09-21" };
  const nonOverlappingWindow = { from: "2026-11-01", to: "2026-11-15" };

  it("1. an overlapping read that shows the exact full source resolves unresolved, not stuck at null", () => {
    const sourceStillThere = board(
      { assignments: [{ segmentId: "seg-1", segmentVersion: 3, physicalRoomId: "room-101", actualRoomTypeId: "type-std", ...LONG_RANGE }], unassignedRanges: [] },
      overlappingWindow
    );
    expect(evaluateUncertainWrite(longMoveEntry(), sourceStillThere)).toBe("unresolved");
  });

  it("2. an overlapping read that shows the exact full destination resolves observed", () => {
    const atDestination = board(
      { assignments: [{ segmentId: "seg-9", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-std", ...LONG_RANGE }], unassignedRanges: [] },
      overlappingWindow
    );
    expect(evaluateUncertainWrite(longMoveEntry(), atDestination)).toBe("observed");
  });

  it("3. an overlapping read that shows the source's identity/version changed resolves changed", () => {
    const sourceSuperseded = board(
      { assignments: [{ segmentId: "seg-1", segmentVersion: 4, physicalRoomId: "room-101", actualRoomTypeId: "type-std", ...LONG_RANGE }], unassignedRanges: [] },
      overlappingWindow
    );
    expect(evaluateUncertainWrite(longMoveEntry(), sourceSuperseded)).toBe("changed");
  });

  it("4. a board window that does not overlap the range at all still resolves nothing", () => {
    expect(evaluateUncertainWrite(longMoveEntry(), board(null, nonOverlappingWindow))).toBeNull();
  });

  it("5. an equivalent create target on the same partial (overlapping, non-containing) window still resolves nothing — create semantics are not loosened", () => {
    const createTarget: CreateReconciliationTarget = {
      operation: "create",
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102",
      ...LONG_RANGE,
      roomNumber: "102",
      guestDisplayName: "Guest",
      confirmationNumber: "CNF-1",
    };
    const createEntry = entry({ certainty: "uncertain", resolution: "unresolved", target: createTarget });
    const boardShowingUncovered = board({ assignments: [], unassignedRanges: [LONG_RANGE] }, overlappingWindow);
    expect(evaluateUncertainWrite(createEntry, boardShowingUncovered)).toBeNull();
  });
});
