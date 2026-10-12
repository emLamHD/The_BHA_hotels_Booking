/**
 * PMS-CAL-002-CP05: board-level wiring for the split-move flow — assigned bar → popover
 * `Move from a date…` → `ReservationSplitMoveDialog` → the one split-move request → the authoritative
 * re-read. The API client is mocked, so these tests prove the board's decisions; the isolated
 * Chrome + Kestrel + PostgreSQL run in the CP05 report proves the rest.
 */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import type ReservationBoardStayPopoverType from "./ReservationBoardStayPopover";
import type ReservationSplitMoveDialogType from "./ReservationSplitMoveDialog";
import type { SplitMoveIntent } from "./ReservationSplitMoveDialog";
import { addDaysIso } from "./dateMath";
import { boardIdentityKey } from "./assignmentTarget";
import { PENDING_WRITES_STORAGE_KEY, UNCERTAIN_WRITES_STORAGE_KEY, persistUncertainWrites } from "./uncertainWriteStorage";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";
import type { Reconciliation } from "./reconciliation";
import type { BoardAccess } from "./calendarAccess";
import type { StaffMembership } from "@/lib/api/staff";
import type {
  MoveAssignmentOutcome,
  SplitMoveAssignmentOutcome,
  UnassignAssignmentOutcome,
} from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse } from "@/lib/api/types";

// The real dialog, wrapped only to remember the props the board last gave it: a test can then call the
// board's own `onSubmit` the way a stale or doubled callback would, without the dialog's guards in front.
const popoverProbe: { props: React.ComponentProps<typeof ReservationBoardStayPopoverType> | null } = vi.hoisted(() => ({ props: null }));
vi.mock("./ReservationBoardStayPopover", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationBoardStayPopover")>();
  const React = await import("react");
  const Real = actual.default;
  return {
    ...actual,
    default: (props: React.ComponentProps<typeof Real>) => {
      popoverProbe.props = props;
      return React.createElement(Real, props);
    },
  };
});
const dialogProbe: { props: React.ComponentProps<typeof ReservationSplitMoveDialogType> | null } = vi.hoisted(() => ({ props: null }));
vi.mock("./ReservationSplitMoveDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationSplitMoveDialog")>();
  const React = await import("react");
  const Real = actual.default;
  return {
    ...actual,
    default: (props: React.ComponentProps<typeof Real>) => {
      dialogProbe.props = props;
      return React.createElement(Real, props);
    },
  };
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
}));

import {
  createOperationalBlock,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
  splitMoveReservationAssignment,
  unassignReservationAssignment,
} from "@/lib/api/client";

const mockedProperties = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedSplit = vi.mocked(splitMoveReservationAssignment);
const mockedMove = vi.mocked(moveReservationAssignment);
const mockedUnassign = vi.mocked(unassignReservationAssignment);
const mockedBlockCreate = vi.mocked(createOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const PENDING_KEY = PENDING_WRITES_STORAGE_KEY;
const UNCERTAIN_KEY = UNCERTAIN_WRITES_STORAGE_KEY;
const BAR = "Nguyen Van A — CNF-100";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** What the mocked server shows. Dates are offsets from the board's `from`. */
interface Fixture {
  sourceRoom: string;
  startOffset: number;
  endOffset: number;
  version: number;
  /** The Property's `localToday`, as an offset from `from`. */
  todayOffset: number;
  room102Status: string;
  /** Replaces the source stay's assignments (for a board that shows a result). */
  assignments?: (at: (offset: number) => string) => ReservationBoardResponse["stays"][number]["assignments"];
}

const defaults = (): Fixture => ({
  sourceRoom: "room-101",
  startOffset: -2,
  endOffset: 6,
  version: 4,
  todayOffset: 0,
  room102Status: "Active",
});

let fixture: Fixture = defaults();

function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
  const at = (offset: number) => addDaysIso(from, offset);
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: at(fixture.todayOffset), checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: [
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    ],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: fixture.room102Status },
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
        checkIn: at(fixture.startOffset),
        checkOut: at(fixture.endOffset),
        coverageStatus: "FullyAssigned",
        assignments: fixture.assignments
          ? fixture.assignments(at)
          : [
              {
                segmentId: "seg-1",
                segmentVersion: fixture.version,
                physicalRoomId: fixture.sourceRoom,
                actualRoomTypeId: fixture.sourceRoom === "room-301" ? "type-deluxe" : "type-standard",
                startDate: at(fixture.startOffset),
                endDate: at(fixture.endOffset),
              },
            ],
        unassignedRanges: [],
      },
    ],
    operationalBlocks: [],
  };
}

const membership = (role: string): StaffMembership => ({ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role });

function staffAccess(role: string) {
  const onSessionExpired = vi.fn();
  const refreshAccess = vi.fn().mockResolvedValue("authenticated" as const);
  const onWriteActivityChange = vi.fn();
  const state = { signingOut: false };
  const access: BoardAccess = {
    mode: "Staff",
    memberships: [membership(role)],
    onSessionExpired,
    refreshAccess,
    onWriteActivityChange,
    isSigningOut: () => state.signingOut,
  };
  return { access, onSessionExpired, refreshAccess, onWriteActivityChange, state };
}

