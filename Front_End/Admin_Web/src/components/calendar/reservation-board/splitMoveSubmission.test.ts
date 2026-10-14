import { describe, expect, it } from "vitest";
import {
  SPLIT_MOVE_AWAITING_REREAD_MESSAGE,
  SPLIT_MOVE_CROSS_NOT_PERMITTED_MESSAGE,
  SPLIT_MOVE_ROOM_LOCKED_MESSAGE,
  SPLIT_MOVE_SOURCE_CHANGED_MESSAGE,
  STALE_SPLIT_MOVE_DIALOG_MESSAGE,
  checkSplitMoveLocks,
  evaluateSplitMoveOffer,
  planSplitMoveSend,
  segmentCanBeSplit,
  type SplitMoveSendInput,
} from "./splitMoveSubmission";
import { boardIdentityKey } from "./assignmentTarget";
import { buildSplitMoveTarget, type SplitMoveTarget } from "./splitMoveTarget";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";
import type { Reconciliation, ReconciliationTarget } from "./reconciliation";
import type { SplitMoveIntent } from "./ReservationSplitMoveDialog";
import type { AssignedSegmentSelection } from "./ReservationBoardServerTimeline";
import type { ReservationBoardResponse } from "@/lib/api/types";

const FROM = "2026-09-01";
const TO = "2026-09-15";
const KEY = boardIdentityKey("prop-a", FROM, TO);

interface BoardOptions {
  sourceRoom?: string;
  start?: string;
  end?: string;
  version?: number;
  localToday?: string;
  room102Status?: string;
}

function board(options: BoardOptions = {}): ReservationBoardResponse {
  const { sourceRoom = "room-101", start = "2026-09-04", end = "2026-09-10", version = 3, localToday = "2026-09-01", room102Status = "Active" } = options;
  return {
    property: { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday, checkInTime: "14:00", checkOutTime: "12:00" },
    from: FROM,
    to: TO,
    roomTypes: [
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    ],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: room102Status },
      { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "Active" },
      { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
      { id: "room-301", roomTypeId: "type-deluxe", roomNumber: "301", floor: 3, operationalStatus: "Active" },
    ],
    stays: [
      {
        reservationId: "res-1",
        reservationUnitId: "unit-1",
        confirmationNumber: "CNF-100",
        guestDisplayName: "Nguyen Van A",
        soldRoomTypeId: "type-standard",
        checkIn: start,
        checkOut: end,
        coverageStatus: "FullyAssigned",
        assignments: [
          {
            segmentId: "seg-1",
            segmentVersion: version,
            physicalRoomId: sourceRoom,
            actualRoomTypeId: sourceRoom === "room-301" ? "type-deluxe" : "type-standard",
            startDate: start,
            endDate: end,
          },
        ],
        unassignedRanges: [],
      },
    ],
    operationalBlocks: [],
  };
}

const selectionOf = (b: ReservationBoardResponse): AssignedSegmentSelection => ({ stay: b.stays[0], segment: b.stays[0].assignments[0] });

function openedFrom(b: ReservationBoardResponse): SplitMoveTarget {
  const target = buildSplitMoveTarget(b, "prop-a", selectionOf(b));
  if (target === null) throw new Error("fixture must build a target");
  return target;
}

const intent = (overrides: Partial<SplitMoveIntent> = {}): SplitMoveIntent => ({
  splitDate: "2026-09-07",
  destinationPhysicalRoomId: "room-102",
  confirmCrossRoomType: false,
  pastDateAcknowledged: false,
  ...overrides,
});

function input(overrides: Partial<SplitMoveSendInput> = {}, boardOptions: BoardOptions = {}): SplitMoveSendInput {
  const b = board(boardOptions);
  return {
    opened: openedFrom(board()),
    intent: intent(),
    board: b,
    currentBoardKey: KEY,
    canConfirmCrossRoomType: false,
    assignments: [],
    blocks: [],
    ...overrides,
  };
}

function plan(overrides: Partial<SplitMoveSendInput> = {}, boardOptions: BoardOptions = {}) {
  return planSplitMoveSend(input(overrides, boardOptions));
}

