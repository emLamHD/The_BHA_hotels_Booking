/**
 * PMS-CAL-003-CP03: the pure decisions behind a block move — whether the popover may offer it and why not,
 * and everything re-checked against the board as it is at send time. A stale view, a block that changed,
 * a destination that is no longer offered or any unresolved write refuses with no request, and the request
 * that does go out is built field by field from the verified target: it can never carry a confirmation,
 * an actor, dates, a header or a version the operator typed.
 */

import { describe, expect, it } from "vitest";
import {
  BLOCK_MOVE_AWAITING_REREAD_MESSAGE,
  BLOCK_MOVE_NO_ROOM_MESSAGE,
  BLOCK_MOVE_REASON_MAX_LENGTH,
  BLOCK_MOVE_SOURCE_CHANGED_MESSAGE,
  BLOCK_WRITE_LOCKED_MESSAGE,
  STALE_BLOCK_MOVE_DIALOG_MESSAGE,
  checkBlockMoveLocks,
  evaluateBlockMoveOffer,
  planBlockMoveSend,
  type BlockMoveIntent,
  type BlockMoveSendInput,
} from "./blockMoveSubmission";
import { boardIdentityKey } from "./assignmentTarget";
import { buildBlockMoveTarget, type BlockMoveTarget } from "./blockMoveTarget";
import type { BlockCreateReconciliation, BlockWriteTarget } from "./blockCreateReconciliation";
import type { Reconciliation, ReconciliationTarget } from "./reconciliation";
import type { BlockSelection } from "./ReservationBoardServerTimeline";
import type { ReservationBoardOperationalBlock, ReservationBoardPhysicalRoom, ReservationBoardResponse } from "@/lib/api/types";

const FROM = "2026-09-01";
const TO = "2026-09-15";
const KEY = boardIdentityKey("prop-a", FROM, TO);

const block: ReservationBoardOperationalBlock = {
  roomBlockId: "header-1",
  segmentId: "seg-1",
  segmentVersion: 42,
  physicalRoomId: "room-101",
  // Wider than the board window on both sides: the plan must carry the segment's own range.
  startDate: "2026-08-28",
  endDate: "2026-09-20",
  reason: "Burst pipe",
};

const rooms: ReservationBoardPhysicalRoom[] = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
  { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
];

function boardWith(
  blocks: ReservationBoardOperationalBlock[] = [block],
  physicalRooms: ReservationBoardPhysicalRoom[] = rooms,
  overrides: Partial<ReservationBoardResponse> = {}
): ReservationBoardResponse {
  return {
    property: { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: "2026-09-01", checkInTime: "14:00", checkOutTime: "12:00" },
    from: FROM,
    to: TO,
    roomTypes: [
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    ],
    physicalRooms,
    stays: [],
    operationalBlocks: blocks,
    ...overrides,
  };
}

const select = (value: ReservationBoardOperationalBlock = block): BlockSelection => ({ block: value, roomNumber: "101" });

function blockEntry(target: BlockWriteTarget, overrides: Partial<BlockCreateReconciliation> = {}): BlockCreateReconciliation {
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
    target,
    ...overrides,
  };
}

const cancelTarget = (overrides: Partial<Extract<BlockWriteTarget, { operation: "cancel" }>> = {}): BlockWriteTarget => ({
  operation: "cancel",
  physicalRoomId: "room-101",
  roomNumber: "101",
  startDate: block.startDate,
  endDate: block.endDate,
  reason: "Burst pipe",
  segmentId: "seg-1",
  expectedVersion: 42,
  ...overrides,
});

const moveTarget = (overrides: Partial<Extract<BlockWriteTarget, { operation: "move" }>> = {}): BlockWriteTarget => ({
  operation: "move",
  roomBlockId: "header-1",
  segmentId: "seg-1",
  expectedVersion: 42,
  sourcePhysicalRoomId: "room-101",
  sourceRoomNumber: "101",
  physicalRoomId: "room-102",
  roomNumber: "102",
  startDate: block.startDate,
  endDate: block.endDate,
  ...overrides,
});

function offerInput(overrides: Partial<Parameters<typeof evaluateBlockMoveOffer>[0]> = {}) {
  return {
    board: boardWith() as ReservationBoardResponse | null,
    selectedPropertyId: "prop-a" as string | null,
    currentBoardKey: KEY as string | null,
    selection: select(),
    assignments: [] as Reconciliation[],
    blocks: [] as BlockCreateReconciliation[],
    ...overrides,
  };
}

