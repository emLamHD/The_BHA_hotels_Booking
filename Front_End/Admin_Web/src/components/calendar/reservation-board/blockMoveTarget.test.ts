/**
 * PMS-CAL-003-CP02: `buildBlockMoveTarget` refuses every selection the authoritative board no longer backs,
 * so a stale click can never become a move of a look-alike segment — and it carries the facts a later
 * dialog needs (full range, header, candidates) without ever claiming a room is free.
 */

import { describe, expect, it } from "vitest";
import { MAX_BLOCK_MOVE_NIGHTS, buildBlockMoveTarget } from "./blockMoveTarget";
import type { BlockSelection } from "./ReservationBoardServerTimeline";
import type { ReservationBoardOperationalBlock, ReservationBoardPhysicalRoom, ReservationBoardResponse } from "@/lib/api/types";

const block: ReservationBoardOperationalBlock = {
  roomBlockId: "header-1",
  segmentId: "seg-1",
  segmentVersion: 42,
  physicalRoomId: "room-101",
  // Deliberately wider than the board window below.
  startDate: "2026-08-28",
  endDate: "2026-09-20",
  reason: "Burst pipe",
};

const rooms: ReservationBoardPhysicalRoom[] = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
  { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
  { id: "room-301", roomTypeId: "type-unlisted", roomNumber: "301", floor: 3, operationalStatus: "Active" },
];

function boardWith(
  blocks: ReservationBoardOperationalBlock[],
  physicalRooms: ReservationBoardPhysicalRoom[] = rooms,
  propertyId = "prop-a"
): ReservationBoardResponse {
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: "2026-09-01", checkInTime: "14:00", checkOutTime: "12:00" },
    from: "2026-09-01",
    to: "2026-09-15",
    roomTypes: [
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    ],
    physicalRooms,
    stays: [],
    operationalBlocks: blocks,
  };
}

const select = (value: ReservationBoardOperationalBlock = block): BlockSelection => ({ block: value, roomNumber: "101" });

describe("buildBlockMoveTarget — what it carries", () => {
  it("carries the segment's own full range, its header and the board identity, not the board window", () => {
    const target = buildBlockMoveTarget(boardWith([block]), "prop-a", select());

    expect(target).not.toBeNull();
    expect(target!.block).toEqual(block);
    expect(target!.block.startDate).toBe("2026-08-28");
    expect(target!.block.endDate).toBe("2026-09-20");
    expect(target!.block.roomBlockId).toBe("header-1");
    expect(target!.nights).toBe(23);
    expect(target!.propertyId).toBe("prop-a");
    expect(target!.propertyName).toBe("Property A");
    expect(target!.boardKey).toBe("prop-a|2026-09-01|2026-09-15");
    expect([target!.boardFrom, target!.boardTo]).toEqual(["2026-09-01", "2026-09-15"]);
    expect(target!.sourceRoomNumber).toBe("101");
    expect(target!.sourceRoomTypeId).toBe("type-standard");
    expect(target!.sourceRoomTypeName).toBe("Standard");
  });

  it("offers every Active room of the Property except the source room, in board order, as facts and never as a promise", () => {
    const target = buildBlockMoveTarget(boardWith([block]), "prop-a", select())!;

    expect(target.candidateRooms.map((room) => room.id)).toEqual(["room-102", "room-201", "room-301"]);
    // OutOfService room-103 and the source room-101 are not offered.
    expect(target.candidateRooms.find((room) => room.id === "room-103")).toBeUndefined();
    expect(target.candidateRooms.find((room) => room.id === "room-101")).toBeUndefined();
    expect(target.candidateRooms.map((room) => [room.roomNumber, room.floor, room.roomTypeName, room.sameRoomTypeAsSource])).toEqual([
      ["102", 1, "Standard", true],
      ["201", 2, "Deluxe", false],
      ["301", 3, "Unknown room type", false],
    ]);
    // Nothing in the target says a room is free or has capacity.
    expect(JSON.stringify(target)).not.toMatch(/free|available|capacity/i);
  });

  it("still builds a target when the source room is no longer Active — an existing block must stay movable", () => {
    const inactive = rooms.map((room) => (room.id === "room-101" ? { ...room, operationalStatus: "OutOfService" } : room));
    const target = buildBlockMoveTarget(boardWith([block], inactive), "prop-a", select())!;

    expect(target.sourceRoomOperationalStatus).toBe("OutOfService");
    expect(target.candidateRooms.map((room) => room.id)).toEqual(["room-102", "room-201", "room-301"]);
  });

  it("builds a one-night target, and has no candidates when no other room is Active", () => {
    const oneNight = { ...block, startDate: "2026-09-04", endDate: "2026-09-05" };
    expect(buildBlockMoveTarget(boardWith([oneNight]), "prop-a", select(oneNight))!.nights).toBe(1);

    const alone = [rooms[0], rooms[2]];
    expect(buildBlockMoveTarget(boardWith([block], alone), "prop-a", select())!.candidateRooms).toEqual([]);
  });

  it("does not mutate the board or the selection it was given", () => {
    const board = boardWith([block]);
    const selection = select();
    const snapshot = JSON.stringify([board, selection]);

    buildBlockMoveTarget(board, "prop-a", selection);

    expect(JSON.stringify([board, selection])).toBe(snapshot);
  });
});