function entry(target: Partial<ReconciliationTarget> & { operation: ReconciliationTarget["operation"] }, extra: Partial<Reconciliation> = {}): Reconciliation {
  const base = {
    reservationUnitId: "unit-1",
    startDate: "2026-09-04",
    endDate: "2026-09-10",
    roomNumber: "102",
    guestDisplayName: "Nguyen Van A",
    confirmationNumber: "CNF-100",
    physicalRoomId: "room-102",
    segmentId: "seg-1",
    expectedVersion: 3,
    sourcePhysicalRoomId: "room-101",
    splitDate: "2026-09-07",
  };
  return {
    id: 1,
    key: KEY,
    propertyId: "prop-a",
    from: FROM,
    to: TO,
    afterSeq: 0,
    certainty: "uncertain",
    status: "done",
    resolution: "unresolved",
    target: { ...base, ...target } as ReconciliationTarget,
    ...extra,
  };
}

const blockEntry = (room: string, startDate: string, endDate: string, extra: Partial<BlockCreateReconciliation> = {}): BlockCreateReconciliation => ({
  id: 9,
  key: KEY,
  propertyId: "prop-a",
  from: FROM,
  to: TO,
  afterSeq: 0,
  certainty: "uncertain",
  status: "done",
  resolution: "unresolved",
  target: { operation: "create", physicalRoomId: room, roomNumber: room.slice(-3), startDate, endDate, reason: "Leak" },
  ...extra,
});

describe("planSplitMoveSend — the request", () => {
  it("builds exactly the five contract fields from the verified target, and the reconciliation target for the full source range", () => {
    const result = plan();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.propertyId).toBe("prop-a");
    expect(result.plan.segmentId).toBe("seg-1");
    expect(result.plan.request).toEqual({
      expectedVersion: 3,
      splitDate: "2026-09-07",
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: false,
    });
    expect(result.plan.writeTarget).toEqual({
      operation: "split-move",
      reservationUnitId: "unit-1",
      startDate: "2026-09-04",
      endDate: "2026-09-10",
      roomNumber: "102",
      guestDisplayName: "Nguyen Van A",
      confirmationNumber: "CNF-100",
      physicalRoomId: "room-102",
      segmentId: "seg-1",
      expectedVersion: 3,
      sourcePhysicalRoomId: "room-101",
      splitDate: "2026-09-07",
    });
  });

  it("takes version, ids and range from the board, never from the form: extra intent fields cannot reach the body", () => {
    const wide = { ...intent(), expectedVersion: 99, segmentId: "seg-evil", actor: "x", evidence: "y", propertyId: "other", pastDateAcknowledged: true };
    const result = plan({ intent: wide as SplitMoveIntent });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.plan.request).sort()).toEqual(["confirmCrossRoomType", "destinationPhysicalRoomId", "expectedVersion", "splitDate"]);
    expect(result.plan.request.expectedVersion).toBe(3);
    expect(result.plan.segmentId).toBe("seg-1");
    expect(JSON.stringify(result.plan.request)).not.toMatch(/actor|evidence|pastDate|seg-evil/);
  });

  it("includes a trimmed reason only when there is one", () => {
    const withReason = plan({ intent: intent({ reason: "  Guest request.  " }) });
    const blank = plan({ intent: intent({ reason: "   " }) });
    expect(withReason.ok && withReason.plan.request.reason).toBe("Guest request.");
    expect(blank.ok && "reason" in blank.plan.request).toBe(false);
  });
});

