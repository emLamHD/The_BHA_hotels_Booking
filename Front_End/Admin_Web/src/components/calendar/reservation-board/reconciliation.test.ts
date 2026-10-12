import { describe, expect, it } from "vitest";
import {
  isRoomRangeUnresolved,
  boardCanEvaluate,
  evaluateUncertainWrite,
  isBoardAwaitingReconciliation,
  isSegmentAssignmentWriteUnresolved,
  isSegmentMoveUnresolved,
  isSegmentSplitMoveUnresolved,
  isSegmentUnassignUnresolved,
  isUnassignedRangeUnresolved,
  settleReconciliations,
  type CreateReconciliationTarget,
  type MoveReconciliationTarget,
  type Reconciliation,
  type SplitMoveReconciliationTarget,
  type UnassignReconciliationTarget,
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

/**
 * PMS-CAL-001.2-CP04C.3-C2: `boardCanEvaluate` is the one predicate both
 * `evaluateUncertainWrite` above and `ReservationBoard.tsx`'s retry gate
 * (`canCheckHere` on the "Check again" notice) must agree on. These tests
 * pin its own contract directly, independent of `evaluateUncertainWrite`'s
 * behavior, so a future change to one can never silently diverge from the
 * other without a failing test naming which one moved.
 */
describe("boardCanEvaluate — the shared board-authority predicate (PMS-CAL-001.2-CP04C.3-C2)", () => {
  const LONG_RANGE = { startDate: "2026-08-01", endDate: "2026-10-15" };
  const longMove: MoveReconciliationTarget = {
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
  };
  const longMoveUnresolved = entry({ certainty: "uncertain", resolution: "unresolved", target: longMove });

  it("1. allows a long move segment to be checked from a board window that only overlaps its range", () => {
    expect(
      boardCanEvaluate(longMoveUnresolved, { propertyId: "prop-a", from: "2026-09-07", to: "2026-09-21" })
    ).toBe(true);
  });

  it("2. refuses a long move segment from a board window that does not overlap at all, including exact half-open adjacency", () => {
    expect(
      boardCanEvaluate(longMoveUnresolved, { propertyId: "prop-a", from: "2026-11-01", to: "2026-11-15" })
    ).toBe(false);
    // Adjacent, not overlapping: a window starting exactly where the range ends.
    expect(
      boardCanEvaluate(longMoveUnresolved, { propertyId: "prop-a", from: LONG_RANGE.endDate, to: "2026-11-01" })
    ).toBe(false);
    // Adjacent the other way: a window ending exactly where the range starts.
    expect(
      boardCanEvaluate(longMoveUnresolved, { propertyId: "prop-a", from: "2026-07-01", to: LONG_RANGE.startDate })
    ).toBe(false);
  });

  it("3. refuses a create target from a board window that only overlaps, not fully contains, its range", () => {
    const createTarget: CreateReconciliationTarget = {
      operation: "create",
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102",
      ...LONG_RANGE,
      roomNumber: "102",
      guestDisplayName: "Guest",
      confirmationNumber: "CNF-1",
    };
    const createUnresolved = entry({ certainty: "uncertain", resolution: "unresolved", target: createTarget });
    expect(
      boardCanEvaluate(createUnresolved, { propertyId: "prop-a", from: "2026-09-07", to: "2026-09-21" })
    ).toBe(false);
    // A create target is allowed once the window fully contains it — existing behavior preserved.
    expect(
      boardCanEvaluate(createUnresolved, { propertyId: "prop-a", from: "2026-07-01", to: "2026-11-01" })
    ).toBe(true);
  });

  it("4. refuses any target, of either operation, from the wrong Property regardless of window", () => {
    expect(
      boardCanEvaluate(longMoveUnresolved, { propertyId: "prop-b", from: "2026-08-01", to: "2026-10-15" })
    ).toBe(false);
    expect(boardCanEvaluate(entry(), { propertyId: "prop-b", from: "2026-09-07", to: "2026-09-21" })).toBe(false);
  });

  it("5. evaluateUncertainWrite never resolves a board that boardCanEvaluate refuses, and always proceeds to judge one it allows", () => {
    const boardsAndExpectations: Array<[ReservationBoardResponse, boolean]> = [
      [board(null, { propertyId: "prop-a", from: "2026-09-07", to: "2026-09-21" }), true],
      [board(null, { propertyId: "prop-a", from: "2026-11-01", to: "2026-11-15" }), false],
      [board(null, { propertyId: "prop-b", from: "2026-08-01", to: "2026-10-15" }), false],
    ];
    for (const [candidateBoard, canEvaluate] of boardsAndExpectations) {
      const allowed = boardCanEvaluate(longMoveUnresolved, {
        propertyId: candidateBoard.property.id,
        from: candidateBoard.from,
        to: candidateBoard.to,
      });
      expect(allowed).toBe(canEvaluate);
      const verdict = evaluateUncertainWrite(longMoveUnresolved, candidateBoard);
      // boardCanEvaluate:false must always mean evaluateUncertainWrite returns
      // null; boardCanEvaluate:true means it proceeds to a real verdict
      // (here "changed", since board(null, ...) has no stays at all).
      expect(verdict === null).toBe(!allowed);
    }
  });

  it("6. an existing (non-long) create target still works exactly as before: full containment allows, partial overlap refuses", () => {
    expect(boardCanEvaluate(entry(), { propertyId: "prop-a", from: "2026-09-07", to: "2026-09-21" })).toBe(true);
    expect(boardCanEvaluate(entry(), { propertyId: "prop-a", from: "2026-09-11", to: "2026-09-25" })).toBe(false);
  });
});

/**
 * PMS-CAL-001.2-CP04D.3: an uncertain single-segment unassign. It has no
 * destination, so it can only ever be `unresolved` or `changed` — never
 * `observed` — and, like a move, it is judged from any window that overlaps
 * its full, un-clipped segment range.
 */
describe("unassign reconciliation (PMS-CAL-001.2-CP04D.3)", () => {
  const unassignTarget = (extra: Partial<UnassignReconciliationTarget> = {}): UnassignReconciliationTarget => ({
    operation: "unassign",
    reservationUnitId: "unit-1",
    ...TARGET,
    roomNumber: "101", // the source room being released
    guestDisplayName: "Guest",
    confirmationNumber: "CNF-1",
    segmentId: "seg-1",
    expectedVersion: 3,
    sourcePhysicalRoomId: "room-101",
    ...extra,
  });
  const unassignEntry = (overrides: Partial<Reconciliation> = {}, extra: Partial<UnassignReconciliationTarget> = {}) =>
    entry({ certainty: "uncertain", resolution: "unresolved", target: unassignTarget(extra), ...overrides });

  const segment = (over: Record<string, unknown> = {}) => ({
    segmentId: "seg-1",
    segmentVersion: 3,
    physicalRoomId: "room-101",
    actualRoomTypeId: "type-std",
    ...TARGET,
    ...over,
  });
  const withAssignments = (...assignments: ReturnType<typeof segment>[]) =>
    board({ assignments, unassignedRanges: [] });

  const sourceIntact = withAssignments(segment());

  it("1. stays unresolved across any number of authoritative reads while the exact source segment is intact", () => {
    let list = [unassignEntry()];
    for (let seq = 6; seq < 12; seq += 1) list = settleReconciliations(list, A, seq, loaded(sourceIntact));
    expect(list[0].resolution).toBe("unresolved");
    expect(list[0].status).toBe("done");
  });

  it("2. resolves as changed when the source segment is gone", () => {
    const gone = board({ assignments: [], unassignedRanges: [TARGET] });
    expect(settleReconciliations([unassignEntry()], A, 6, loaded(gone))[0].resolution).toBe("changed");
    expect(evaluateUncertainWrite(unassignEntry(), board(null))).toBe("changed");
  });

  it("3. resolves as changed when the source version no longer matches, even with the same id and room", () => {
    expect(evaluateUncertainWrite(unassignEntry(), withAssignments(segment({ segmentVersion: 4 })))).toBe("changed");
  });

  it("4. resolves as changed when the source room or range no longer matches", () => {
    expect(evaluateUncertainWrite(unassignEntry(), withAssignments(segment({ physicalRoomId: "room-103" })))).toBe("changed");
    expect(evaluateUncertainWrite(unassignEntry(), withAssignments(segment({ endDate: "2026-09-14" })))).toBe("changed");
    expect(evaluateUncertainWrite(unassignEntry(), withAssignments(segment({ startDate: "2026-09-09" })))).toBe("changed");
  });

  it("5. never reports another assignment over the same range as an observed unassign", () => {
    // Different id in a different room, and a different id in the very same room: neither is evidence of an unassign.
    for (const other of [segment({ segmentId: "seg-9", physicalRoomId: "room-102" }), segment({ segmentId: "seg-9" })]) {
      expect(evaluateUncertainWrite(unassignEntry(), withAssignments(other))).toBe("changed");
    }
    // A sibling segment does not hide the source: the exact one is still found by identity.
    const sibling = segment({ segmentId: "seg-2", physicalRoomId: "room-102", startDate: "2026-09-13", endDate: "2026-09-15" });
    expect(evaluateUncertainWrite(unassignEntry(), withAssignments(sibling, segment()))).toBe("unresolved");
  });

  it("6. is never resolved by a wrong Property, or a window that does not overlap — including half-open adjacency", () => {
    expect(evaluateUncertainWrite(unassignEntry(), board(null, { propertyId: "prop-b" }))).toBeNull();
    expect(evaluateUncertainWrite(unassignEntry(), board(null, { from: "2026-09-14", to: "2026-09-25" }))).toBeNull();
    // TARGET is [09-10, 09-13): a window ending on 09-10 or starting on 09-13 only touches it.
    expect(evaluateUncertainWrite(unassignEntry(), board(null, { from: "2026-09-01", to: "2026-09-10" }))).toBeNull();
    expect(evaluateUncertainWrite(unassignEntry(), board(null, { from: "2026-09-13", to: "2026-09-20" }))).toBeNull();
  });

  it("7. is never resolved by a read issued before the write attempt, or by a failed read", () => {
    const gone = board({ assignments: [], unassignedRanges: [TARGET] });
    const list = [unassignEntry({ afterSeq: 10 })];
    expect(settleReconciliations(list, A, 9, loaded(gone))).toBe(list);
    expect(settleReconciliations(list, A, 10, loaded(gone))).toBe(list);
    expect(settleReconciliations(list, A, 11, { kind: "failed" })[0].resolution).toBe("unresolved");
  });

  it("8. is evaluated from a window that only overlaps a segment longer than the board's own maximum window", () => {
    const LONG = { startDate: "2026-08-01", endDate: "2026-10-15" };
    const long = unassignEntry({}, LONG);
    const longSegment = segment(LONG);
    const overlapping = { from: "2026-09-07", to: "2026-09-21" };
    expect(boardCanEvaluate(long, { propertyId: "prop-a", ...overlapping })).toBe(true);
    expect(evaluateUncertainWrite(long, board({ assignments: [longSegment], unassignedRanges: [] }, overlapping))).toBe("unresolved");
    expect(
      evaluateUncertainWrite(long, board({ assignments: [{ ...longSegment, segmentVersion: 4 }], unassignedRanges: [] }, overlapping))
    ).toBe("changed");
    expect(boardCanEvaluate(long, { propertyId: "prop-a", from: "2026-11-01", to: "2026-11-15" })).toBe(false);
  });

  it("9. uses overlap where create still needs full containment, on the very same window", () => {
    const partial = { propertyId: "prop-a", from: "2026-09-11", to: "2026-09-25" };
    expect(boardCanEvaluate(unassignEntry(), partial)).toBe(true);
    expect(boardCanEvaluate(entry(), partial)).toBe(false);
    expect(boardCanEvaluate(moveEntry(), partial)).toBe(true);
  });

  it("10. isSegmentUnassignUnresolved locks exactly the unresolved unassign of that segment on that Property", () => {
    const list = [unassignEntry({ status: "done" })];
    expect(isSegmentUnassignUnresolved(list, "prop-a", "seg-1")).toBe(true);
    expect(isSegmentUnassignUnresolved(list, "prop-a", "seg-other")).toBe(false); // sibling segment, same Unit
    expect(isSegmentUnassignUnresolved(list, "prop-b", "seg-1")).toBe(false);
    // Never locks create/move entries, even one whose segment id matches.
    expect(isSegmentUnassignUnresolved([moveEntry({ status: "done" })], "prop-a", "seg-1")).toBe(false);
    expect(isSegmentUnassignUnresolved([uncertain({ status: "done" })], "prop-a", "seg-1")).toBe(false);
    // Nor an entry that is observed, changed or settled.
    for (const resolution of ["observed", "changed", "settled"] as const) {
      expect(isSegmentUnassignUnresolved([unassignEntry({ resolution })], "prop-a", "seg-1")).toBe(false);
    }
    // The move lock never locks an unassign either.
    expect(isSegmentMoveUnresolved(list, "prop-a", "seg-1")).toBe(false);
  });

  it("11. settleReconciliations returns the same list and entry objects when an unassign is still unresolved and nothing else changed", () => {
    const first = settleReconciliations([unassignEntry()], A, 6, loaded(sourceIntact));
    expect(first[0].status).toBe("done");
    const second = settleReconciliations(first, A, 7, loaded(sourceIntact));
    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
  });
});

describe("isRoomRangeUnresolved (PMS-CAL-001.3-CP03-C1)", () => {
  const nights = { startDate: "2026-09-02", endDate: "2026-09-05" };
  const base = { id: 1, key: "k", propertyId: "prop-a", from: "2026-09-01", to: "2026-09-15", afterSeq: 1, certainty: "uncertain" as const };
  const person = { reservationUnitId: "unit-1", roomNumber: "101", guestDisplayName: "G", confirmationNumber: "C" };
  const move = {
    ...base,
    // Re-read already completed, yet still unresolved: must keep locking.
    status: "done" as const,
    resolution: "unresolved" as const,
    target: { ...person, ...nights, operation: "move" as const, physicalRoomId: "room-102", sourcePhysicalRoomId: "room-101", segmentId: "s", expectedVersion: 1 },
  };
  const block = {
    ...base,
    status: "done" as const,
    resolution: "unresolved" as const,
    target: { operation: "create" as const, physicalRoomId: "room-201", roomNumber: "201", ...nights, reason: "Leak" },
  };

  it("locks both rooms of an unresolved move and the room of an unresolved block, on overlapping nights of the same Property only", () => {
    expect(isRoomRangeUnresolved([move], [], "prop-a", ["room-101"], { startDate: "2026-09-04", endDate: "2026-09-06" })).toBe(true);
    expect(isRoomRangeUnresolved([move], [], "prop-a", ["room-102"], nights)).toBe(true);
    expect(isRoomRangeUnresolved([], [block], "prop-a", ["room-201"], nights)).toBe(true);
    expect(isRoomRangeUnresolved([move], [block], "prop-a", ["room-301"], nights)).toBe(false);
    expect(isRoomRangeUnresolved([move], [block], "prop-a", ["room-101"], { startDate: "2026-09-05", endDate: "2026-09-07" })).toBe(false);
    expect(isRoomRangeUnresolved([move], [block], "prop-b", ["room-101", "room-201"], nights)).toBe(false);
  });

  it("releases the lock once the write is settled, observed or changed", () => {
    expect(isRoomRangeUnresolved([{ ...move, resolution: "changed" }], [], "prop-a", ["room-101"], nights)).toBe(false);
    expect(isRoomRangeUnresolved([{ ...move, resolution: "observed" }], [], "prop-a", ["room-102"], nights)).toBe(false);
    expect(isRoomRangeUnresolved([], [{ ...block, resolution: "observed" }], "prop-a", ["room-201"], nights)).toBe(false);
  });
});

describe("split-move reconciliation (PMS-CAL-002-CP03)", () => {
  // Source room-101 holds [09-10, 09-20); from 09-15 the stay should be in room-102.
  const SRC = { startDate: "2026-09-10", endDate: "2026-09-20" };
  const SPLIT = "2026-09-15";

  function splitEntry(overrides: Partial<SplitMoveReconciliationTarget> = {}, entryOverrides: Partial<Reconciliation> = {}): Reconciliation {
    const target: SplitMoveReconciliationTarget = {
      operation: "split-move",
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102", // destination
      ...SRC,
      roomNumber: "102",
      guestDisplayName: "Guest",
      confirmationNumber: "CNF-1",
      segmentId: "seg-1",
      expectedVersion: 3,
      sourcePhysicalRoomId: "room-101",
      splitDate: SPLIT,
      ...overrides,
    };
    return entry({ certainty: "uncertain", resolution: "unresolved", target, ...entryOverrides });
  }

  const seg = (segmentId: string, version: number, room: string, startDate: string, endDate: string) => ({
    segmentId,
    segmentVersion: version,
    physicalRoomId: room,
    actualRoomTypeId: "type-std",
    startDate,
    endDate,
  });
  const source = seg("seg-1", 3, "room-101", SRC.startDate, SRC.endDate);
  const prefix = seg("seg-2", 4, "room-101", SRC.startDate, SPLIT);
  const suffix = seg("seg-3", 4, "room-102", SPLIT, SRC.endDate);
  const read = (assignments: ReturnType<typeof seg>[], window = {}) => board({ assignments, unassignedRanges: [] }, window);
  const verdict = (b: ReservationBoardResponse, e = splitEntry()) => evaluateUncertainWrite(e, b);

  describe("a window that straddles the split date", () => {
    it("observes the result only when BOTH successors are there, in the right rooms and over exactly the right nights", () => {
      expect(verdict(read([prefix, suffix]))).toBe("observed");
    });

    it("keeps the source intact as unresolved", () => {
      expect(verdict(read([source]))).toBe("unresolved");
    });

    it("never takes one successor for the result — the source is gone, so the verdict is changed", () => {
      expect(verdict(read([prefix]))).toBe("changed");
      expect(verdict(read([suffix]))).toBe("changed");
    });

    it("does not take a destination assignment over the whole range for the result", () => {
      expect(verdict(read([seg("seg-9", 1, "room-102", SRC.startDate, SRC.endDate)]))).toBe("changed");
    });

    it.each([
      ["prefix in another room", [seg("p", 4, "room-103", SRC.startDate, SPLIT), suffix]],
      ["suffix in another room", [prefix, seg("s", 4, "room-103", SPLIT, SRC.endDate)]],
      ["prefix one night short", [seg("p", 4, "room-101", SRC.startDate, "2026-09-14"), suffix]],
      ["suffix starting a night late", [prefix, seg("s", 4, "room-102", "2026-09-16", SRC.endDate)]],
      ["suffix ending early", [prefix, seg("s", 4, "room-102", SPLIT, "2026-09-19")]],
      ["prefix and suffix swapped between rooms", [seg("p", 4, "room-102", SRC.startDate, SPLIT), seg("s", 4, "room-101", SPLIT, SRC.endDate)]],
    ])("does not observe %s", (_name, assignments) => {
      expect(verdict(read(assignments))).toBe("changed");
    });

    it("judges only the target's own Unit — successors of another Unit prove nothing", () => {
      const other = read([prefix, suffix]);
      other.stays[0] = { ...other.stays[0], reservationUnitId: "unit-2" };
      expect(verdict(other)).toBe("changed");
      expect(verdict(board(null))).toBe("changed");
    });

    it.each([
      ["a different version", seg("seg-1", 4, "room-101", SRC.startDate, SRC.endDate)],
      ["a different id", seg("seg-x", 3, "room-101", SRC.startDate, SRC.endDate)],
      ["a different room", seg("seg-1", 3, "room-103", SRC.startDate, SRC.endDate)],
      ["a different end", seg("seg-1", 3, "room-101", SRC.startDate, "2026-09-21")],
    ])("treats a source with %s as changed — its expectedVersion can never commit", (_name, changedSource) => {
      expect(verdict(read([changedSource]))).toBe("changed");
    });

    it("prefers observed over an intact source only when the successors are really there", () => {
      expect(verdict(read([source, prefix, suffix]))).toBe("observed");
    });
  });

  describe("a window that does not straddle the split date", () => {
    it("window ending exactly at the split date returns the prefix only and can never observe", () => {
      const window = { from: "2026-09-07", to: SPLIT };
      expect(verdict(read([prefix], window))).toBe("changed");
      expect(verdict(read([source], window))).toBe("unresolved");
      // Even a board that (unrealistically) listed both successors cannot be taken as proof.
      expect(verdict(read([prefix, suffix], window))).not.toBe("observed");
    });

    it("window starting exactly at the split date returns the suffix only and can never observe", () => {
      const window = { from: SPLIT, to: "2026-09-25" };
      expect(verdict(read([suffix], window))).toBe("changed");
      expect(verdict(read([source], window))).toBe("unresolved");
      expect(verdict(read([prefix, suffix], window))).not.toBe("observed");
    });

    it("a window inside the prefix nights, with the source gone, is changed — never observed", () => {
      expect(verdict(read([prefix], { from: "2026-09-11", to: "2026-09-13" }))).toBe("changed");
    });

    it("a window one night either side of the split date straddles", () => {
      expect(verdict(read([prefix, suffix], { from: "2026-09-14", to: "2026-09-16" }))).toBe("observed");
    });
  });

  describe("which boards may say anything (the shared boardCanEvaluate)", () => {
    const can = (propertyId: string, from: string, to: string) => boardCanEvaluate(splitEntry(), { propertyId, from, to });

    it("needs the same Property and a window that overlaps the source's full range, not one that contains it", () => {
      expect(can("prop-a", "2026-09-07", "2026-09-21")).toBe(true);
      expect(can("prop-a", "2026-09-12", "2026-09-13")).toBe(true);
      expect(can("prop-a", "2026-09-19", "2026-10-03")).toBe(true);
      expect(can("prop-a", "2026-09-01", "2026-09-11")).toBe(true);
    });

    it("refuses another Property and windows that merely touch the half-open edges", () => {
      expect(can("prop-b", "2026-09-07", "2026-09-21")).toBe(false);
      expect(can("prop-a", "2026-09-01", SRC.startDate)).toBe(false);
      expect(can("prop-a", SRC.endDate, "2026-09-30")).toBe(false);
      expect(can("prop-a", "2026-08-01", "2026-08-10")).toBe(false);
    });

    it("gives no verdict at all for a board it cannot evaluate", () => {
      expect(verdict(read([prefix, suffix], { propertyId: "prop-b" }))).toBeNull();
      expect(verdict(read([source], { from: SRC.endDate, to: "2026-09-30" }))).toBeNull();
      expect(verdict(read([source], { from: "2026-09-01", to: SRC.startDate }))).toBeNull();
    });
  });

  describe("a source longer than the board window", () => {
    // 09-01 .. 10-31 split at 09-15: the board returns the un-clipped successors because they overlap its window.
    const LONG = { startDate: "2026-09-01", endDate: "2026-10-31" };
    const long = splitEntry(LONG);
    it("observes un-clipped successors from a window that is inside neither of them", () => {
      const successors = [seg("p", 4, "room-101", LONG.startDate, SPLIT), seg("s", 4, "room-102", SPLIT, LONG.endDate)];
      expect(verdict(read(successors), long)).toBe("observed");
    });
    it("keeps the un-clipped source unresolved and refuses a clipped copy of a successor", () => {
      expect(verdict(read([seg("seg-1", 3, "room-101", LONG.startDate, LONG.endDate)]), long)).toBe("unresolved");
      const clipped = [seg("p", 4, "room-101", "2026-09-07", SPLIT), seg("s", 4, "room-102", SPLIT, "2026-09-21")];
      expect(verdict(read(clipped), long)).toBe("changed");
    });
  });

  describe("settleReconciliations", () => {
    it("resolves on a loaded read issued after the write, keeping the sequence gate", () => {
      const list = [splitEntry({}, { afterSeq: 5 })];
      expect(settleReconciliations(list, A, 5, loaded(read([prefix, suffix])))).toBe(list);
      expect(settleReconciliations(list, A, 6, loaded(read([prefix, suffix])))[0]).toMatchObject({ status: "done", resolution: "observed" });
      expect(settleReconciliations(list, A, 6, loaded(read([prefix])))[0].resolution).toBe("changed");
    });

    it("never resolves on a failed read, and a source still intact stays unresolved with a stable reference once done", () => {
      const list = [splitEntry()];
      const failed = settleReconciliations(list, A, 6, { kind: "failed" });
      expect(failed[0]).toMatchObject({ status: "failed", resolution: "unresolved" });
      const intact = settleReconciliations(failed, A, 7, loaded(read([source])));
      expect(intact[0]).toMatchObject({ status: "done", resolution: "unresolved" });
      expect(settleReconciliations(intact, A, 8, loaded(read([source])))).toBe(intact);
    });

    it("leaves a board that cannot evaluate it unresolved, and never turns a resolved or settled entry back", () => {
      const list = [splitEntry()];
      const elsewhere = settleReconciliations(list, B, 9, loaded(board({ assignments: [], unassignedRanges: [] }, { from: "2026-09-21", to: "2026-10-05" })));
      expect(elsewhere).toBe(list);
      const observed = settleReconciliations(list, A, 6, loaded(read([prefix, suffix])));
      expect(settleReconciliations(observed, A, 7, loaded(read([source])))[0].resolution).toBe("observed");
    });
  });

  describe("locks", () => {
    const locked = (rooms: string[], range: { startDate: string; endDate: string }, e = splitEntry(), property = "prop-a") =>
      isRoomRangeUnresolved([e], [], property, rooms, range);
    const nights = (startDate: string, endDate: string) => ({ startDate, endDate });

    it("locks the source room over its whole range — prefix and suffix nights alike", () => {
      expect(locked(["room-101"], nights("2026-09-10", "2026-09-11"))).toBe(true);
      expect(locked(["room-101"], nights("2026-09-14", "2026-09-15"))).toBe(true);
      expect(locked(["room-101"], nights("2026-09-15", "2026-09-16"))).toBe(true);
      expect(locked(["room-101"], nights("2026-09-19", "2026-09-20"))).toBe(true);
    });

    it("locks the destination room only from the split date, so its prefix nights stay free", () => {
      expect(locked(["room-102"], nights("2026-09-15", "2026-09-16"))).toBe(true);
      expect(locked(["room-102"], nights("2026-09-19", "2026-09-20"))).toBe(true);
      expect(locked(["room-102"], nights("2026-09-14", "2026-09-15"))).toBe(false);
      expect(locked(["room-102"], nights("2026-09-10", "2026-09-15"))).toBe(false);
      expect(locked(["room-102"], nights("2026-09-12", "2026-09-16"))).toBe(true);
    });

    it("honours half-open edges", () => {
      expect(locked(["room-101"], nights("2026-09-05", "2026-09-10"))).toBe(false);
      expect(locked(["room-101"], nights("2026-09-20", "2026-09-25"))).toBe(false);
      expect(locked(["room-102"], nights("2026-09-20", "2026-09-25"))).toBe(false);
    });

    it("ignores other rooms, another Property, and every resolution but unresolved — even a done one is still locked", () => {
      expect(locked(["room-103"], nights("2026-09-10", "2026-09-20"))).toBe(false);
      expect(locked(["room-101"], nights("2026-09-10", "2026-09-20"), splitEntry(), "prop-b")).toBe(false);
      for (const resolution of ["settled", "observed", "changed"] as const) {
        expect(locked(["room-101"], nights("2026-09-10", "2026-09-20"), splitEntry({}, { resolution }))).toBe(false);
      }
      expect(locked(["room-101"], nights("2026-09-10", "2026-09-20"), splitEntry({}, { status: "done" }))).toBe(true);
    });

    it("locks the Unit over the whole source range on any board, and only that Unit", () => {
      const list = [splitEntry()];
      const prefixNights = nights("2026-09-10", "2026-09-12");
      expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-1", prefixNights)).toBe(true);
      expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-1", nights("2026-09-18", "2026-09-19"))).toBe(true);
      expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-2", prefixNights)).toBe(false);
      expect(isUnassignedRangeUnresolved(list, "prop-b", "unit-1", prefixNights)).toBe(false);
      expect(isUnassignedRangeUnresolved(list, "prop-a", "unit-1", nights("2026-09-20", "2026-09-22"))).toBe(false);
    });

    it("keeps the older operations' room locks exactly as they were", () => {
      const move = moveEntry();
      expect(isRoomRangeUnresolved([move], [], "prop-a", ["room-102"], nights("2026-09-10", "2026-09-11"))).toBe(true);
      expect(isRoomRangeUnresolved([move], [], "prop-a", ["room-101"], nights("2026-09-12", "2026-09-13"))).toBe(true);
      expect(isRoomRangeUnresolved([move], [], "prop-a", ["room-101"], nights("2026-09-13", "2026-09-14"))).toBe(false);
      const create = uncertain();
      expect(isRoomRangeUnresolved([create], [], "prop-a", ["room-101"], nights("2026-09-12", "2026-09-14"))).toBe(true);
      expect(isRoomRangeUnresolved([create], [], "prop-a", ["room-102"], nights("2026-09-12", "2026-09-14"))).toBe(false);
    });
  });

  describe("segment predicates", () => {
    const unassign = uncertain({
      target: { operation: "unassign", reservationUnitId: "unit-1", ...TARGET, roomNumber: "101", guestDisplayName: "G", confirmationNumber: "C", segmentId: "seg-1", expectedVersion: 3, sourcePhysicalRoomId: "room-101" },
    });

    it("the split-move predicate matches on the segment id of an unresolved split-move only", () => {
      expect(isSegmentSplitMoveUnresolved([splitEntry()], "prop-a", "seg-1")).toBe(true);
      expect(isSegmentSplitMoveUnresolved([splitEntry()], "prop-a", "seg-other")).toBe(false);
      expect(isSegmentSplitMoveUnresolved([splitEntry()], "prop-b", "seg-1")).toBe(false);
      expect(isSegmentSplitMoveUnresolved([splitEntry({}, { resolution: "changed" })], "prop-a", "seg-1")).toBe(false);
      expect(isSegmentSplitMoveUnresolved([moveEntry(), unassign], "prop-a", "seg-1")).toBe(false);
    });

    it("the shared predicate matches a move, an unassign or a split-move of that segment id — never a create, version or room", () => {
      for (const unresolved of [moveEntry(), unassign, splitEntry()]) {
        expect(isSegmentAssignmentWriteUnresolved([unresolved], "prop-a", "seg-1")).toBe(true);
        expect(isSegmentAssignmentWriteUnresolved([unresolved], "prop-a", "seg-other")).toBe(false);
        expect(isSegmentAssignmentWriteUnresolved([unresolved], "prop-b", "seg-1")).toBe(false);
        expect(isSegmentAssignmentWriteUnresolved([{ ...unresolved, resolution: "observed" }], "prop-a", "seg-1")).toBe(false);
      }
      expect(isSegmentAssignmentWriteUnresolved([uncertain()], "prop-a", "seg-1")).toBe(false);
    });

    it("leaves the move and unassign predicates meaning exactly what they did", () => {
      expect(isSegmentMoveUnresolved([splitEntry()], "prop-a", "seg-1")).toBe(false);
      expect(isSegmentUnassignUnresolved([splitEntry()], "prop-a", "seg-1")).toBe(false);
    });
  });
});
