import { describe, expect, it } from "vitest";
import { buildAssignmentTarget, selectAssignableRoomCandidates } from "./assignmentTarget";
import type { ReservationBoardPhysicalRoom, ReservationBoardResponse, ReservationBoardRoomType, ReservationBoardStay } from "@/lib/api/types";

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
  // Suite has a RoomType entry but its only room is OutOfService — the RoomType must contribute nothing.
  { id: "room-301", roomTypeId: "type-suite", roomNumber: "301", floor: 3, operationalStatus: "OutOfService" },
];

// A stay that runs past the board window on both sides, with the board's
// window-clipped, split unassigned ranges.
const stay: ReservationBoardStay = {
  reservationId: "res-1",
  reservationUnitId: "unit-1",
  confirmationNumber: "CNF-1",
  guestDisplayName: "Guest One",
  soldRoomTypeId: "type-standard",
  checkIn: "2026-08-25",
  checkOut: "2026-09-20",
  coverageStatus: "PartiallyAssigned",
  assignments: [],
  unassignedRanges: [
    { startDate: "2026-09-01", endDate: "2026-09-04" },
    { startDate: "2026-09-06", endDate: "2026-09-15" },
  ],
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

describe("selectAssignableRoomCandidates (PMS-CAL-001.2-CP03B)", () => {
  it("orders same sold-RoomType candidates first, then cross-RoomType candidates, each group in board order", () => {
    const candidates = selectAssignableRoomCandidates(rooms, roomTypes, "type-standard");
    expect(candidates.map((room) => room.id)).toEqual(["room-101", "room-102", "room-201", "room-202"]);
  });

  it("tags same sold-RoomType candidates isSameSoldType:true with the sold RoomType's own name", () => {
    const candidates = selectAssignableRoomCandidates(rooms, roomTypes, "type-standard");
    expect(candidates.slice(0, 2)).toEqual([
      { id: "room-101", roomNumber: "101", floor: 1, roomTypeId: "type-standard", roomTypeName: "Standard", isSameSoldType: true },
      { id: "room-102", roomNumber: "102", floor: 1, roomTypeId: "type-standard", roomTypeName: "Standard", isSameSoldType: true },
    ]);
  });

  it("tags cross-RoomType candidates isSameSoldType:false with their own RoomType's name — never the sold one", () => {
    const candidates = selectAssignableRoomCandidates(rooms, roomTypes, "type-standard");
    expect(candidates.slice(2)).toEqual([
      { id: "room-201", roomNumber: "201", floor: 2, roomTypeId: "type-deluxe", roomTypeName: "Deluxe", isSameSoldType: false },
      { id: "room-202", roomNumber: "202", floor: 2, roomTypeId: "type-deluxe", roomTypeName: "Deluxe", isSameSoldType: false },
    ]);
  });

  it("never offers an OutOfService room, in either group, even when it is the RoomType's only room", () => {
    const candidates = selectAssignableRoomCandidates(rooms, roomTypes, "type-standard");
    expect(candidates.some((room) => room.id === "room-103")).toBe(false);
    expect(candidates.some((room) => room.id === "room-301")).toBe(false);
    expect(candidates.some((room) => room.roomTypeId === "type-suite")).toBe(false);
  });

  it("puts every Active room into the cross-RoomType group when the sold RoomType matches none of them", () => {
    const candidates = selectAssignableRoomCandidates(rooms, roomTypes, "type-penthouse");
    expect(candidates.every((room) => room.isSameSoldType === false)).toBe(true);
    expect(candidates.map((room) => room.id)).toEqual(["room-101", "room-102", "room-201", "room-202"]);
  });

  it("falls back to a safe placeholder name for a RoomType id absent from the board's roomTypes list", () => {
    const orphanRoom: ReservationBoardPhysicalRoom = {
      id: "room-901",
      roomTypeId: "type-unknown",
      roomNumber: "901",
      floor: 9,
      operationalStatus: "Active",
    };
    const candidates = selectAssignableRoomCandidates([orphanRoom], roomTypes, "type-standard");
    expect(candidates).toEqual([
      { id: "room-901", roomNumber: "901", floor: 9, roomTypeId: "type-unknown", roomTypeName: "Unknown room type", isSameSoldType: false },
    ]);
  });
});

describe("buildAssignmentTarget", () => {
  it("targets exactly the selected partial range of a stay that extends beyond the window", () => {
    const target = buildAssignmentTarget(board, "prop-a", {
      stay,
      unassignedRange: { startDate: "2026-09-06", endDate: "2026-09-15" },
    });

    expect(target).not.toBeNull();
    expect(target!.propertyId).toBe("prop-a");
    expect(target!.unassignedRange).toEqual({ startDate: "2026-09-06", endDate: "2026-09-15" });
    expect(target!.stay.reservationUnitId).toBe("unit-1");
    expect(target!.soldRoomTypeName).toBe("Standard");
  });

  it("populates candidateRooms with every Active room of the Property, same sold RoomType first (PMS-CAL-001.2-CP03B)", () => {
    const target = buildAssignmentTarget(board, "prop-a", { stay, unassignedRange: stay.unassignedRanges[0] });
    expect(target!.candidateRooms.map((room) => room.id)).toEqual(["room-101", "room-102", "room-201", "room-202"]);
    expect(target!.candidateRooms.filter((room) => room.isSameSoldType).map((room) => room.id)).toEqual([
      "room-101",
      "room-102",
    ]);
    expect(target!.candidateRooms.filter((room) => !room.isSameSoldType).map((room) => room.id)).toEqual([
      "room-201",
      "room-202",
    ]);
  });

  it("refuses a board that is not for the currently selected Property", () => {
    expect(
      buildAssignmentTarget(board, "prop-b", { stay, unassignedRange: stay.unassignedRanges[0] })
    ).toBeNull();
    expect(buildAssignmentTarget(board, null, { stay, unassignedRange: stay.unassignedRanges[0] })).toBeNull();
  });

  it("refuses a range that is not one of the Unit's server-returned ranges (e.g. reconstructed or stale)", () => {
    expect(
      buildAssignmentTarget(board, "prop-a", { stay, unassignedRange: { startDate: "2026-09-01", endDate: "2026-09-15" } })
    ).toBeNull();
    expect(
      buildAssignmentTarget(board, "prop-a", { stay, unassignedRange: { startDate: "2026-09-02", endDate: "2026-09-04" } })
    ).toBeNull();
  });

  it("refuses a Unit that is not on this board", () => {
    const other = { ...stay, reservationUnitId: "unit-elsewhere" };
    expect(buildAssignmentTarget(board, "prop-a", { stay: other, unassignedRange: stay.unassignedRanges[0] })).toBeNull();
  });
});
