/**
 * PMS-CAL-003-CP03: board-level wiring for moving one operational block — block bar → details popover →
 * Move block… → dialog → the one move request → the authoritative re-read. The API client is mocked, so
 * these tests prove the board's decisions (what is offered, what is re-checked at send time, what is
 * recorded, locked and painted); the isolated Chrome + Kestrel + PostgreSQL run in the CP03 report proves
 * the rest. The rule under test throughout is that the board concludes nothing the server did not say:
 * a block appears in its new room only because a GET returned it, a refusal is never shown as a move, and a
 * lost response is never resolved by sending again.
 */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import type ReservationBoardStayPopoverType from "./ReservationBoardStayPopover";
import type ReservationBlockMoveDialogType from "./ReservationBlockMoveDialog";
import { addDaysIso } from "./dateMath";
import { PENDING_WRITES_STORAGE_KEY, UNCERTAIN_WRITES_STORAGE_KEY, persistUncertainWrites } from "./uncertainWriteStorage";
import { boardIdentityKey } from "./assignmentTarget";
import type { BlockCreateReconciliation, BlockWriteTarget } from "./blockCreateReconciliation";
import type { BoardAccess } from "./calendarAccess";
import type { StaffMembership } from "@/lib/api/staff";
import type { OperationalBlockMoveOutcome } from "@/lib/api/client";
import type { BlockSelection } from "./ReservationBoardServerTimeline";
import type { ApiProperty, ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";

// The real components, wrapped only to remember the props the board last gave them: a test can then call
// the board's own callbacks the way a stale or doubled one would, without the component's guards in front.
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
const dialogProbe: { props: React.ComponentProps<typeof ReservationBlockMoveDialogType> | null } = vi.hoisted(() => ({ props: null }));
vi.mock("./ReservationBlockMoveDialog", async (importActual) => {
  const actual = await importActual<typeof import("./ReservationBlockMoveDialog")>();
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
const mockedMove = vi.mocked(moveOperationalBlock);
const mockedCancel = vi.mocked(cancelOperationalBlock);
const mockedCreate = vi.mocked(createOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const propertyB: ApiProperty = { id: "prop-b", name: "Property B", timeZone: "Asia/Ho_Chi_Minh" };
const PENDING_KEY = PENDING_WRITES_STORAGE_KEY;
const UNCERTAIN_KEY = UNCERTAIN_WRITES_STORAGE_KEY;

const REASON = "Burst pipe";
const HEADER = "header-1";
const SEGMENT = "seg-block-1";
const VERSION = 3;
const SUCCESSOR = "seg-successor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/** What the mocked server shows; the block's nights are offsets from the board's `from`/`to`. */
interface Fixture {
  /** Where the tracked block is, or how the server changed it. */
  scene: "intact" | "moved" | "gone" | "wrong-header" | "re-versioned" | "intact-with-lookalike";
  /** Overrides for the block's own fields. */
  block: (from: string, to: string) => Partial<ReservationBoardOperationalBlock>;
  room102Status: string;
  onlyOneActiveRoom: boolean;
  /** A stay on room 201 so a stay popover can be opened. */
  withStay: boolean;
  /** A second, unrelated block (room 103) so another write can be made while a move's notice is shown. */
  withSecondBlock: boolean;
}

const defaults = (): Fixture => ({
  scene: "intact",
  // Starts one night before the window and ends one night after it, so any place that shows the clipped bar
  // range instead of the segment's own range is visible as a failure.
  block: () => ({}),
  room102Status: "Active",
  onlyOneActiveRoom: false,
  withStay: true,
  withSecondBlock: false,
});

let fixture: Fixture = defaults();

function sourceBlock(from: string, to: string, overrides: Partial<ReservationBoardOperationalBlock> = {}): ReservationBoardOperationalBlock {
  return {
    roomBlockId: HEADER,
    segmentId: SEGMENT,
    segmentVersion: VERSION,
    physicalRoomId: "room-101",
    startDate: addDaysIso(from, -1),
    endDate: addDaysIso(to, 1),
    reason: REASON,
    ...fixture.block(from, to),
    ...overrides,
  };
}

function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
  const at = (offset: number) => addDaysIso(from, offset);
  const base = sourceBlock(from, to);
  const successor = (overrides: Partial<ReservationBoardOperationalBlock> = {}): ReservationBoardOperationalBlock => ({
    ...base,
    segmentId: SUCCESSOR,
    segmentVersion: 1,
    physicalRoomId: "room-102",
    ...overrides,
  });
  let blocks: ReservationBoardOperationalBlock[];
  switch (fixture.scene) {
    case "moved":
      blocks = [successor()];
      break;
    case "gone":
      blocks = [];
      break;
    case "wrong-header":
      blocks = [successor({ roomBlockId: "header-other" })];
      break;
    case "re-versioned":
      blocks = [{ ...base, segmentVersion: VERSION + 1 }];
      break;
    case "intact-with-lookalike":
      blocks = [base, successor({ segmentId: "seg-lookalike" })];
      break;
    default:
      blocks = [base];
  }
  return {
    property: { id: propertyId, name: propertyId === "prop-a" ? "Property A" : "Property B", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: [
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    ],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: fixture.onlyOneActiveRoom ? "OutOfService" : fixture.room102Status },
      { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
      { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: fixture.onlyOneActiveRoom ? "OutOfService" : "Active" },
    ],
    stays:
      propertyId === "prop-a" && fixture.withStay
        ? [
            {
              reservationId: "res-1",
              reservationUnitId: "unit-1",
              confirmationNumber: "CNF-100",
              guestDisplayName: "Nguyen Van A",
              soldRoomTypeId: "type-deluxe",
              checkIn: at(2),
              checkOut: at(4),
              coverageStatus: "FullyAssigned",
              assignments: [{ segmentId: "seg-stay", segmentVersion: 1, physicalRoomId: "room-201", actualRoomTypeId: "type-deluxe", startDate: at(2), endDate: at(4) }],
              unassignedRanges: [],
            },
          ]
        : [],
    operationalBlocks:
      propertyId === "prop-a"
        ? [
            ...blocks,
            ...(fixture.withSecondBlock
              ? [{ roomBlockId: "header-2", segmentId: "seg-block-2", segmentVersion: 5, physicalRoomId: "room-103", startDate: at(8), endDate: at(9), reason: "Second block" }]
              : []),
          ]
        : [],
  };
}

const membership = (role: string): StaffMembership => ({ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role });

function staffAccess(role: string) {
  const onSessionExpired = vi.fn();
  const refreshAccess = vi.fn().mockResolvedValue("authenticated" as const);
  const onWriteActivityChange = vi.fn();
  const state = { signingOut: false, memberships: [membership(role)] };
  const access = (): BoardAccess => ({
    mode: "Staff",
    memberships: state.memberships,
    onSessionExpired,
    refreshAccess,
    onWriteActivityChange,
    isSigningOut: () => state.signingOut,
  });
  return { access, onSessionExpired, refreshAccess, onWriteActivityChange, state };
}

beforeEach(() => {
  sessionStorage.clear();
  dialogProbe.props = null;
  popoverProbe.props = null;
  vi.restoreAllMocks();
  for (const mock of [mockedProperties, mockedBoard, mockedMove, mockedCancel, mockedCreate]) mock.mockReset();
  fixture = defaults();
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) }));
  mockedMove.mockResolvedValue({ kind: "moved", segments: null });
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function renderBoard(access?: BoardAccess) {
  const view = render(access ? <ReservationBoard access={access} /> : <ReservationBoard />);
  await waitFor(() => expect(screen.getAllByTitle(REASON).length).toBeGreaterThan(0));
  // A restored record is judged by the first read; let it settle before the test looks at what is offered.
  await flush();
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { ...view, from, to, at: (offset: number) => addDaysIso(from, offset), key: boardIdentityKey("prop-a", from, to) };
}

const blockBar = () => screen.getAllByTitle(REASON)[0];
const popover = () => screen.getByRole("dialog", { name: "Operational block details" });
const moveButton = () => within(popover()).queryByRole("button", { name: "Move block…" });
const cancelButton = () => within(popover()).queryByRole("button", { name: "Cancel block" });
const moveDialog = () => screen.getByRole("dialog", { name: "Move operational block" });
const queryMoveDialog = () => screen.queryByRole("dialog", { name: "Move operational block" });
const confirmButton = () => within(moveDialog()).queryByRole("button", { name: /^(Move block|Moving…)/ });
const form = () => moveDialog().querySelector("form")!;
const pick = (number: string) => fireEvent.click(within(moveDialog()).getByRole("radio", { name: new RegExp(`Room ${number}`) }));
const setReason = (value: string) => fireEvent.change(within(moveDialog()).getByLabelText(/^Reason for moving/), { target: { value } });
const pendingTokens = () => {
  const text = sessionStorage.getItem(PENDING_KEY);
  return text === null ? [] : (JSON.parse(text).writes as Array<{ token?: string } | null>);
};
const storedRecord = () => JSON.parse(sessionStorage.getItem(UNCERTAIN_KEY) ?? "null");
const postCount = () => mockedMove.mock.calls.length + mockedCancel.mock.calls.length + mockedCreate.mock.calls.length;

type User = ReturnType<typeof userEvent.setup>;

async function openPopover(user: User) {
  await user.click(blockBar());
}

async function openMove(user: User) {
  await openPopover(user);
  await user.click(moveButton()!);
}

async function confirmMove(user: User, room = "102") {
  await openMove(user);
  pick(room);
  await user.click(confirmButton()!);
}

async function settleReread(before: number) {
  await waitFor(() => expect(mockedBoard.mock.calls.length).toBeGreaterThan(before));
  await flush();
}

function pageShowFromCache() {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}

async function reloadSameTab(access?: BoardAccess) {
  cleanup();
  return renderBoard(access);
}

describe("the action (offered, absent, disabled)", () => {
  it("is offered beside Cancel block on a block bar, and absent from a stay's popover", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openPopover(user);
    expect(moveButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    // Move block… is listed before the destructive Cancel block.
    const labels = within(popover()).getAllByRole("button").map((button) => button.textContent);
    expect(labels.indexOf("Move block…")).toBeLessThan(labels.indexOf("Cancel block"));
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    const stay = screen.getByRole("dialog", { name: "Reservation details" });
    expect(within(stay).queryByRole("button", { name: "Move block…" })).not.toBeInTheDocument();
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("opens the dialog for the segment's own full nights, not the part the window shows", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderBoard();
    await openMove(user);
    expect(queryMoveDialog()).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Operational block details" })).not.toBeInTheDocument();
    const d = moveDialog();
    expect(d).toHaveTextContent(`[${addDaysIso(from, -1)}, ${addDaysIso(to, 1)})`);
    expect(d).toHaveTextContent(`${SEGMENT} · v${VERSION}`);
    expect(d).toHaveTextContent(REASON);
    expect(d).toHaveTextContent("Block reason (unchanged)");
    expect(d.querySelector('input[type="date"]')).toBeNull();
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
  });

  it("is present, enabled and the same for FrontDesk and Manager; absent for a role without BlockWrite", async () => {
    const user = userEvent.setup();
    for (const role of ["FrontDesk", "Manager"]) {
      const { unmount } = await renderBoard(staffAccess(role).access());
      await openPopover(user);
      expect(moveButton()).toBeEnabled();
      unmount();
    }
    const viewer = staffAccess("Viewer");
    render(<ReservationBoard access={viewer.access()} />);
    await flush();
    expect(screen.queryByTitle(REASON)).not.toBeInTheDocument();
  });

  it("is offered for a one-night block and for a block in a room that is no longer Active", async () => {
    const user = userEvent.setup();
    fixture.block = (from) => ({ startDate: addDaysIso(from, 3), endDate: addDaysIso(from, 4) });
    await renderBoard();
    await openPopover(user);
    expect(moveButton()).toBeEnabled();
    await user.click(moveButton()!);
    expect(moveDialog()).toHaveTextContent("1 night");
    cleanup();

    fixture = defaults();
    mockedBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      return Promise.resolve({ ok: true, data: { ...board, physicalRooms: board.physicalRooms.map((room) => (room.id === "room-101" ? { ...room, operationalStatus: "OutOfService" } : room)) } });
    });
    await renderBoard();
    await openPopover(user);
    expect(moveButton()).toBeEnabled();
    await user.click(moveButton()!);
    expect(moveDialog()).toHaveTextContent("101 (Standard) · OutOfService");
  });

  it("is disabled with a reason when no other Active room exists; Cancel block is unaffected", async () => {
    const user = userEvent.setup();
    fixture.onlyOneActiveRoom = true;
    await renderBoard();
    await openPopover(user);
    expect(moveButton()).toBeDisabled();
    expect(popover()).toHaveTextContent("No other Active room is available");
    expect(cancelButton()).toBeEnabled();
    await user.click(moveButton()!);
    expect(queryMoveDialog()).not.toBeInTheDocument();
  });

  it("is disabled for a block of more than 366 nights, which can still be cancelled; 366 nights can be moved", async () => {
    const user = userEvent.setup();
    fixture.block = () => ({ startDate: "2026-01-01", endDate: "2027-01-03" });
    await renderBoard();
    await openPopover(user);
    expect(moveButton()).toBeDisabled();
    expect(popover()).toHaveTextContent("longer than 366 nights");
    expect(popover()).toHaveTextContent("can still be cancelled");
    expect(cancelButton()).toBeEnabled();
    cleanup();

    fixture.block = () => ({ startDate: "2026-01-01", endDate: "2027-01-02" });
    await renderBoard();
    await openPopover(user);
    expect(moveButton()).toBeEnabled();
  });

  it("is disabled while the board is waiting to be re-read after another change", async () => {
    const user = userEvent.setup();
    const { from } = await renderBoard();
    mockedCancel.mockResolvedValue({ kind: "cancelled", segment: null });
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedBoard.mockImplementation(() => reread.promise);
    // A block cancel on the same board: its re-read has not completed.
    await openPopover(user);
    await user.click(cancelButton()!);
    await user.click(within(screen.getByRole("dialog", { name: "Cancel operational block" })).getByRole("button", { name: /^Cancel block on room/ }));
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledTimes(1));
    await flush();
    await act(async () => reread.resolve({ ok: true, data: boardFor("prop-a", from, addDaysIso(from, 14)) }));
    expect(mockedMove).not.toHaveBeenCalled();
  });
});

