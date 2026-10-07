import { describe, expect, it } from "vitest";
import { buildMoveTarget } from "./moveTarget";
import type {
  ReservationBoardPhysicalRoom,
  ReservationBoardResponse,
  ReservationBoardRoomType,
  ReservationBoardStay,
} from "@/lib/api/types";
import type { AssignedSegmentSelection } from "./ReservationBoardServerTimeline";

const roomTypes: ReservationBoardRoomType[] = [
  { id: "type-standard", code: "STD", name: "Standard", isActive: true },
  { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
  { id: "type-suite", code: "STE", name: "Suite", isActive: true },
];

const rooms: ReservationBoardPhysicalRoom[] = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
  { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
  { id: "room-202", roomTypeId: "type-deluxe", roomNumber: "202", floor: 2, operationalStatus: "Active" },
  { id: "room-301", roomTypeId: "type-suite", roomNumber: "301", floor: 3, operationalStatus: "OutOfService" },
];

// One stay with two assignments in different rooms, one of which (seg-1)
// runs past the board's own visible window on both sides.
const seg1 = {
  segmentId: "seg-1",
  segmentVersion: 2,
  physicalRoomId: "room-101",
  actualRoomTypeId: "type-standard",
  startDate: "2026-08-20",
  endDate: "2026-09-25",
};
const seg2 = {
  segmentId: "seg-2",
  segmentVersion: 5,
  physicalRoomId: "room-201",
  actualRoomTypeId: "type-deluxe",
  startDate: "2026-09-05",
  endDate: "2026-09-10",
};

const stay: ReservationBoardStay = {
  reservationId: "res-1",
  reservationUnitId: "unit-1",
  confirmationNumber: "CNF-1",
  guestDisplayName: "Guest One",
  soldRoomTypeId: "type-standard",
  checkIn: "2026-08-20",
  checkOut: "2026-09-25",
  coverageStatus: "FullyAssigned",
  assignments: [seg1, seg2],
  unassignedRanges: [],
};

const board: ReservationBoardResponse = {
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
  roomTypes,
  physicalRooms: rooms,
  stays: [stay],
  operationalBlocks: [],
};

function selectionFor(segment: typeof seg1 | typeof seg2): AssignedSegmentSelection {
  return { stay, segment };
}

describe("buildMoveTarget (PMS-CAL-001.2-CP04C.2)", () => {
  it("selects exactly the clicked segment's identity, not just the ReservationUnit, when a stay has more than one assignment", () => {
    const targetForSeg1 = buildMoveTarget(board, "prop-a", selectionFor(seg1));
    expect(targetForSeg1?.segment.segmentId).toBe("seg-1");
    expect(targetForSeg1?.segment.segmentVersion).toBe(2);
    expect(targetForSeg1?.currentRoomNumber).toBe("101");

    const targetForSeg2 = buildMoveTarget(board, "prop-a", selectionFor(seg2));
    expect(targetForSeg2?.segment.segmentId).toBe("seg-2");
    expect(targetForSeg2?.segment.segmentVersion).toBe(5);
    expect(targetForSeg2?.currentRoomNumber).toBe("201");
  });

  it("keeps the segment's full half-open range even though it extends past the board's own visible window", () => {
    const target = buildMoveTarget(board, "prop-a", selectionFor(seg1));
    expect(target?.segment.startDate).toBe("2026-08-20");
    expect(target?.segment.endDate).toBe("2026-09-25");
    expect(target?.boardFrom).toBe("2026-09-01");
    expect(target?.boardTo).toBe("2026-09-15");
  });

  it("refuses a board that is not for the currently selected Property", () => {
    expect(buildMoveTarget(board, "prop-b", selectionFor(seg1))).toBeNull();
    expect(buildMoveTarget(board, null, selectionFor(seg1))).toBeNull();
  });

  it("refuses a Unit that is not on this board", () => {
    const elsewhere: AssignedSegmentSelection = { stay: { ...stay, reservationUnitId: "unit-gone" }, segment: seg1 };
    expect(buildMoveTarget(board, "prop-a", elsewhere)).toBeNull();
  });

  it("refuses a segmentId that no longer exists on this Unit (already unassigned or superseded elsewhere)", () => {
    const gone = { ...seg1, segmentId: "seg-gone" };
    expect(buildMoveTarget(board, "prop-a", selectionFor(gone))).toBeNull();
  });

  it("refuses a stale selection whose version no longer matches the board's current segment", () => {
    const stale = { ...seg1, segmentVersion: 1 };
    expect(buildMoveTarget(board, "prop-a", selectionFor(stale))).toBeNull();
  });

  it("refuses a stale selection whose room or range no longer matches the board's current segment", () => {
    const wrongRoom = { ...seg1, physicalRoomId: "room-102" };
    expect(buildMoveTarget(board, "prop-a", selectionFor(wrongRoom))).toBeNull();

    const wrongRange = { ...seg1, endDate: "2026-09-26" };
    expect(buildMoveTarget(board, "prop-a", selectionFor(wrongRange))).toBeNull();
  });

  it("excludes the segment's own current room from candidateRooms — no no-op move is offered", () => {
    const target = buildMoveTarget(board, "prop-a", selectionFor(seg1));
    expect(target?.candidateRooms.some((room) => room.id === "room-101")).toBe(false);
  });

  it("offers only Active rooms, same sold RoomType first, then cross-RoomType, excluding the current room", () => {
    const target = buildMoveTarget(board, "prop-a", selectionFor(seg1));
    expect(target?.candidateRooms.map((room) => room.id)).toEqual(["room-102", "room-201", "room-202"]);
    expect(target?.candidateRooms.filter((room) => room.isSameSoldType).map((room) => room.id)).toEqual([
      "room-102",
    ]);
    expect(target?.candidateRooms.some((room) => room.id === "room-103")).toBe(false);
    expect(target?.candidateRooms.some((room) => room.id === "room-301")).toBe(false);
  });

  it("does not mutate its board input", () => {
    const before = JSON.parse(JSON.stringify(board));
    buildMoveTarget(board, "prop-a", selectionFor(seg1));
    expect(board).toEqual(before);
  });
});
