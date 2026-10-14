/**
 * PMS-CAL-004-CP01: board-level behaviour when the API lists a room that is not Active because an Effective
 * operational block sits in it. The block can be opened, moved and cancelled with the existing PMS-CAL-003
 * actions and guards; the room is never a destination for any placement (pickers, drag, direct callbacks); and
 * its row disappears from the authoritative re-read only when its last qualifying block is gone, without
 * losing a notice or an unconfirmed record. The API client is mocked: this proves the UI's decisions, not the
 * real API (see the report's isolated browser acceptance).
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import type ReservationMoveDialogType from "./ReservationMoveDialog";
import type ReservationSplitMoveDialogType from "./ReservationSplitMoveDialog";
import type ReservationAssignmentDialogType from "./ReservationAssignmentDialog";
import type ReservationBlockCreateDialogType from "./ReservationBlockCreateDialog";
import type ReservationBlockMoveDialogType from "./ReservationBlockMoveDialog";
import { addDaysIso } from "./dateMath";
import { UNCERTAIN_WRITES_STORAGE_KEY } from "./uncertainWriteStorage";
import type { ApiProperty, ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";

// The real dialogs, wrapped only to remember the props the board gave them, so a test can call the board's own
// submit callback the way a forged or stale one would — without the dialog's own checks in front.
const probes = vi.hoisted(() => ({
  move: null as { onSubmit: (...args: never[]) => Promise<unknown> } | null,
  split: null as { onSubmit: (...args: never[]) => Promise<unknown> } | null,
  assign: null as { onSubmit: (...args: never[]) => Promise<unknown> } | null,
  create: null as { onSubmit: (...args: never[]) => Promise<unknown> } | null,
  blockMove: null as { onSubmit: (...args: never[]) => Promise<unknown> } | null,
}));
vi.mock("./ReservationMoveDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationMoveDialog")>();
  const React = await import("react");
  const Real = actual.default as typeof ReservationMoveDialogType;
  return { ...actual, default: (props: React.ComponentProps<typeof Real>) => { probes.move = props as never; return React.createElement(Real, props); } };
});
vi.mock("./ReservationSplitMoveDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationSplitMoveDialog")>();
  const React = await import("react");
  const Real = actual.default as typeof ReservationSplitMoveDialogType;
  return { ...actual, default: (props: React.ComponentProps<typeof Real>) => { probes.split = props as never; return React.createElement(Real, props); } };
});
vi.mock("./ReservationAssignmentDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationAssignmentDialog")>();
  const React = await import("react");
  const Real = actual.default as typeof ReservationAssignmentDialogType;
  return { ...actual, default: (props: React.ComponentProps<typeof Real>) => { probes.assign = props as never; return React.createElement(Real, props); } };
});
vi.mock("./ReservationBlockCreateDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationBlockCreateDialog")>();
  const React = await import("react");
  const Real = actual.default as typeof ReservationBlockCreateDialogType;
  return { ...actual, default: (props: React.ComponentProps<typeof Real>) => { probes.create = props as never; return React.createElement(Real, props); } };
});

vi.mock("./ReservationBlockMoveDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationBlockMoveDialog")>();
  const React = await import("react");
  const Real = actual.default as typeof ReservationBlockMoveDialogType;
  return { ...actual, default: (props: React.ComponentProps<typeof Real>) => { probes.blockMove = props as never; return React.createElement(Real, props); } };
});

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
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveOperationalBlock,
  moveReservationAssignment,
  splitMoveReservationAssignment,
  unassignReservationAssignment,
} from "@/lib/api/client";

const mockedProperties = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedBlockMove = vi.mocked(moveOperationalBlock);
const mockedCancel = vi.mocked(cancelOperationalBlock);
const mockedCreateBlock = vi.mocked(createOperationalBlock);
const mockedAssign = vi.mocked(createReservationAssignment);
const mockedMove = vi.mocked(moveReservationAssignment);
const mockedSplit = vi.mocked(splitMoveReservationAssignment);
const mockedUnassign = vi.mocked(unassignReservationAssignment);
const allWrites = [mockedBlockMove, mockedCancel, mockedCreateBlock, mockedAssign, mockedMove, mockedSplit, mockedUnassign];

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const UNCERTAIN = UNCERTAIN_WRITES_STORAGE_KEY;

/** What the mocked server holds. Offsets are nights from the board's `from`. */
interface Server {
  blocks: Array<{ segmentId: string; version: number; header: string; room: string; start: number; end: number; reason: string }>;
}