describe("one request, the right body", () => {
  it("sends exactly expectedVersion + destinationPhysicalRoomId once, paints nothing of its own, and shows the new room only from the re-read", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderBoard();
    const write = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => write.promise);
    await openMove(user);
    pick("102");
    act(() => {
      fireEvent.submit(form());
      fireEvent.submit(form());
    });
    await user.dblClick(within(moveDialog()).getByRole("button", { name: /^Moving…/ }));
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(mockedMove).toHaveBeenCalledWith("prop-a", SEGMENT, { expectedVersion: VERSION, destinationPhysicalRoomId: "room-102" });
    expect(Object.keys(mockedMove.mock.calls[0][2]).sort()).toEqual(["destinationPhysicalRoomId", "expectedVersion"]);
    // One intent for one request, recorded before the wire, and the block is not moved on screen.
    expect(pendingTokens()).toHaveLength(1);
    expect(pendingTokens()[0]).toMatchObject({ write: { target: { operation: "move", segmentId: SEGMENT, expectedVersion: VERSION, sourcePhysicalRoomId: "room-101", physicalRoomId: "room-102" } } });
    expect(screen.getAllByTitle(REASON)).toHaveLength(1);

    const before = mockedBoard.mock.calls.length;
    fixture.scene = "moved";
    await act(async () => write.resolve({ kind: "moved", segments: null }));
    await settleReread(before);

    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(mockedBoard.mock.calls.length).toBe(before + 1);
    expect(queryMoveDialog()).not.toBeInTheDocument();
    const notice = screen.getByText(`Block moved from room 101 to room 102 for [${addDaysIso(from, -1)}, ${addDaysIso(to, 1)}).`).closest("[role=status]")!;
    expect(notice).toHaveTextContent("Saved on the server");
    expect(notice).toHaveTextContent("The board has been reloaded from the server.");
    expect(pendingTokens()).toHaveLength(0);
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
    // Still one bar: the same block, now in room 102 — drawn from the GET.
    expect(screen.getAllByTitle(REASON)).toHaveLength(1);
  });

  it("sends a trimmed reason only when one was typed, and never the block's own reason", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    setReason("   Repair done  ");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(mockedMove.mock.calls[0][2]).toEqual({ expectedVersion: VERSION, destinationPhysicalRoomId: "room-102", reason: "Repair done" });
    cleanup();

    mockedMove.mockClear();
    await renderBoard();
    await openMove(user);
    pick("102");
    setReason("    ");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(mockedMove.mock.calls[0][2]).toEqual({ expectedVersion: VERSION, destinationPhysicalRoomId: "room-102" });
  });

  it("accepts a reason of exactly 500 characters; 501 sends nothing and leaves no intent", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    setReason("x".repeat(501));
    await user.click(confirmButton()!);
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("at most 500 characters");
    setReason("x".repeat(500));
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(mockedMove.mock.calls[0][2].reason).toHaveLength(500);
  });

  it.each([["FrontDesk"], ["Manager"]])("%s moves a one-night block to a room of another room type with no confirmation, in one request", async (role) => {
    const user = userEvent.setup();
    fixture.block = (from) => ({ startDate: addDaysIso(from, 3), endDate: addDaysIso(from, 4) });
    const staff = staffAccess(role);
    await renderBoard(staff.access());
    await openMove(user);
    pick("201");
    expect(within(moveDialog()).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(mockedMove).toHaveBeenCalledWith("prop-a", SEGMENT, { expectedVersion: VERSION, destinationPhysicalRoomId: "room-201" });
  });

  it("through the board's own callback, a doubled call records one intent and sends one request; the second answers not-sent", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const write = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => write.promise);
    await openMove(user);
    const submit = dialogProbe.props!.onSubmit;
    let first!: Promise<OperationalBlockMoveOutcome>;
    let second!: Promise<OperationalBlockMoveOutcome>;
    act(() => {
      first = submit({ destinationPhysicalRoomId: "room-102" });
      second = submit({ destinationPhysicalRoomId: "room-102" });
    });
    await expect(second).resolves.toMatchObject({ kind: "not-sent", message: expect.stringContaining("already waiting") });
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(pendingTokens()).toHaveLength(1);
    await act(async () => write.resolve({ kind: "moved", segments: null }));
    await expect(first).resolves.toEqual({ kind: "moved", segments: null });
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });
});