beforeEach(() => {
  sessionStorage.clear();
  dialogProbe.props = null;
  popoverProbe.props = null;
  vi.restoreAllMocks();
  for (const mock of [mockedProperties, mockedBoard, mockedSplit, mockedMove, mockedUnassign, mockedBlockCreate]) mock.mockReset();
  fixture = defaults();
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA] });
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) }));
  mockedSplit.mockResolvedValue({ kind: "split", segments: null });
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function renderBoard(access?: BoardAccess) {
  const view = render(access ? <ReservationBoard access={access} /> : <ReservationBoard />);
  await waitFor(() => expect(screen.getAllByTitle(BAR).length).toBeGreaterThan(0));
  const [propertyId, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { ...view, propertyId, from, to, at: (offset: number) => addDaysIso(from, offset) };
}

const popover = () => screen.getByRole("dialog", { name: "Reservation details" });
const splitButton = () => within(popover()).queryByRole("button", { name: /^Move from a date/ });
const splitDialog = () => screen.getByRole("dialog", { name: "Move from a date" });
const dateInput = () => screen.getByLabelText("Destination room takes over from") as HTMLInputElement;
const confirmButton = () => screen.queryByRole("button", { name: /^(Split and move|Splitting)/ });
const form = () => splitDialog().querySelector("form")!;
const setDate = (value: string) => fireEvent.change(dateInput(), { target: { value } });
const pick = (number: string) => fireEvent.click(within(splitDialog()).getByLabelText(new RegExp(`Room ${number}`)));
const crossCheckbox = () => within(splitDialog()).getByLabelText(/deliberately chosen/) as HTMLInputElement;
const pastCheckbox = () => within(splitDialog()).getByLabelText(/already passed/) as HTMLInputElement;
const setReason = (value: string) => fireEvent.change(within(splitDialog()).getByLabelText(/^Reason/), { target: { value } });

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByTitle(BAR)[0]);
}

async function openSplit(user: ReturnType<typeof userEvent.setup>) {
  await openPopover(user);
  await user.click(splitButton()!);
}

async function closeSplit(user: ReturnType<typeof userEvent.setup>) {
  const buttons = within(splitDialog()).getAllByRole("button", { name: "Close" });
  await user.click(buttons.at(-1)!);
}

async function settleReread(before: number) {
  await waitFor(() => expect(mockedBoard.mock.calls.length).toBeGreaterThan(before));
  await flush();
}

/** Opens the dialog, fills a same-type split and confirms. */
async function confirmSameType(user: ReturnType<typeof userEvent.setup>, splitDate: string, room = "102") {
  await openSplit(user);
  setDate(splitDate);
  pick(room);
  await user.click(confirmButton()!);
}

async function reloadSameTab(access?: BoardAccess) {
  cleanup();
  return renderBoard(access);
}

describe("the action (offered, absent, disabled)", () => {
  it("is offered on an assigned bar of at least two nights, and opens the dialog for the exact full source range", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openPopover(user);
    expect(splitButton()).toBeEnabled();
    await user.click(splitButton()!);
    // The bar is only partly visible (it starts before the window); the dialog speaks of the whole segment.
    const dialog = within(splitDialog());
    expect(dialog.getByText(new RegExp(`\\[${at(-2)}, ${at(6)}\\)`))).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Reservation details" })).not.toBeInTheDocument();
    expect(mockedSplit).not.toHaveBeenCalled();
  });

  it("is absent for a one-night segment, for an unassigned range and for an operational block", async () => {
    fixture.startOffset = 1;
    fixture.endOffset = 2;
    const user = userEvent.setup();
    await renderBoard();
    await openPopover(user);
    expect(splitButton()).not.toBeInTheDocument();
    expect(within(popover()).getByRole("button", { name: "Move room" })).toBeInTheDocument();
  });

  it("is absent for a role that cannot change assignments, present for FrontDesk and Manager", async () => {
    const user = userEvent.setup();
    const viewer = staffAccess("Viewer");
    render(<ReservationBoard access={viewer.access} />);
    await flush();
    expect(screen.queryByTitle(BAR)).not.toBeInTheDocument();
    cleanup();

    for (const role of ["FrontDesk", "Manager"]) {
      const { unmount } = await renderBoard(staffAccess(role).access);
      await openPopover(user);
      expect(splitButton()).toBeEnabled();
      unmount();
    }
  });

  it("FrontDesk: a stay whose current room is another type than sold is disabled with a reason; Manager may open it", async () => {
    fixture.sourceRoom = "room-301";
    const user = userEvent.setup();
    await renderBoard(staffAccess("FrontDesk").access);
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
    expect(popover()).toHaveTextContent("needs a Manager");
    await user.click(within(popover()).getByRole("button", { name: "Close" }));
    expect(mockedSplit).not.toHaveBeenCalled();
    cleanup();

    await renderBoard(staffAccess("Manager").access);
    await openPopover(user);
    expect(splitButton()).toBeEnabled();
  });

  it("is disabled while the board is waiting to be re-read after another change", async () => {
    const user = userEvent.setup();
    const { from } = await renderBoard();
    // An earlier write's re-read has not completed: the board on screen is already contradicted.
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    await openPopover(user);
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
    mockedBoard.mockImplementation(() => reread.promise);
    await user.click(within(screen.getByRole("dialog", { name: "Move room" })).getByLabelText(/Room 102/));
    await user.click(within(screen.getByRole("dialog", { name: "Move room" })).getByRole("button", { name: /^Move to room/ }));
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    await flush();
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
    expect(popover()).toHaveTextContent("re-read");
    await act(async () => reread.resolve({ ok: true, data: boardFor("prop-a", from, addDaysIso(from, 14)) }));
  });
});