const initialBlocks = (): Server["blocks"] => [
  { segmentId: "seg-109a", version: 5, header: "header-1", room: "room-109", start: 1, end: 3, reason: "Pipe burst" },
  { segmentId: "seg-109b", version: 6, header: "header-1", room: "room-109", start: 4, end: 5, reason: "Pipe burst 2" },
  { segmentId: "seg-303", version: 1, header: "header-3", room: "room-303", start: 2, end: 3, reason: "Archived" },
];

let server: Server = { blocks: initialBlocks() };

const ROOMS = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
  { id: "room-109", roomTypeId: "type-standard", roomNumber: "109", floor: 1, operationalStatus: "OutOfService" },
  { id: "room-303", roomTypeId: "type-archive", roomNumber: "303", floor: 3, operationalStatus: "Inactive" },
];
const TYPES = [
  { id: "type-standard", code: "STD", name: "Standard", isActive: true },
  { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
  { id: "type-archive", code: "ARC", name: "Archive", isActive: false },
];

/** Mirrors the API contract: every Active room, plus a non-Active room only while a block sits in it. */
function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
  const at = (offset: number) => addDaysIso(from, offset);
  const blocks: ReservationBoardOperationalBlock[] = server.blocks.map((block) => ({
    roomBlockId: block.header,
    segmentId: block.segmentId,
    segmentVersion: block.version,
    physicalRoomId: block.room,
    startDate: at(block.start),
    endDate: at(block.end),
    reason: block.reason,
  }));
  const blockRooms = new Set(blocks.map((block) => block.physicalRoomId));
  const rooms = ROOMS.filter((room) => room.operationalStatus === "Active" || blockRooms.has(room.id));
  const typeIds = new Set(rooms.map((room) => room.roomTypeId));
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: TYPES.filter((type) => typeIds.has(type.id)),
    physicalRooms: rooms,
    stays: [
      {
        reservationId: "res-1",
        reservationUnitId: "unit-1",
        confirmationNumber: "CNF-100",
        guestDisplayName: "Nguyen Van A",
        soldRoomTypeId: "type-standard",
        checkIn: at(1),
        checkOut: at(4),
        coverageStatus: "FullyAssigned",
        assignments: [{ segmentId: "seg-stay", segmentVersion: 2, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: at(1), endDate: at(4) }],
        unassignedRanges: [],
      },
      {
        reservationId: "res-2",
        reservationUnitId: "unit-2",
        confirmationNumber: "CNF-200",
        guestDisplayName: "Tran Thi B",
        soldRoomTypeId: "type-standard",
        checkIn: at(5),
        checkOut: at(7),
        coverageStatus: "FullyUnassigned",
        assignments: [],
        unassignedRanges: [{ startDate: at(5), endDate: at(7) }],
      },
    ],
    operationalBlocks: blocks,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  for (const probe of Object.keys(probes) as Array<keyof typeof probes>) probes[probe] = null;
  for (const mock of [mockedProperties, mockedBoard, ...allWrites]) mock.mockReset();
  server = { blocks: initialBlocks() };
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA] });
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) }));
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function renderBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Pipe burst — room 109, Out of service" })).toBeInTheDocument());
  await flush();
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { from, to, at: (offset: number) => addDaysIso(from, offset) };
}

const bar109a = () => screen.getByRole("button", { name: "Pipe burst — room 109, Out of service" });
const popover = () => screen.getByRole("dialog", { name: "Operational block details" });
const moveDialog = () => screen.getByRole("dialog", { name: "Move operational block" });
const roomStatus = (id: string) => screen.queryByTestId(`room-status-${id}`);
const radioRooms = (dialog: HTMLElement) =>
  within(dialog).getAllByRole("radio").map((radio) => /Room (\d+)/.exec(radio.closest("label")!.textContent!)![1]);

type User = ReturnType<typeof userEvent.setup>;

async function openBlockMove(user: User, bar: HTMLElement = bar109a()) {
  await user.click(bar);
  await user.click(within(popover()).getByRole("button", { name: "Move block…" }));
  return moveDialog();
}