describe("planSplitMoveSend — the board must still be the one the dialog was opened from", () => {
  it("a view that moved on (live board key), no loaded board, or a board of another identity is stale and closes the dialog", () => {
    for (const result of [
      plan({ currentBoardKey: boardIdentityKey("prop-a", "2026-09-15", "2026-09-29") }),
      plan({ currentBoardKey: null }),
      plan({ board: null }),
      planSplitMoveSend({ ...input(), board: { ...board(), from: "2026-09-02" } }),
    ]) {
      expect(result).toEqual({ ok: false, message: STALE_SPLIT_MOVE_DIALOG_MESSAGE, stale: true });
    }
  });

  it("a source whose version, room or range changed is refused with the source-changed message", () => {
    for (const options of [{ version: 4 }, { sourceRoom: "room-103" }, { end: "2026-09-11" }, { start: "2026-09-03" }]) {
      expect(plan({}, options)).toEqual({ ok: false, message: SPLIT_MOVE_SOURCE_CHANGED_MESSAGE, stale: false });
    }
  });

  it("a stay that disappeared, or a segment that shrank to one night, is refused", () => {
    expect(plan({ board: { ...board(), stays: [] } })).toMatchObject({ ok: false, message: SPLIT_MOVE_SOURCE_CHANGED_MESSAGE });
    const oneNight = board({ start: "2026-09-04", end: "2026-09-05" });
    expect(planSplitMoveSend({ ...input(), board: oneNight, opened: { ...openedFrom(board()), segment: { ...openedFrom(board()).segment, endDate: "2026-09-05" } } })).toMatchObject({ ok: false });
  });
});

describe("planSplitMoveSend — the split date is a real Gregorian date strictly inside the source range", () => {
  it("accepts the first and last interior night, refuses the source's start and end", () => {
    expect(plan({ intent: intent({ splitDate: "2026-09-05" }) }).ok).toBe(true);
    expect(plan({ intent: intent({ splitDate: "2026-09-09" }) }).ok).toBe(true);
    for (const splitDate of ["2026-09-04", "2026-09-10", "2026-09-03", "2026-09-11"]) {
      const result = plan({ intent: intent({ splitDate }) });
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.message).toContain("2026-09-05");
      expect(!result.ok && result.message).toContain("2026-09-09");
    }
  });

  it("refuses an empty, malformed, impossible or padded date", () => {
    for (const splitDate of ["", "2026-9-7", "2026-02-30", "2026-13-01", "0000-01-01", "2026-09-07\n", " 2026-09-07", "07/09/2026"]) {
      expect(plan({ intent: intent({ splitDate }) })).toMatchObject({ ok: false });
    }
  });

  it("works on the earliest and latest real dates, where Date.UTC would misplace years 0–99", () => {
    const early = board({ start: "0001-02-27", end: "0001-03-02" }); // not a leap year: two nights before 03-01
    const opened = openedFrom(early);
    const ok = planSplitMoveSend({ ...input(), opened, board: early, currentBoardKey: boardIdentityKey("prop-a", FROM, TO), intent: intent({ splitDate: "0001-02-28", pastDateAcknowledged: true }) });
    expect(ok.ok).toBe(true);
    const late = board({ start: "9999-12-29", end: "9999-12-31", localToday: "9999-12-01" });
    const lateOk = planSplitMoveSend({ ...input(), opened: openedFrom(late), board: late, intent: intent({ splitDate: "9999-12-30" }) });
    expect(lateOk.ok).toBe(true);
  });
});