describe("refused before sending: zero requests and no orphan intent", () => {
  it("Property/range navigation before Confirm closes the dialog and sends nothing", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(queryMoveDialog()).not.toBeInTheDocument());
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
  });

  it("a Confirm that lands before React has re-rendered the navigation is still refused, with a notice on the board", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Next date range" }));
      fireEvent.submit(form());
    });
    await flush();
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    expect(queryMoveDialog()).not.toBeInTheDocument();
  });

  it("switching Property in the same tick as Confirm is refused too", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    // The callback the dialog holds is the one a Confirm in this tick would call.
    const submit = dialogProbe.props!.onSubmit;
    let outcome!: OperationalBlockMoveOutcome;
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Property"), { target: { value: "prop-b" } });
      outcome = await submit({ destinationPhysicalRoomId: "room-102" });
    });
    await flush();
    expect(outcome).toMatchObject({ kind: "not-sent" });
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
  });

  it("the block changes on the server while the dialog is open: Confirm sends nothing, closes the dialog and the board says why", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    fixture.scene = "re-versioned";
    await act(async () => pageShowFromCache());
    await flush();
    // The re-read board no longer shows the version the dialog was built for.
    await user.click(confirmButton()!);
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(screen.getByTestId("move-refusal-notice")).toHaveTextContent("changed on the server");
  });

  it("through the board's own callback, a changed block is refused as stale: the dialog closes and the board says so", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    const submit = dialogProbe.props!.onSubmit;
    fixture.scene = "re-versioned";
    await act(async () => pageShowFromCache());
    await flush();
    let outcome!: OperationalBlockMoveOutcome;
    await act(async () => {
      outcome = await submit({ destinationPhysicalRoomId: "room-102" });
    });
    expect(outcome).toMatchObject({ kind: "not-sent" });
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(screen.getByTestId("move-refusal-notice")).toHaveTextContent("changed on the server");
  });

  it("the destination stops being Active while the dialog is open: Confirm sends nothing", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    fixture.room102Status = "OutOfService";
    await act(async () => pageShowFromCache());
    await flush();
    await user.click(confirmButton()!);
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("Choose one of the listed rooms");
  });

  it("a role lowered after opening is refused at send time even through a stale callback", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const view = await renderBoard(desk.access());
    await openMove(user);
    const submit = dialogProbe.props!.onSubmit;
    desk.state.memberships = [membership("Viewer")];
    view.rerender(<ReservationBoard access={desk.access()} />);
    let outcome!: OperationalBlockMoveOutcome;
    await act(async () => {
      outcome = await submit({ destinationPhysicalRoomId: "room-102" });
    });
    expect(outcome).toMatchObject({ kind: "not-sent", message: expect.stringContaining("does not allow this change") });
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
  });

  it("a stale popover callback after the role was lowered opens no dialog", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    const view = await renderBoard(desk.access());
    await openPopover(user);
    const staleOpen = popoverProbe.props!.onMoveBlock!;
    const selection = popoverProbe.props!.selection.value as BlockSelection;
    desk.state.memberships = [membership("Viewer")];
    view.rerender(<ReservationBoard access={desk.access()} />);
    act(() => staleOpen(selection));
    expect(queryMoveDialog()).not.toBeInTheDocument();
  });

  it("a sign-out waiting for the server pauses the write: nothing is sent", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    await renderBoard(desk.access());
    await openMove(user);
    pick("102");
    desk.state.signingOut = true;
    act(() => {
      fireEvent.submit(form());
    });
    await flush();
    expect(mockedMove).not.toHaveBeenCalled();
    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("Signing out");
    expect(pendingTokens()).toHaveLength(0);
  });

  it("while the safety records of earlier requests cannot be read, nothing is sent; once they can, it is", async () => {
    const user = userEvent.setup();
    const real = Storage.prototype.getItem;
    let refuse = true;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (refuse && (key === UNCERTAIN_KEY || key === PENDING_KEY)) throw new DOMException("refused", "SecurityError");
      return real.call(this, key);
    });
    await renderBoard();
    expect(screen.getByTestId("unverified-storage-writes")).toBeInTheDocument();
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    expect(await within(moveDialog()).findByRole("alert")).toHaveTextContent("could not read the safety records");
    expect(mockedMove).not.toHaveBeenCalled();
    refuse = false;
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
  });

  it("when the intent cannot be stored, nothing is sent; once storage works the dialog sends", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    pick("102");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await user.click(confirmButton()!);
    spy.mockRestore();
    expect(mockedMove).not.toHaveBeenCalled();
    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("could not keep the safety record");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
  });

  it("an earlier unconfirmed write into the destination room over the block's nights refuses the send; adjacent nights do not", async () => {
    const user = userEvent.setup();
    const { from, to, key, at } = await renderBoard();
    const lock = (start: string, end: string): BlockCreateReconciliation => ({
      id: 1, key, propertyId: "prop-a", from, to, afterSeq: 0, certainty: "uncertain", status: "done", resolution: "unresolved",
      target: { operation: "create", physicalRoomId: "room-102", roomNumber: "102", startDate: start, endDate: end, reason: "Leak" },
    });
    cleanup();
    // The block's last night is `to` — inside its own range but outside the visible window [from, to):
    // only the full range can see this lock. [to + 1, to + 2) would merely touch the block's end.
    persistUncertainWrites(sessionStorage, [], [lock(to, addDaysIso(to, 1))]);
    await renderBoard();
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    // The same lock does not stop a move to another room.
    pick("201");
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(at(0)).toBeTruthy();
  });
});

