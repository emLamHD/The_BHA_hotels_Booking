import { describe, expect, it } from "vitest";
import { buildUnassignTarget } from "./unassignTarget";
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
];

const rooms: ReservationBoardPhysicalRoom[] = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
];

// unit-1 has three segments: seg-1 runs past the board window on both sides,
// seg-2 sits in a different RoomType, seg-3 is in a room that is out of service.
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
  startDate: "2026-09-25",
  endDate: "2026-09-28",
};
const seg3 = {
  segmentId: "seg-3",
  segmentVersion: 1,
  physicalRoomId: "room-103",
  actualRoomTypeId: "type-standard",
  startDate: "2026-09-28",
  endDate: "2026-10-01",
};
// A second ReservationUnit of the same Reservation.
const segOtherUnit = {
  segmentId: "seg-9",
  segmentVersion: 1,
  physicalRoomId: "room-101",
  actualRoomTypeId: "type-standard",
  startDate: "2026-09-03",
  endDate: "2026-09-06",
};

const stay: ReservationBoardStay = {
  reservationId: "res-1",
  reservationUnitId: "unit-1",
  confirmationNumber: "CNF-1",
  guestDisplayName: "Guest One",
  soldRoomTypeId: "type-standard",
  checkIn: "2026-08-20",
  checkOut: "2026-10-01",
  coverageStatus: "FullyAssigned",
  assignments: [seg1, seg2, seg3],
  unassignedRanges: [],
};
const otherUnit: ReservationBoardStay = {
  ...stay,
  reservationUnitId: "unit-2",
  guestDisplayName: "Guest Two",
  checkIn: "2026-09-03",
  checkOut: "2026-09-06",
  assignments: [segOtherUnit],
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
  stays: [stay, otherUnit],
  operationalBlocks: [],
};

function selectionFor(segment: typeof seg1): AssignedSegmentSelection {
  return { stay, segment };
}

describe("buildUnassignTarget (PMS-CAL-001.2-CP04D.2)", () => {
  it("selects exactly the clicked segment, not the first or newest one, when a stay has several assignments", () => {
    for (const segment of [seg1, seg2, seg3]) {
      const target = buildUnassignTarget(board, "prop-a", selectionFor(segment));
      expect(target?.segment.segmentId).toBe(segment.segmentId);
      expect(target?.segment.segmentVersion).toBe(segment.segmentVersion);
      expect(target?.segment.physicalRoomId).toBe(segment.physicalRoomId);
    }
    expect(buildUnassignTarget(board, "prop-a", selectionFor(seg2))?.currentRoomNumber).toBe("201");
  });

  it("keeps the segment's full half-open range even though it extends past both edges of the board window", () => {
    const target = buildUnassignTarget(board, "prop-a", selectionFor(seg1));
    expect(target?.segment.startDate).toBe("2026-08-20");
    expect(target?.segment.endDate).toBe("2026-09-25");
    expect(target?.boardFrom).toBe("2026-09-01");
    expect(target?.boardTo).toBe("2026-09-15");
  });

  it("exposes the board identity, guest, sold RoomType and current room a dialog needs, from board data", () => {
    const target = buildUnassignTarget(board, "prop-a", selectionFor(seg2));
    expect(target).toMatchObject({
      propertyId: "prop-a",
      boardKey: "prop-a|2026-09-01|2026-09-15",
      propertyName: "Property A",
      soldRoomTypeName: "Standard",
      currentRoomNumber: "201",
      currentRoomTypeName: "Deluxe",
    });
    expect(target?.stay.guestDisplayName).toBe("Guest One");
    expect(target?.stay.confirmationNumber).toBe("CNF-1");
  });

  it("targets the clicked ReservationUnit, not every unit of the Reservation", () => {
    const target = buildUnassignTarget(board, "prop-a", { stay: otherUnit, segment: segOtherUnit });
    expect(target?.stay.reservationUnitId).toBe("unit-2");
    expect(target?.segment.segmentId).toBe("seg-9");
  });

  it("refuses a segment that belongs to a different ReservationUnit than the one clicked", () => {
    expect(buildUnassignTarget(board, "prop-a", { stay: otherUnit, segment: seg1 })).toBeNull();
  });

  it("refuses a board that is not for the currently selected Property", () => {
    expect(buildUnassignTarget(board, "prop-b", selectionFor(seg1))).toBeNull();
    expect(buildUnassignTarget(board, null, selectionFor(seg1))).toBeNull();
  });

  it("refuses a Unit that is no longer on this board", () => {
    const elsewhere: AssignedSegmentSelection = { stay: { ...stay, reservationUnitId: "unit-gone" }, segment: seg1 };
    expect(buildUnassignTarget(board, "prop-a", elsewhere)).toBeNull();
  });

  it("refuses a segmentId that no longer exists on this Unit", () => {
    expect(buildUnassignTarget(board, "prop-a", selectionFor({ ...seg1, segmentId: "seg-gone" }))).toBeNull();
  });

  it("refuses a stale selection whose version no longer matches, even with the same segmentId", () => {
    expect(buildUnassignTarget(board, "prop-a", selectionFor({ ...seg1, segmentVersion: 1 }))).toBeNull();
  });

  it("refuses a stale selection whose room or range no longer matches the board's current segment", () => {
    expect(buildUnassignTarget(board, "prop-a", selectionFor({ ...seg1, physicalRoomId: "room-201" }))).toBeNull();
    expect(buildUnassignTarget(board, "prop-a", selectionFor({ ...seg1, startDate: "2026-08-21" }))).toBeNull();
    expect(buildUnassignTarget(board, "prop-a", selectionFor({ ...seg1, endDate: "2026-09-26" }))).toBeNull();
  });

  it("refuses when the segment's current room is no longer in the Property data", () => {
    const withoutRoom = { ...board, physicalRooms: rooms.filter((room) => room.id !== "room-101") };
    expect(buildUnassignTarget(withoutRoom, "prop-a", selectionFor(seg1))).toBeNull();
  });

  it("still builds a target when the current room is not Active — operational status must not block an unassign", () => {
    const target = buildUnassignTarget(board, "prop-a", selectionFor(seg3));
    expect(target?.segment.segmentId).toBe("seg-3");
    expect(target?.currentRoomNumber).toBe("103");
  });

  it("does not mutate its board or selection input and offers no candidate rooms", () => {
    const selection = selectionFor(seg1);
    const boardBefore = JSON.parse(JSON.stringify(board));
    const selectionBefore = JSON.parse(JSON.stringify(selection));
    const target = buildUnassignTarget(board, "prop-a", selection);
    expect(board).toEqual(boardBefore);
    expect(selection).toEqual(selectionBefore);
    expect(target).not.toHaveProperty("candidateRooms");
  });
});