describe("evaluateBlockMoveOffer — when the popover may offer Move block…", () => {
  it("offers a block the board still shows exactly as clicked, and builds the target from the board", () => {
    const offer = evaluateBlockMoveOffer(offerInput());
    expect(offer.unavailableReason).toBeNull();
    expect(offer.target).toEqual(buildBlockMoveTarget(boardWith(), "prop-a", select()));
    expect(offer.target!.candidateRooms.map((room) => room.id)).toEqual(["room-102", "room-201"]);
  });

  it("offers a one-night block and a block in a room that is no longer Active", () => {
    const oneNight = { ...block, startDate: "2026-09-03", endDate: "2026-09-04" };
    expect(evaluateBlockMoveOffer(offerInput({ board: boardWith([oneNight]), selection: select(oneNight) })).unavailableReason).toBeNull();

    const inactive = rooms.map((room) => (room.id === "room-101" ? { ...room, operationalStatus: "OutOfService" } : room));
    const offer = evaluateBlockMoveOffer(offerInput({ board: boardWith([block], inactive) }));
    expect(offer.unavailableReason).toBeNull();
    expect(offer.target!.sourceRoomOperationalStatus).toBe("OutOfService");
  });

  it("says why when no board is loaded", () => {
    expect(evaluateBlockMoveOffer(offerInput({ board: null }))).toEqual({ target: null, unavailableReason: "The board is not loaded." });
  });

  it("says why when the board on screen is not the one the view shows", () => {
    for (const currentBoardKey of [null, boardIdentityKey("prop-b", FROM, TO), boardIdentityKey("prop-a", FROM, "2026-09-16")]) {
      const offer = evaluateBlockMoveOffer(offerInput({ currentBoardKey }));
      expect(offer.target).toBeNull();
      expect(offer.unavailableReason).toMatch(/out of date/);
    }
  });

  it("refuses a selection the board no longer backs, and says the block changed", () => {
    for (const changed of [
      { ...block, segmentVersion: 43 },
      { ...block, physicalRoomId: "room-102" },
      { ...block, endDate: "2026-09-21" },
      { ...block, roomBlockId: "header-2" },
    ]) {
      const offer = evaluateBlockMoveOffer(offerInput({ board: boardWith([changed]) }));
      expect(offer.target).toBeNull();
      expect(offer.unavailableReason).toBe(BLOCK_MOVE_SOURCE_CHANGED_MESSAGE);
    }
    expect(evaluateBlockMoveOffer(offerInput({ board: boardWith([]) })).unavailableReason).toBe(BLOCK_MOVE_SOURCE_CHANGED_MESSAGE);
    expect(evaluateBlockMoveOffer(offerInput({ selectedPropertyId: "prop-b" })).target).toBeNull();
    expect(evaluateBlockMoveOffer(offerInput({ selectedPropertyId: null })).target).toBeNull();
  });

  it("says a block of more than 366 nights cannot be moved in one step but can still be cancelled", () => {
    const longBlock = { ...block, startDate: "2026-01-01", endDate: "2027-01-03" }; // 367 nights
    const offer = evaluateBlockMoveOffer(offerInput({ board: boardWith([longBlock]), selection: select(longBlock) }));
    expect(offer.target).toBeNull();
    expect(offer.unavailableReason).toMatch(/longer than 366 nights/);
    expect(offer.unavailableReason).toMatch(/can still be cancelled/);

    const limit = { ...block, startDate: "2026-01-01", endDate: "2027-01-02" }; // 366 nights
    expect(evaluateBlockMoveOffer(offerInput({ board: boardWith([limit]), selection: select(limit) })).unavailableReason).toBeNull();
  });

  it("says an invalid date range cannot be moved", () => {
    for (const bad of [
      { ...block, startDate: "2026-02-30" },
      { ...block, endDate: "not-a-date" },
      { ...block, endDate: block.startDate },
    ]) {
      const offer = evaluateBlockMoveOffer(offerInput({ board: boardWith([bad]), selection: select(bad) }));
      expect(offer.target).toBeNull();
      expect(offer.unavailableReason).toMatch(/not valid/);
    }
  });

  it("says when no other Active room can take the block", () => {
    const onlyOne = rooms.map((room) => (room.id === "room-101" ? room : { ...room, operationalStatus: "OutOfService" }));
    const offer = evaluateBlockMoveOffer(offerInput({ board: boardWith([block], onlyOne) }));
    expect(offer.target).not.toBeNull();
    expect(offer.unavailableReason).toMatch(/No other Active room/);
  });

  it("waits while a write made from this board has not been re-read — of either list", () => {
    const pendingBlock = blockEntry(cancelTarget(), { status: "pending", certainty: "settled", resolution: "settled" });
    const pendingAssignment: Reconciliation = {
      id: 2, key: KEY, propertyId: "prop-a", from: FROM, to: TO, afterSeq: 0, certainty: "settled", status: "pending", resolution: "settled",
      target: { operation: "unassign", reservationUnitId: "u", startDate: "2026-09-02", endDate: "2026-09-04", roomNumber: "205", guestDisplayName: "", confirmationNumber: "", segmentId: "s", expectedVersion: 1, sourcePhysicalRoomId: "room-201" } as ReconciliationTarget,
    };
    for (const input of [offerInput({ blocks: [pendingBlock] }), offerInput({ assignments: [pendingAssignment] })]) {
      const offer = evaluateBlockMoveOffer(input);
      expect(offer.target).not.toBeNull();
      expect(offer.unavailableReason).toMatch(/re-read after the last change/);
    }
    // A write made from another board does not hold this one.
    const elsewhere = blockEntry(cancelTarget(), { key: boardIdentityKey("prop-b", FROM, TO), propertyId: "prop-b", status: "pending", certainty: "settled", resolution: "settled" });
    expect(evaluateBlockMoveOffer(offerInput({ blocks: [elsewhere] })).unavailableReason).toBeNull();
  });

  it("is unavailable while this very segment has an unresolved cancel or move, even when its rooms and nights do not overlap", () => {
    const farAway = { startDate: "2027-05-01", endDate: "2027-05-03" };
    for (const entry of [
      blockEntry(cancelTarget({ physicalRoomId: "room-201", roomNumber: "201", ...farAway })),
      blockEntry(moveTarget({ sourcePhysicalRoomId: "room-201", sourceRoomNumber: "201", physicalRoomId: "room-103", roomNumber: "103", ...farAway })),
    ]) {
      const offer = evaluateBlockMoveOffer(offerInput({ blocks: [entry] }));
      expect(offer.target).not.toBeNull();
      expect(offer.unavailableReason).toMatch(/still unconfirmed/);
    }
  });

  it("is unavailable while any unresolved write covers the source room over its nights, and not otherwise", () => {
    const createInSource = blockEntry({ operation: "create", physicalRoomId: "room-101", roomNumber: "101", startDate: "2026-09-02", endDate: "2026-09-03", reason: "x" });
    expect(evaluateBlockMoveOffer(offerInput({ blocks: [createInSource] })).unavailableReason).toMatch(/still unconfirmed/);

    const otherRoom = blockEntry({ operation: "create", physicalRoomId: "room-201", roomNumber: "201", startDate: "2026-09-02", endDate: "2026-09-03", reason: "x" });
    expect(evaluateBlockMoveOffer(offerInput({ blocks: [otherRoom] })).unavailableReason).toBeNull();

    // Half-open adjacency: a lock ending where the block starts does not touch it.
    const adjacent = blockEntry({ operation: "create", physicalRoomId: "room-101", roomNumber: "101", startDate: "2026-08-26", endDate: "2026-08-28", reason: "x" });
    expect(evaluateBlockMoveOffer(offerInput({ blocks: [adjacent] })).unavailableReason).toBeNull();
  });

  it("a resolved or settled entry of the same segment does not hold the move", () => {
    for (const resolution of ["observed", "changed", "settled"] as const) {
      const entry = blockEntry(moveTarget(), { resolution, certainty: resolution === "settled" ? "settled" : "uncertain" });
      expect(evaluateBlockMoveOffer(offerInput({ blocks: [entry] })).unavailableReason).toBeNull();
    }
    // Another segment's cancel in another room does not either.
    const otherSegment = blockEntry(cancelTarget({ segmentId: "seg-other", physicalRoomId: "room-201", roomNumber: "201" }));
    expect(evaluateBlockMoveOffer(offerInput({ blocks: [otherSegment] })).unavailableReason).toBeNull();
  });
});