describe("send-time authority that no opener closure can grant", () => {
  it("a stale popover callback opens no dialog while a sign-out is waiting for the server, even though the board stays readable", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    await renderBoard(desk.access());
    await openPopover(user);
    const staleOpen = popoverProbe.props!.onMoveBlock!;
    const selection = popoverProbe.props!.selection.value as BlockSelection;
    desk.state.signingOut = true;
    act(() => staleOpen(selection));
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(screen.getAllByTitle(REASON).length).toBeGreaterThan(0);
  });

  it("a correctable dialog (400) closes as soon as the view moves to another board, because its form is only correctable where it was opened", async () => {
    const user = userEvent.setup();
    await renderBoard();
    mockedMove.mockResolvedValue({ kind: "rejected", status: 400, category: "validation", detail: "Same room." });
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    await within(moveDialog()).findByRole("alert");
    expect(confirmButton()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(queryMoveDialog()).not.toBeInTheDocument());
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("a move's notice keeps its re-read status while another write of the same list is made", async () => {
    const user = userEvent.setup();
    fixture.withSecondBlock = true;
    await renderBoard();
    fixture.scene = "moved";
    await confirmMove(user);
    const notice = (await screen.findByText(/^Block moved from room 101 to room 102/)).closest("[role=status]")!;
    await waitFor(() => expect(notice).toHaveTextContent("The board has been reloaded from the server."));

    // A different block write in the same list: it must not drop the move notice's entry.
    mockedCancel.mockResolvedValue({ kind: "cancelled", segment: null });
    await user.click(screen.getByTitle("Second block"));
    await user.click(within(popover()).getByRole("button", { name: "Cancel block" }));
    await user.click(within(screen.getByRole("dialog", { name: "Cancel operational block" })).getByRole("button", { name: /^Cancel block on room/ }));
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledTimes(1));
    await flush();
    const stillThere = screen.getByText(/^Block moved from room 101 to room 102/).closest("[role=status]")!;
    expect(stillThere).toHaveTextContent("The board has been reloaded from the server.");
    expect(stillThere).not.toHaveTextContent("Reloading the board…");
  });
});

