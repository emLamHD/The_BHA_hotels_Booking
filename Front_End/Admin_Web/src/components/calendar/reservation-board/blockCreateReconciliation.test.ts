import { describe, expect, it } from "vitest";
import type { ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";
import {
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