describe("buildBlockMoveTarget — refusals", () => {
  it("refuses another Property, or no selected Property", () => {
    expect(buildBlockMoveTarget(boardWith([block]), "prop-b", select())).toBeNull();
    expect(buildBlockMoveTarget(boardWith([block]), null, select())).toBeNull();
    expect(buildBlockMoveTarget(boardWith([block], rooms, "prop-b"), "prop-a", select())).toBeNull();
  });

  it("refuses a selection the board no longer shows exactly: segment, header, version, room or either date", () => {
    const stale: Partial<ReservationBoardOperationalBlock>[] = [
      { segmentId: "seg-2" },
      { roomBlockId: "header-2" },
      { segmentVersion: 43 },
      { physicalRoomId: "room-102" },
      { startDate: "2026-08-29" },
      { endDate: "2026-09-21" },
    ];
    for (const change of stale) {
      // The board moved on; the operator's bar is the old one.
      expect(buildBlockMoveTarget(boardWith([{ ...block, ...change }]), "prop-a", select()), JSON.stringify(change)).toBeNull();
      // The bar differs, the board is as it was.
      expect(buildBlockMoveTarget(boardWith([block]), "prop-a", select({ ...block, ...change })), JSON.stringify(change)).toBeNull();
    }
    expect(buildBlockMoveTarget(boardWith([]), "prop-a", select())).toBeNull();
  });

  it("never matches a look-alike: the same room and dates under another segment or header are not this block", () => {
    const lookAlike = { ...block, segmentId: "seg-9", roomBlockId: "header-9" };
    expect(buildBlockMoveTarget(boardWith([lookAlike]), "prop-a", select())).toBeNull();
    expect(buildBlockMoveTarget(boardWith([lookAlike, block]), "prop-a", select())).not.toBeNull();
  });

  it("refuses a board that lists one segment id twice", () => {
    expect(buildBlockMoveTarget(boardWith([block, { ...block, physicalRoomId: "room-102" }]), "prop-a", select())).toBeNull();
    expect(buildBlockMoveTarget(boardWith([block, { ...block }]), "prop-a", select())).toBeNull();
  });

  it("refuses a segment whose room is not on the board", () => {
    expect(buildBlockMoveTarget(boardWith([block], rooms.slice(1)), "prop-a", select())).toBeNull();
  });

  it("accepts exactly the uint range for the version and nothing else", () => {
    const ok = (segmentVersion: number) => {
      const value = { ...block, segmentVersion };
      return buildBlockMoveTarget(boardWith([value]), "prop-a", select(value)) !== null;
    };
    expect([ok(0), ok(1), ok(4_294_967_295)]).toEqual([true, true, true]);
    for (const bad of [-1, 4_294_967_296, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expect(ok(bad), String(bad)).toBe(false);
    }
    const textual = { ...block, segmentVersion: "42" as unknown as number };
    expect(buildBlockMoveTarget(boardWith([textual]), "prop-a", select(textual))).toBeNull();
  });
});

describe("buildBlockMoveTarget — dates are real Gregorian days, 1…366 nights", () => {
  const build = (startDate: string, endDate: string) => {
    const value = { ...block, startDate, endDate };
    return buildBlockMoveTarget(boardWith([value]), "prop-a", select(value));
  };

  it("accepts 366 nights and refuses 367 — across a leap and a non-leap year", () => {
    expect(MAX_BLOCK_MOVE_NIGHTS).toBe(366);
    expect(build("2028-01-01", "2029-01-01")!.nights).toBe(366); // leap year, 366 days
    expect(build("2028-01-01", "2029-01-02")).toBeNull(); // 367
    expect(build("2026-01-01", "2027-01-01")!.nights).toBe(365);
    expect(build("2026-01-01", "2027-01-02")!.nights).toBe(366);
    expect(build("2026-01-01", "2027-01-03")).toBeNull();
  });

  it("refuses an empty, reversed or absurdly long range", () => {
    expect(build("2026-09-04", "2026-09-04")).toBeNull();
    expect(build("2026-09-05", "2026-09-04")).toBeNull();
    expect(build("0001-01-01", "9999-12-31")).toBeNull();
  });

  it("works on years 0001–0099, where Date.UTC would misplace them", () => {
    expect(build("0001-01-01", "0001-01-02")!.nights).toBe(1);
    expect(build("0099-12-31", "0100-01-02")!.nights).toBe(2);
    expect(build("0004-02-28", "0004-03-01")!.nights).toBe(2); // year 4 is a leap year
    expect(build("0100-02-28", "0100-03-01")!.nights).toBe(1); // year 100 is not
    expect(build("9999-12-30", "9999-12-31")!.nights).toBe(1);
  });

  it("refuses non-existent, malformed, padded and out-of-range dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-09-00", "0000-01-01", "10000-01-01", "2026-9-4", "26-09-04", "2026/09/04", "2026-09-04\n", " 2026-09-04", "2026-09-04T00:00:00Z", ""]) {
      expect(build(bad, "2026-09-10"), `start ${JSON.stringify(bad)}`).toBeNull();
      expect(build("2026-09-01", bad), `end ${JSON.stringify(bad)}`).toBeNull();
    }
  });
});