describe("one request, the right body (FrontDesk, same RoomType)", () => {
  it("sends exactly the five contract fields once, and shows the saved notice only after the board is re-read", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    const before = mockedBoard.mock.calls.length;
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0]).toEqual([
      "prop-a",
      "seg-1",
      { expectedVersion: 4, splitDate: at(2), destinationPhysicalRoomId: "room-102", confirmCrossRoomType: false },
    ]);
    // No acknowledgement flag, actor, evidence, role, Unit, range or replacement list.
    expect(Object.keys(mockedSplit.mock.calls[0][2]).sort()).toEqual(["confirmCrossRoomType", "destinationPhysicalRoomId", "expectedVersion", "splitDate"]);
    await settleReread(before);
    expect(mockedBoard.mock.calls.length).toBe(before + 1);
    expect(screen.queryByRole("dialog", { name: "Move from a date" })).not.toBeInTheDocument();
    const notice = screen.getByText(/Room split-move saved for Nguyen Van A \(CNF-100\)/);
    expect(notice).toHaveTextContent(`room 101 keeps [${at(-2)}, ${at(2)}) and room 102 takes [${at(2)}, ${at(6)})`);
    expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
  });

  it("draws no successor bars of its own: only the re-read board is shown", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    await flush();
    // The mocked server still shows the source: nothing else is painted.
    expect(screen.getAllByTitle(BAR)).toHaveLength(1);

    // Once the server shows the two successors, they — and only they — are drawn.
    fixture.assignments = (offset) => [
      { segmentId: "seg-2", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: offset(-2), endDate: offset(2) },
      { segmentId: "seg-3", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-standard", startDate: offset(2), endDate: offset(6) },
    ];
    const before = mockedBoard.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await settleReread(before);
    expect(screen.getAllByTitle(BAR)).toHaveLength(2);
  });

  it("trims an optional reason and sends it; a blank reason is not sent", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    setReason("   Guest asked to change rooms.  ");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toEqual({
      expectedVersion: 4,
      splitDate: at(2),
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: false,
      reason: "Guest asked to change rooms.",
    });
  });

  it("a double submit (two submit events and a double click) records one intent and sends one request", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    await openSplit(user);
    setDate(at(2));
    pick("102");
    act(() => {
      fireEvent.submit(form());
      fireEvent.submit(form());
    });
    await user.dblClick(confirmButton()!);
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    const record = JSON.parse(sessionStorage.getItem(PENDING_KEY)!);
    expect(record.writes).toHaveLength(1);
    expect(record.writes[0].write.target).toMatchObject({
      operation: "split-move",
      segmentId: "seg-1",
      expectedVersion: 4,
      sourcePhysicalRoomId: "room-101",
      physicalRoomId: "room-102",
      splitDate: at(2),
      startDate: at(-2),
      endDate: at(6),
    });
    await act(async () => answer.resolve({ kind: "split", segments: null }));
    expect(mockedSplit).toHaveBeenCalledTimes(1);
  });
});