describe("planSplitMoveSend — destination (D2) and RoomType (D1, D3)", () => {
  it("refuses the source room, an unknown room and a room that is no longer Active", () => {
    for (const destinationPhysicalRoomId of ["room-101", "room-999", ""]) {
      expect(plan({ intent: intent({ destinationPhysicalRoomId }) })).toMatchObject({ ok: false });
    }
    expect(plan({}, { room102Status: "OutOfService" })).toMatchObject({ ok: false });
  });

  it("same RoomType both parts: no confirmation, a reason is optional, and confirm is sent false even if the form said true", () => {
    const result = plan({ intent: intent({ confirmCrossRoomType: true }) });
    expect(result.ok && result.plan.request.confirmCrossRoomType).toBe(false);
    expect(result.ok && result.plan.crossRoomType).toBe(false);
  });

  const matrix = [
    { name: "suffix only", source: "room-101", destination: "room-201" },
    { name: "prefix only", source: "room-301", destination: "room-102" },
    { name: "both", source: "room-301", destination: "room-201" },
  ];
  for (const { name, source, destination } of matrix) {
    it(`${name}: needs a Manager, the confirmation and a non-blank reason; then sends confirm true with the trimmed reason`, () => {
      const options = { sourceRoom: source };
      const opened = openedFrom(board(options));
      const base = { opened, intent: intent({ destinationPhysicalRoomId: destination, confirmCrossRoomType: true, reason: "  Upgrade  " }) };
      expect(plan({ ...base, canConfirmCrossRoomType: false }, options)).toEqual({ ok: false, message: SPLIT_MOVE_CROSS_NOT_PERMITTED_MESSAGE, stale: false });
      expect(plan({ ...base, canConfirmCrossRoomType: true, intent: { ...base.intent, confirmCrossRoomType: false } }, options)).toMatchObject({ ok: false });
      for (const reason of [undefined, "", "   "]) {
        expect(plan({ ...base, canConfirmCrossRoomType: true, intent: { ...base.intent, reason } }, options)).toMatchObject({ ok: false });
      }
      const ok = plan({ ...base, canConfirmCrossRoomType: true }, options);
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.plan.request.confirmCrossRoomType).toBe(true);
        expect(ok.plan.request.reason).toBe("Upgrade");
      }
    });
  }

  it("the reason limit is 500 characters after trimming, with or without a cross-type part", () => {
    const exactly = "x".repeat(500);
    const over = "x".repeat(501);
    expect(plan({ intent: intent({ reason: ` ${exactly} ` }) }).ok).toBe(true);
    expect(plan({ intent: intent({ reason: over }) })).toMatchObject({ ok: false });
    const options = { sourceRoom: "room-101" };
    const cross = { canConfirmCrossRoomType: true, intent: intent({ destinationPhysicalRoomId: "room-201", confirmCrossRoomType: true }) };
    expect(plan({ ...cross, intent: { ...cross.intent, reason: exactly } }, options).ok).toBe(true);
    expect(plan({ ...cross, intent: { ...cross.intent, reason: over } }, options)).toMatchObject({ ok: false });
  });
});

describe("planSplitMoveSend — the past-date rule (D4) uses the board's current localToday", () => {
  it("before localToday needs the acknowledgement; the day itself and later do not; the flag never reaches the request", () => {
    const options = { localToday: "2026-09-08" };
    expect(plan({ intent: intent({ splitDate: "2026-09-07" }) }, options)).toMatchObject({ ok: false });
    const acknowledged = plan({ intent: intent({ splitDate: "2026-09-07", pastDateAcknowledged: true }) }, options);
    expect(acknowledged.ok).toBe(true);
    expect(acknowledged.ok && JSON.stringify(acknowledged.plan.request)).not.toMatch(/ack|past/i);
    expect(plan({ intent: intent({ splitDate: "2026-09-08" }) }, options).ok).toBe(true);
    expect(plan({ intent: intent({ splitDate: "2026-09-09" }) }, options).ok).toBe(true);
  });

  it("an acknowledged dialog whose Property date has since moved on is still judged against the new date", () => {
    // Opened when the Property's date was 09-01 (not past); now the board says 09-08.
    expect(plan({ intent: intent({ splitDate: "2026-09-07" }) }, { localToday: "2026-09-08" })).toMatchObject({ ok: false });
  });

  it("an invalid localToday is never read as 'not in the past'", () => {
    for (const localToday of ["", "2026-02-30", "garbage"]) {
      expect(plan({}, { localToday })).toMatchObject({ ok: false });
    }
  });

  it("the past acknowledgement does not replace the cross-type confirmation, nor the reverse", () => {
    const options = { localToday: "2026-09-08" };
    const cross = { canConfirmCrossRoomType: true };
    const both = intent({ destinationPhysicalRoomId: "room-201", splitDate: "2026-09-07", confirmCrossRoomType: true, reason: "Upgrade", pastDateAcknowledged: true });
    expect(plan({ ...cross, intent: both }, options).ok).toBe(true);
    expect(plan({ ...cross, intent: { ...both, confirmCrossRoomType: false } }, options)).toMatchObject({ ok: false });
    expect(plan({ ...cross, intent: { ...both, pastDateAcknowledged: false } }, options)).toMatchObject({ ok: false });
    // Past alone needs no reason.
    expect(plan({ intent: intent({ splitDate: "2026-09-07", pastDateAcknowledged: true }) }, options).ok).toBe(true);
  });
});

