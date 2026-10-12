/**
 * PMS-CAL-003-CP02: the board's side of the block-move foundation — what a RESTORED move looks like and
 * what it locks. There is deliberately no action, dialog or send path for a block move yet (CP03): these
 * tests seed the tab's records the way a lost response or a reload leaves them, and prove the board words
 * them honestly, keeps the rooms locked while they are unresolved, resolves them only on evidence, lets a
 * resolved notice be dismissed without touching any other record, and never calls the move client.
 * The API client is mocked; none of this is a real-browser acceptance.
 */

import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import { addDaysIso } from "./dateMath";
import { boardIdentityKey } from "./assignmentTarget";
import { UNCERTAIN_WRITES_STORAGE_KEY, beginPendingWrite, persistUncertainWrites } from "./uncertainWriteStorage";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";
import type { Reconciliation } from "./reconciliation";
import type { ApiProperty, ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createReservationAssignment: vi.fn(),
  moveReservationAssignment: vi.fn(),
  unassignReservationAssignment: vi.fn(),
  splitMoveReservationAssignment: vi.fn(),
  createOperationalBlock: vi.fn(),
  cancelOperationalBlock: vi.fn(),
  moveOperationalBlock: vi.fn(),
}));

import {
  cancelOperationalBlock,
  createOperationalBlock,
  fetchActiveProperties,
  fetchReservationBoard,
  moveOperationalBlock,
} from "@/lib/api/client";

const mockedProperties = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedCreate = vi.mocked(createOperationalBlock);
const mockedCancel = vi.mocked(cancelOperationalBlock);
const mockedMove = vi.mocked(moveOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const UNCERTAIN = UNCERTAIN_WRITES_STORAGE_KEY;
const HEADER = "header-1";
const SOURCE_SEG = "seg-source";
const SOURCE_VERSION = 42;

/** What the mocked server shows: the block moved, still in its source room, or something else entirely. */
type Scene = "intact" | "moved" | "gone" | "other-header" | "re-versioned";
let scene: Scene = "intact";

function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
  const at = (offset: number) => addDaysIso(from, offset);
  const block = (overrides: Partial<ReservationBoardOperationalBlock>): ReservationBoardOperationalBlock => ({
    roomBlockId: HEADER,
    segmentId: SOURCE_SEG,
    segmentVersion: SOURCE_VERSION,
    physicalRoomId: "room-101",
    startDate: at(2),
    endDate: at(5),
    reason: "Burst pipe",
    ...overrides,
  });
  const blocks: ReservationBoardOperationalBlock[] =
    scene === "intact"
      ? [block({})]
      : scene === "moved"
        ? [block({ segmentId: "seg-successor", segmentVersion: 1, physicalRoomId: "room-102" })]
        : scene === "other-header"
          ? [block({ roomBlockId: "header-other", segmentId: "seg-successor", segmentVersion: 1, physicalRoomId: "room-102" })]
          : scene === "re-versioned"
            ? [block({ segmentVersion: SOURCE_VERSION + 1 })]
            : [];
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
      { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "Active" },
    ],
    stays: [],
    operationalBlocks: blocks,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  scene = "intact";
  for (const mock of [mockedProperties, mockedBoard, mockedCreate, mockedCancel, mockedMove]) mock.mockReset();
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA] });
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) }));
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** Renders the board once to learn its window, so a record can be written for exactly that board, then renders it again. */
async function renderWith(seed: (window: { from: string; to: string; at: (offset: number) => string; key: string }) => void) {
  const first = render(<ReservationBoard />);
  await waitFor(() => expect(mockedBoard).toHaveBeenCalled());
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  first.unmount();
  cleanup();
  const window = { from, to, at: (offset: number) => addDaysIso(from, offset), key: boardIdentityKey("prop-a", from, to) };
  seed(window);
  mockedBoard.mockClear();
  render(<ReservationBoard />);
  await waitFor(() => expect(mockedBoard).toHaveBeenCalled());
  await flush();
  return window;
}