describe("cross-RoomType (D1, D3) — Manager only", () => {
  it("suffix-only: a Deluxe destination needs the confirmation and a reason; the body carries both", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard(staffAccess("Manager").access);
    await openSplit(user);
    setDate(at(2));
    pick("201");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    fireEvent.click(crossCheckbox());
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    setReason("  Upgrade for the second half.  ");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toEqual({
      expectedVersion: 4,
      splitDate: at(2),
      destinationPhysicalRoomId: "room-201",
      confirmCrossRoomType: true,
      reason: "Upgrade for the second half.",
    });
  });

  it("prefix-only: the stay already sits in Deluxe and moves to a Standard room — the prefix is cross, so confirmation and a reason are needed (D1)", async () => {
    fixture.sourceRoom = "room-301";
    const user = userEvent.setup();
    const { at } = await renderBoard(staffAccess("Manager").access);
    await openSplit(user);
    setDate(at(2));
    pick("102");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    fireEvent.click(crossCheckbox());
    setReason("Prefix stays in the Deluxe room.");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toEqual({
      expectedVersion: 4,
      splitDate: at(2),
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: true,
      reason: "Prefix stays in the Deluxe room.",
    });
  });

  it("both parts cross: Deluxe source and Deluxe destination send one confirmation and one reason", async () => {
    fixture.sourceRoom = "room-301";
    const user = userEvent.setup();
    const { at } = await renderBoard(staffAccess("Manager").access);
    await openSplit(user);
    setDate(at(2));
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("Both halves deliberately upgraded.");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toMatchObject({ destinationPhysicalRoomId: "room-201", confirmCrossRoomType: true });
  });

  it("FrontDesk is offered Standard rooms only and sends confirmCrossRoomType false", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard(staffAccess("FrontDesk").access);
    await openSplit(user);
    expect(within(splitDialog()).queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    setDate(at(2));
    pick("103");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toMatchObject({ destinationPhysicalRoomId: "room-103", confirmCrossRoomType: false });
    expect(mockedSplit.mock.calls[0][2]).not.toHaveProperty("reason");
  });

  it("a role lowered while the dialog is open sends nothing for a cross-RoomType split", async () => {
    const user = userEvent.setup();
    const manager = staffAccess("Manager");
    const { at, rerender } = await renderBoard(manager.access);
    await openSplit(user);
    setDate(at(2));
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("Upgrade");
    rerender(<ReservationBoard access={{ ...manager.access, memberships: [membership("FrontDesk")] } as BoardAccess} />);
    // The dialog drops the Deluxe room it can no longer offer, so there is nothing left to confirm; a
    // late callback would be refused by the board too (see splitMoveSubmission.test.ts).
    await flush();
    expect(within(splitDialog()).queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    fireEvent.submit(form());
    await flush();
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("past split date (D4) — judged against the Property's localToday", () => {
  it("needs its own acknowledgement; without it nothing is sent, with it the request leaves without the flag", async () => {
    fixture.todayOffset = 4;
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(1));
    pick("102");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(pastCheckbox().checked).toBe(false);
    fireEvent.click(pastCheckbox());
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toEqual({
      expectedVersion: 4,
      splitDate: at(1),
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: false,
    });
  });

  it("past alone does not need a reason; with a cross-type destination the two controls are independent", async () => {
    fixture.todayOffset = 4;
    const user = userEvent.setup();
    const { at } = await renderBoard(staffAccess("Manager").access);
    await openSplit(user);
    setDate(at(1));
    pick("201");
    // The past acknowledgement does not stand in for the cross-type confirmation …
    fireEvent.click(pastCheckbox());
    setReason("Upgrade");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    // … and the cross-type confirmation does not stand in for the past acknowledgement.
    fireEvent.click(pastCheckbox());
    fireEvent.click(crossCheckbox());
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    fireEvent.click(pastCheckbox());
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(mockedSplit.mock.calls[0][2]).toMatchObject({ confirmCrossRoomType: true, reason: "Upgrade" });
  });

  it("a Property date that moves past the chosen date after the dialog opened needs the acknowledgement at send time", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(1));
    pick("102");
    // The server's board now says the Property's date is after the chosen date (a re-read from the back/forward cache).
    fixture.todayOffset = 4;
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    await flush();
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent(/before the Property's current date|already passed/i);
  });
});

describe("refused before sending: zero requests, no new pending intent", () => {
  it("Property/range navigation before Confirm closes the dialog and sends nothing", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Move from a date" })).not.toBeInTheDocument());
    expect(screen.getByTestId("move-refusal-notice")).toHaveTextContent("Nothing was sent");
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("a Confirm that lands before React has re-rendered the navigation is still refused", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    const next = screen.getByRole("button", { name: "Next date range" });
    act(() => {
      fireEvent.click(next);
      fireEvent.submit(form());
    });
    await flush();
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("the source segment changes on the server while the dialog is open: Confirm sends nothing", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    fixture.version = 5;
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    await flush();
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(within(splitDialog()).getByRole("alert")).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("the destination stops being Active while the dialog is open: Confirm sends nothing", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    fixture.room102Status = "OutOfService";
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    await flush();
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("a sign-out waiting for the server pauses writes: nothing is sent", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const { at } = await renderBoard(desk.access);
    await openSplit(user);
    setDate(at(2));
    pick("102");
    desk.state.signingOut = true;
    act(() => {
      fireEvent.submit(form());
    });
    await flush();
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent("Signing out");
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("an earlier unconfirmed write into the destination over the later nights refuses the send; over the earlier nights only, it does not", async () => {
    const user = userEvent.setup();
    const { at, from, to } = await renderBoard();
    // Seed an unresolved block in room 102 over the later nights only [at(3), at(4)).
    const key = boardIdentityKey("prop-a", from, to);
    const lockedLater: BlockCreateReconciliation = {
      id: 1, key, propertyId: "prop-a", from, to, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved",
      target: { operation: "create", physicalRoomId: "room-102", roomNumber: "102", startDate: at(3), endDate: at(4), reason: "Leak" },
    };
    cleanup();
    persistUncertainWrites(sessionStorage, [], [lockedLater]);
    await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    await closeSplit(user);
    cleanup();

    // The same block over the nights before the split does not touch the destination's part.
    sessionStorage.clear();
    const lockedEarlier: BlockCreateReconciliation = { ...lockedLater, target: { ...lockedLater.target, startDate: at(0), endDate: at(1) } };
    persistUncertainWrites(sessionStorage, [], [lockedEarlier]);
    await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
  });
});

describe("outcomes", () => {
  it("HTTP 200 with an unreadable body and a failed re-read is still saved — never unknown, never resent", async () => {
    mockedSplit.mockResolvedValue({ kind: "split", segments: null });
    const user = userEvent.setup();
    const { at } = await renderBoard();
    const before = mockedBoard.mock.calls.length;
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "network", message: "Could not reach the Admin API." } });
    await confirmSameType(user, at(2));
    await settleReread(before);
    expect(screen.getByText(/Room split-move saved/)).toBeInTheDocument();
    expect(screen.getByText(/Saved on the server, but the board could not be reloaded/)).toBeInTheDocument();
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(mockedSplit).toHaveBeenCalledTimes(1);
  });

  it("a client that throws is an unconfirmed result: one request, a lock, and the activity count is balanced", async () => {
    mockedSplit.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const { at } = await renderBoard(desk.access);
    await confirmSameType(user, at(2));
    await waitFor(() => expect(within(splitDialog()).getByRole("alert")).toHaveTextContent(/may or may not/i));
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    expect(desk.onWriteActivityChange.mock.calls.map((call) => call[0])).toEqual([true, false]);
    await closeSplit(user);
    expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("Unconfirmed room split-move request for Nguyen Van A (CNF-100)");
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();
  });

  it("409 is reported, the board is re-read, and the dialog cannot resend", async () => {
    mockedSplit.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict", detail: "The room is taken." });
    const user = userEvent.setup();
    const { at } = await renderBoard();
    const before = mockedBoard.mock.calls.length;
    await confirmSameType(user, at(2));
    await settleReread(before);
    expect(within(splitDialog()).getByRole("alert")).toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("not-sent and a 400 leave the dialog resubmittable by an explicit new Confirm, with no unconfirmed record", async () => {
    mockedSplit.mockResolvedValueOnce({ kind: "not-sent", message: "not configured" });
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    mockedSplit.mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "bad" });
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(confirmButton()).toBeInTheDocument();
  });

  it("Staff: a 401 is settled as a rejection first (intent dropped, nothing resent), then the session is handed back", async () => {
    mockedSplit.mockResolvedValue({ kind: "rejected", status: 401, category: "refused", detail: "Your Staff session has ended." });
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const { at } = await renderBoard(desk.access);
    await confirmSameType(user, at(2));
    await waitFor(() => expect(desk.onSessionExpired).toHaveBeenCalledTimes(1));
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(desk.onWriteActivityChange.mock.calls.at(-1)).toEqual([false]);
  });

  it("Staff: a generic 403 re-reads access once and resends nothing; the store's cross-type 403 does not re-read access", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const { at } = await renderBoard(desk.access);
    mockedSplit.mockResolvedValue({ kind: "rejected", status: 403, category: "not-permitted" });
    await confirmSameType(user, at(2));
    await waitFor(() => expect(desk.refreshAccess).toHaveBeenCalledTimes(1));
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    cleanup();

    const manager = staffAccess("Manager");
    const second = await renderBoard(manager.access);
    mockedSplit.mockResolvedValue({
      kind: "rejected",
      status: 403,
      category: "cross-room-type-confirmation-required",
      detail: "A successor crosses the sold RoomType.",
    });
    await openSplit(user);
    setDate(second.at(2));
    pick("102");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(2));
    expect(manager.refreshAccess).not.toHaveBeenCalled();
    expect(manager.onSessionExpired).not.toHaveBeenCalled();
  });

  it("Sign-out is reported blocked while the request is on the wire and released after its answer", async () => {
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const { at } = await renderBoard(desk.access);
    await confirmSameType(user, at(2));
    expect(desk.onWriteActivityChange.mock.calls.at(-1)).toEqual([true]);
    await act(async () => answer.resolve({ kind: "split", segments: null }));
    await flush();
    expect(desk.onWriteActivityChange.mock.calls.at(-1)).toEqual([false]);
  });
});

describe("unconfirmed result: notice, locks and reconciliation by the board", () => {
  async function loseSplit(user: ReturnType<typeof userEvent.setup>, at: (offset: number) => string) {
    mockedSplit.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    await flush();
  }

  it("says it may or may not have been saved, never retries, and keeps the source's range locked after a re-read that shows it unchanged", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await loseSplit(user, at);
    const alert = within(splitDialog()).getByRole("alert");
    expect(alert).toHaveTextContent(/may or may not/i);
    await closeSplit(user);
    const notice = screen.getByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent("Unconfirmed room split-move request for Nguyen Van A (CNF-100)");
    expect(notice).toHaveTextContent(`the source room keeps [${at(-2)}, ${at(2)}) and room 102 takes [${at(2)}, ${at(6)})`);
    expect(notice).toHaveTextContent("still shown unchanged");
    expect(notice).not.toHaveTextContent("saved");
    // The source segment cannot be split, moved or unassigned again.
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
    expect(within(popover()).getByRole("button", { name: "Move room" })).toBeDisabled();
    expect(within(popover()).getByRole("button", { name: "Remove room assignment" })).toBeDisabled();
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    const before = mockedBoard.mock.calls.length;
    await user.click(within(notice).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    expect(mockedSplit).toHaveBeenCalledTimes(1);
  });

  it("a re-read showing both exact successors on a window that straddles the split date is observed — and unlocks", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await loseSplit(user, at);
    await closeSplit(user);
    fixture.assignments = (offset) => [
      { segmentId: "seg-2", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: offset(-2), endDate: offset(2) },
      { segmentId: "seg-3", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-standard", startDate: offset(2), endDate: offset(6) },
    ];
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    const notice = screen.getByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent("now shows both parts");
    expect(notice).toHaveTextContent("it does not prove this request made it");
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
  });

  it("only one successor shown is never observed; a source replaced by something else is 'changed', never 'saved'", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await loseSplit(user, at);
    await closeSplit(user);
    fixture.assignments = (offset) => [
      { segmentId: "seg-2", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: offset(-2), endDate: offset(2) },
    ];
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    const notice = screen.getByTestId("uncertain-write-notice");
    expect(notice).not.toHaveTextContent("now shows both parts");
    expect(notice).toHaveTextContent("changed on the server");
    expect(notice).not.toHaveTextContent(/split-move saved/i);
  });

  it("a failed re-read never resolves it", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await loseSplit(user, at);
    await closeSplit(user);
    const before = mockedBoard.mock.calls.length;
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "network", message: "down" } });
    await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("could not be reloaded");
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();
  });

  it("the lock outlives a change of view: leaving the range and coming back, the source is still locked", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await loseSplit(user, at);
    await closeSplit(user);
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await flush();
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await waitFor(() => expect(screen.getAllByTitle(BAR).length).toBeGreaterThan(0));
    await flush();
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
  });

  it("a lost move or unassign of the same segment locks the split-move, and a lost split locks drag-move targets too", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    // A lost move of the segment …
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" } as MoveAssignmentOutcome);
    await openPopover(user);
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
    const moveDialog = () => screen.getByRole("dialog", { name: "Move room" });
    await user.click(within(moveDialog()).getByLabelText(/Room 103/));
    await user.click(within(moveDialog()).getByRole("button", { name: /^Move to room/ }));
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    await flush();
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
    expect(mockedSplit).not.toHaveBeenCalled();
    void at;
  });

  it("a lost unassign of the segment also locks the split-move", async () => {
    mockedUnassign.mockResolvedValue({ kind: "unknown", reason: "timeout" } as UnassignAssignmentOutcome);
    const user = userEvent.setup();
    await renderBoard();
    await openPopover(user);
    await user.click(within(popover()).getByRole("button", { name: "Remove room assignment" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove room assignment" })).getByRole("button", { name: /^Remove room/ }));
    await waitFor(() => expect(mockedUnassign).toHaveBeenCalledTimes(1));
    await flush();
    await user.click(within(screen.getByRole("dialog", { name: "Remove room assignment" })).getAllByRole("button", { name: "Close" }).at(-1)!);
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
  });
});

describe("pending, navigation, unmount and reload", () => {
  it("navigation while the request is pending keeps the dialog; the success is not painted onto the other board", async () => {
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await confirmSameType(user, at(2));
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await flush();
    expect(screen.getByRole("dialog", { name: "Move from a date" })).toBeInTheDocument();
    await act(async () => answer.resolve({ kind: "split", segments: null }));
    await flush();
    // The dialog reports its own board's result; no success notice appears on this board.
    expect(screen.queryByText(/Room split-move saved for/)).not.toBeInTheDocument();
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent(/saved/i);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(mockedSplit).toHaveBeenCalledTimes(1);
  });

  it("the dialog cannot be closed or edited while the request is on the wire (Escape does nothing)", async () => {
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await confirmSameType(user, at(2));
    fireEvent.keyDown(splitDialog(), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Move from a date" })).toBeInTheDocument();
    await act(async () => answer.resolve({ kind: "split", segments: null }));
  });

  it("unmounting the board while pending leaves the unconfirmed intent for the next page and sets no state", async () => {
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    const { at, unmount } = await renderBoard();
    await confirmSameType(user, at(2));
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
    unmount();
    await act(async () => answer.resolve({ kind: "unknown", reason: "aborted" }));
    // An unknown outcome on a page that is gone stays recorded for the next one.
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
    expect(mockedSplit).toHaveBeenCalledTimes(1);
  });

  it("a reload while pending restores the in-flight record: no resend, the source is locked, and the intent is read once", async () => {
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await confirmSameType(user, at(2));
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      answer.resolve({ kind: "unknown", reason: "aborted" });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();

    await reloadSameTab();
    const notice = await screen.findByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent("Unconfirmed room split-move request sent just before this page was reloaded or left");
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
    expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);

    // A second look at the tab (back/forward cache) does not take the same write in twice.
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    await flush();
    expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
  });

  it("a reload after an unknown outcome restores it from the unconfirmed record; sign-out and sign-in keep it and resend nothing", async () => {
    mockedSplit.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const { at } = await renderBoard(desk.access);
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    await flush();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();

    // Sign-out ends the page; a different Staff member signs in to the same tab.
    cleanup();
    await renderBoard(staffAccess("Manager").access);
    const notice = screen.getByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent("from before this page was reloaded or left");
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    await openPopover(user);
    expect(splitButton()).toBeDisabled();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();
  });
});

describe("storage (mixed lists and failures)", () => {
  it("an unconfirmed split-move is saved together with an unconfirmed block, and neither list loses the other", async () => {
    const user = userEvent.setup();
    const { from, to, at } = await renderBoard();
    const block: BlockCreateReconciliation = {
      id: 1, key: boardIdentityKey("prop-a", from, to), propertyId: "prop-a", from, to, afterSeq: 0,
      certainty: "uncertain", status: "pending", resolution: "unresolved",
      target: { operation: "create", physicalRoomId: "room-103", roomNumber: "103", startDate: at(8), endDate: at(9), reason: "Leak" },
    };
    cleanup();
    persistUncertainWrites(sessionStorage, [], [block]);
    await renderBoard();
    mockedSplit.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    await flush();
    const record = JSON.parse(sessionStorage.getItem(UNCERTAIN_KEY)!);
    expect(record.assignments).toHaveLength(1);
    expect(record.assignments[0].target.operation).toBe("split-move");
    expect(record.blocks).toHaveLength(1);
    expect(record.blocks[0].target.physicalRoomId).toBe("room-103");
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("the intent is dropped only once the unconfirmed record is saved: while storage refuses that record, it stays", async () => {
    const realSet = Storage.prototype.setItem;
    mockedSplit.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    const user = userEvent.setup();
    const { at } = await renderBoard();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === UNCERTAIN_KEY) throw new DOMException("full", "QuotaExceededError");
      realSet.call(this, key, value);
    });
    await confirmSameType(user, at(2));
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
    await flush();
    spy.mockRestore();
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
    await reloadSameTab();
    expect(await screen.findByTestId("uncertain-write-notice")).toHaveTextContent("sent just before this page was reloaded or left");
  });

  it("when the intent cannot be stored, nothing is sent; once storage works the dialog sends", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await user.click(confirmButton()!);
    spy.mockRestore();
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent("could not keep the safety record");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
  });

  it("a damaged pending record is never overwritten: nothing is sent and the record is untouched", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    sessionStorage.setItem(PENDING_KEY, "{not json");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBe("{not json");
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent("could not keep the safety record");
  });

  it("records that could not be read at mount keep every write closed — including a split-move — until they can be read", async () => {
    const realGet = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === UNCERTAIN_KEY || key === PENDING_KEY) throw new DOMException("denied", "SecurityError");
      return realGet.call(this, key);
    });
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    setDate(at(2));
    pick("102");
    await user.click(confirmButton()!);
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(within(splitDialog()).getByRole("alert")).toHaveTextContent("could not read the safety records");
    spy.mockRestore();
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedSplit).toHaveBeenCalledTimes(1));
  });
});