describe("checkBlockMoveLocks", () => {
  const target = (): BlockMoveTarget => buildBlockMoveTarget(boardWith(), "prop-a", select())!;

  it("returns null with nothing outstanding", () => {
    expect(checkBlockMoveLocks({ assignments: [], blocks: [] }, target())).toBeNull();
  });

  it("answers the awaiting-reread message for a settled write whose board has not been re-read", () => {
    const pending = blockEntry(moveTarget(), { status: "pending", certainty: "settled", resolution: "settled" });
    expect(checkBlockMoveLocks({ assignments: [], blocks: [pending] }, target())).toBe(BLOCK_MOVE_AWAITING_REREAD_MESSAGE);
  });

  it("answers the locked message — the more precise one — when an unresolved write is also awaiting its re-read", () => {
    const pendingAndUnresolved = blockEntry(moveTarget(), { status: "pending" });
    expect(checkBlockMoveLocks({ assignments: [], blocks: [pendingAndUnresolved] }, target())).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
  });

  it("answers the locked message for a segment or source-room lock", () => {
    expect(checkBlockMoveLocks({ assignments: [], blocks: [blockEntry(cancelTarget())] }, target())).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
  });

  it("looks at the destination only when one is given", () => {
    const inDestination = blockEntry({ operation: "create", physicalRoomId: "room-102", roomNumber: "102", startDate: "2026-09-02", endDate: "2026-09-03", reason: "x" });
    expect(checkBlockMoveLocks({ assignments: [], blocks: [inDestination] }, target())).toBeNull();
    expect(checkBlockMoveLocks({ assignments: [], blocks: [inDestination] }, target(), "room-102")).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
    expect(checkBlockMoveLocks({ assignments: [], blocks: [inDestination] }, target(), "room-201")).toBeNull();
  });
});

