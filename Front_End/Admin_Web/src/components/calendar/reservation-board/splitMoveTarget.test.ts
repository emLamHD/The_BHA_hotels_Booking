import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSplitMoveTarget } from "./splitMoveTarget";
import type {
  ReservationBoardAssignment,
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
  { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
  { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
  { id: "room-202", roomTypeId: "type-deluxe", roomNumber: "202", floor: 2, operationalStatus: "Active" },
];

// seg1 runs past the visible window on both sides; seg2 is a one-night segment of the same booked stay;
// seg3 is a partial segment of a longer booked stay, placed in a room of another RoomType than the one sold.
const seg1: ReservationBoardAssignment = {
  segmentId: "seg-1",
  segmentVersion: 2,
  physicalRoomId: "room-101",
  actualRoomTypeId: "type-standard",
  startDate: "2026-08-20",
  endDate: "2026-09-25",
};
const seg2: ReservationBoardAssignment = { ...seg1, segmentId: "seg-2", segmentVersion: 5, startDate: "2026-09-25", endDate: "2026-09-26" };
const seg3: ReservationBoardAssignment = {
  segmentId: "seg-3",
  segmentVersion: 7,
  physicalRoomId: "room-201",
  actualRoomTypeId: "type-deluxe",
  startDate: "2026-09-26",
  endDate: "2026-09-28",
};

const stay: ReservationBoardStay = {
  reservationId: "res-1",
  reservationUnitId: "unit-1",
  confirmationNumber: "CNF-1",
  guestDisplayName: "Guest One",
  soldRoomTypeId: "type-standard",
  checkIn: "2026-08-20",
  checkOut: "2026-10-05",
  coverageStatus: "PartiallyAssigned",
  assignments: [seg1, seg2, seg3],
  unassignedRanges: [{ startDate: "2026-09-28", endDate: "2026-10-05" }],
};

const board: ReservationBoardResponse = {
  property: { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: "2026-09-01", checkInTime: "14:00", checkOutTime: "12:00" },
  from: "2026-09-01",
  to: "2026-09-15",
  roomTypes,
  physicalRooms: rooms,
  stays: [stay],
  operationalBlocks: [],
};

const select = (segment: ReservationBoardAssignment, from: ReservationBoardStay = stay): AssignedSegmentSelection => ({ stay: from, segment });

describe("buildSplitMoveTarget (PMS-CAL-002-CP03)", () => {
  it("carries the exact source segment, its own full range, the board identity and localToday as data", () => {
    const target = buildSplitMoveTarget(board, "prop-a", select(seg1));
    expect(target).toMatchObject({
      propertyId: "prop-a",
      boardKey: "prop-a|2026-09-01|2026-09-15",
      boardFrom: "2026-09-01",
      boardTo: "2026-09-15",
      propertyName: "Property A",
      localToday: "2026-09-01",
      currentRoomNumber: "101",
      currentRoomTypeId: "type-standard",
      currentRoomTypeName: "Standard",
      soldRoomTypeName: "Standard",
    });
    expect(target?.segment).toEqual(seg1);
    expect(target?.stay.reservationUnitId).toBe("unit-1");
  });

  it("uses the segment's own range — not the visible window and not the booked stay — for a long and for a partial source", () => {
    const long = buildSplitMoveTarget(board, "prop-a", select(seg1));
    expect([long?.segment.startDate, long?.segment.endDate]).toEqual(["2026-08-20", "2026-09-25"]);
    const partial = buildSplitMoveTarget(board, "prop-a", select(seg3));
    expect([partial?.segment.startDate, partial?.segment.endDate]).toEqual(["2026-09-26", "2026-09-28"]);
    expect(partial?.stay.checkOut).toBe("2026-10-05");
  });

  it("refuses a one-night source — both successors need a night", () => {
    expect(buildSplitMoveTarget(board, "prop-a", select(seg2))).toBeNull();
  });

  it("accepts exactly two nights", () => {
    expect(buildSplitMoveTarget(board, "prop-a", select(seg3))?.segment.segmentId).toBe("seg-3");
  });

  afterEach(() => vi.useRealTimers());

  it("takes localToday from the board, not from the browser date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-06-15T12:00:00Z"));
    expect(buildSplitMoveTarget(board, "prop-a", select(seg1))?.localToday).toBe("2026-09-01");
    const farFuture = { ...board, property: { ...board.property, localToday: "2031-02-03" } };
    expect(buildSplitMoveTarget(farFuture, "prop-a", select(seg1))?.localToday).toBe("2031-02-03");
    const past = { ...board, property: { ...board.property, localToday: "2001-01-01" } };
    expect(buildSplitMoveTarget(past, "prop-a", select(seg1))?.localToday).toBe("2001-01-01");
  });

  it("refuses another Property, no selected Property, a missing Unit, a missing segment", () => {
    expect(buildSplitMoveTarget(board, "prop-b", select(seg1))).toBeNull();
    expect(buildSplitMoveTarget(board, null, select(seg1))).toBeNull();
    expect(buildSplitMoveTarget(board, "prop-a", select(seg1, { ...stay, reservationUnitId: "unit-gone" }))).toBeNull();
    expect(buildSplitMoveTarget(board, "prop-a", select({ ...seg1, segmentId: "seg-gone" }))).toBeNull();
  });

  it.each([
    ["version", { segmentVersion: 1 }],
    ["room", { physicalRoomId: "room-102" }],
    ["start date", { startDate: "2026-08-21" }],
    ["end date", { endDate: "2026-09-26" }],
  ])("refuses a stale selection whose %s differs from the board — it never substitutes the board's segment", (_name, patch) => {
    expect(buildSplitMoveTarget(board, "prop-a", select({ ...seg1, ...patch }))).toBeNull();
  });

  it("refuses a segment whose room is not on the board", () => {
    const missingRoom = { ...board, physicalRooms: rooms.filter((room) => room.id !== "room-101") };
    expect(buildSplitMoveTarget(missingRoom, "prop-a", select(seg1))).toBeNull();
  });

  it("takes the actual RoomType and names from the board's room, not from a stale selection", () => {
    const staleSelection = { ...seg3, actualRoomTypeId: "type-standard" };
    const target = buildSplitMoveTarget(board, "prop-a", select(staleSelection));
    // The stale actual type makes no difference: the segment is matched on id, version, room and range only.
    expect(target?.currentRoomTypeId).toBe("type-deluxe");
    expect(target?.currentRoomTypeName).toBe("Deluxe");
    expect(target?.segment.actualRoomTypeId).toBe("type-deluxe");
    const staleStay = { ...stay, soldRoomTypeId: "type-deluxe", guestDisplayName: "Stale" };
    expect(buildSplitMoveTarget(board, "prop-a", select(seg3, staleStay))?.stay.soldRoomTypeId).toBe("type-standard");
  });

  it("lists Active rooms only, excluding the source room, same sold RoomType first and each group in board order", () => {
    expect(buildSplitMoveTarget(board, "prop-a", select(seg1))?.candidateRooms.map((room) => room.id)).toEqual(["room-102", "room-201", "room-202"]);
    const fromDeluxe = buildSplitMoveTarget(board, "prop-a", select(seg3));
    expect(fromDeluxe?.candidateRooms.map((room) => room.id)).toEqual(["room-101", "room-102", "room-202"]);
    expect(fromDeluxe?.candidateRooms.map((room) => room.isSameSoldType)).toEqual([true, true, false]);
  });

  // PMS-CAL-002-CP03-C1: the two-night guard must hold on real Gregorian dates 0001–9999. Every expected value
  // below is a calendar fact written by hand (month lengths, the leap rule: divisible by 4, except centuries
  // unless divisible by 400) — none is computed with dateMath or with the implementation under test.
  const withSourceRange = (startDate: string, endDate: string) => {
    const source: ReservationBoardAssignment = { ...seg1, startDate, endDate };
    const sourceStay: ReservationBoardStay = { ...stay, checkIn: startDate, checkOut: endDate, assignments: [source], unassignedRanges: [] };
    const sourceBoard: ReservationBoardResponse = { ...board, stays: [sourceStay] };
    return buildSplitMoveTarget(sourceBoard, "prop-a", select(source, sourceStay));
  };

  it.each([
    ["crossing the 0099/0100 year boundary", "0099-12-31", "0100-01-02"],
    ["inside year 0099", "0099-06-10", "0099-06-12"],
    ["inside year 0050", "0050-03-01", "0050-03-03"],
    ["at the first representable day, 0001", "0001-01-01", "0001-01-03"],
    ["at the last representable days, 9999", "9999-12-29", "9999-12-31"],
    ["across the 0001/0002 boundary", "0001-12-31", "0002-01-02"],
    ["over 29 February of leap year 0004", "0004-02-28", "0004-03-01"],
    ["over 29 February of leap year 0400", "0400-02-28", "0400-03-01"],
    ["over 29 February of leap year 2028", "2028-02-28", "2028-03-01"],
    ["across 28 February of non-leap century year 0100 (two nights ending 2 March)", "0100-02-28", "0100-03-02"],
    ["across 28 February of non-leap year 1900", "1900-02-28", "1900-03-02"],
    ["a modern two-night stay", "2026-09-26", "2026-09-28"],
    ["a modern month-end two-night stay", "2026-09-30", "2026-10-02"],
    ["a long span between ancient and modern years", "0099-12-31", "2026-09-28"],
  ])("accepts a source of at least two nights %s", (_name, startDate, endDate) => {
    const target = withSourceRange(startDate, endDate);
    expect(target?.segment.segmentId).toBe("seg-1");
    // The server's strings are carried verbatim — never normalised to another year.
    expect([target?.segment.startDate, target?.segment.endDate]).toEqual([startDate, endDate]);
  });

  it.each([
    ["crossing the 0099/0100 year boundary", "0099-12-31", "0100-01-01"],
    ["inside year 0099", "0099-06-10", "0099-06-11"],
    ["at the first representable day, 0001", "0001-01-01", "0001-01-02"],
    ["at the last representable days, 9999", "9999-12-30", "9999-12-31"],
    ["over 28 February of leap year 0004 (the next day is 29 February)", "0004-02-28", "0004-02-29"],
    ["over 29 February of leap year 0400", "0400-02-29", "0400-03-01"],
    ["over 28 February of non-leap year 0100 (the next day is 1 March)", "0100-02-28", "0100-03-01"],
    ["a modern one-night stay", "2026-09-25", "2026-09-26"],
  ])("refuses a one-night source %s", (_name, startDate, endDate) => {
    expect(withSourceRange(startDate, endDate)).toBeNull();
  });

  it.each([
    ["year 0000", "0000-12-31", "0001-01-02"],
    ["year 0000 on both ends", "0000-01-01", "0000-01-05"],
    ["a day that does not exist (30 February)", "2026-02-28", "2026-02-30"],
    ["a day that does not exist (29 February 0100, a non-leap century)", "0100-02-27", "0100-02-29"],
    ["a day that does not exist (31 April)", "2026-04-29", "2026-04-31"],
    ["a month that does not exist", "2026-12-30", "2026-13-02"],
    ["day zero", "2026-09-00", "2026-09-05"],
    ["a reversed range", "2026-09-28", "2026-09-26"],
    ["an empty range", "2026-09-26", "2026-09-26"],
    ["a reversed range in year 0099/0100", "0100-01-02", "0099-12-31"],
    ["a date that is not zero-padded ISO", "2026-9-26", "2026-9-28"],
    ["text that is not a date", "not-a-date", "2026-09-28"],
    ["an empty string", "", ""],
    ["a five-digit year", "10000-01-01", "10000-01-05"],
  ])("refuses an invalid or unrepresentable source range: %s", (_name, startDate, endDate) => {
    expect(withSourceRange(startDate, endDate)).toBeNull();
  });

  it("does not mutate its board or selection", () => {
    const boardBefore = JSON.parse(JSON.stringify(board));
    const selection = select(seg1);
    const selectionBefore = JSON.parse(JSON.stringify(selection));
    buildSplitMoveTarget(board, "prop-a", selection);
    expect(board).toEqual(boardBefore);
    expect(selection).toEqual(selectionBefore);
  });
});