describe("focus", () => {
  it("closing the dialog returns focus to the bar that opened it; a saved result moves focus to the notice", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    const bar = screen.getAllByTitle(BAR)[0];
    await openSplit(user);
    expect(splitDialog().contains(document.activeElement)).toBe(true);
    await closeSplit(user);
    expect(document.activeElement).toBe(bar);

    await confirmSameType(user, at(2));
    await waitFor(() => expect(screen.getByText(/Room split-move saved for/)).toBeInTheDocument());
    const noticeEl = screen.getByText(/Room split-move saved for/).closest('[role="status"]') as HTMLElement;
    expect(noticeEl.contains(document.activeElement)).toBe(true);
    // Dismissing it by keyboard hands focus to a stable board control, not a removed node.
    within(noticeEl).getByRole("button", { name: "Dismiss notice" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Property"));
  });

  it("when the opening bar is gone after the board changed, closing falls back to the Property selector", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openSplit(user);
    fixture.assignments = () => [];
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    await waitFor(() => expect(screen.queryByTitle(BAR)).not.toBeInTheDocument());
    await closeSplit(user);
    expect(document.activeElement).toBe(screen.getByLabelText("Property"));
  });
});

describe("the board's own submit handler, called directly (a doubled, stale or hostile callback)", () => {
  const callBoard = (intent: Partial<SplitMoveIntent> & { splitDate: string }) => {
    const props = dialogProbe.props!;
    return props.onSubmit({
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: false,
      pastDateAcknowledged: false,
      ...intent,
    });
  };

  it("two calls in the same tick record one intent and send one request; the second is answered 'not sent'", async () => {
    const answer = deferred<SplitMoveAssignmentOutcome>();
    mockedSplit.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    let first!: Promise<SplitMoveAssignmentOutcome>;
    let second!: Promise<SplitMoveAssignmentOutcome>;
    act(() => {
      first = callBoard({ splitDate: at(2) });
      second = callBoard({ splitDate: at(2) });
    });
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!).writes).toHaveLength(1);
    await expect(second).resolves.toMatchObject({ kind: "not-sent" });
    await act(async () => answer.resolve({ kind: "split", segments: null }));
    await expect(first).resolves.toMatchObject({ kind: "split" });
    expect(mockedSplit).toHaveBeenCalledTimes(1);
  });

  it("refuses, with zero requests and no intent, every request the form could not have produced", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard(staffAccess("FrontDesk").access);
    await openSplit(user);
    const refused = async (intent: Parameters<typeof callBoard>[0]) => {
      let outcome!: SplitMoveAssignmentOutcome;
      await act(async () => {
        outcome = await callBoard(intent);
      });
      expect(outcome).toMatchObject({ kind: "not-sent" });
    };
    await refused({ splitDate: at(-2) }); // the source's own start
    await refused({ splitDate: at(6) }); // the source's own end
    await refused({ splitDate: "" });
    await refused({ splitDate: "2026-02-30" });
    await refused({ splitDate: at(2), destinationPhysicalRoomId: "room-101" }); // D2: the source room
    await refused({ splitDate: at(2), destinationPhysicalRoomId: "room-999" });
    // FrontDesk cannot confirm a cross-RoomType placement even if the callback says so.
    await refused({ splitDate: at(2), destinationPhysicalRoomId: "room-201", confirmCrossRoomType: true, reason: "Upgrade" });
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("a past date without the acknowledgement is refused at the callback; with it the request leaves", async () => {
    fixture.todayOffset = 4;
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    await act(async () => {
      await expect(callBoard({ splitDate: at(1) })).resolves.toMatchObject({ kind: "not-sent" });
    });
    expect(mockedSplit).not.toHaveBeenCalled();
    await act(async () => {
      await callBoard({ splitDate: at(1), pastDateAcknowledged: true });
    });
    expect(mockedSplit).toHaveBeenCalledTimes(1);
    expect(mockedSplit.mock.calls[0][2]).not.toHaveProperty("pastDateAcknowledged");
  });

  it("a callback captured before the view moved on sends nothing to the old board", async () => {
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await openSplit(user);
    const stale = dialogProbe.props!.onSubmit;
    const next = screen.getByRole("button", { name: "Next date range" });
    let outcome!: SplitMoveAssignmentOutcome;
    await act(async () => {
      fireEvent.click(next);
      outcome = await stale({ splitDate: at(2), destinationPhysicalRoomId: "room-102", confirmCrossRoomType: false, pastDateAcknowledged: false });
    });
    expect(outcome).toMatchObject({ kind: "not-sent" });
    expect(mockedSplit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("handlers called around a disabled button, and locks that only the segment id explains", () => {
  /** A restored, unresolved split-move of `seg-1` whose rooms, Unit and dates touch nothing on this board. */
  function foreignEntryForSegment(from: string, to: string, at: (offset: number) => string, operation: "split-move" | "move" | "unassign"): Reconciliation {
    const target =
      operation === "split-move"
        ? { operation, splitDate: at(42) }
        : { operation };
    return {
      id: 1,
      key: boardIdentityKey("prop-a", from, to),
      propertyId: "prop-a",
      from,
      to,
      afterSeq: 0,
      certainty: "uncertain",
      status: "pending",
      resolution: "unresolved",
      target: {
        reservationUnitId: "unit-x",
        startDate: at(40),
        endDate: at(44),
        roomNumber: "203",
        guestDisplayName: "x",
        confirmationNumber: "y",
        physicalRoomId: "room-201",
        segmentId: "seg-1",
        expectedVersion: 1,
        sourcePhysicalRoomId: "room-301",
        ...target,
      } as Reconciliation["target"],
    };
  }

  for (const operation of ["split-move", "move", "unassign"] as const) {
    it(`an unresolved ${operation} of this segment id locks move, unassign and split-move even when no room or Unit overlaps`, async () => {
      const user = userEvent.setup();
      const { from, to, at } = await renderBoard();
      cleanup();
      persistUncertainWrites(sessionStorage, [foreignEntryForSegment(from, to, at, operation)], []);
      await renderBoard();
      await openPopover(user);
      for (const name of [/^Move room$/, /^Remove room assignment$/, /^Move from a date/]) {
        expect(within(popover()).getByRole("button", { name })).toBeDisabled();
      }
      // The handlers themselves refuse too, if they are reached around the disabled buttons.
      const { selection } = popoverProbe.props!;
      if (selection.kind !== "stay" || !selection.value.segment) throw new Error("expected an assigned bar");
      const chosen = { stay: selection.value.stay, segment: selection.value.segment };
      act(() => {
        popoverProbe.props!.onMoveRoom?.(chosen);
        popoverProbe.props!.onUnassignRoom?.(chosen);
        popoverProbe.props!.onSplitMove?.(chosen);
      });
      expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Remove room assignment" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Move from a date" })).not.toBeInTheDocument();
    });
  }

  it("a stale entry for the segment id also stops a drag of it", async () => {
    // Drag is exercised in ReservationBoardMoveDragDrop.test.tsx; here the board's own refusal text is read.
    const { from, to, at } = await renderBoard();
    cleanup();
    persistUncertainWrites(sessionStorage, [foreignEntryForSegment(from, to, at, "split-move")], []);
    await renderBoard();
    const bar = screen.getAllByTitle(BAR)[0];
    const transfer = { setData: () => undefined, getData: () => "", types: [] as string[], dropEffect: "none", effectAllowed: "all" };
    expect(fireEvent.dragStart(bar, { dataTransfer: transfer })).toBe(false);
    expect(screen.getByTestId("board-drag-feedback")).toHaveTextContent("still unconfirmed");
  });

  it("the split-move notice keeps saying the board was reloaded after a later assignment write adds its own record", async () => {
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });
    const user = userEvent.setup();
    const { at } = await renderBoard();
    await confirmSameType(user, at(2));
    await waitFor(() => expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());

    // The (mocked) server still shows the source segment, so it can be moved; that move adds its own record.
    await openPopover(user);
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
    const moveDialog = screen.getByRole("dialog", { name: "Move room" });
    await user.click(within(moveDialog).getByLabelText(/Room 103/));
    await user.click(within(moveDialog).getByRole("button", { name: "Move to room 103" }));
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    await flush();
    const splitNotice = screen.getByText(/Room split-move saved for/).closest('[role="status"]') as HTMLElement;
    expect(splitNotice).toHaveTextContent("The board has been reloaded from the server");
    expect(splitNotice).not.toHaveTextContent("Reloading the board");
  });
});
