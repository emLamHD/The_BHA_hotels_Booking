import { describe, expect, it } from "vitest";
import type { ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";
import {
  blockRoomsTouchedBy,
  evaluateBlockMove,
  isBlockSegmentWriteUnresolved,
  isBoardAwaitingBlockReconciliation,
  settleBlockReconciliations,
  type BlockCreateReconciliation,
} from "./blockCreateReconciliation";

const KEY = "prop-a|2026-09-01|2026-09-15";

function entry(overrides: Partial<BlockCreateReconciliation> = {}): BlockCreateReconciliation {
  return {
    id: 1,
    key: KEY,
    propertyId: "prop-a",
    from: "2026-09-01",
    to: "2026-09-15",
    afterSeq: 3,
    certainty: "uncertain",
    target: {
      operation: "create",
      physicalRoomId: "room-101",
      roomNumber: "101",
      startDate: "2026-09-02",
      endDate: "2026-09-05",
      reason: "Pipe",
    },
    status: "pending",
    resolution: "unresolved",
    ...overrides,
  };
}

function board(from: string, to: string, blocks: Partial<ReservationBoardOperationalBlock>[], propertyId = "prop-a") {
  return {
    property: { id: propertyId },
    from,
    to,
    operationalBlocks: blocks.map((block) => ({
      roomBlockId: "b",
      segmentId: "s",
      segmentVersion: 1,
      physicalRoomId: "room-101",
      startDate: "2026-09-02",
      endDate: "2026-09-05",
      reason: "Pipe",
      ...block,
    })),
  } as unknown as ReservationBoardResponse;
}

describe("blockCreateReconciliation (PMS-CAL-001.3-CP03)", () => {
  it("ignores reads issued before the write resolved", () => {
    const list = [entry()];
    expect(settleBlockReconciliations(list, KEY, 3, { kind: "loaded", board: board("2026-09-01", "2026-09-15", [{}]) })).toBe(list);
  });

  it("marks the written board done on a later read of the same identity, and failed on a failed one", () => {
    const [done] = settleBlockReconciliations([entry({ certainty: "settled", resolution: "settled" })], KEY, 4, {
      kind: "loaded",
      board: board("2026-09-01", "2026-09-15", []),
    });
    expect(done.status).toBe("done");

    const [failed] = settleBlockReconciliations([entry()], KEY, 4, { kind: "failed" });
    expect(failed.status).toBe("failed");
    expect(failed.resolution).toBe("unresolved");
  });

  it("a read of another range or Property never marks the written board done", () => {
    const list = [entry()];
    const [other] = settleBlockReconciliations(list, "prop-a|2026-09-15|2026-09-29", 4, {
      kind: "loaded",
      board: board("2026-09-15", "2026-09-29", []),
    });
    expect(other.status).toBe("pending");
    expect(isBoardAwaitingBlockReconciliation([other], KEY)).toBe(true);
  });

  it("observes an uncertain write only when the same room holds a block over exactly the same nights", () => {
    const near = settleBlockReconciliations([entry()], KEY, 4, {
      kind: "loaded",
      board: board("2026-09-01", "2026-09-15", [{ endDate: "2026-09-06" }, { physicalRoomId: "room-102" }]),
    });
    expect(near[0].resolution).toBe("unresolved");

    const exact = settleBlockReconciliations([entry()], KEY, 4, {
      kind: "loaded",
      board: board("2026-09-01", "2026-09-15", [{}]),
    });
    expect(exact[0].resolution).toBe("observed");
  });

  it("an overlapping window of the same Property can observe; another Property's board cannot", () => {
    const overlapping = settleBlockReconciliations([entry()], "prop-a|2026-09-04|2026-09-11", 4, {
      kind: "loaded",
      board: board("2026-09-04", "2026-09-11", [{}]),
    });
    expect(overlapping[0].resolution).toBe("observed");
    expect(overlapping[0].status).toBe("pending");

    const otherProperty = settleBlockReconciliations([entry()], "prop-b|2026-09-01|2026-09-15", 4, {
      kind: "loaded",
      board: board("2026-09-01", "2026-09-15", [{}], "prop-b"),
    });
    expect(otherProperty[0].resolution).toBe("unresolved");
  });
});

describe("blockCreateReconciliation — the cancel direction (PMS-CAL-001.3-CP04)", () => {
  /** A lost cancel of segment `s` at version 1, on room 101 over [09-02, 09-05). */
  const cancelEntry = (overrides: Partial<BlockCreateReconciliation> = {}) =>
    entry({
      target: {
        operation: "cancel",
        physicalRoomId: "room-101",
        roomNumber: "101",
        startDate: "2026-09-02",
        endDate: "2026-09-05",
        reason: "Pipe",
        segmentId: "s",
        expectedVersion: 1,
      },
      ...overrides,
    });

  const settle = (list: BlockCreateReconciliation[], blocks: Partial<ReservationBoardOperationalBlock>[]) =>
    settleBlockReconciliations(list, KEY, 4, {
      kind: "loaded",
      board: board("2026-09-01", "2026-09-15", blocks),
    });

  it("stays unresolved while the board still shows that exact segment and version", () => {
    const [settled] = settle([cancelEntry()], [{ segmentId: "s", segmentVersion: 1 }]);
    expect(settled.status).toBe("done");
    // A read that still shows the segment proves nothing: the transaction may
    // simply not have committed yet.
    expect(settled.resolution).toBe("unresolved");
  });

  it("becomes observed when the segment is gone from a board that could have shown it", () => {
    const [settled] = settle([cancelEntry()], []);
    expect(settled.resolution).toBe("observed");
  });

  it("becomes observed when the segment comes back at a different version", () => {
    const [settled] = settle([cancelEntry()], [{ segmentId: "s", segmentVersion: 2 }]);
    expect(settled.resolution).toBe("observed");
  });

  it("ignores a different segment that happens to sit on the same room and nights", () => {
    const [settled] = settle([cancelEntry()], [{ segmentId: "other", segmentVersion: 1 }]);
    expect(settled.resolution).toBe("observed");

    const [kept] = settle([cancelEntry()], [
      { segmentId: "other", segmentVersion: 9 },
      { segmentId: "s", segmentVersion: 1 },
    ]);
    expect(kept.resolution).toBe("unresolved");
  });

  it("never resolves from a board that cannot see those nights, or another Property's", () => {
    const [farAway] = settleBlockReconciliations([cancelEntry()], KEY, 4, {
      kind: "loaded",
      board: board("2026-10-01", "2026-10-15", []),
    });
    expect(farAway.resolution).toBe("unresolved");

    const [otherProperty] = settleBlockReconciliations([cancelEntry()], KEY, 4, {
      kind: "loaded",
      board: board("2026-09-01", "2026-09-15", [], "prop-b"),
    });
    expect(otherProperty.resolution).toBe("unresolved");
  });

  it("keeps the board-awaiting rule shared with create", () => {
    expect(isBoardAwaitingBlockReconciliation([cancelEntry()], KEY)).toBe(true);
    expect(isBoardAwaitingBlockReconciliation([cancelEntry({ status: "done" })], KEY)).toBe(false);
  });
});

describe("blockCreateReconciliation — block move verdicts (PMS-CAL-003-CP02)", () => {
  const MOVE_KEY = "prop-a|2026-10-25|2026-11-08";
  const FROM = "2026-11-01";
  const TO = "2026-11-04";

  function move(overrides: Partial<BlockCreateReconciliation> = {}): BlockCreateReconciliation {
    return entry({
      key: MOVE_KEY,
      from: "2026-10-25",
      to: "2026-11-08",
      target: {
        operation: "move",
        roomBlockId: "H",
        segmentId: "S",
        expectedVersion: 42,
        sourcePhysicalRoomId: "room-A",
        sourceRoomNumber: "A",
        physicalRoomId: "room-B",
        roomNumber: "B",
        startDate: FROM,
        endDate: TO,
      },
      ...overrides,
    });
  }

  /** A block as the projection reports it: un-clipped, whole segment. */
  const shown = (overrides: Partial<ReservationBoardOperationalBlock>): Partial<ReservationBoardOperationalBlock> => ({
    roomBlockId: "H",
    segmentId: "S",
    segmentVersion: 42,
    physicalRoomId: "room-A",
    startDate: FROM,
    endDate: TO,
    ...overrides,
  });
  const successor = (overrides: Partial<ReservationBoardOperationalBlock> = {}) =>
    shown({ segmentId: "T", segmentVersion: 1, physicalRoomId: "room-B", ...overrides });
  const unrelated = (overrides: Partial<ReservationBoardOperationalBlock> = {}) =>
    shown({ roomBlockId: "Z", segmentId: "U", segmentVersion: 9, physicalRoomId: "room-C", ...overrides });

  const verdict = (blocks: Partial<ReservationBoardOperationalBlock>[], window: [string, string] = ["2026-10-25", "2026-11-08"]) =>
    evaluateBlockMove(move(), board(window[0], window[1], blocks));

  it("observed only when the source is no longer shown and a different segment of the same header holds exactly the source's nights in the destination", () => {
    expect(verdict([successor()])).toBe("observed");
    // Other blocks around do not change it.
    expect(verdict([successor(), unrelated()])).toBe("observed");
  });

  it("source exactly as it was is unresolved — alone, and with a look-alike sibling in the destination", () => {
    expect(verdict([shown({})])).toBe("unresolved");
    expect(verdict([shown({}), successor()])).toBe("unresolved");
    expect(verdict([shown({}), successor({ roomBlockId: "Z" })])).toBe("unresolved");
    expect(verdict([shown({}), unrelated()])).toBe("unresolved");
  });

  it("the source gone is changed, never saved, unless the matching successor is there", () => {
    expect(verdict([])).toBe("changed");
    expect(verdict([unrelated()])).toBe("changed");
    // Same destination and nights under another header.
    expect(verdict([successor({ roomBlockId: "Z" })])).toBe("changed");
    // Same header and destination, other nights (shorter, longer, shifted).
    expect(verdict([successor({ endDate: "2026-11-03" })])).toBe("changed");
    expect(verdict([successor({ endDate: "2026-11-05" })])).toBe("changed");
    expect(verdict([successor({ startDate: "2026-11-02" })])).toBe("changed");
    expect(verdict([successor({ startDate: "2026-10-31" })])).toBe("changed");
    // Same header and nights, a room that is not the destination.
    expect(verdict([successor({ physicalRoomId: "room-C" })])).toBe("changed");
    expect(verdict([successor({ physicalRoomId: "room-A" })])).toBe("changed");
  });

  it("the source still shown but not exactly as it was is changed — a successor beside it never makes it observed", () => {
    expect(verdict([shown({ segmentVersion: 43 })])).toBe("changed");
    expect(verdict([shown({ segmentVersion: 41 })])).toBe("changed");
    expect(verdict([shown({ physicalRoomId: "room-C" })])).toBe("changed");
    expect(verdict([shown({ roomBlockId: "Z" })])).toBe("changed");
    expect(verdict([shown({ endDate: "2026-11-05" })])).toBe("changed");
    expect(verdict([shown({ startDate: "2026-11-02" })])).toBe("changed");
    expect(verdict([shown({ segmentVersion: 43 }), successor()])).toBe("changed");
    // The same segment id now in the destination is the source "still shown", not a successor.
    expect(verdict([shown({ physicalRoomId: "room-B" })])).toBe("changed");
  });

  it("says nothing for another Property or for a window that does not overlap the source's nights — half-open adjacency included", () => {
    expect(evaluateBlockMove(move(), board("2026-10-25", "2026-11-08", [successor()], "prop-b"))).toBeNull();
    expect(verdict([successor()], ["2026-10-20", FROM])).toBeNull(); // ends the day the source starts
    expect(verdict([successor()], [TO, "2026-11-10"])).toBeNull(); // starts the day the source ends
    expect(verdict([successor()], ["2026-10-20", "2026-11-02"])).toBe("observed"); // one night of overlap is enough
    expect(verdict([successor()], ["2026-11-03", "2026-11-20"])).toBe("observed");
    expect(verdict([successor()], ["2026-09-01", "2027-09-01"])).toBe("observed");
    // A create or a cancel has no move verdict.
    expect(evaluateBlockMove(entry(), board("2026-09-01", "2026-09-15", [{}]))).toBeNull();
  });

  it("settle: observed and changed are set only by a loaded read after the write, on the right Property and window", () => {
    const list = [move()];
    const loaded = (blocks: Partial<ReservationBoardOperationalBlock>[], seq = 4, key = MOVE_KEY, window: [string, string] = ["2026-10-25", "2026-11-08"], property = "prop-a") =>
      settleBlockReconciliations(list, key, seq, { kind: "loaded", board: board(window[0], window[1], blocks, property) });

    expect(loaded([successor()])[0]).toMatchObject({ resolution: "observed", status: "done" });
    expect(loaded([])[0]).toMatchObject({ resolution: "changed", status: "done" });
    expect(loaded([shown({})])[0]).toMatchObject({ resolution: "unresolved", status: "done" });

    // A read issued before the write resolved changes nothing at all.
    expect(loaded([successor()], 3)).toBe(list);
    // A failed read resolves nothing and fails only the pending status.
    const [failed] = settleBlockReconciliations(list, MOVE_KEY, 4, { kind: "failed" });
    expect(failed).toMatchObject({ resolution: "unresolved", status: "failed" });
    // Another Property resolves nothing, even on the same key text.
    expect(loaded([successor()], 4, MOVE_KEY, ["2026-10-25", "2026-11-08"], "prop-b")[0].resolution).toBe("unresolved");
    // A window that does not overlap resolves nothing, but the read of the written board still marks it done.
    const [elsewhere] = loaded([successor()], 4, "prop-a|2026-11-10|2026-11-24", ["2026-11-10", "2026-11-24"]);
    expect(elsewhere).toMatchObject({ resolution: "unresolved", status: "pending" });
    const [adjacent] = loaded([successor()], 4, MOVE_KEY, ["2026-11-04", "2026-11-18"]);
    expect(adjacent.resolution).toBe("unresolved");
  });

  it("status and resolution stay apart: done does not resolve, resolved stays resolved, and a later read never undoes a verdict", () => {
    const [done] = settleBlockReconciliations([move()], MOVE_KEY, 4, { kind: "loaded", board: board("2026-10-25", "2026-11-08", [shown({})]) });
    expect(done).toMatchObject({ status: "done", resolution: "unresolved" });
    const [observed] = settleBlockReconciliations([done], MOVE_KEY, 5, { kind: "loaded", board: board("2026-10-25", "2026-11-08", [successor()]) });
    expect(observed.resolution).toBe("observed");
    const list = [observed];
    // Resolved entries are final: a later contradictory board changes nothing.
    expect(settleBlockReconciliations(list, MOVE_KEY, 6, { kind: "loaded", board: board("2026-10-25", "2026-11-08", [shown({})]) })).toBe(list);
  });

  it("an uncertain move and an unresolved cancel/create keep the rules they had: create and cancel never produce changed", () => {
    const cancel = entry({ target: { operation: "cancel", physicalRoomId: "room-101", roomNumber: "101", startDate: "2026-09-02", endDate: "2026-09-05", reason: "Pipe", segmentId: "s", expectedVersion: 1 } });
    const [stillThere] = settleBlockReconciliations([cancel], KEY, 4, { kind: "loaded", board: board("2026-09-01", "2026-09-15", [{ segmentVersion: 1 }]) });
    expect(stillThere.resolution).toBe("unresolved");
    const [gone] = settleBlockReconciliations([cancel], KEY, 4, { kind: "loaded", board: board("2026-09-01", "2026-09-15", []) });
    expect(gone.resolution).toBe("observed");
    const [none] = settleBlockReconciliations([entry()], KEY, 4, { kind: "loaded", board: board("2026-09-01", "2026-09-15", []) });
    expect(none.resolution).toBe("unresolved");
    const [created] = settleBlockReconciliations([entry()], KEY, 4, { kind: "loaded", board: board("2026-09-01", "2026-09-15", [{}]) });
    expect(created.resolution).toBe("observed");
  });

  it("blockRoomsTouchedBy names both rooms of a move and the one room of a create or cancel", () => {
    expect(blockRoomsTouchedBy(move().target)).toEqual(["room-A", "room-B"]);
    expect(blockRoomsTouchedBy(entry().target)).toEqual(["room-101"]);
  });

  it("isBlockSegmentWriteUnresolved: an unresolved cancel or move of this segment on this Property, nothing else", () => {
    const cancel = (overrides: Partial<BlockCreateReconciliation> = {}) =>
      entry({ target: { operation: "cancel", physicalRoomId: "room-101", roomNumber: "101", startDate: "2026-09-02", endDate: "2026-09-05", reason: "x", segmentId: "S", expectedVersion: 1 }, ...overrides });
    expect(isBlockSegmentWriteUnresolved([move()], "prop-a", "S")).toBe(true);
    expect(isBlockSegmentWriteUnresolved([cancel()], "prop-a", "S")).toBe(true);
    // Another segment, another Property, a create, and every resolved or settled state do not lock it.
    expect(isBlockSegmentWriteUnresolved([move()], "prop-a", "other")).toBe(false);
    expect(isBlockSegmentWriteUnresolved([move()], "prop-b", "S")).toBe(false);
    expect(isBlockSegmentWriteUnresolved([entry()], "prop-a", "S")).toBe(false);
    for (const resolution of ["observed", "changed", "settled"] as const) {
      expect(isBlockSegmentWriteUnresolved([move({ resolution })], "prop-a", "S")).toBe(false);
      expect(isBlockSegmentWriteUnresolved([cancel({ resolution })], "prop-a", "S")).toBe(false);
    }
    // It is the segment id alone: other dates, rooms and boards still lock it (a still-stale board must not reopen it).
    const stale = move({ key: "prop-a|2030-01-01|2030-01-15", from: "2030-01-01", to: "2030-01-15" });
    expect(isBlockSegmentWriteUnresolved([stale], "prop-a", "S")).toBe(true);
    // Done is not resolved.
    expect(isBlockSegmentWriteUnresolved([move({ status: "done" })], "prop-a", "S")).toBe(true);
  });
});