describe("a cancel and a move of one block segment gate each other", () => {
  /** A record for this very segment in rooms and nights that overlap nothing else on the board. */
  const farAway = (kind: "cancel" | "move", w: { key: string; from: string; to: string }): BlockCreateReconciliation => {
    const target: BlockWriteTarget =
      kind === "cancel"
        ? { operation: "cancel", physicalRoomId: "room-201", roomNumber: "201", startDate: "2031-05-01", endDate: "2031-05-03", reason: "Paint", segmentId: SEGMENT, expectedVersion: VERSION }
        : { operation: "move", roomBlockId: HEADER, segmentId: SEGMENT, expectedVersion: VERSION, sourcePhysicalRoomId: "room-201", sourceRoomNumber: "201", physicalRoomId: "room-103", roomNumber: "103", startDate: "2031-05-01", endDate: "2031-05-03" };
    return { id: 1, key: w.key, propertyId: "prop-a", from: w.from, to: w.to, afterSeq: 0, certainty: "uncertain", status: "done", resolution: "unresolved", target };
  };

  it.each([["cancel"], ["move"]] as const)("an unresolved %s of this segment disables both actions at open, whatever rooms and nights it names", async (kind) => {
    const user = userEvent.setup();
    const w = await renderBoard();
    cleanup();
    persistUncertainWrites(sessionStorage, [], [farAway(kind, w)]);
    await renderBoard();
    await openPopover(user);
    expect(cancelButton()).toBeDisabled();
    expect(moveButton()).toBeDisabled();
    expect(popover()).toHaveTextContent("still unconfirmed");
    await user.click(cancelButton()!);
    await user.click(moveButton()!);
    expect(screen.queryByRole("dialog", { name: "Cancel operational block" })).not.toBeInTheDocument();
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(postCount()).toBe(0);
  });

  it("a stale open callback cannot open either dialog while the segment is unresolved", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    await openPopover(user);
    const props = popoverProbe.props!;
    const clicked = props.selection.value as BlockSelection;
    const selection: BlockSelection = { block: clicked.block, roomNumber: "101" };
    cleanup();
    persistUncertainWrites(sessionStorage, [], [farAway("cancel", w)]);
    await renderBoard();
    await openPopover(user);
    act(() => {
      popoverProbe.props!.onMoveBlock!(selection);
      popoverProbe.props!.onCancelBlock!(selection);
    });
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Cancel operational block" })).not.toBeInTheDocument();
  });

  it("a record for this segment that appears after the move dialog opened refuses the send", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    await openMove(user);
    pick("102");
    persistUncertainWrites(sessionStorage, [], [farAway("cancel", w)]);
    await act(async () => pageShowFromCache());
    await flush();
    await user.click(confirmButton()!);
    expect(mockedMove).not.toHaveBeenCalled();
    expect(pendingTokens()).toHaveLength(0);
    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
  });

  it("a record for this segment that appears after the cancel dialog opened refuses the cancel", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    await openPopover(user);
    await user.click(cancelButton()!);
    const dialog = screen.getByRole("dialog", { name: "Cancel operational block" });
    persistUncertainWrites(sessionStorage, [], [farAway("move", w)]);
    await act(async () => pageShowFromCache());
    await flush();
    await user.click(within(dialog).getByRole("button", { name: /^Cancel block on room/ }));
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(pendingTokens()).toHaveLength(0);
  });

  it("a resolved or settled entry of this segment does not hold either action", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    cleanup();
    persistUncertainWrites(sessionStorage, [], [{ ...farAway("move", w), resolution: "observed" }]);
    await renderBoard();
    await openPopover(user);
    expect(cancelButton()).toBeEnabled();
    expect(moveButton()).toBeEnabled();
  });
});