function moveEntry(window: { from: string; to: string; at: (o: number) => string; key: string }, overrides: Partial<BlockCreateReconciliation> = {}): BlockCreateReconciliation {
  return {
    id: 1,
    key: window.key,
    propertyId: "prop-a",
    from: window.from,
    to: window.to,
    afterSeq: 0,
    certainty: "uncertain",
    status: "pending",
    resolution: "unresolved",
    target: {
      operation: "move",
      roomBlockId: HEADER,
      segmentId: SOURCE_SEG,
      expectedVersion: SOURCE_VERSION,
      sourcePhysicalRoomId: "room-101",
      sourceRoomNumber: "101",
      physicalRoomId: "room-102",
      roomNumber: "102",
      startDate: window.at(2),
      endDate: window.at(5),
    },
    ...overrides,
  };
}

const notice = () => screen.getByTestId("uncertain-block-notice");
const storedRecord = () => JSON.parse(sessionStorage.getItem(UNCERTAIN) ?? "null");
const moveBar = () => screen.getByTitle("Burst pipe");

describe("a restored block move on the board", () => {
  it("is worded as a move between two rooms, says its result was never confirmed, and offers only Check again", async () => {
    const w = await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));

    const text = notice().textContent!;
    expect(text).toContain("Unconfirmed block move request from before this page was reloaded or left: from room 101 to room 102");
    expect(text).toContain(`[${w.at(2)}, ${w.at(5)})`);
    expect(text).toContain("Its result was never confirmed. It may already have been saved");
    // The source is shown exactly as it was: still unknown, both rooms locked, never resent.
    expect(text).toContain("the block is still shown in room 101 exactly as it was, so the result is still unknown");
    expect(text).toContain("Rooms 101 and 102 stay locked");
    expect(text).toContain("will not be sent again");
    expect(within(notice()).getByRole("button", { name: "Check again" })).toBeInTheDocument();
    expect(within(notice()).queryByRole("button", { name: "Dismiss notice" })).not.toBeInTheDocument();
    // Nothing personal or free-text is invented for it.
    expect(text).not.toMatch(/Burst pipe|reason|staff|actor/i);
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("describes an in-flight record (the page left before any answer) as sent just before, still honest about not knowing", async () => {
    await renderWith((win) => {
      beginPendingWrite(sessionStorage, { kind: "block", entry: moveEntry(win) });
    });

    expect(notice().textContent).toContain("Unconfirmed block move request sent just before this page was reloaded or left: from room 101 to room 102");
    expect(notice().textContent).toContain("The request may never have reached the server, or may already have been saved");
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("locks the source room and the destination room for the source's nights, and only those", async () => {
    const user = userEvent.setup();
    const w = await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));
    const reviewBlock = async (room: string, startOffset: number, endOffset: number) => {
      await user.click(screen.getByRole("button", { name: "Create operational block" }));
      const dialog = within(screen.getByRole("dialog", { name: "Create operational block" }));
      await user.selectOptions(dialog.getByLabelText("Room"), room);
      fireEvent.change(dialog.getByLabelText("First blocked night"), { target: { value: w.at(startOffset) } });
      fireEvent.change(dialog.getByLabelText("End date (exclusive)"), { target: { value: w.at(endOffset) } });
      await user.type(dialog.getByLabelText("Reason"), "Leak");
      await user.click(dialog.getByRole("button", { name: "Review" }));
      return dialog;
    };
    const close = async (dialog: ReturnType<typeof within>) => user.click(dialog.getAllByRole("button", { name: "Close" }).at(-1)!);

    // Both rooms are locked over the move's nights …
    for (const room of ["room-101", "room-102"]) {
      const dialog = await reviewBlock(room, 3, 4);
      expect(dialog.getByRole("alert")).toHaveTextContent("still unconfirmed");
      await close(dialog);
    }
    // … half-open adjacency and another room are not.
    for (const [room, start, end] of [["room-102", 5, 6], ["room-102", 0, 2], ["room-103", 3, 4]] as const) {
      const dialog = await reviewBlock(room, start, end);
      expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
      await close(dialog);
    }
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("holds the source block's Cancel unavailable while unresolved, and offers no move action at all", async () => {
    const user = userEvent.setup();
    await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));

    await user.click(moveBar());
    const popover = within(screen.getByRole("dialog", { name: "Operational block details" }));
    expect(popover.getByRole("button", { name: "Cancel block" })).toBeDisabled();
    // CP02 is a foundation only: no block-move action, no dialog, no client call.
    expect(popover.queryByRole("button", { name: /move/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /move/i })).not.toBeInTheDocument();
    expect(mockedMove).not.toHaveBeenCalled();
    expect(mockedCancel).not.toHaveBeenCalled();
  });

  it("Check again only re-reads the board — never sends — and a read that still shows the source keeps it unresolved and locked", async () => {
    const user = userEvent.setup();
    await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));
    const before = mockedBoard.mock.calls.length;

    await user.click(within(notice()).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(before + 1));
    await flush();

    expect(notice().textContent).toContain("still shown in room 101 exactly as it was");
    expect(storedRecord().blocks).toHaveLength(1);
    expect(mockedMove).not.toHaveBeenCalled();
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("a failed re-read resolves nothing and says so", async () => {
    const user = userEvent.setup();
    await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "network", message: "down" } });

    await user.click(within(notice()).getByRole("button", { name: "Check again" }));
    await flush();

    expect(notice().textContent).toMatch(/could not be reloaded, so the result is still unknown/);
    expect(storedRecord().blocks).toHaveLength(1);
  });
});

