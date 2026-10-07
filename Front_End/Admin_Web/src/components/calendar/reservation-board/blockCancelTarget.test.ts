/**
 * PMS-CAL-001.3-CP04: `buildBlockCancelTarget` refuses every selection the
 * authoritative board no longer backs, so a stale click can never be turned
 * into a cancel of a look-alike segment.
 */

import { describe, expect, it } from "vitest";
import { buildBlockCancelTarget } from "./blockCancelTarget";
import type { BlockSelection } from "./ReservationBoardServerTimeline";
import type { ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";

const block: ReservationBoardOperationalBlock = {
  roomBlockId: "block-1",
  segmentId: "seg-1",
  segmentVersion: 3,
  physicalRoomId: "room-101",
  // Deliberately wider than the board window below.
  startDate: "2026-08-28",
  endDate: "2026-09-20",
  reason: "Burst pipe",
};

function boardWith(blocks: ReservationBoardOperationalBlock[]): ReservationBoardResponse {
  return {
    property: {
      id: "prop-a",
      name: "Property A",
      timeZone: "Asia/Ho_Chi_Minh",
      localToday: "2026-09-01",
      checkInTime: "14:00",
      checkOutTime: "12:00",
    },
    from: "2026-09-01",
    to: "2026-09-15",
    roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
    ],
    stays: [],
    operationalBlocks: blocks,
  };
}

const selection: BlockSelection = { block, roomNumber: "101" };

describe("buildBlockCancelTarget (PMS-CAL-001.3-CP04)", () => {
  it("carries the segment's own full range, not the board window", () => {
    const target = buildBlockCancelTarget(boardWith([block]), "prop-a", selection);

    expect(target).not.toBeNull();
    expect(target!.block.startDate).toBe("2026-08-28");
    expect(target!.block.endDate).toBe("2026-09-20");
    expect(target!.block.segmentId).toBe("seg-1");
    expect(target!.block.segmentVersion).toBe(3);
    expect(target!.roomNumber).toBe("101");
    expect(target!.boardKey).toBe("prop-a|2026-09-01|2026-09-15");
    expect(target!.boardFrom).toBe("2026-09-01");
    expect(target!.boardTo).toBe("2026-09-15");
  });

  it("refuses when the board is for another Property, or no Property is selected", () => {
    expect(buildBlockCancelTarget(boardWith([block]), "prop-b", selection)).toBeNull();
    expect(buildBlockCancelTarget(boardWith([block]), null, selection)).toBeNull();
  });

  it("refuses when the board no longer shows the segment at all", () => {
    expect(buildBlockCancelTarget(boardWith([]), "prop-a", selection)).toBeNull();
  });

  it.each([
    ["version", { segmentVersion: 4 }],
    ["segment id", { segmentId: "seg-2" }],
    ["room", { physicalRoomId: "room-999" }],
    ["start date", { startDate: "2026-08-29" }],
    ["end date", { endDate: "2026-09-21" }],
  ])("refuses when the board's %s no longer matches the click", (_label, change) => {
    const moved = { ...block, ...change } as ReservationBoardOperationalBlock;
    expect(buildBlockCancelTarget(boardWith([moved]), "prop-a", selection)).toBeNull();
  });

  it("refuses when the segment's room is not on the board", () => {
    const board = boardWith([block]);
    expect(buildBlockCancelTarget({ ...board, physicalRooms: [] }, "prop-a", selection)).toBeNull();
  });

  it("still offers a cancel when the room has gone out of service", () => {
    const board = boardWith([block]);
    const outOfService = {
      ...board,
      physicalRooms: [{ ...board.physicalRooms[0], operationalStatus: "OutOfService" }],
    };
    expect(buildBlockCancelTarget(outOfService, "prop-a", selection)).not.toBeNull();
  });
});