describe("a room listed only because a block sits in it", () => {
  it("shows the row with its real status, the block bar, and an inactive-only RoomType's header — with no empty Unassigned lane for it", async () => {
    await renderBoard();
    expect(roomStatus("room-109")).toHaveTextContent("Out of service");
    expect(roomStatus("room-303")).toHaveTextContent("Inactive");
    expect(roomStatus("room-101")).not.toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pipe burst 2 — room 109, Out of service" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived — room 303, Inactive" })).toBeInTheDocument();
    // Standard keeps its one empty lane plus one for the visible unassigned stay (they pack into one lane);
    // Deluxe keeps its one; Archive adds none.
    // Lane labels are the sticky label cells; the toolbar's filter chip carries the same word.
    const lanes = screen.getAllByText("Unassigned").filter((element) => element.classList.contains("sticky"));
    expect(lanes).toHaveLength(2);
  });

  it("opens the existing Move block… from such a bar and offers only Active rooms — never the source and never another non-Active room", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const dialog = await openBlockMove(user);
    expect(dialog).toHaveTextContent("109 (Standard) · OutOfService");
    expect(dialog).toHaveTextContent("Pipe burst");
    expect(radioRooms(dialog)).toEqual(["101", "102", "201"]);
    expect(mockedBlockMove).not.toHaveBeenCalled();
  });

  it("moves it out with one request of the exact body; a sibling keeps the row, the last block takes it away, and the notice stays usable", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    mockedBlockMove.mockImplementationOnce(async () => {
      // The server's committed state: the first segment is gone, its successor is in room 102.
      server.blocks = server.blocks.filter((block) => block.segmentId !== "seg-109a");
      server.blocks.push({ segmentId: "seg-succ-1", version: 9, header: "header-1", room: "room-102", start: 1, end: 3, reason: "Pipe burst" });
      return { kind: "moved", segments: null };
    });

    const dialog = await openBlockMove(user);
    await user.click(within(dialog).getByRole("radio", { name: /Room 102/ }));
    await user.click(within(dialog).getByRole("button", { name: "Move block to room 102" }));

    await waitFor(() => expect(mockedBlockMove).toHaveBeenCalledTimes(1));
    expect(mockedBlockMove).toHaveBeenCalledWith("prop-a", "seg-109a", { expectedVersion: 5, destinationPhysicalRoomId: "room-102" });
    const notice = (await screen.findByText(`Block moved from room 109 to room 102 for [${at(1)}, ${at(3)}).`)).closest("[role=status]")!;
    await waitFor(() => expect(notice).toHaveTextContent("The board has been reloaded from the server."));
    // The sibling is still in room 109: its row, status and bar remain; the moved block is drawn in 102.
    expect(roomStatus("room-109")).toHaveTextContent("Out of service");
    expect(screen.getByRole("button", { name: "Pipe burst 2 — room 109, Out of service" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(notice));

    // Moving the last block out takes the row with it after the next authoritative read.
    mockedBlockMove.mockImplementationOnce(async () => {
      server.blocks = server.blocks.filter((block) => block.segmentId !== "seg-109b");
      server.blocks.push({ segmentId: "seg-succ-2", version: 3, header: "header-1", room: "room-201", start: 4, end: 5, reason: "Pipe burst 2" });
      return { kind: "moved", segments: null };
    });
    const second = await openBlockMove(user, screen.getByRole("button", { name: "Pipe burst 2 — room 109, Out of service" }));
    await user.click(within(second).getByRole("radio", { name: /Room 201/ }));
    await user.click(within(second).getByRole("button", { name: "Move block to room 201" }));
    await waitFor(() => expect(mockedBlockMove).toHaveBeenCalledTimes(2));
    expect(mockedBlockMove).toHaveBeenLastCalledWith("prop-a", "seg-109b", { expectedVersion: 6, destinationPhysicalRoomId: "room-201" });
    await waitFor(() => expect(roomStatus("room-109")).not.toBeInTheDocument());
    // Room 109 itself is untouched by the UI: no write of any other kind happened.
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(mockedAssign).not.toHaveBeenCalled();
    expect(screen.getByText(/^Block moved from room 109 to room 201/)).toBeInTheDocument();
  });

  it("cancels it with one request; the row and an inactive-only RoomType's header go with the last block after the re-read", async () => {
    const user = userEvent.setup();
    await renderBoard();
    mockedCancel.mockImplementationOnce(async () => {
      server.blocks = server.blocks.filter((block) => block.segmentId !== "seg-303");
      return { kind: "cancelled", segment: null };
    });
    await user.click(screen.getByRole("button", { name: "Archived — room 303, Inactive" }));
    await user.click(within(popover()).getByRole("button", { name: "Cancel block" }));
    await user.click(within(screen.getByRole("dialog", { name: "Cancel operational block" })).getByRole("button", { name: /^Cancel block on room 303/ }));

    await waitFor(() => expect(mockedCancel).toHaveBeenCalledTimes(1));
    expect(mockedCancel).toHaveBeenCalledWith("prop-a", "seg-303", { expectedVersion: 1 });
    await waitFor(() => expect(roomStatus("room-303")).not.toBeInTheDocument());
    expect(screen.queryByText("Archive")).not.toBeInTheDocument();
    expect(screen.getByText("Block on room 303 cancelled", { exact: false })).toBeInTheDocument();
    expect(mockedBlockMove).not.toHaveBeenCalled();
  });

  it("keeps an unconfirmed move's record and both rooms' locks while the source row comes and goes", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    // 109's second block is gone first, so the first segment is the last one in the room.
    server.blocks = server.blocks.filter((block) => block.segmentId !== "seg-109b");
    await user.click(screen.getByRole("button", { name: "Archived — room 303, Inactive" }));
    await user.click(within(popover()).getByRole("button", { name: "Close" }));
    mockedBlockMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    // A fresh read shows the room with one block; open and send.
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    const dialog = await openBlockMove(user, await screen.findByRole("button", { name: "Pipe burst — room 109, Out of service" }));
    await user.click(within(dialog).getByRole("radio", { name: /Room 102/ }));
    await user.click(within(dialog).getByRole("button", { name: "Move block to room 102" }));
    expect(await within(moveDialog()).findByRole("alert")).toHaveTextContent("may or may not have been moved");
    await flush();
    expect(JSON.parse(sessionStorage.getItem(UNCERTAIN)!).blocks).toHaveLength(1);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    // Both rooms are locked over the block's nights and the same segment can no longer be moved or cancelled.
    await user.click(screen.getByRole("button", { name: "Pipe burst — room 109, Out of service" }));
    expect(within(popover()).getByRole("button", { name: "Move block…" })).toBeDisabled();
    expect(within(popover()).getByRole("button", { name: "Cancel block" })).toBeDisabled();
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    // The move did commit: the room has no block left, so its row is gone — the record and its notice are not.
    server.blocks = server.blocks.filter((block) => block.segmentId !== "seg-109a");
    server.blocks.push({ segmentId: "seg-succ", version: 4, header: "header-1", room: "room-102", start: 1, end: 3, reason: "Pipe burst" });
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(roomStatus("room-109")).not.toBeInTheDocument());
    const notice = screen.getByTestId("uncertain-block-notice");
    expect(notice).toHaveTextContent("The block is no longer shown in room 109, and the same block is now shown in room 102");
    expect(notice).toHaveTextContent(`[${at(1)}, ${at(3)})`);
    expect(notice).not.toHaveTextContent(/Saved/);
    expect(mockedBlockMove).toHaveBeenCalledTimes(1);
    // Dismissing it by keyboard leaves focus on a control that still exists.
    await user.click(within(notice).getByRole("button", { name: "Dismiss notice" }));
    expect(document.activeElement).not.toBeNull();
    expect(document.contains(document.activeElement)).toBe(true);
  });
});