describe("a restored block move resolves only on evidence", () => {
  it("observed: the source is gone and the same block now holds those nights in the destination — said as a fact of the schedule, dismissible", async () => {
    scene = "moved";
    const user = userEvent.setup();
    const w = await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));

    const text = notice().textContent!;
    expect(text).toContain("The block is no longer shown in room 101, and the same block is now shown in room 102");
    expect(text).toContain(`[${w.at(2)}, ${w.at(5)})`);
    expect(text).toContain("it does not prove this request moved it");
    expect(text).not.toMatch(/Saved on the server|was saved|has been moved/i);
    // Resolved: nothing is locked, nothing kept in the tab, and the notice can be dismissed.
    expect(sessionStorage.getItem(UNCERTAIN)).toBeNull();
    expect(within(notice()).queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    await user.click(within(notice()).getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByTestId("uncertain-block-notice")).not.toBeInTheDocument();
  });

  it.each<[Scene, string]>([
    ["gone", "the source is gone and nothing matches"],
    ["other-header", "the same room and nights now belong to another block"],
    ["re-versioned", "the source is shown at another version"],
  ])("changed (%s — %s): worded as a change, never as saved, and dismissible", async (kind) => {
    scene = kind;
    const user = userEvent.setup();
    await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));

    const text = notice().textContent!;
    expect(text).toContain("These nights have since changed on the server, so this request can no longer take effect");
    expect(text).toContain("this is not a record that the move was saved");
    expect(text).not.toMatch(/now shown in room 102|Saved|Check again/);
    expect(sessionStorage.getItem(UNCERTAIN)).toBeNull();
    await user.click(within(notice()).getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByTestId("uncertain-block-notice")).not.toBeInTheDocument();
  });

  it("dismissing a resolved move leaves every other record and lock exactly as they were", async () => {
    scene = "gone";
    const user = userEvent.setup();
    const w = await renderWith((win) => {
      const other: BlockCreateReconciliation = {
        id: 2,
        key: win.key,
        propertyId: "prop-a",
        from: win.from,
        to: win.to,
        afterSeq: 0,
        certainty: "uncertain",
        status: "pending",
        resolution: "unresolved",
        target: { operation: "create", physicalRoomId: "room-103", roomNumber: "103", startDate: win.at(8), endDate: win.at(9), reason: "Leak" },
      };
      const assignment: Reconciliation = {
        id: 3,
        key: win.key,
        propertyId: "prop-a",
        from: win.from,
        to: win.to,
        afterSeq: 0,
        certainty: "uncertain",
        status: "pending",
        resolution: "unresolved",
        target: { operation: "unassign", reservationUnitId: "unit-9", startDate: win.at(40), endDate: win.at(42), roomNumber: "101", guestDisplayName: "", confirmationNumber: "", segmentId: "seg-asg", expectedVersion: 3, sourcePhysicalRoomId: "room-101" },
      };
      persistUncertainWrites(sessionStorage, [assignment], [moveEntry(win), other]);
    });

    // The move resolved to `changed`. The create (its block is simply not shown) and the assignment (its nights lie outside
    // the board window, so this board cannot judge it) both stay unresolved and persisted.
    const notices = screen.getAllByTestId("uncertain-block-notice");
    const moveNotice = notices.find((n) => n.textContent!.includes("block move"))!;
    await user.click(within(moveNotice).getByRole("button", { name: "Dismiss notice" }));

    const record = storedRecord();
    expect(record.blocks.map((b: { target: { operation: string } }) => b.target.operation)).toEqual(["create"]);
    expect(record.assignments.map((a: { target: { operation: string } }) => a.target.operation)).toEqual(["unassign"]);
    expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
    expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
    expect(w.key).toBeTruthy();
  });

  it("a move restored beside a split-move and a cancel keeps all of them, each worded for what it is", async () => {
    const w = await renderWith((win) => {
      const cancel: BlockCreateReconciliation = {
        id: 2, key: win.key, propertyId: "prop-a", from: win.from, to: win.to, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved",
        target: { operation: "cancel", physicalRoomId: "room-103", roomNumber: "103", startDate: win.at(8), endDate: win.at(9), reason: "Paint", segmentId: "seg-c", expectedVersion: 5 },
      };
      const split: Reconciliation = {
        id: 3, key: win.key, propertyId: "prop-a", from: win.from, to: win.to, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved",
        target: { operation: "split-move", reservationUnitId: "unit-9", physicalRoomId: "room-102", sourcePhysicalRoomId: "room-101", segmentId: "seg-s", expectedVersion: 2, startDate: win.at(10), endDate: win.at(14), splitDate: win.at(12), roomNumber: "102", guestDisplayName: "", confirmationNumber: "" },
      };
      persistUncertainWrites(sessionStorage, [split], [moveEntry(win), cancel]);
    });

    const blockNotices = screen.getAllByTestId("uncertain-block-notice").map((n) => n.textContent!);
    expect(blockNotices.some((t) => t.includes("block move request"))).toBe(true);
    expect(blockNotices.some((t) => t.includes("block cancel request"))).toBe(true);
    expect(screen.getByTestId("uncertain-write-notice").textContent).toContain("room split-move request");
    expect(w.key).toBeTruthy();
  });
});

describe("the foundation adds no send path", () => {
  it("never calls the move client, whatever is restored or resolved", async () => {
    for (const kind of ["intact", "moved", "gone"] as const) {
      sessionStorage.clear();
      scene = kind;
      await renderWith((win) => persistUncertainWrites(sessionStorage, [], [moveEntry(win)]));
      await flush();
      cleanup();
    }
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("ReservationBoard.tsx neither imports nor calls moveOperationalBlock, and mounts no block-move dialog", () => {
    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "ReservationBoard.tsx"), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*(import\b|moveOperationalBlock,|type OperationalBlockMoveOutcome)/.test(line)).join("\n");
    expect(imports).not.toContain("moveOperationalBlock");
    expect(imports).not.toContain("OperationalBlockMoveOutcome");
    expect(imports).not.toMatch(/blockMoveTarget|BlockMoveDialog/);
    expect(source).not.toMatch(/moveOperationalBlock\(|buildBlockMoveTarget|BlockMoveDialog|onMoveBlock/);
  });
});