describe("outcomes", () => {
  it("200 with no readable body and a failing GET is still a known success — never unknown, never locked", async () => {
    const user = userEvent.setup();
    await renderBoard();
    mockedMove.mockImplementation(async () => {
      mockedBoard.mockResolvedValue({ ok: false, error: { kind: "network", message: "Could not reach the Admin API." } });
      return { kind: "moved", segments: null };
    });
    await confirmMove(user);
    await waitFor(() => expect(screen.getByText(/Saved on the server, but the board could not be reloaded/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
    expect(pendingTokens()).toHaveLength(0);
    expect(screen.queryByTestId("uncertain-block-notice")).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("409: a warning in the dialog, one re-read, no resend, and nothing left locked", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const before = mockedBoard.mock.calls.length;
    mockedMove.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict", detail: "The destination room is not free." });
    await confirmMove(user);
    const alert = await within(moveDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("This block was not moved");
    expect(alert).toHaveTextContent("The destination room is not free.");
    await settleReread(before);
    expect(mockedBoard.mock.calls.length).toBe(before + 1);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
    expect(pendingTokens()).toHaveLength(0);
    // The refusal leaves the block where it was and the actions available.
    expect(screen.getAllByTitle(REASON)).toHaveLength(1);
  });

  it.each([
    [404, "not part of this Property"],
    [403, "The server refused this write."],
  ])("%i never claims the block moved or was removed, sends no re-read and leaves no record", async (status, detail) => {
    const user = userEvent.setup();
    await renderBoard();
    const before = mockedBoard.mock.calls.length;
    mockedMove.mockResolvedValue({ kind: "rejected", status, category: "not-permitted" });
    await confirmMove(user);
    const alert = await within(moveDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("Moving operational blocks is not available from this Admin session. Nothing was changed.");
    expect(alert).toHaveTextContent(detail);
    expect(alert).not.toHaveTextContent(/was moved|has been moved|deleted|no longer exists/i);
    expect(mockedBoard.mock.calls.length).toBe(before);
    expect(screen.getAllByTitle(REASON)).toHaveLength(1);
    expect(pendingTokens()).toHaveLength(0);
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
  });

  it("400 and not-sent allow a deliberate second attempt from the same board, and send no re-read", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const before = mockedBoard.mock.calls.length;
    mockedMove
      .mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "Same room." })
      .mockResolvedValueOnce({ kind: "not-sent", message: "The Admin API address is not configured." })
      .mockResolvedValueOnce({ kind: "moved", segments: null });
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    expect(await within(moveDialog()).findByRole("alert")).toHaveTextContent("Same room.");
    expect(mockedBoard.mock.calls.length).toBe(before);
    expect(pendingTokens()).toHaveLength(0);
    await user.click(confirmButton()!);
    await within(moveDialog()).findByText(/not configured/);
    expect(mockedBoard.mock.calls.length).toBe(before);
    expect(mockedMove).toHaveBeenCalledTimes(2);
    await user.click(confirmButton()!);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(3));
  });

  it("a correctable dialog closes when the view has moved to another board; a sent one stays to report", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const write = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => write.promise);
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await flush();
    // A request is on the wire: the dialog stays open to report its own result.
    expect(queryMoveDialog()).toBeInTheDocument();
    await act(async () => write.resolve({ kind: "rejected", status: 400, category: "validation", detail: "Same room." }));
    await flush();
    // The result proves nothing was written, and the form is only correctable on the board it was opened from.
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(screen.getByTestId("move-refusal-notice")).toHaveTextContent("nothing was changed");
  });

  it("a 200 that lands after the view moved on is reported by the dialog and never painted onto the other board", async () => {
    const user = userEvent.setup();
    await renderBoard();
    const write = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => write.promise);
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    await act(async () => write.resolve({ kind: "moved", segments: null }));
    await flush();
    expect(screen.queryByText(/Block moved from room/)).not.toBeInTheDocument();
    expect(moveDialog()).toHaveTextContent("Operational block moved.");
    expect(moveDialog()).toHaveTextContent("The view changed before the board was reloaded");
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("401 ends the session once the write is settled, with no resend; a generic 403 re-reads access once", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    await renderBoard(desk.access());
    mockedMove.mockResolvedValue({ kind: "rejected", status: 401, category: "refused", detail: "Your Staff session has ended." });
    await confirmMove(user);
    await waitFor(() => expect(desk.onSessionExpired).toHaveBeenCalledTimes(1));
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(pendingTokens()).toHaveLength(0);
    cleanup();

    const desk2 = staffAccess("FrontDesk");
    mockedMove.mockClear();
    mockedMove.mockResolvedValue({ kind: "rejected", status: 403, category: "not-permitted" });
    await renderBoard(desk2.access());
    await confirmMove(user);
    await waitFor(() => expect(desk2.refreshAccess).toHaveBeenCalledTimes(1));
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(desk2.onSessionExpired).not.toHaveBeenCalled();
  });

  it("a sign-out cannot start while the request is on the wire, and the activity is balanced afterwards", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    await renderBoard(desk.access());
    const write = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => write.promise);
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    expect(desk.onWriteActivityChange).toHaveBeenLastCalledWith(true);
    await act(async () => write.resolve({ kind: "moved", segments: null }));
    await flush();
    expect(desk.onWriteActivityChange).toHaveBeenLastCalledWith(false);
  });

  it("a client that throws is an unconfirmed result, the activity is still balanced, and nothing is sent twice", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    await renderBoard(desk.access());
    mockedMove.mockRejectedValue(new Error("boom"));
    await confirmMove(user);
    const alert = await within(moveDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("may or may not have been moved");
    expect(desk.onWriteActivityChange).toHaveBeenLastCalledWith(false);
    await flush();
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(storedRecord().blocks).toHaveLength(1);
    expect(pendingTokens()).toHaveLength(0);
  });
});