describe("a room that is not Active is never a destination", () => {
  it("is absent from the assign, move, split-move and block-create pickers", async () => {
    const user = userEvent.setup();
    await renderBoard();

    // Assign (an unassigned bar of the stay sold as Standard).
    await user.click(screen.getByRole("button", { name: /Assign room: Tran Thi B/ }));
    const assign = screen.getByRole("dialog", { name: "Assign room" });
    expect(radioRooms(assign)).toEqual(["101", "102", "201"]);
    await user.click(within(assign).getAllByRole("button", { name: "Close" }).at(-1)!);

    // Move room and Move from a date… (the assigned bar).
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(screen.getByRole("button", { name: "Move room" }));
    const moveRoom = screen.getByRole("dialog", { name: "Move room" });
    expect(radioRooms(moveRoom)).toEqual(["102", "201"]);
    await user.click(within(moveRoom).getAllByRole("button", { name: "Close" }).at(-1)!);
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(screen.getByRole("button", { name: /^Move from a date/ }));
    const split = screen.getByRole("dialog", { name: "Move from a date" });
    expect(radioRooms(split)).toEqual(["102", "201"]);
    await user.click(within(split).getAllByRole("button", { name: "Close" }).at(-1)!);

    // Create operational block: the room select.
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const create = screen.getByRole("dialog", { name: "Create operational block" });
    const options = within(create).getAllByRole("option").map((option) => option.textContent ?? "");
    expect(options.join("|")).toMatch(/101/);
    expect(options.join("|")).not.toMatch(/109|303/);
    for (const mock of allWrites) expect(mock).not.toHaveBeenCalled();
  });

  it("is refused by every submit callback even when one is forced: nothing is sent and nothing is recorded", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const outcomes: unknown[] = [];

    await user.click(screen.getByRole("button", { name: /Assign room: Tran Thi B/ }));
    outcomes.push(await (probes.assign!.onSubmit as (room: string, cross: null) => Promise<unknown>)("room-109", null));
    await user.click(within(screen.getByRole("dialog", { name: "Assign room" })).getAllByRole("button", { name: "Close" }).at(-1)!);

    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(screen.getByRole("button", { name: "Move room" }));
    outcomes.push(await (probes.move!.onSubmit as (room: string, cross: null) => Promise<unknown>)("room-303", null));
    await user.click(within(screen.getByRole("dialog", { name: "Move room" })).getAllByRole("button", { name: "Close" }).at(-1)!);

    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(screen.getByRole("button", { name: /^Move from a date/ }));
    outcomes.push(
      await (probes.split!.onSubmit as (intent: unknown) => Promise<unknown>)({
        splitDate: addDaysIso(boardFrom(), 2),
        destinationPhysicalRoomId: "room-109",
        confirmCrossRoomType: false,
        pastDateAcknowledged: false,
      })
    );
    await user.click(within(screen.getByRole("dialog", { name: "Move from a date" })).getAllByRole("button", { name: "Close" }).at(-1)!);

    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    outcomes.push(
      await (probes.create!.onSubmit as (request: unknown) => Promise<unknown>)({
        physicalRoomId: "room-109",
        startDate: addDaysIso(boardFrom(), 6),
        endDate: addDaysIso(boardFrom(), 7),
        reason: "forced",
      })
    );
    await user.click(within(screen.getByRole("dialog", { name: "Create operational block" })).getAllByRole("button", { name: "Close" }).at(-1)!);

    await user.click(bar109a());
    await user.click(within(popover()).getByRole("button", { name: "Move block…" }));
    outcomes.push(await (probes.blockMove!.onSubmit as (intent: unknown) => Promise<unknown>)({ destinationPhysicalRoomId: "room-303" }));

    for (const outcome of outcomes) expect(outcome).toMatchObject({ kind: "not-sent" });
    for (const mock of allWrites) expect(mock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("thebha.adminCalendar.pendingWrites")).toBeNull();
    expect(sessionStorage.getItem(UNCERTAIN)).toBeNull();
  });

  it("a drag onto its row is refused with its reason and sends nothing; the row is not an eligible target", async () => {
    await renderBoard();
    const transfer = { dropEffect: "none", effectAllowed: "all", setData: vi.fn(), getData: () => "", types: [] };
    fireEvent.dragStart(screen.getByTitle("Nguyen Van A — CNF-100"), { dataTransfer: transfer });
    const cell = Array.from(document.querySelectorAll<HTMLElement>('div[data-drop-room-id="room-109"]')).find(
      (element) => !element.classList.contains("sticky")
    )!;
    const accepted = !fireEvent.dragOver(cell, { dataTransfer: transfer });
    expect(accepted).toBe(false);
    expect(transfer.dropEffect).not.toBe("move");
    fireEvent.drop(cell, { dataTransfer: transfer });
    expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
    expect(screen.getByTestId("board-drag-feedback")).toHaveTextContent("Room 109 is not Active.");
    for (const mock of allWrites) expect(mock).not.toHaveBeenCalled();
  });
});

function boardFrom(): string {
  return mockedBoard.mock.calls.at(-1)![1];
}