describe("locks — checked before any intent is recorded or request sent", () => {
  const refusedAs = (lists: Partial<SplitMoveSendInput>, message: string) =>
    expect(plan(lists)).toEqual({ ok: false, message, stale: false });

  it("a board waiting to be re-read after any write refuses the send", () => {
    refusedAs({ assignments: [entry({ operation: "move" }, { status: "pending", certainty: "settled", resolution: "settled" })] }, SPLIT_MOVE_AWAITING_REREAD_MESSAGE);
    refusedAs({ blocks: [blockEntry("room-103", "2026-09-12", "2026-09-13", { status: "pending", certainty: "settled", resolution: "settled" })] }, SPLIT_MOVE_AWAITING_REREAD_MESSAGE);
  });

  it("an unresolved move, unassign or split-move of the same segment refuses it — whichever operation", () => {
    for (const operation of ["move", "unassign", "split-move"] as const) {
      refusedAs({ assignments: [entry({ operation })] }, SPLIT_MOVE_ROOM_LOCKED_MESSAGE);
    }
  });

  it("the segment lock matches on the segment id alone — a stale entry with other dates or another Unit still refuses it", () => {
    refusedAs(
      { assignments: [entry({ operation: "move", startDate: "2026-08-01", endDate: "2026-08-03", reservationUnitId: "unit-x", sourcePhysicalRoomId: "room-399", physicalRoomId: "room-398" })] },
      SPLIT_MOVE_ROOM_LOCKED_MESSAGE
    );
    // A different segment id with no overlap locks nothing.
    expect(plan({ assignments: [entry({ operation: "move", segmentId: "seg-other", startDate: "2026-08-01", endDate: "2026-08-03", reservationUnitId: "unit-x", sourcePhysicalRoomId: "room-399", physicalRoomId: "room-398" })] }).ok).toBe(true);
  });

  it("an unresolved write on the source room over its nights, or for this Unit over those nights, refuses it", () => {
    refusedAs({ blocks: [blockEntry("room-101", "2026-09-08", "2026-09-09")] }, SPLIT_MOVE_ROOM_LOCKED_MESSAGE);
    refusedAs({ assignments: [entry({ operation: "create", segmentId: undefined, expectedVersion: undefined, sourcePhysicalRoomId: undefined, physicalRoomId: "room-103", startDate: "2026-09-05", endDate: "2026-09-06" } as never)] }, SPLIT_MOVE_ROOM_LOCKED_MESSAGE);
  });

  it("the destination is locked only over the later nights [splitDate, end): a lock on the prefix nights does not refuse it", () => {
    refusedAs({ blocks: [blockEntry("room-102", "2026-09-08", "2026-09-09")] }, SPLIT_MOVE_ROOM_LOCKED_MESSAGE);
    expect(plan({ blocks: [blockEntry("room-102", "2026-09-04", "2026-09-06")] }).ok).toBe(true);
    // Half-open adjacency is not overlap.
    expect(plan({ blocks: [blockEntry("room-102", "2026-09-05", "2026-09-07")] }).ok).toBe(true);
    expect(plan({ blocks: [blockEntry("room-102", "2026-09-10", "2026-09-12")] }).ok).toBe(true);
  });

  it("settled, observed and changed entries, other Properties and other rooms lock nothing", () => {
    expect(plan({ assignments: [entry({ operation: "move" }, { resolution: "observed" }), entry({ operation: "unassign" }, { resolution: "changed" }), entry({ operation: "split-move" }, { certainty: "settled", resolution: "settled" })] }).ok).toBe(true);
    expect(plan({ assignments: [entry({ operation: "move" }, { propertyId: "prop-b" })] }).ok).toBe(true);
    expect(plan({ blocks: [blockEntry("room-103", "2026-09-04", "2026-09-10")] }).ok).toBe(true);
  });

  it("checkSplitMoveLocks answers for a built target on its own", () => {
    const target = openedFrom(board());
    expect(checkSplitMoveLocks({ assignments: [], blocks: [] }, target)).toBeNull();
    expect(checkSplitMoveLocks({ assignments: [entry({ operation: "split-move" })], blocks: [] }, target)).toBe(SPLIT_MOVE_ROOM_LOCKED_MESSAGE);
  });
});