describe("a move whose response was lost", () => {
  async function loseMove(user: User, reason?: string) {
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    await openMove(user);
    pick("102");
    if (reason !== undefined) setReason(reason);
    await user.click(confirmButton()!);
    const alert = await within(moveDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("may or may not have been moved");
    await flush();
    return alert;
  }

  const reviewBlock = async (user: User, w: { at: (n: number) => string }, room: string, startOffset: number, endOffset: number) => {
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const dialog = within(screen.getByRole("dialog", { name: "Create operational block" }));
    await user.selectOptions(dialog.getByLabelText("Room"), room);
    fireEvent.change(dialog.getByLabelText("First blocked night"), { target: { value: w.at(startOffset) } });
    fireEvent.change(dialog.getByLabelText("End date (exclusive)"), { target: { value: w.at(endOffset) } });
    await user.type(dialog.getByLabelText("Reason"), "Leak");
    await user.click(dialog.getByRole("button", { name: "Review" }));
    return dialog;
  };

  it("stays unknown: one record without the reason, both rooms locked, no second request, and Check again only reads", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    await loseMove(user, "Secret audit reason");
    expect(mockedMove).toHaveBeenCalledTimes(1);

    // One tracked record, handed over from the intent; nothing free-text in storage.
    const record = storedRecord();
    expect(record.blocks).toHaveLength(1);
    expect(record.blocks[0].target).toMatchObject({ operation: "move", segmentId: SEGMENT, expectedVersion: VERSION, sourcePhysicalRoomId: "room-101", physicalRoomId: "room-102" });
    expect(JSON.stringify(record)).not.toContain("Secret audit reason");
    expect(pendingTokens()).toHaveLength(0);

    // The dialog does not turn into a success, and has no way to send again.
    expect(moveDialog()).not.toHaveTextContent("Operational block moved.");
    expect(confirmButton()).not.toBeInTheDocument();
    expect(moveDialog()).toHaveTextContent("still shown in its original room exactly as it was");

    // Both rooms are locked over the block's nights.
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    for (const room of ["room-101", "room-102"]) {
      const dialog = await reviewBlock(user, w, room, 3, 4);
      expect(dialog.getByRole("alert")).toHaveTextContent("still unconfirmed");
      await user.click(dialog.getAllByRole("button", { name: "Close" }).at(-1)!);
    }
    const free = await reviewBlock(user, w, "room-201", 3, 4);
    expect(free.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(free.getAllByRole("button", { name: "Close" }).at(-1)!);

    // The same segment cannot be cancelled or moved again.
    await openPopover(user);
    expect(cancelButton()).toBeDisabled();
    expect(moveButton()).toBeDisabled();
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    // Check again re-reads and nothing else.
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    expect(mockedBoard.mock.calls.length).toBe(before + 1);
    expect(postCount()).toBe(1);
    expect(storedRecord().blocks).toHaveLength(1);
  });

  it("observed: the source is gone and the same header holds the exact nights in the destination — a fact of the schedule, not a success", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await loseMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    fixture.scene = "moved";
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    const notice = screen.getByTestId("uncertain-block-notice");
    expect(notice).toHaveTextContent("no longer shown in room 101, and the same block is now shown in room 102");
    expect(notice).toHaveTextContent("it does not prove this request moved it");
    expect(notice).not.toHaveTextContent(/Saved|moved successfully/);
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();
    // The locks are released, the actions are back, and nothing was sent again.
    await openPopover(user);
    expect(moveButton()).toBeEnabled();
    expect(postCount()).toBe(1);
  });

  it("changed: the source was re-versioned, so this request can no longer take effect — never worded as saved", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await loseMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    fixture.scene = "re-versioned";
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    const notice = screen.getByTestId("uncertain-block-notice");
    expect(notice).toHaveTextContent("can no longer take effect");
    expect(notice).toHaveTextContent("not a record that the move was saved");
    expect(postCount()).toBe(1);
  });

  it("a look-alike in the destination does not make it observed while the source is still shown", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await loseMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    fixture.scene = "intact-with-lookalike";
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    expect(screen.getByTestId("uncertain-block-notice")).toHaveTextContent("still shown in room 101 exactly as it was");
    expect(storedRecord().blocks).toHaveLength(1);
  });

  it.each([["wrong-header"], ["gone"]] as const)("scene %s: the source is not shown and no exact successor of its header is — never observed, and never worded as saved", async (scene) => {
    const user = userEvent.setup();
    await renderBoard();
    await loseMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    fixture.scene = scene;
    const before = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await settleReread(before);
    const notice = screen.getByTestId("uncertain-block-notice");
    expect(notice).not.toHaveTextContent("is now shown in room 102");
    expect(notice).not.toHaveTextContent("does not prove this request moved it");
    expect(notice).toHaveTextContent("can no longer take effect");
    expect(notice).toHaveTextContent("not a record that the move was saved");
    expect(postCount()).toBe(1);
  });

  it("a failed re-read resolves nothing", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await loseMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "network", message: "down" } });
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await flush();
    expect(screen.getByTestId("uncertain-block-notice")).toHaveTextContent("could not be reloaded, so the result is still unknown");
    expect(storedRecord().blocks).toHaveLength(1);
    expect(postCount()).toBe(1);
  });

  it("a reload while the request is pending restores one in-flight record: no resend, both rooms locked, read once", async () => {
    const user = userEvent.setup();
    const answer = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => answer.promise);
    await renderBoard();
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    expect(pendingTokens()).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      answer.resolve({ kind: "unknown", reason: "aborted" });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(pendingTokens()).toHaveLength(1);

    await reloadSameTab();
    const notice = await screen.findByTestId("uncertain-block-notice");
    expect(notice).toHaveTextContent("Unconfirmed block move request sent just before this page was reloaded or left: from room 101 to room 102");
    expect(mockedMove).toHaveBeenCalledTimes(1);
    await openPopover(user);
    expect(moveButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();

    pageShowFromCache();
    await flush();
    expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
  });

  it("a reload after an unknown outcome restores it; sign-out and another Staff member signing in keep it and resend nothing", async () => {
    const user = userEvent.setup();
    const desk = staffAccess("FrontDesk");
    await renderBoard(desk.access());
    await loseMove(user);
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();

    cleanup();
    await renderBoard(staffAccess("Manager").access());
    const notice = screen.getByTestId("uncertain-block-notice");
    expect(notice).toHaveTextContent("from before this page was reloaded or left");
    expect(mockedMove).toHaveBeenCalledTimes(1);
    await openPopover(user);
    expect(moveButton()).toBeDisabled();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();
  });

  it("unmounting the board while the request is pending leaves the unconfirmed intent for the next page", async () => {
    const user = userEvent.setup();
    const answer = deferred<OperationalBlockMoveOutcome>();
    mockedMove.mockImplementation(() => answer.promise);
    const { unmount } = await renderBoard();
    await openMove(user);
    pick("102");
    await user.click(confirmButton()!);
    unmount();
    await act(async () => answer.resolve({ kind: "unknown", reason: "aborted" }));
    expect(pendingTokens()).toHaveLength(1);
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("is saved together with an unconfirmed assignment write, and neither list loses the other", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    cleanup();
    persistUncertainWrites(
      sessionStorage,
      [
        {
          id: 1, key: w.key, propertyId: "prop-a", from: w.from, to: w.to, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved",
          target: { operation: "unassign", reservationUnitId: "unit-9", startDate: w.at(40), endDate: w.at(42), roomNumber: "201", guestDisplayName: "", confirmationNumber: "", segmentId: "seg-asg", expectedVersion: 3, sourcePhysicalRoomId: "room-201" },
        },
      ],
      []
    );
    await renderBoard();
    await loseMove(user);
    const record = storedRecord();
    expect(record.assignments).toHaveLength(1);
    expect(record.assignments[0].target.operation).toBe("unassign");
    expect(record.blocks).toHaveLength(1);
    expect(record.blocks[0].target.operation).toBe("move");
  });

  it("when storage refuses the unconfirmed record, the intent stays and a reload still restores the write", async () => {
    const user = userEvent.setup();
    const realSet = Storage.prototype.setItem;
    await renderBoard();
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === UNCERTAIN_KEY) throw new DOMException("full", "QuotaExceededError");
      realSet.call(this, key, value);
    });
    await confirmMove(user);
    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    await flush();
    spy.mockRestore();
    expect(pendingTokens()).toHaveLength(1);
    await reloadSameTab();
    expect(await screen.findByTestId("uncertain-block-notice")).toHaveTextContent("sent just before this page was reloaded or left");
  });

  it("dismissing a resolved move leaves every other record and lock exactly as they were", async () => {
    const user = userEvent.setup();
    const w = await renderBoard();
    await loseMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    // Another unresolved record, in a room the board can judge nothing about.
    const other: BlockCreateReconciliation = {
      id: 90, key: w.key, propertyId: "prop-a", from: w.from, to: w.to, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved",
      target: { operation: "create", physicalRoomId: "room-201", roomNumber: "201", startDate: w.at(8), endDate: w.at(9), reason: "Leak" },
    };
    const record = storedRecord();
    cleanup();
    persistUncertainWrites(sessionStorage, [], [...record.blocks.map((b: { target: BlockWriteTarget }) => ({ ...b, id: 1, key: w.key, propertyId: "prop-a", from: w.from, to: w.to, afterSeq: 0, certainty: "uncertain", status: "pending", resolution: "unresolved" })), other]);
    fixture.scene = "moved";
    await renderBoard();
    await flush();
    const notices = screen.getAllByTestId("uncertain-block-notice");
    const moveNotice = notices.find((n) => n.textContent!.includes("block move"))!;
    await user.click(within(moveNotice).getByRole("button", { name: "Dismiss notice" }));
    expect(storedRecord().blocks.map((b: { target: { operation: string } }) => b.target.operation)).toEqual(["create"]);
    expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
  });
});

describe("focus", () => {
  it("returns to the block bar when the dialog is closed without sending", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(blockBar());
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("falls back to the Property selector when the opener is gone, never to a removed element", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await openMove(user);
    const opener = blockBar();
    fixture.scene = "gone";
    await act(async () => pageShowFromCache());
    await flush();
    expect(opener.isConnected).toBe(false);
    await user.keyboard("{Escape}");
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement).toBe(document.getElementById("reservation-board-property"));
  });

  it("moves focus to the success notice after a move", async () => {
    const user = userEvent.setup();
    await renderBoard();
    await confirmMove(user);
    const notice = await screen.findByText(/^Block moved from room 101 to room 102/);
    await waitFor(() => expect(notice.closest("[role=status]")).toBe(document.activeElement));
  });
});
