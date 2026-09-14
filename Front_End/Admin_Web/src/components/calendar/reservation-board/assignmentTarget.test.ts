import { describe, expect, it } from "vitest";
import { buildAssignmentTarget, selectSameRoomTypeCandidates } from "./assignmentTarget";
import type { ReservationBoardPhysicalRoom, ReservationBoardResponse, ReservationBoardStay } from "@/lib/api/types";

const rooms: ReservationBoardPhysicalRoom[] = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
  { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
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
  roomTypes: [
    { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    { id: "type-standard", code: "STD", name: "Standard", isActive: true },
  ],
  physicalRooms: rooms,
  stays: [stay],
  operationalBlocks: [],
};

describe("selectSameRoomTypeCandidates", () => {
  it("returns only Active rooms of the sold RoomType, in board order", () => {
    expect(selectSameRoomTypeCandidates(rooms, "type-standard").map((room) => room.id)).toEqual([
      "room-101",
      "room-102",
    ]);
  });

  it("never offers a room of another RoomType", () => {
    expect(selectSameRoomTypeCandidates(rooms, "type-deluxe").map((room) => room.id)).toEqual(["room-201"]);
    expect(selectSameRoomTypeCandidates(rooms, "type-penthouse")).toEqual([]);
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
    expect(target!.candidateRooms.map((room) => room.id)).toEqual(["room-101", "room-102"]);
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