describe("evaluateSplitMoveOffer", () => {
  const offer = (overrides: Partial<Parameters<typeof evaluateSplitMoveOffer>[0]> = {}, boardOptions: BoardOptions = {}) => {
    const b = board(boardOptions);
    return evaluateSplitMoveOffer({
      board: b,
      selectedPropertyId: "prop-a",
      selection: selectionOf(board()),
      assignments: [],
      blocks: [],
      canConfirmCrossRoomType: false,
      ...overrides,
    });
  };

  it("offers a built target for a matching selection", () => {
    const result = offer();
    expect(result.unavailableReason).toBeNull();
    expect(result.target?.segment.segmentId).toBe("seg-1");
  });

  it("offers nothing without a loaded board, for another Property, or when the selection no longer matches", () => {
    expect(offer({ board: null })).toEqual({ target: null, unavailableReason: "The board is not loaded." });
    expect(offer({ selectedPropertyId: "prop-b" }).target).toBeNull();
    expect(offer({}, { version: 9 })).toMatchObject({ target: null, unavailableReason: SPLIT_MOVE_SOURCE_CHANGED_MESSAGE });
  });

  it("says why when a lock refuses it, still returning the target", () => {
    const awaiting = offer({ assignments: [entry({ operation: "move" }, { status: "pending", certainty: "settled", resolution: "settled" })] });
    expect(awaiting.target).not.toBeNull();
    expect(awaiting.unavailableReason).toContain("re-read");
    const unresolved = offer({ assignments: [entry({ operation: "unassign" })] });
    expect(unresolved.unavailableReason).toContain("unconfirmed");
  });

  it("a stay whose current room is another type than sold needs the Manager permission", () => {
    // A selection made on the Standard board no longer matches a board whose source sits in a Deluxe room.
    expect(offer({}, { sourceRoom: "room-301" }).unavailableReason).toBe(SPLIT_MOVE_SOURCE_CHANGED_MESSAGE);
    // The selection must be the board's own segment, so build it for the Deluxe source.
    const deluxe = board({ sourceRoom: "room-301" });
    const asManager = evaluateSplitMoveOffer({ board: deluxe, selectedPropertyId: "prop-a", selection: selectionOf(deluxe), assignments: [], blocks: [], canConfirmCrossRoomType: true });
    expect(asManager.unavailableReason).toBeNull();
    const asDesk = evaluateSplitMoveOffer({ board: deluxe, selectedPropertyId: "prop-a", selection: selectionOf(deluxe), assignments: [], blocks: [], canConfirmCrossRoomType: false });
    expect(asDesk.unavailableReason).toContain("needs a Manager");
  });
});

describe("segmentCanBeSplit", () => {
  it("is true from two nights, false for one night and for ranges that are not real dates", () => {
    expect(segmentCanBeSplit({ startDate: "2026-09-04", endDate: "2026-09-06" })).toBe(true);
    expect(segmentCanBeSplit({ startDate: "2026-09-04", endDate: "2026-09-05" })).toBe(false);
    expect(segmentCanBeSplit({ startDate: "2026-09-04", endDate: "2026-09-04" })).toBe(false);
    expect(segmentCanBeSplit({ startDate: "2026-09-06", endDate: "2026-09-04" })).toBe(false);
    expect(segmentCanBeSplit({ startDate: "2026-02-30", endDate: "2026-03-05" })).toBe(false);
    expect(segmentCanBeSplit({ startDate: "0001-12-30", endDate: "0002-01-01" })).toBe(true);
  });
});