function sendInput(overrides: Partial<BlockMoveSendInput> = {}): BlockMoveSendInput {
  return {
    opened: buildBlockMoveTarget(boardWith(), "prop-a", select())!,
    intent: { destinationPhysicalRoomId: "room-102" },
    board: boardWith(),
    currentBoardKey: KEY,
    assignments: [],
    blocks: [],
    ...overrides,
  };
}

function okPlan(input: BlockMoveSendInput) {
  const result = planBlockMoveSend(input);
  if (!result.ok) throw new Error(`expected a plan, got refusal: ${result.message}`);
  return result.plan;
}

function refusal(input: BlockMoveSendInput) {
  const result = planBlockMoveSend(input);
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

describe("planBlockMoveSend — the request", () => {
  it("builds exactly expectedVersion + destinationPhysicalRoomId from the verified target when there is no reason", () => {
    const plan = okPlan(sendInput());
    expect(plan.propertyId).toBe("prop-a");
    expect(plan.segmentId).toBe("seg-1");
    expect(plan.request).toEqual({ expectedVersion: 42, destinationPhysicalRoomId: "room-102" });
    expect(Object.keys(plan.request)).toEqual(["expectedVersion", "destinationPhysicalRoomId"]);
  });

  it("sends a trimmed reason only when one was entered; blank or whitespace sends none", () => {
    expect(okPlan(sendInput({ intent: { destinationPhysicalRoomId: "room-102", reason: "  Repair done \n" } })).request).toEqual({
      expectedVersion: 42,
      destinationPhysicalRoomId: "room-102",
      reason: "Repair done",
    });
    for (const reason of ["", "   ", "\n\t "]) {
      const plan = okPlan(sendInput({ intent: { destinationPhysicalRoomId: "room-102", reason } }));
      expect(Object.keys(plan.request)).toEqual(["expectedVersion", "destinationPhysicalRoomId"]);
    }
  });

  it("accepts a reason of exactly 500 characters (also after trimming) and refuses 501", () => {
    const exactly = "x".repeat(BLOCK_MOVE_REASON_MAX_LENGTH);
    expect(okPlan(sendInput({ intent: { destinationPhysicalRoomId: "room-102", reason: exactly } })).request.reason).toBe(exactly);
    expect(okPlan(sendInput({ intent: { destinationPhysicalRoomId: "room-102", reason: `  ${exactly}  ` } })).request.reason).toBe(exactly);
    const over = refusal(sendInput({ intent: { destinationPhysicalRoomId: "room-102", reason: "x".repeat(501) } }));
    expect(over.message).toMatch(/at most 500 characters/);
    expect(over.stale).toBe(false);
  });

  it("builds the request the same for a room of another room type — no confirmation, evidence or reason is required", () => {
    const plan = okPlan(sendInput({ intent: { destinationPhysicalRoomId: "room-201" } }));
    expect(plan.request).toEqual({ expectedVersion: 42, destinationPhysicalRoomId: "room-201" });
    expect(plan.destination.sameRoomTypeAsSource).toBe(false);
  });

  it("ignores anything else a caller smuggled into the intent", () => {
    const smuggled = {
      destinationPhysicalRoomId: "room-102",
      reason: "ok",
      confirmCrossRoomType: true,
      expectedVersion: 99,
      segmentId: "other",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      roomBlockId: "x",
      actorReference: "staff:evil",
      authorizationEvidence: "evil",
    } as unknown as BlockMoveIntent;
    const plan = okPlan(sendInput({ intent: smuggled }));
    expect(plan.request).toEqual({ expectedVersion: 42, destinationPhysicalRoomId: "room-102", reason: "ok" });
    expect(plan.segmentId).toBe("seg-1");
    expect(plan.writeTarget.expectedVersion).toBe(42);
  });

  it("uses the version, header and range of the board as it is now, not of the opener's copy", () => {
    // The board still shows the same segment; the opener's extra fields cannot change what is sent.
    const opener = { ...sendInput().opened, nights: 1 };
    const plan = okPlan(sendInput({ opened: opener }));
    expect(plan.target.nights).toBe(23);
    expect(plan.request.expectedVersion).toBe(plan.target.block.segmentVersion);
  });

  it("describes the write for reconciliation with the destination room and the segment's own full range", () => {
    const plan = okPlan(sendInput());
    expect(plan.writeTarget).toEqual({
      operation: "move",
      roomBlockId: "header-1",
      segmentId: "seg-1",
      expectedVersion: 42,
      sourcePhysicalRoomId: "room-101",
      sourceRoomNumber: "101",
      physicalRoomId: "room-102",
      roomNumber: "102",
      startDate: "2026-08-28",
      endDate: "2026-09-20",
    });
    // No free text of any kind is carried into the record.
    expect(JSON.stringify(plan.writeTarget)).not.toMatch(/Burst pipe|reason/);
  });

  it("does not mutate its inputs", () => {
    const input = sendInput({ intent: { destinationPhysicalRoomId: "room-102", reason: " r " } });
    const snapshot = JSON.stringify(input);
    okPlan(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("planBlockMoveSend — the view and the block must still be what the dialog was opened for", () => {
  it("refuses, stale, when the view has moved to another board — even though the loaded board is still the old one", () => {
    for (const currentBoardKey of [boardIdentityKey("prop-b", FROM, TO), boardIdentityKey("prop-a", "2026-09-08", "2026-09-22"), null]) {
      const result = refusal(sendInput({ currentBoardKey }));
      expect(result.stale).toBe(true);
      expect(result.message).toBe(STALE_BLOCK_MOVE_DIALOG_MESSAGE);
    }
  });

  it("refuses, stale, when no board is loaded or the loaded board is another one", () => {
    expect(refusal(sendInput({ board: null })).stale).toBe(true);
    const other = boardWith([block], rooms, { from: "2026-09-02" });
    expect(refusal(sendInput({ board: other })).message).toBe(STALE_BLOCK_MOVE_DIALOG_MESSAGE);
  });

  it("refuses, stale, when the block changed or is gone — version, room, range, header or removal", () => {
    for (const changed of [
      [{ ...block, segmentVersion: 43 }],
      [{ ...block, physicalRoomId: "room-102" }],
      [{ ...block, startDate: "2026-08-29" }],
      [{ ...block, endDate: "2026-09-19" }],
      [{ ...block, roomBlockId: "header-2" }],
      [],
      [block, block],
    ]) {
      const result = refusal(sendInput({ board: boardWith(changed) }));
      expect(result.stale).toBe(true);
      expect(result.message).toBe(BLOCK_MOVE_SOURCE_CHANGED_MESSAGE);
    }
  });

  it("refuses, stale, when the block has grown past 366 nights since the dialog opened", () => {
    const grown = { ...block, endDate: "2027-09-20" };
    expect(refusal(sendInput({ board: boardWith([grown]) })).stale).toBe(true);
  });

  it("refuses a destination the board no longer offers — removed, no longer Active, the source itself — without closing the dialog", () => {
    const deactivated = rooms.map((room) => (room.id === "room-102" ? { ...room, operationalStatus: "OutOfService" } : room));
    const cases: Array<[BlockMoveSendInput["board"], string]> = [
      [boardWith(), "room-999"],
      [boardWith(), "room-101"],
      [boardWith(), "room-103"],
      [boardWith([block], deactivated), "room-102"],
      [boardWith([block], rooms.filter((room) => room.id !== "room-102")), "room-102"],
    ];
    for (const [board, destinationPhysicalRoomId] of cases) {
      const result = refusal(sendInput({ board, intent: { destinationPhysicalRoomId } }));
      expect(result.message).toBe(BLOCK_MOVE_NO_ROOM_MESSAGE);
      expect(result.stale).toBe(false);
    }
    const notString = { destinationPhysicalRoomId: 7 } as unknown as BlockMoveIntent;
    expect(refusal(sendInput({ intent: notString })).message).toBe(BLOCK_MOVE_NO_ROOM_MESSAGE);
  });

  it("refuses a reason that is not text", () => {
    const bad = { destinationPhysicalRoomId: "room-102", reason: 5 } as unknown as BlockMoveIntent;
    expect(refusal(sendInput({ intent: bad })).message).toMatch(/must be text/);
  });
});

describe("planBlockMoveSend — unresolved writes refuse the send", () => {
  it("refuses while this board is waiting to be re-read after a settled write", () => {
    const pending = blockEntry(cancelTarget({ segmentId: "seg-other", physicalRoomId: "room-201", roomNumber: "201" }), { status: "pending", certainty: "settled", resolution: "settled" });
    expect(refusal(sendInput({ blocks: [pending] })).message).toBe(BLOCK_MOVE_AWAITING_REREAD_MESSAGE);
  });

  it("refuses when this segment has an unresolved cancel or move, in rooms and nights that do not overlap anything here", () => {
    const farAway = { startDate: "2027-05-01", endDate: "2027-05-03" };
    for (const entry of [
      blockEntry(cancelTarget({ physicalRoomId: "room-201", roomNumber: "201", ...farAway })),
      blockEntry(moveTarget({ sourcePhysicalRoomId: "room-201", sourceRoomNumber: "201", physicalRoomId: "room-103", roomNumber: "103", ...farAway })),
    ]) {
      const result = refusal(sendInput({ blocks: [entry] }));
      expect(result.message).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
      expect(result.stale).toBe(false);
    }
  });

  it("refuses when the source room or the chosen destination is locked over the block's full range, and only that destination", () => {
    const lock = (room: string, number: string, startDate: string, endDate: string) =>
      blockEntry({ operation: "create", physicalRoomId: room, roomNumber: number, startDate, endDate, reason: "x" });

    // Source room, a night inside the block but outside the visible window.
    expect(refusal(sendInput({ blocks: [lock("room-101", "101", "2026-09-18", "2026-09-19")] })).message).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
    // Destination room, any night of the block's own range.
    expect(refusal(sendInput({ blocks: [lock("room-102", "102", "2026-08-29", "2026-08-30")] })).message).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
    // The same lock does not touch another destination …
    expect(okPlan(sendInput({ blocks: [lock("room-102", "102", "2026-08-29", "2026-08-30")], intent: { destinationPhysicalRoomId: "room-201" } })).destination.id).toBe("room-201");
    // … nor does half-open adjacency to either end of the block.
    expect(okPlan(sendInput({ blocks: [lock("room-102", "102", "2026-09-20", "2026-09-22")] })).destination.id).toBe("room-102");
    expect(okPlan(sendInput({ blocks: [lock("room-102", "102", "2026-08-26", "2026-08-28")] })).destination.id).toBe("room-102");
  });

  it("an assignment write in doubt on the destination over the block's nights refuses too", () => {
    const assignment: Reconciliation = {
      id: 3, key: KEY, propertyId: "prop-a", from: FROM, to: TO, afterSeq: 0, certainty: "uncertain", status: "done", resolution: "unresolved",
      target: { operation: "create", reservationUnitId: "unit-1", physicalRoomId: "room-102", startDate: "2026-09-02", endDate: "2026-09-05", roomNumber: "102", guestDisplayName: "", confirmationNumber: "" },
    };
    expect(refusal(sendInput({ assignments: [assignment] })).message).toBe(BLOCK_WRITE_LOCKED_MESSAGE);
  });

  it("a resolved entry, or one of another Property, does not refuse", () => {
    const observed = blockEntry(moveTarget(), { resolution: "observed" });
    const changed = blockEntry(moveTarget(), { resolution: "changed" });
    const otherProperty = blockEntry(cancelTarget(), { propertyId: "prop-b", key: boardIdentityKey("prop-b", FROM, TO) });
    expect(okPlan(sendInput({ blocks: [observed, changed, otherProperty] })).segmentId).toBe("seg-1");
  });
});
