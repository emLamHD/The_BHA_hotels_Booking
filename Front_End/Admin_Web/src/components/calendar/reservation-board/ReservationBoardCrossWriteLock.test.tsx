/**
 * PMS-CAL-001.3-CP03-C1: two board-level guarantees across write types.
 *
 * 1. A write whose response was lost stays `resolution: "unresolved"` after a
 *    re-read that cannot settle it (`status: "done"`). While it does, no other
 *    write of any type — assignment create, move, unassign, block create — may
 *    be sent for the same Property, room and overlapping nights, including
 *    from a dialog that was already open when the lock appeared. Other rooms
 *    and nights stay usable.
 * 2. A Property/range switch that happens while a block create is in flight,
 *    and before React has re-rendered, never lets that create's success
 *    notice land on the new board or close its dialog.
 * 3. (C2) A block dialog whose result proved nothing was written (`not-sent`,
 *    `400`) is correctable only on the board it was opened from. Once the view
 *    shows another board — before or after that result arrives — the old
 *    dialog is gone and nothing can send its Property, room and nights.
 *
 * The API client is mocked; these prove the board's decisions.
 */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import { PENDING_WRITES_STORAGE_KEY, UNCERTAIN_WRITES_STORAGE_KEY, beginPendingWrite, persistUncertainWrites } from "./uncertainWriteStorage";
import type { BlockCreateReconciliation } from "./blockCreateReconciliation";
import type { Reconciliation } from "./reconciliation";
import { addDaysIso } from "./dateMath";
import type {
  AssignmentCreateOutcome,
  MoveAssignmentOutcome,
  OperationalBlockCreateOutcome,
  UnassignAssignmentOutcome,
} from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createReservationAssignment: vi.fn(),
  moveReservationAssignment: vi.fn(),
  unassignReservationAssignment: vi.fn(),
  createOperationalBlock: vi.fn(),
  cancelOperationalBlock: vi.fn(),
}));

import {
  cancelOperationalBlock,
  createOperationalBlock,
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
  unassignReservationAssignment,
} from "@/lib/api/client";

const mockedProperties = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedCreate = vi.mocked(createReservationAssignment);
const mockedMove = vi.mocked(moveReservationAssignment);
const mockedUnassign = vi.mocked(unassignReservationAssignment);
const mockedBlock = vi.mocked(createOperationalBlock);
const mockedCancel = vi.mocked(cancelOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const propertyB: ApiProperty = { id: "prop-b", name: "Property B", timeZone: "Asia/Ho_Chi_Minh" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/**
 * Rooms 101/102 (Standard) and 201 (Deluxe). One stay: unassigned
 * `[from, from+2)` and `[from+4, to)`, with segment `seg-existing` in room 101
 * over `[from+2, from+4)`. Never changes, so no re-read can settle a lost write.
 */
function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
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
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
      { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
    ],
    stays:
      propertyId === "prop-a"
        ? [
            {
              reservationId: "res-1",
              reservationUnitId: "unit-1",
              confirmationNumber: "CNF-100",
              guestDisplayName: "Nguyen Van A",
              soldRoomTypeId: "type-standard",
              checkIn: from,
              checkOut: to,
              coverageStatus: "PartiallyAssigned",
              assignments: [
                { segmentId: "seg-existing", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: addDaysIso(from, 2), endDate: addDaysIso(from, 4) },
              ],
              unassignedRanges: [
                { startDate: from, endDate: addDaysIso(from, 2) },
                { startDate: addDaysIso(from, 4), endDate: to },
              ],
            },
          ]
        : [],
    operationalBlocks: [],
  };
}

async function renderLoadedBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { from, to };
}

/** Waits until the board has re-read after a write and offers writes again. */
async function settleReread(boardCallsBefore: number) {
  await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore + 1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
}

const blockDialog = () => screen.getByRole("dialog", { name: "Create operational block" });
const assignDialog = () => screen.getByRole("dialog", { name: "Assign room" });
const moveDialog = () => screen.getByRole("dialog", { name: "Move room" });
const closeDialog = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
  user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);

/** Opens the block dialog and reviews `room` over `[start, end)`. */
async function reviewBlock(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
  await user.click(screen.getByRole("button", { name: "Create operational block" }));
  const view = within(blockDialog());
  await user.selectOptions(view.getByLabelText("Room"), room);
  fireEvent.change(view.getByLabelText("First blocked night"), { target: { value: start } });
  fireEvent.change(view.getByLabelText("End date (exclusive)"), { target: { value: end } });
  await user.type(view.getByLabelText("Reason"), "Leak");
  await user.click(view.getByRole("button", { name: "Review" }));
}

/** A block create whose response is lost, followed by one re-read that still shows no block. */
async function loseBlock(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
  mockedBlock.mockResolvedValueOnce({ kind: "unknown", reason: "timeout" });
  const before = mockedBoard.mock.calls.length;
  await reviewBlock(user, room, start, end);
  await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
  await settleReread(before);
  await closeDialog(user, blockDialog());
  expect(screen.getByTestId("uncertain-block-notice")).toHaveTextContent("no matching block is shown yet");
}

const firstRangeBar = (from: string) =>
  screen.getByRole("button", { name: `Assign room: Nguyen Van A, CNF-100, unassigned ${from} to ${addDaysIso(from, 2)}` });

async function openMoveDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
  await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Move room" }));
}

/** Lets the queued promise continuations run inside the surrounding `act`. */
async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  // Unconfirmed writes survive a reload in this tab (PMS-CAL-001.5-CP02): no test may inherit another's.
  sessionStorage.clear();
  for (const mock of [mockedProperties, mockedBoard, mockedCreate, mockedMove, mockedUnassign, mockedBlock, mockedCancel]) mock.mockReset();
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) }));
});

describe("ReservationBoard — unresolved writes lock the same room and nights across write types (PMS-CAL-001.3-CP03-C1)", () => {
  it("block → assignment: a lost block on room 102 stops an assignment to 102 on overlapping nights; room 101 still works", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseBlock(user, "room-102", from, addDaysIso(from, 1));

    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    expect(await within(assignDialog()).findByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(mockedCreate).not.toHaveBeenCalled();

    mockedCreate.mockResolvedValue({ kind: "rejected", status: 400, category: "validation" });
    await user.click(within(assignDialog()).getByLabelText(/Room 101/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 101" }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][1].physicalRoomId).toBe("room-101");
  });

  it("block → move: a lost block on room 102 stops moving a segment into 102 on overlapping nights", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseBlock(user, "room-102", addDaysIso(from, 3), addDaysIso(from, 4));

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    expect(await within(moveDialog()).findByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("block → unassign: a lost block on the segment's own room keeps its unassign unavailable", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseBlock(user, "room-101", addDaysIso(from, 2), addDaysIso(from, 3));

    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    const popover = screen.getByRole("dialog", { name: "Reservation details" });
    await user.click(within(popover).getByRole("button", { name: "Remove room assignment" }));
    expect(screen.queryByRole("dialog", { name: "Remove room assignment" })).not.toBeInTheDocument();
    expect(mockedUnassign).not.toHaveBeenCalled();
  });

  it("assignment → block: a lost assignment to room 102 stops a block on 102 over overlapping nights; room 201 still works", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "network" } as AssignmentCreateOutcome);
    const before = mockedBoard.mock.calls.length;
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await settleReread(before);
    await closeDialog(user, assignDialog());

    await reviewBlock(user, "room-102", addDaysIso(from, 1), addDaysIso(from, 2));
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");

    mockedBlock.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict" });
    await user.selectOptions(within(blockDialog()).getByLabelText("Room"), "room-201");
    await user.click(within(blockDialog()).getByRole("button", { name: "Review" }));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    await waitFor(() => expect(mockedBlock).toHaveBeenCalledTimes(1));
    expect(mockedBlock.mock.calls[0][1].physicalRoomId).toBe("room-201");
  });

  it("move → block: a lost move locks both its source room 101 and destination room 102 for its nights, and nothing else", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" } as MoveAssignmentOutcome);
    const before = mockedBoard.mock.calls.length;
    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await settleReread(before);
    await closeDialog(user, moveDialog());

    for (const room of ["room-101", "room-102"]) {
      await reviewBlock(user, room, addDaysIso(from, 3), addDaysIso(from, 4));
      expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
      await closeDialog(user, blockDialog());
    }

    mockedBlock.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict" });
    await reviewBlock(user, "room-101", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    await waitFor(() => expect(mockedBlock).toHaveBeenCalledTimes(1));
  });

  it("unassign → block: a lost unassign locks its source room for its nights", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedUnassign.mockResolvedValue({ kind: "unknown", reason: "network" } as UnassignAssignmentOutcome);
    const before = mockedBoard.mock.calls.length;
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Remove room assignment" }));
    const unassignDialog = screen.getByRole("dialog", { name: "Remove room assignment" });
    await user.click(within(unassignDialog).getByRole("button", { name: "Remove room 101 assignment" }));
    await settleReread(before);
    await closeDialog(user, screen.getByRole("dialog", { name: "Remove room assignment" }));

    await reviewBlock(user, "room-101", addDaysIso(from, 2), addDaysIso(from, 3));
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(mockedBlock).not.toHaveBeenCalled();
  });

  it("a dialog opened before the lock appeared still cannot send into the locked room", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const lost = deferred<OperationalBlockCreateOutcome>();
    mockedBlock.mockImplementation(() => lost.promise);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));

    // While the block POST is still in flight, an assignment dialog is opened behind it.
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));

    const before = mockedBoard.mock.calls.length;
    await act(async () => lost.resolve({ kind: "unknown", reason: "timeout" }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(before + 1));

    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    expect(await within(assignDialog()).findByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe("ReservationBoard — navigation while a block create is in flight (PMS-CAL-001.3-CP03-C1)", () => {
  /**
   * Deterministic, not timing-based: the POST resolves first, then the
   * navigation is dispatched as a raw DOM event in the same synchronous block.
   * The navigation handler therefore runs before the create's continuation,
   * but React (19) renders and runs the navigation's effects only in a
   * microtask queued *after* that continuation — so the continuation sees
   * whatever the handler itself recorded, and nothing the effect sets.
   */
  async function navigateThenResolve(navigate: () => void, write: ReturnType<typeof deferred<OperationalBlockCreateOutcome>>) {
    await act(async () => {
      write.resolve({ kind: "created", block: null });
      navigate();
      await flushMicrotasks();
    });
  }

  async function startCreate(user: ReturnType<typeof userEvent.setup>, from: string) {
    const write = deferred<OperationalBlockCreateOutcome>();
    mockedBlock.mockImplementation(() => write.promise);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    return write;
  }

  function expectOriginResultKeptInDialog() {
    expect(screen.queryByText(/^Room 102 blocked for/)).not.toBeInTheDocument();
    const status = within(blockDialog()).getByRole("status");
    expect(status).toHaveTextContent("Operational block created.");
    expect(status).toHaveTextContent("the board this block was created from has not been re-read yet");
  }

  it("Property switch", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const write = await startCreate(user, from);
    const select = screen.getByLabelText("Property") as HTMLSelectElement;
    await navigateThenResolve(() => {
      select.value = "prop-b";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, write);
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    expectOriginResultKeptInDialog();
  });

  it.each([["Next date range"], ["Previous date range"], ["7 days"]])("%s", async (control) => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const write = await startCreate(user, from);
    const button = screen.getByRole("button", { name: control });
    await navigateThenResolve(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })), write);
    expectOriginResultKeptInDialog();
  });

  it("a control that does not change the board still counts as the same board", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const write = await startCreate(user, from);
    // 14 days is already selected: the board identity does not change.
    const button = screen.getByRole("button", { name: "14 days" });
    await navigateThenResolve(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })), write);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create operational block" })).not.toBeInTheDocument());
    expect(screen.getByText(`Room 102 blocked for [${from}, ${addDaysIso(from, 1)}): Leak`)).toBeInTheDocument();
  });

  it("returning to the origin board reports it synchronised only after the server re-read", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const write = await startCreate(user, from);
    const next = screen.getByRole("button", { name: "Next date range" });
    await navigateThenResolve(() => next.dispatchEvent(new MouseEvent("click", { bubbles: true })), write);
    expectOriginResultKeptInDialog();

    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedBoard.mockImplementationOnce(() => reread.promise);
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    const status = within(blockDialog()).getByRole("status");
    expect(status).not.toHaveTextContent("The board has been reloaded from the server.");
    await act(async () => reread.resolve({ ok: true, data: boardFor("prop-a", from, mockedBoard.mock.calls.at(-1)![2]) }));
    await waitFor(() => expect(status).toHaveTextContent("The board has been reloaded from the server."));
  });
});

describe("ReservationBoard — a correctable block result never sends for a board the operator has left (PMS-CAL-001.3-CP03-C2)", () => {
  const validation: OperationalBlockCreateOutcome = { kind: "rejected", status: 400, category: "validation", detail: "reason is invalid." };
  const notSent: OperationalBlockCreateOutcome = { kind: "not-sent", message: "The Admin API address is not configured." };

  const propertySelect = () => screen.getByLabelText("Property") as HTMLSelectElement;
  const createBlockButton = () => screen.getByRole("button", { name: "Create operational block" });
  const queryBlockDialog = () => screen.queryByRole("dialog", { name: "Create operational block" });

  function switchToPropertyB() {
    propertySelect().value = "prop-b";
    propertySelect().dispatchEvent(new Event("change", { bubbles: true }));
  }
  function nextRange() {
    screen.getByRole("button", { name: "Next date range" }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  /** Reviews room 102 for the first night and confirms; the POST stays pending until `write` resolves. */
  async function startPending(user: ReturnType<typeof userEvent.setup>, from: string) {
    const write = deferred<OperationalBlockCreateOutcome>();
    mockedBlock.mockImplementationOnce(() => write.promise);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    expect(mockedBlock).toHaveBeenCalledTimes(1);
    return write;
  }

  /** Every way an old dialog could still send: back on the form it reviews again, then confirms. */
  async function tryToSendAgain(user: ReturnType<typeof userEvent.setup>) {
    const dialog = queryBlockDialog();
    if (!dialog) return;
    const review = within(dialog).queryByRole("button", { name: "Review" });
    if (review) await user.click(review);
    const create = within(dialog).queryByRole("button", { name: "Create block" });
    if (create) await user.click(create);
  }

  function expectFocusOnStableBoardControl() {
    expect(document.activeElement).not.toBe(document.body);
    expect([createBlockButton(), propertySelect()]).toContain(document.activeElement);
  }

  beforeEach(() => {
    // A stray second POST must be observable as a call, not crash the dialog.
    mockedBlock.mockResolvedValue({ kind: "created", block: null });
  });

  it.each([
    ["Property switch", "400", switchToPropertyB, validation],
    ["Property switch", "not-sent", switchToPropertyB, notSent],
    ["Next date range", "400", nextRange, validation],
    ["Next date range", "not-sent", nextRange, notSent],
  ])("%s while the POST is pending, then %s: the old dialog closes and sends nothing", async (_nav, _kind, navigate, outcome) => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const write = await startPending(user, from);
    const boardCallsBefore = mockedBoard.mock.calls.length;

    await act(async () => navigate());
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBeGreaterThan(boardCallsBefore));
    // The dialog is still reporting its pending request.
    expect(blockDialog()).toBeInTheDocument();

    await act(async () => write.resolve(outcome));
    await tryToSendAgain(user);

    expect(mockedBlock).toHaveBeenCalledTimes(1);
    expect(queryBlockDialog()).not.toBeInTheDocument();
    expectFocusOnStableBoardControl();
  });

  it.each([
    ["Property switch", switchToPropertyB],
    ["Next date range", nextRange],
  ])("400 on the origin board, then %s: the old dialog closes and sends nothing", async (_nav, navigate) => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedBlock.mockResolvedValueOnce(validation);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    expect(await within(blockDialog()).findByRole("alert")).toHaveTextContent("reason is invalid.");

    await act(async () => navigate());
    await tryToSendAgain(user);

    expect(mockedBlock).toHaveBeenCalledTimes(1);
    expect(queryBlockDialog()).not.toBeInTheDocument();
  });

  it("400 while still on the origin board keeps the values for a deliberate correction and sends the corrected request", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedBlock.mockResolvedValueOnce(validation);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    expect(await within(blockDialog()).findByRole("alert")).toHaveTextContent("reason is invalid.");
    expect(within(blockDialog()).getByLabelText("Room")).toHaveValue("room-102");
    expect(within(blockDialog()).getByLabelText("Reason")).toHaveValue("Leak");

    const reason = within(blockDialog()).getByLabelText("Reason");
    await user.clear(reason);
    await user.type(reason, "Leak in bathroom");
    await user.click(within(blockDialog()).getByRole("button", { name: "Review" }));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));

    expect(mockedBlock).toHaveBeenCalledTimes(2);
    expect(mockedBlock).toHaveBeenLastCalledWith("prop-a", {
      physicalRoomId: "room-102",
      startDate: from,
      endDate: addDaysIso(from, 1),
      reason: "Leak in bathroom",
    });
  });

  it("a confirm that lands in the old dialog after its 400, before React has re-rendered it, sends nothing", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const write = await startPending(user, from);
    await act(async () => switchToPropertyB());
    const form = blockDialog().querySelector("form")!;

    // Same act: the 400 continuation runs, then a confirm reaches the dialog
    // that React has not re-rendered or removed yet.
    await act(async () => {
      write.resolve(validation);
      await flushMicrotasks();
      expect(form.isConnected).toBe(true);
      fireEvent.submit(form);
      await flushMicrotasks();
    });

    expect(mockedBlock).toHaveBeenCalledTimes(1);
    expect(queryBlockDialog()).not.toBeInTheDocument();
    expectFocusOnStableBoardControl();
  });
});

describe("ReservationBoard — an unconfirmed write survives a reload in the same tab (PMS-CAL-001.5-CP02)", () => {
  /**
   * A reload of the same tab is simulated by unmounting the board and mounting
   * a fresh one: every React state and ref is lost, exactly as on a page
   * reload, while `sessionStorage` — which belongs to the tab — is kept.
   */
  async function reloadSameTab() {
    cleanup();
    return renderLoadedBoard();
  }

  /** The restored lock is proven the way the operator meets it: a block on those nights is refused. */
  async function expectBlockLocked(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    await closeDialog(user, blockDialog());
  }

  async function expectBlockAllowed(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(blockDialog()).getByRole("button", { name: "Create block" })).toBeInTheDocument();
    await closeDialog(user, blockDialog());
  }

  /** What every restored notice must say: the request may have been saved, and the board proves only the schedule. */
  function expectRestoredWording(notice: HTMLElement) {
    expect(notice).toHaveTextContent("before this page was reloaded");
    expect(notice).toHaveTextContent("may already have been saved");
    expect(notice).toHaveTextContent("shows the schedule, not which request changed it");
  }

  it("assign: the notice and the lock on its room and nights come back, nothing is resent, and Check again only reads", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "network" } as AssignmentCreateOutcome);
    const before = mockedBoard.mock.calls.length;
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await settleReread(before);
    await closeDialog(user, assignDialog());

    await reloadSameTab();

    const notice = await screen.findByTestId("uncertain-write-notice");
    expectRestoredWording(notice);
    expect(notice).toHaveTextContent(`room 102, [${from}, ${addDaysIso(from, 2)})`);
    // The new page's first read already counts as a read of that board: it is
    // judged at once, not left "Checking…" behind a previous page's sequence.
    await waitFor(() => expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("still unknown"));
    // No guest name or confirmation number was kept.
    expect(notice).not.toHaveTextContent("Nguyen Van A");
    expect(notice).not.toHaveTextContent("CNF-100");
    // The range stays unconfirmed: it cannot be assigned again.
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
    await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
    // An unrelated room over the same nights is not locked.
    await expectBlockAllowed(user, "room-201", from, addDaysIso(from, 1));

    const boardCalls = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
    expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("still unknown");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("move: both its source and destination rooms stay locked for its nights after the reload", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" } as MoveAssignmentOutcome);
    const before = mockedBoard.mock.calls.length;
    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await settleReread(before);
    await closeDialog(user, moveDialog());

    await reloadSameTab();

    expectRestoredWording(await screen.findByTestId("uncertain-write-notice"));
    await expectBlockLocked(user, "room-101", addDaysIso(from, 3), addDaysIso(from, 4));
    await expectBlockLocked(user, "room-102", addDaysIso(from, 3), addDaysIso(from, 4));
    // Nights outside the segment are not locked.
    await expectBlockAllowed(user, "room-102", from, addDaysIso(from, 1));
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("unassign: its source room stays locked and the segment's unassign stays unavailable after the reload", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedUnassign.mockResolvedValue({ kind: "unknown", reason: "network" } as UnassignAssignmentOutcome);
    const before = mockedBoard.mock.calls.length;
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Remove room assignment" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove room assignment" })).getByRole("button", { name: "Remove room 101 assignment" }));
    await settleReread(before);
    await closeDialog(user, screen.getByRole("dialog", { name: "Remove room assignment" }));

    await reloadSameTab();

    expectRestoredWording(await screen.findByTestId("uncertain-write-notice"));
    await expectBlockLocked(user, "room-101", addDaysIso(from, 2), addDaysIso(from, 3));
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    expect(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Remove room assignment" })).toBeDisabled();
    expect(mockedUnassign).toHaveBeenCalledTimes(1);
  });

  it("block create: the notice (without its reason) and the room's lock come back after the reload", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseBlock(user, "room-102", from, addDaysIso(from, 1));

    await reloadSameTab();

    const notice = await screen.findByTestId("uncertain-block-notice");
    expectRestoredWording(notice);
    expect(notice).toHaveTextContent(`room 102, [${from}, ${addDaysIso(from, 1)})`);
    expect(notice).not.toHaveTextContent("Leak");
    await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
    expect(mockedBlock).toHaveBeenCalledTimes(1);
  });

  it("block cancel: the lock on the block's room and nights comes back after the reload, and the cancel is not offered again", async () => {
    const user = userEvent.setup();
    mockedBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      return Promise.resolve({
        ok: true,
        data: {
          ...board,
          operationalBlocks:
            propertyId === "prop-a"
              ? [{ roomBlockId: "b-1", segmentId: "seg-b-1", segmentVersion: 7, physicalRoomId: "room-201", startDate: addDaysIso(from, 6), endDate: addDaysIso(from, 7), reason: "Paint" }]
              : [],
        },
      });
    });
    const { from } = await renderLoadedBoard();
    mockedCancel.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    const before = mockedBoard.mock.calls.length;
    await user.click(screen.getByTitle("Paint"));
    await user.click(within(screen.getByRole("dialog", { name: "Operational block details" })).getByRole("button", { name: "Cancel block" }));
    await user.click(within(screen.getByRole("dialog", { name: "Cancel operational block" })).getByRole("button", { name: "Cancel block on room 201" }));
    await settleReread(before);
    await closeDialog(user, screen.getByRole("dialog", { name: "Cancel operational block" }));

    await reloadSameTab();

    const notice = await screen.findByTestId("uncertain-block-notice");
    expectRestoredWording(notice);
    expect(notice).not.toHaveTextContent("Paint");
    await expectBlockLocked(user, "room-201", addDaysIso(from, 6), addDaysIso(from, 7));
    await user.click(screen.getByTitle("Paint"));
    expect(within(screen.getByRole("dialog", { name: "Operational block details" })).getByRole("button", { name: "Cancel block" })).toBeDisabled();
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  /** Loses an assignment of the first unassigned range to room 102, then leaves the dialog. */
  async function loseAssignment(user: ReturnType<typeof userEvent.setup>, from: string) {
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "network" } as AssignmentCreateOutcome);
    const before = mockedBoard.mock.calls.length;
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await settleReread(before);
    await closeDialog(user, assignDialog());
  }

  /** The board as the server shows it once an assignment of `[from, from+2)` to room 102 exists. */
  function serveAssignedTo102() {
    mockedBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      if (propertyId !== "prop-a") return Promise.resolve({ ok: true, data: board });
      const [stay] = board.stays;
      return Promise.resolve({
        ok: true,
        data: {
          ...board,
          stays: [
            {
              ...stay,
              assignments: [
                ...stay.assignments,
                { segmentId: "seg-new", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-standard", startDate: from, endDate: addDaysIso(from, 2) },
              ],
              unassignedRanges: stay.unassignedRanges.slice(1),
            },
          ],
        },
      });
    });
  }

  it("server evidence after the reload resolves it through the existing rules and clears the tab's record; a later reload shows nothing", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseAssignment(user, from);
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).not.toBeNull();

    serveAssignedTo102();
    await reloadSameTab();

    await waitFor(() =>
      expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("is now shown on the server")
    );
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).toBeNull();

    await reloadSameTab();
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("a board that cannot see those nights after the reload resolves nothing, even if it contains other data", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseAssignment(user, from);
    await reloadSameTab();
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));

    const notice = await screen.findByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent("Open a view of this Property that includes");
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).not.toBeNull();
  });

  it.each([
    ["201", { kind: "created", segment: null }],
    ["409", { kind: "rejected", status: 409, category: "conflict" }],
    ["400", { kind: "rejected", status: 400, category: "validation" }],
    ["not-sent", { kind: "not-sent", message: "No API address." }],
  ] as [string, AssignmentCreateOutcome][])("a %s result leaves nothing for a reload to restore", async (_label, outcome) => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue(outcome);
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
    expect(sessionStorage.getItem(UNCERTAIN_WRITES_STORAGE_KEY)).toBeNull();

    await reloadSameTab();
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
  });

  it.each([
    ["not JSON", "{broken"],
    ["another format version", JSON.stringify({ v: 99, assignments: [], blocks: [] })],
  ])("a stored record that is %s never crashes the board, and says a protection could not be restored", async (_label, text) => {
    sessionStorage.setItem(UNCERTAIN_WRITES_STORAGE_KEY, text);
    await renderLoadedBoard();
    const warning = screen.getByTestId("unreadable-uncertain-writes");
    expect(warning).toHaveTextContent("could not be restored");
    expect(warning).toHaveTextContent("may already have been saved");
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
  });

  it("once resolved, a restored notice dismissed by keyboard hands focus to a stable control; dismissed with focus elsewhere, it leaves focus alone", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await loseAssignment(user, from);
    serveAssignedTo102();
    await reloadSameTab();
    const dismiss = await within(await screen.findByTestId("uncertain-write-notice")).findByRole("button", { name: "Dismiss notice" });

    dismiss.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create operational block" }));

    // Same, from a pointer while focus is elsewhere: focus stays put.
    cleanup();
    sessionStorage.clear();
    mockedBoard.mockImplementation((propertyId, boardFrom, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, boardFrom, to) }));
    const again = await renderLoadedBoard();
    await loseAssignment(user, again.from);
    serveAssignedTo102();
    await reloadSameTab();
    const dismissAgain = await within(await screen.findByTestId("uncertain-write-notice")).findByRole("button", { name: "Dismiss notice" });
    const next = screen.getByRole("button", { name: "Next date range" });
    next.focus();
    fireEvent.click(dismissAgain);
    expect(document.activeElement).toBe(next);
  });
});

describe("ReservationBoard — a write still in flight survives a reload in the same tab (PMS-CAL-001.5-CP03)", () => {
  /** The board as the server shows it once an assignment of `[from, from+2)` to room 102 exists. */
  function serveAssignedTo102() {
    mockedBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      if (propertyId !== "prop-a") return Promise.resolve({ ok: true, data: board });
      const [stay] = board.stays;
      return Promise.resolve({
        ok: true,
        data: {
          ...board,
          stays: [
            {
              ...stay,
              assignments: [
                ...stay.assignments,
                { segmentId: "seg-new", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-standard", startDate: from, endDate: addDaysIso(from, 2) },
              ],
              unassignedRanges: stay.unassignedRanges.slice(1),
            },
          ],
        },
      });
    });
  }

  const PENDING_KEY = "thebha.adminCalendar.pendingWrites";
  const UNCERTAIN_KEY = "thebha.adminCalendar.uncertainWrites";

  async function reloadSameTab() {
    cleanup();
    return renderLoadedBoard();
  }

  async function expectBlockLocked(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    await closeDialog(user, blockDialog());
  }

  async function expectBlockAllowed(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).queryByRole("alert")).not.toBeInTheDocument();
    await closeDialog(user, blockDialog());
  }

  function expectInFlightWording(notice: HTMLElement) {
    expect(notice).toHaveTextContent("sent just before this page was reloaded");
    expect(notice).toHaveTextContent("may never have reached the server, or may already have been saved");
    expect(notice).toHaveTextContent("shows the schedule, not which request changed it");
  }

  /** Starts an assignment of the first unassigned range to room 102 whose POST never answers. */
  async function startPendingAssignment(user: ReturnType<typeof userEvent.setup>, from: string) {
    const post = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => post.promise);
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    return post;
  }

  it("assign: reloaded while its POST is pending, the notice and the lock come back, nothing is resent, and Check again only reads", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await startPendingAssignment(user, from);

    await reloadSameTab();

    const notice = await screen.findByTestId("uncertain-write-notice");
    expectInFlightWording(notice);
    expect(notice).toHaveTextContent(`room 102, [${from}, ${addDaysIso(from, 2)})`);
    expect(notice).not.toHaveTextContent("Nguyen Van A");
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
    await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
    await expectBlockAllowed(user, "room-201", from, addDaysIso(from, 1));
    await expectBlockAllowed(user, "room-102", addDaysIso(from, 5), addDaysIso(from, 6));

    const boardCalls = mockedBoard.mock.calls.length;
    await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
    expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("still unknown");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("move: reloaded while pending, both its source and destination rooms stay locked for its nights", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockImplementation(() => deferred<MoveAssignmentOutcome>().promise);
    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    await reloadSameTab();

    expectInFlightWording(await screen.findByTestId("uncertain-write-notice"));
    await expectBlockLocked(user, "room-101", addDaysIso(from, 2), addDaysIso(from, 3));
    await expectBlockLocked(user, "room-102", addDaysIso(from, 3), addDaysIso(from, 4));
    await expectBlockAllowed(user, "room-102", from, addDaysIso(from, 1));
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("unassign: reloaded while pending, its source room stays locked and the unassign is not offered again", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedUnassign.mockImplementation(() => deferred<UnassignAssignmentOutcome>().promise);
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Remove room assignment" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove room assignment" })).getByRole("button", { name: "Remove room 101 assignment" }));

    await reloadSameTab();

    expectInFlightWording(await screen.findByTestId("uncertain-write-notice"));
    await expectBlockLocked(user, "room-101", addDaysIso(from, 2), addDaysIso(from, 3));
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    expect(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Remove room assignment" })).toBeDisabled();
    expect(mockedUnassign).toHaveBeenCalledTimes(1);
  });

  it("block create: reloaded while pending, the room's nights stay locked and the notice carries no reason", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedBlock.mockImplementation(() => deferred<OperationalBlockCreateOutcome>().promise);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));

    await reloadSameTab();

    const notice = await screen.findByTestId("uncertain-block-notice");
    expectInFlightWording(notice);
    expect(notice).not.toHaveTextContent("Leak");
    await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
    await expectBlockAllowed(user, "room-101", from, addDaysIso(from, 1));
    expect(mockedBlock).toHaveBeenCalledTimes(1);
  });

  it("block cancel: reloaded while pending, the block's room and nights stay locked and the cancel is not offered again", async () => {
    const user = userEvent.setup();
    mockedBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      return Promise.resolve({
        ok: true,
        data: {
          ...board,
          operationalBlocks:
            propertyId === "prop-a"
              ? [{ roomBlockId: "b-1", segmentId: "seg-b-1", segmentVersion: 7, physicalRoomId: "room-201", startDate: addDaysIso(from, 6), endDate: addDaysIso(from, 7), reason: "Paint" }]
              : [],
        },
      });
    });
    const { from } = await renderLoadedBoard();
    mockedCancel.mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByTitle("Paint"));
    await user.click(within(screen.getByRole("dialog", { name: "Operational block details" })).getByRole("button", { name: "Cancel block" }));
    await user.click(within(screen.getByRole("dialog", { name: "Cancel operational block" })).getByRole("button", { name: "Cancel block on room 201" }));

    await reloadSameTab();

    const notice = await screen.findByTestId("uncertain-block-notice");
    expectInFlightWording(notice);
    expect(notice).not.toHaveTextContent("Paint");
    await expectBlockLocked(user, "room-201", addDaysIso(from, 6), addDaysIso(from, 7));
    await user.click(screen.getByTitle("Paint"));
    expect(within(screen.getByRole("dialog", { name: "Operational block details" })).getByRole("button", { name: "Cancel block" })).toBeDisabled();
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["201", { kind: "created", segment: null }],
    ["409", { kind: "rejected", status: 409, category: "conflict" }],
    ["400", { kind: "rejected", status: 400, category: "validation" }],
    ["not-sent", { kind: "not-sent", message: "No API address." }],
  ] as [string, AssignmentCreateOutcome][])("a %s answer removes the intent, and a later reload restores nothing", async (_label, outcome) => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const post = await startPendingAssignment(user, from);
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();

    await act(async () => post.resolve(outcome));
    await waitFor(() => expect(sessionStorage.getItem(PENDING_KEY)).toBeNull());
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();

    await reloadSameTab();
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
  });

  it("an unknown answer hands the lock from the intent to the unconfirmed record with no moment unlocked", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const post = await startPendingAssignment(user, from);

    // Watch every storage write: at no point may both records be empty.
    const gaps: string[] = [];
    const realRemove = Storage.prototype.removeItem;
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      realRemove.call(this, key);
      if (this.getItem(PENDING_KEY) === null && this.getItem(UNCERTAIN_KEY) === null) gaps.push(key);
    });
    await act(async () => post.resolve({ kind: "unknown", reason: "timeout" }));
    spy.mockRestore();

    expect(gaps).toEqual([]);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();
    await reloadSameTab();
    expect(await screen.findByTestId("uncertain-write-notice")).toHaveTextContent("from before this page was reloaded");
  });

  it("a late answer from the page that was reloaded cannot remove what the new page is tracking", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const post = await startPendingAssignment(user, from);

    await reloadSameTab();
    await screen.findByTestId("uncertain-write-notice");
    // The old page's request now answers — its page is gone.
    await act(async () => post.resolve({ kind: "created", segment: null }));

    // The new page still tracks it: only server data may resolve it.
    expect(screen.getByTestId("uncertain-write-notice")).toBeInTheDocument();
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
    await reloadSameTab();
    expect(await screen.findByTestId("uncertain-write-notice")).toBeInTheDocument();
  });

  it("an unknown answer that reaches the old page after it unmounted, before the new page loads, is still there for the new page", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const post = await startPendingAssignment(user, from);

    cleanup();
    await act(async () => post.resolve({ kind: "unknown", reason: "network" }));
    await renderLoadedBoard();

    expectInFlightWording(await screen.findByTestId("uncertain-write-notice"));
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
  });

  it("once server data resolves a restored in-flight write, a later reload does not bring it back", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await startPendingAssignment(user, from);

    serveAssignedTo102();
    await reloadSameTab();
    await waitFor(() => expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("is now shown on the server"));
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();

    await reloadSameTab();
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
  });

  it("a real reload aborts the pending POST while the old page is still mounted: the intent stays in flight, with the in-flight wording", async () => {
    // Verified live in Chrome: reloading aborts the old page's fetch *before*
    // that page unmounts, so the client reports `unknown/aborted` to a board
    // that is still mounted. `pagehide` marks the page as unloading first.
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const post = await startPendingAssignment(user, from);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      post.resolve({ kind: "unknown", reason: "aborted" });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();

    await reloadSameTab();
    expectInFlightWording(await screen.findByTestId("uncertain-write-notice"));
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
  });

  it("when the intent cannot be stored, nothing is sent and the operator is told why", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    spy.mockRestore();

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(await within(assignDialog()).findByRole("alert")).toHaveTextContent("could not keep the safety record");
    // The dialog stays usable once storage works again.
    mockedCreate.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict" });
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
  });

  it("a double submit records one intent for its one POST, and a refusal before sending records none", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    // Refused before sending: the destination is locked by an earlier lost block.
    await loseBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    expect(await within(assignDialog()).findByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();

    mockedCreate.mockImplementation(() => deferred<AssignmentCreateOutcome>().promise);
    await user.click(within(assignDialog()).getByLabelText(/Room 101/));
    await user.dblClick(within(assignDialog()).getByRole("button", { name: "Assign room 101" }));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!).writes).toHaveLength(1);
  });
});

describe("ReservationBoard — no write that may have reached the server is ever left without a record (PMS-CAL-001.5-CP03-C1)", () => {
  const PENDING_KEY = "thebha.adminCalendar.pendingWrites";
  const UNCERTAIN_KEY = "thebha.adminCalendar.uncertainWrites";

  async function reloadSameTab() {
    cleanup();
    return renderLoadedBoard();
  }

  /** Storage that refuses only the unconfirmed record (quota, temporary denial); the intent key keeps working. */
  function refuseUnconfirmedRecord() {
    const realSet = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === UNCERTAIN_KEY) throw new DOMException("full", "QuotaExceededError");
      realSet.call(this, key, value);
    });
  }

  async function expectBlockLocked(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    await closeDialog(user, blockDialog());
  }

  async function expectBlockAllowed(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).queryByRole("alert")).not.toBeInTheDocument();
    await closeDialog(user, blockDialog());
  }

  const pendingCount = () => {
    const text = sessionStorage.getItem(PENDING_KEY);
    return text === null ? 0 : (JSON.parse(text).writes as unknown[]).length;
  };

  /** An assignment of the first unassigned range to room 102 whose POST answers only when told to. */
  async function startPendingAssignment(user: ReturnType<typeof userEvent.setup>, from: string) {
    const post = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => post.promise);
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    return post;
  }

  /** A block create on room 102 for `[from, from+1)` whose POST answers only when told to. */
  async function startPendingBlock(user: ReturnType<typeof userEvent.setup>, from: string) {
    const post = deferred<OperationalBlockCreateOutcome>();
    mockedBlock.mockImplementation(() => post.promise);
    await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    expect(mockedBlock).toHaveBeenCalledTimes(1);
    return post;
  }

  function showFromBackForwardCache() {
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
  }

  describe("the unconfirmed record cannot be written when a restored intent is handed over at mount", () => {
    it("assignment: the intent survives, and the next reload still shows the notice and the lock", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      await startPendingAssignment(user, from);
      expect(pendingCount()).toBe(1);

      const spy = refuseUnconfirmedRecord();
      await reloadSameTab();
      // This page itself still warns and locks, from memory.
      expect(await screen.findByTestId("uncertain-write-notice")).toBeInTheDocument();
      expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
      spy.mockRestore();
      expect(pendingCount()).toBe(1);

      await reloadSameTab();
      const notice = await screen.findByTestId("uncertain-write-notice");
      expect(notice).toHaveTextContent(`room 102, [${from}, ${addDaysIso(from, 2)})`);
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      await expectBlockAllowed(user, "room-201", from, addDaysIso(from, 1));
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });

    it("block: the intent survives, and the next reload still shows the notice and the lock", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      await startPendingBlock(user, from);

      const spy = refuseUnconfirmedRecord();
      await reloadSameTab();
      expect(await screen.findByTestId("uncertain-block-notice")).toBeInTheDocument();
      spy.mockRestore();
      expect(pendingCount()).toBe(1);

      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      await expectBlockAllowed(user, "room-101", from, addDaysIso(from, 1));
      expect(mockedBlock).toHaveBeenCalledTimes(1);
    });

    it("once storage accepts the record again, the hand-over completes: one record, no leftover intent, one notice", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      await startPendingAssignment(user, from);

      const spy = refuseUnconfirmedRecord();
      await reloadSameTab();
      await screen.findByTestId("uncertain-write-notice");
      spy.mockRestore();
      // Any later change of the tracked list writes the record again; Check again's re-read is one.
      const boardCalls = mockedBoard.mock.calls.length;
      await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
      await waitFor(() => expect(pendingCount()).toBe(0));
      expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();

      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("the unconfirmed record cannot be written when an unknown answer reaches the live page", () => {
    it("assignment: the intent survives, this page warns and locks, and a reload still does", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      const spy = refuseUnconfirmedRecord();
      const before = mockedBoard.mock.calls.length;
      await act(async () => post.resolve({ kind: "unknown", reason: "timeout" }));
      await settleReread(before);
      spy.mockRestore();
      expect(pendingCount()).toBe(1);
      await closeDialog(user, assignDialog());
      expect(screen.getByTestId("uncertain-write-notice")).toBeInTheDocument();
      expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");

      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });

    it("block: the intent survives, this page warns and locks, and a reload still does", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingBlock(user, from);

      const spy = refuseUnconfirmedRecord();
      const before = mockedBoard.mock.calls.length;
      await act(async () => post.resolve({ kind: "unknown", reason: "timeout" }));
      await settleReread(before);
      spy.mockRestore();
      expect(pendingCount()).toBe(1);
      await closeDialog(user, blockDialog());
      expect(screen.getByTestId("uncertain-block-notice")).toBeInTheDocument();
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));

      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      expect(mockedBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe("the page comes back from the back/forward cache without remounting", () => {
    it("assignment: an unknown answer received while the page was hidden comes back as a notice and a lock before any new write, with no second POST", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        post.resolve({ kind: "unknown", reason: "aborted" });
        await flushMicrotasks();
      });
      const boardCalls = mockedBoard.mock.calls.length;
      await act(async () => {
        showFromBackForwardCache();
        await flushMicrotasks();
      });

      const notice = await screen.findByTestId("uncertain-write-notice");
      expect(notice).toHaveTextContent("sent just before this page was reloaded or left");
      expect(notice).toHaveTextContent("may never have reached the server, or may already have been saved");
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      // An authoritative re-read, not the board as it was before the page was hidden.
      await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
      await waitFor(() => expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("still unknown"));
      await closeDialog(user, assignDialog());
      expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      // A write that does not overlap is still possible.
      await expectBlockAllowed(user, "room-201", from, addDaysIso(from, 1));

      const afterReread = mockedBoard.mock.calls.length;
      await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(afterReread + 1));
      expect(mockedCreate).toHaveBeenCalledTimes(1);
      // The page holds it now: the intent was handed over to the record.
      expect(pendingCount()).toBe(0);
      expect(sessionStorage.getItem(UNCERTAIN_KEY)).not.toBeNull();
    });

    it("block: an unknown answer received while the page was hidden comes back as a notice and a lock", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingBlock(user, from);

      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        post.resolve({ kind: "unknown", reason: "aborted" });
        await flushMicrotasks();
      });
      await act(async () => {
        showFromBackForwardCache();
        await flushMicrotasks();
      });

      expect(await screen.findByTestId("uncertain-block-notice")).toBeInTheDocument();
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await closeDialog(user, blockDialog());
      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      expect(mockedBlock).toHaveBeenCalledTimes(1);
    });

    it("a write still on the wire when the page comes back is not doubled: its own answer later creates the one notice", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        showFromBackForwardCache();
        await flushMicrotasks();
      });
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      const before = mockedBoard.mock.calls.length;
      await act(async () => post.resolve({ kind: "unknown", reason: "timeout" }));
      await settleReread(before);
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(pendingCount()).toBe(0);
    });

    it("a page shown normally (not from the cache) is left alone", async () => {
      await renderLoadedBoard();
      const boardCalls = mockedBoard.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event("pageshow"));
        await flushMicrotasks();
      });
      expect(mockedBoard.mock.calls.length).toBe(boardCalls);
    });
  });
});

describe("ReservationBoard — known outcomes, mixed restores and damaged records stay honest about the tab's writes (PMS-CAL-001.5-CP03-C2)", () => {
  const PENDING_KEY = PENDING_WRITES_STORAGE_KEY;
  const UNCERTAIN_KEY = UNCERTAIN_WRITES_STORAGE_KEY;

  /** Real storage, except that `refuse(key, value)` makes the call throw like a denied or full store. */
  function failStorage(method: "getItem" | "setItem" | "removeItem", refuse: (key: string, value?: string) => boolean) {
    const real = Storage.prototype[method] as (this: Storage, key: string, value?: string) => unknown;
    return vi.spyOn(Storage.prototype, method).mockImplementation(function (this: Storage, key: string, value?: string) {
      if (refuse(key, value)) throw new DOMException("refused", "QuotaExceededError");
      return real.call(this, key, value);
    } as never);
  }

  const pendingTokens = () => {
    const text = sessionStorage.getItem(PENDING_KEY);
    return text === null ? [] : (JSON.parse(text).writes as Array<{ token?: string } | null>).map((record) => record?.token ?? null);
  };
  const pendingCount = () => pendingTokens().length;

  async function reloadSameTab() {
    cleanup();
    return renderLoadedBoard();
  }

  function showFromBackForwardCache() {
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
  }

  async function backForward() {
    await act(async () => {
      showFromBackForwardCache();
      await flushMicrotasks();
    });
  }

  async function startPendingAssignment(user: ReturnType<typeof userEvent.setup>, from: string, room = "102") {
    const post = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => post.promise);
    await user.click(firstRangeBar(from));
    await user.click(within(assignDialog()).getByLabelText(new RegExp(`Room ${room}`)));
    await user.click(within(assignDialog()).getByRole("button", { name: `Assign room ${room}` }));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    return post;
  }

  async function expectBlockLocked(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
    await reviewBlock(user, room, start, end);
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    await closeDialog(user, blockDialog());
  }

  function expectNoWarningOrLock(from: string) {
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("uncertain-block-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unreadable-uncertain-writes")).not.toBeInTheDocument();
    expect(firstRangeBar(from)).not.toHaveAttribute("aria-disabled", "true");
  }

  /** A write of a previous page, as its intent would have been recorded before it went on the wire. */
  function seedAssignmentIntent(from: string, to: string) {
    const entry: Reconciliation = {
      id: 0,
      key: `prop-a|${from}|${to}`,
      propertyId: "prop-a",
      from,
      to,
      afterSeq: 0,
      certainty: "uncertain",
      status: "pending",
      resolution: "unresolved",
      target: {
        operation: "create",
        reservationUnitId: "unit-1",
        physicalRoomId: "room-101",
        startDate: addDaysIso(from, 4),
        endDate: to,
        roomNumber: "101",
        guestDisplayName: "",
        confirmationNumber: "",
      },
    };
    return beginPendingWrite(sessionStorage, { kind: "assignment", entry })!;
  }

  function seedBlockIntent(from: string, to: string) {
    const entry: BlockCreateReconciliation = {
      id: 0,
      key: `prop-a|${from}|${to}`,
      propertyId: "prop-a",
      from,
      to,
      afterSeq: 0,
      certainty: "uncertain",
      status: "pending",
      resolution: "unresolved",
      target: { operation: "create", physicalRoomId: "room-201", roomNumber: "201", startDate: from, endDate: addDaysIso(from, 1), reason: "" },
    };
    return beginPendingWrite(sessionStorage, { kind: "block", entry })!;
  }

  describe("a write whose outcome is known but whose intent storage would not delete (F1)", () => {
    it("a 400 keeps its token for a later retry, which a read of the board provides once storage works — no warning, no lock, ever", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      const spy = failStorage("removeItem", (key) => key === PENDING_KEY);
      await act(async () => post.resolve({ kind: "rejected", status: 400, category: "validation" }));
      spy.mockRestore();
      // Deleting failed: the token is still owed a deletion, but nothing is warned or locked for it.
      expect(pendingCount()).toBe(1);
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      // No list changes for a 400; the read a date-range change issues is the retry chance.
      await closeDialog(user, assignDialog());
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await waitFor(() => expect(pendingCount()).toBe(0));

      await reloadSameTab();
      expectNoWarningOrLock(from);
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });

    it("a page shown from the back/forward cache while that deletion is still refused restores no false unknown write, then finishes the deletion", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      const spy = failStorage("removeItem", (key) => key === PENDING_KEY);
      await act(async () => post.resolve({ kind: "rejected", status: 400, category: "validation" }));
      await closeDialog(user, assignDialog());
      await backForward();
      expectNoWarningOrLock(from);
      expect(pendingCount()).toBe(1);

      spy.mockRestore();
      await backForward();
      expect(pendingCount()).toBe(0);
      expectNoWarningOrLock(from);

      await reloadSameTab();
      expectNoWarningOrLock(from);
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });

    it("an answer that reaches a page already being left is retried too, and the page that returns from the cache is clean", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      const spy = failStorage("removeItem", (key) => key === PENDING_KEY);
      await act(async () => {
        window.dispatchEvent(new Event("pagehide"));
        post.resolve({ kind: "rejected", status: 400, category: "validation" });
        await flushMicrotasks();
      });
      expect(pendingCount()).toBe(1);
      spy.mockRestore();
      await backForward();

      expect(pendingCount()).toBe(0);
      expectNoWarningOrLock(from);
      await closeDialog(user, assignDialog());
      expect(firstRangeBar(from)).not.toHaveAttribute("aria-disabled", "true");
    });

    it("a created answer still reloads the board and reports the assignment while its token waits for deletion", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);

      const spy = failStorage("removeItem", (key) => key === PENDING_KEY);
      const before = mockedBoard.mock.calls.length;
      await act(async () => post.resolve({ kind: "created", segment: null }));
      await settleReread(before);
      spy.mockRestore();

      expect(screen.getByText(`Room 102 assigned to Nguyen Van A (CNF-100) for [${from}, ${addDaysIso(from, 2)}).`)).toBeInTheDocument();
      expect(pendingCount()).toBe(1);
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      await backForward();
      expect(pendingCount()).toBe(0);
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
      await reloadSameTab();
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    });
  });

  describe("a bfcache return that restores both an assignment and a block (F2)", () => {
    it("keeps both intents while the two-list record is refused, and each write comes back exactly once — even after repeated pageshow and reloads", async () => {
      const user = userEvent.setup();
      const { from, to } = await renderLoadedBoard();
      seedAssignmentIntent(from, to);
      seedBlockIntent(from, to);
      expect(pendingCount()).toBe(2);

      // Quota: a record with only one kind of write fits; the full one does not.
      const spy = failStorage("setItem", (key, value) => {
        if (key !== UNCERTAIN_KEY) return false;
        const record = JSON.parse(value ?? "{}") as { assignments: unknown[]; blocks: unknown[] };
        return record.assignments.length > 0 && record.blocks.length > 0;
      });
      await backForward();
      await backForward();

      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await expectBlockLocked(user, "room-101", addDaysIso(from, 4), addDaysIso(from, 5));
      await expectBlockLocked(user, "room-201", from, addDaysIso(from, 1));
      // Neither write was handed over: an intent is all that names it until the record holds both.
      expect(pendingCount()).toBe(2);
      expect(sessionStorage.getItem(UNCERTAIN_KEY)).toBeNull();

      // A reload while storage still refuses restores both, from the intents.
      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await expectBlockLocked(user, "room-201", from, addDaysIso(from, 1));

      // Storage recovers: the next read hands both over, and only then are the intents dropped.
      spy.mockRestore();
      const boardCalls = mockedBoard.mock.calls.length;
      await user.click(within(screen.getByTestId("uncertain-write-notice")).getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
      await waitFor(() => expect(pendingCount()).toBe(0));
      const record = JSON.parse(sessionStorage.getItem(UNCERTAIN_KEY)!);
      expect([record.assignments.length, record.blocks.length]).toEqual([1, 1]);

      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      expect(mockedCreate).not.toHaveBeenCalled();
      expect(mockedBlock).not.toHaveBeenCalled();
    });

    it("never restores or drops the intent of a write of this page that is still on the wire", async () => {
      const user = userEvent.setup();
      const { from, to } = await renderLoadedBoard();
      const post = await startPendingAssignment(user, from);
      seedAssignmentIntent(from, to);
      seedBlockIntent(from, to);
      expect(pendingCount()).toBe(3);

      const spy = failStorage("setItem", (key, value) => {
        if (key !== UNCERTAIN_KEY) return false;
        const record = JSON.parse(value ?? "{}") as { assignments: unknown[]; blocks: unknown[] };
        return record.assignments.length > 0 && record.blocks.length > 0;
      });
      await backForward();

      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      expect(pendingCount()).toBe(3);

      // Its own answer, and only that, makes it a warning.
      const before = mockedBoard.mock.calls.length;
      await act(async () => post.resolve({ kind: "unknown", reason: "timeout" }));
      await settleReread(before);
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(2);
      spy.mockRestore();
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("a damaged pending record (F3)", () => {
    const tryAssign = async (user: ReturnType<typeof userEvent.setup>, from: string) => {
      mockedCreate.mockResolvedValue({ kind: "created", segment: null });
      await user.click(firstRangeBar(from));
      await user.click(within(assignDialog()).getByLabelText(/Room 102/));
      await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    };

    it("a null entry refuses the write: it neither throws, sends, nor leaves a new intent behind", async () => {
      const user = userEvent.setup();
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ v: 1, writes: [null] }));
      const { from } = await renderLoadedBoard();
      const before = sessionStorage.getItem(PENDING_KEY);

      await tryAssign(user, from);

      expect(await within(assignDialog()).findByRole("alert")).toHaveTextContent("could not keep the safety record");
      expect(mockedCreate).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_KEY)).toBe(before);
      expect(screen.getByTestId("unreadable-uncertain-writes")).toBeInTheDocument();
    });

    it("a null entry next to a valid intent keeps the valid write warned and locked, and refuses new writes", async () => {
      const user = userEvent.setup();
      const probe = await renderLoadedBoard();
      cleanup();
      seedAssignmentIntent(probe.from, probe.to);
      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, writes: [null, ...pending.writes] }));

      const { from } = await renderLoadedBoard();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getByTestId("unreadable-uncertain-writes")).toBeInTheDocument();
      const before = [sessionStorage.getItem(PENDING_KEY), sessionStorage.getItem(UNCERTAIN_KEY)];

      await reviewBlock(user, "room-201", from, addDaysIso(from, 1));
      await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
      expect(await within(blockDialog()).findByRole("alert")).toHaveTextContent("could not keep the safety record");
      expect(mockedBlock).not.toHaveBeenCalled();
      expect([sessionStorage.getItem(PENDING_KEY), sessionStorage.getItem(UNCERTAIN_KEY)]).toEqual(before);

      await closeDialog(user, blockDialog());
      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getByTestId("unreadable-uncertain-writes")).toBeInTheDocument();
    });

    it("an intent that was stored but cannot be read back is not sent, and is removed once storage answers again", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();

      let stored = false;
      const set = failStorage("setItem", (key) => {
        if (key === PENDING_KEY) stored = true;
        return false;
      });
      const get = failStorage("getItem", (key) => stored && key === PENDING_KEY);
      await tryAssign(user, from);
      expect(await within(assignDialog()).findByRole("alert")).toHaveTextContent("could not keep the safety record");
      expect(mockedCreate).not.toHaveBeenCalled();
      set.mockRestore();
      get.mockRestore();
      expect(pendingCount()).toBe(1);

      await backForward();
      expect(pendingCount()).toBe(0);
      expectNoWarningOrLock(from);
      await reloadSameTab();
      expectNoWarningOrLock(from);
    });
  });

  describe("storage that cannot be read while restoring never means \"nothing was recorded\" (PMS-CAL-001.5-CP03-C3)", () => {
    const BANNER = "unverified-storage-writes";
    // The genuine reader: the tests must be able to look at storage while a read fault is being injected.
    const rawGet = Storage.prototype.getItem;
    afterEach(() => vi.restoreAllMocks());
    const UNVERIFIED = "could not read the safety records";

    /** The range the board opens on, found by mounting once; the fixtures below are seeded for it. */
    async function probeRange() {
      const range = await renderLoadedBoard();
      cleanup();
      return range;
    }

    const boardKey = (from: string, to: string) => `prop-a|${from}|${to}`;
    const blockEntry = (from: string, to: string, roomId: string, roomNumber: string, start: number, end: number): BlockCreateReconciliation => ({
      id: 0,
      key: boardKey(from, to),
      propertyId: "prop-a",
      from,
      to,
      afterSeq: 0,
      certainty: "uncertain",
      status: "pending",
      resolution: "unresolved",
      target: { operation: "create", physicalRoomId: roomId, roomNumber, startDate: addDaysIso(from, start), endDate: addDaysIso(from, end), reason: "" },
    });
    const assignmentEntry = (from: string, to: string, roomId: string, roomNumber: string, start: number, end: number): Reconciliation => ({
      id: 0,
      key: boardKey(from, to),
      propertyId: "prop-a",
      from,
      to,
      afterSeq: 0,
      certainty: "uncertain",
      status: "pending",
      resolution: "unresolved",
      target: {
        operation: "create",
        reservationUnitId: "unit-1",
        physicalRoomId: roomId,
        startDate: addDaysIso(from, start),
        endDate: addDaysIso(from, end),
        roomNumber,
        guestDisplayName: "",
        confirmationNumber: "",
      },
    });

    /** Reads of `keys` throw until `recover()`; the record itself is untouched. */
    function readFailure(...keys: string[]) {
      const refused = new Set(keys);
      failStorage("getItem", (key) => refused.has(key));
      return { recover: () => refused.clear() };
    }

    async function expectBlockAllowed(user: ReturnType<typeof userEvent.setup>, room: string, start: string, end: string) {
      await reviewBlock(user, room, start, end);
      expect(within(blockDialog()).queryByRole("alert")).not.toBeInTheDocument();
      await closeDialog(user, blockDialog());
    }

    const storedKeys = () => [rawGet.call(sessionStorage, PENDING_KEY), rawGet.call(sessionStorage, UNCERTAIN_KEY)];
    const banner = () => screen.queryByTestId(BANNER);
    const postCount = () => [mockedCreate, mockedMove, mockedUnassign, mockedBlock, mockedCancel].reduce((sum, mock) => sum + mock.mock.calls.length, 0);

    const boardWithPaintBlock = () =>
      mockedBoard.mockImplementation((propertyId, from, to) => {
        const board = boardFor(propertyId, from, to);
        return Promise.resolve({
          ok: true,
          data: {
            ...board,
            operationalBlocks:
              propertyId === "prop-a"
                ? [{ roomBlockId: "b-1", segmentId: "seg-b-1", segmentVersion: 7, physicalRoomId: "room-201", startDate: addDaysIso(from, 6), endDate: addDaysIso(from, 7), reason: "Paint" }]
                : [],
          },
        });
      });

    type User = ReturnType<typeof userEvent.setup>;
    const operations: Array<{
      name: string;
      lock: [roomId: string, roomNumber: string, start: number, end: number];
      prepare?: () => void;
      open: (user: User, from: string) => Promise<HTMLElement>;
      confirm: string;
      /** What the dialog needs before it can be confirmed again after a refusal. */
      again?: (dialog: HTMLElement, user: User) => Promise<void>;
      posted: () => number;
    }> = [
      {
        name: "assign",
        lock: ["room-102", "102", 0, 1],
        open: async (user, from) => {
          await user.click(firstRangeBar(from));
          await user.click(within(assignDialog()).getByLabelText(/Room 102/));
          return assignDialog();
        },
        confirm: "Assign room 102",
        posted: () => mockedCreate.mock.calls.length,
      },
      {
        name: "move",
        lock: ["room-102", "102", 3, 4],
        open: async (user) => {
          await openMoveDialog(user);
          await user.click(within(moveDialog()).getByLabelText(/Room 102/));
          return moveDialog();
        },
        confirm: "Move to room 102",
        posted: () => mockedMove.mock.calls.length,
      },
      {
        name: "unassign",
        lock: ["room-101", "101", 2, 3],
        open: async (user) => {
          await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
          await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Remove room assignment" }));
          return screen.getByRole("dialog", { name: "Remove room assignment" });
        },
        confirm: "Remove room 101 assignment",
        posted: () => mockedUnassign.mock.calls.length,
      },
      {
        name: "block create",
        lock: ["room-102", "102", 0, 1],
        open: async (user, from) => {
          await reviewBlock(user, "room-102", from, addDaysIso(from, 1));
          return blockDialog();
        },
        confirm: "Create block",
        again: (dialog, user) => user.click(within(dialog).getByRole("button", { name: "Review" })),
        posted: () => mockedBlock.mock.calls.length,
      },
      {
        name: "block cancel",
        lock: ["room-201", "201", 6, 7],
        prepare: boardWithPaintBlock,
        open: async (user) => {
          await user.click(screen.getByTitle("Paint"));
          await user.click(within(screen.getByRole("dialog", { name: "Operational block details" })).getByRole("button", { name: "Cancel block" }));
          return screen.getByRole("dialog", { name: "Cancel operational block" });
        },
        confirm: "Cancel block on room 201",
        posted: () => mockedCancel.mock.calls.length,
      },
    ];

    it.each(operations)(
      "$name: a dialog opened while the intent record cannot be read sends nothing — not before, and not once storage is readable again but the operator has not asked to re-check",
      async (operation) => {
        const user = userEvent.setup();
        operation.prepare?.();
        for (const mock of [mockedCreate, mockedMove, mockedUnassign, mockedBlock, mockedCancel]) mock.mockResolvedValue({ kind: "unknown", reason: "timeout" } as never);
        const { from, to } = await probeRange();
        const [roomId, roomNumber, start, end] = operation.lock;
        beginPendingWrite(sessionStorage, { kind: "block", entry: blockEntry(from, to, roomId, roomNumber, start, end) });
        const stored = storedKeys();
        const storage = readFailure(PENDING_KEY);

        await renderLoadedBoard();
        const dialog = await operation.open(user, from);

        // Still unreadable: refused, with the reason, and the operator is told on the board too.
        await user.click(within(dialog).getByRole("button", { name: operation.confirm }));
        expect(operation.posted()).toBe(0);
        expect(await within(dialog).findByRole("alert")).toHaveTextContent(UNVERIFIED);
        expect(banner()).toHaveTextContent(UNVERIFIED);
        expect(screen.queryByTestId("uncertain-block-notice")).not.toBeInTheDocument();

        // Readable again, no click on the board's own re-check: the confirm itself takes the records in first.
        storage.recover();
        await operation.again?.(dialog, user);
        await user.click(within(dialog).getByRole("button", { name: operation.confirm }));
        expect(await within(dialog).findByRole("alert")).toHaveTextContent("still unconfirmed");
        expect(operation.posted()).toBe(0);
        expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
        expect(banner()).not.toBeInTheDocument();
        // Taken in, and the intent handed over to the record (the board may already show the block).
        expect(storedKeys()[0]).not.toEqual(stored[0]);
        expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
      }
    );

    it.each(operations)(
      "$name: storage readable again before the first confirm — the earlier request's lock is in force and the overlapping request is not sent",
      async (operation) => {
        const user = userEvent.setup();
        operation.prepare?.();
        for (const mock of [mockedCreate, mockedMove, mockedUnassign, mockedBlock, mockedCancel]) mock.mockResolvedValue({ kind: "unknown", reason: "timeout" } as never);
        const { from, to } = await probeRange();
        const [roomId, roomNumber, start, end] = operation.lock;
        beginPendingWrite(sessionStorage, { kind: "block", entry: blockEntry(from, to, roomId, roomNumber, start, end) });
        const storage = readFailure(PENDING_KEY);
        await renderLoadedBoard();
        const dialog = await operation.open(user, from);

        storage.recover();
        await user.click(within(dialog).getByRole("button", { name: operation.confirm }));
        expect(operation.posted()).toBe(0);
        expect(await within(dialog).findByRole("alert")).toHaveTextContent("still unconfirmed");
        expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      }
    );

    it.each([
      ["the intent record", PENDING_KEY],
      ["the unconfirmed record", UNCERTAIN_KEY],
    ])("%s unreadable at mount: a warning explains it, Check storage again re-reads without looping, and recovery restores the lock on the mounted board", async (_label, key) => {
      const user = userEvent.setup();
      const { from, to } = await probeRange();
      const entry = assignmentEntry(from, to, "room-102", "102", 0, 2);
      if (key === PENDING_KEY) beginPendingWrite(sessionStorage, { kind: "assignment", entry });
      else persistUncertainWrites(sessionStorage, [entry], []);
      const stored = storedKeys();
      const storage = readFailure(key);

      await renderLoadedBoard();
      expect(banner()).toHaveTextContent("Nothing new was sent");
      expect(banner()).not.toHaveTextContent(/reload the page|close (the|this) tab/i);
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      // Still unreadable: another look changes nothing, sends nothing and does not read the board again.
      const boardCalls = mockedBoard.mock.calls.length;
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      expect(banner()).toBeInTheDocument();
      expect(mockedBoard.mock.calls.length).toBe(boardCalls);
      expect(storedKeys()).toEqual(stored);

      storage.recover();
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      const notice = await screen.findByTestId("uncertain-write-notice");
      expect(notice).toHaveTextContent(`room 102, [${from}, ${addDaysIso(from, 2)})`);
      expect(banner()).not.toBeInTheDocument();
      expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
      await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
      expect(postCount()).toBe(0);
      // Handed over: one record, no leftover intent — and one notice after a reload.
      await waitFor(() => expect(pendingCount()).toBe(0));
      expect(JSON.parse(sessionStorage.getItem(UNCERTAIN_KEY)!).assignments).toHaveLength(1);
      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(banner()).not.toBeInTheDocument();
    });

    it.each([
      ["intent record unreadable, unconfirmed record readable", PENDING_KEY],
      ["unconfirmed record unreadable, intent record readable", UNCERTAIN_KEY],
      ["both unreadable", "both"],
    ])("an assignment in one record and a block in the other, %s: what can be read is locked at once, nothing stored is lost, and every write comes back exactly once", async (_label, unreadable) => {
      const user = userEvent.setup();
      const { from, to } = await probeRange();
      // The assignment lives in the intent record, the block in the unconfirmed record — unless that record is the unreadable one.
      const assignment = assignmentEntry(from, to, "room-102", "102", 0, 2);
      const blockOnly = blockEntry(from, to, "room-201", "201", 0, 1);
      beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignment });
      persistUncertainWrites(sessionStorage, [], [blockOnly]);
      const stored = storedKeys();
      const storage = readFailure(...(unreadable === "both" ? [PENDING_KEY, UNCERTAIN_KEY] : [unreadable]));

      await renderLoadedBoard();
      expect(banner()).toBeInTheDocument();
      expect(screen.queryAllByTestId("uncertain-block-notice")).toHaveLength(unreadable === PENDING_KEY ? 1 : 0);
      expect(screen.queryAllByTestId("uncertain-write-notice")).toHaveLength(unreadable === UNCERTAIN_KEY ? 1 : 0);

      // Whatever else the board does meanwhile, it must not rewrite a record it could not read.
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await user.click(screen.getByRole("button", { name: "Previous date range" }));
      expect(storedKeys()).toEqual(stored);

      storage.recover();
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      await waitFor(() => expect(banner()).not.toBeInTheDocument());
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await waitFor(() => expect(pendingCount()).toBe(0));
      const record = JSON.parse(sessionStorage.getItem(UNCERTAIN_KEY)!);
      expect([record.assignments.length, record.blocks.length]).toEqual([1, 1]);

      await reloadSameTab();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      expect(postCount()).toBe(0);
    });

    it("verified empty after a failed read reopens writes: one deliberate confirm sends exactly one request, and nothing earlier is replayed", async () => {
      const user = userEvent.setup();
      const storage = readFailure(PENDING_KEY, UNCERTAIN_KEY);
      const { from } = await renderLoadedBoard();
      expect(banner()).toBeInTheDocument();

      storage.recover();
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      await waitFor(() => expect(banner()).not.toBeInTheDocument());
      expect(postCount()).toBe(0);
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      mockedCreate.mockResolvedValue({ kind: "created", segment: null });
      await user.click(firstRangeBar(from));
      await user.click(within(assignDialog()).getByLabelText(/Room 102/));
      await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
      await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
      expect(postCount()).toBe(1);
    });

    it("a lock that recovery brought in still holds when the re-read shows nothing new; unrelated rooms and nights stay usable and Check again only reads", async () => {
      const user = userEvent.setup();
      const { from, to } = await probeRange();
      beginPendingWrite(sessionStorage, { kind: "block", entry: blockEntry(from, to, "room-102", "102", 0, 1) });
      const storage = readFailure(PENDING_KEY);
      await renderLoadedBoard();
      storage.recover();
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      const notice = await screen.findByTestId("uncertain-block-notice");
      await waitFor(() => expect(notice).toHaveTextContent("no matching block is shown yet"));

      await expectBlockLocked(user, "room-102", from, addDaysIso(from, 1));
      await expectBlockAllowed(user, "room-102", addDaysIso(from, 1), addDaysIso(from, 2));
      await expectBlockAllowed(user, "room-201", from, addDaysIso(from, 1));
      const boardCalls = mockedBoard.mock.calls.length;
      await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
      expect(postCount()).toBe(0);
    });

    it("a page shown from the back/forward cache, and an ordinary board read, both retry the restoration — and neither restores a write twice", async () => {
      const user = userEvent.setup();
      const { from, to } = await probeRange();
      beginPendingWrite(sessionStorage, { kind: "assignment", entry: assignmentEntry(from, to, "room-102", "102", 0, 2) });
      beginPendingWrite(sessionStorage, { kind: "block", entry: blockEntry(from, to, "room-201", "201", 0, 1) });
      const storage = readFailure(PENDING_KEY);
      await renderLoadedBoard();
      expect(banner()).toBeInTheDocument();

      // An ordinary board read while it is still unreadable changes nothing.
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await user.click(screen.getByRole("button", { name: "Previous date range" }));
      expect(banner()).toBeInTheDocument();
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      storage.recover();
      await backForward();
      await backForward();
      expect(banner()).not.toBeInTheDocument();
      expect(screen.getAllByTestId("uncertain-write-notice")).toHaveLength(1);
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      await waitFor(() => expect(pendingCount()).toBe(0));
      expect(postCount()).toBe(0);
    });

    it("an ordinary board read alone is enough to retry once storage is readable", async () => {
      const user = userEvent.setup();
      const { from, to } = await probeRange();
      beginPendingWrite(sessionStorage, { kind: "block", entry: blockEntry(from, to, "room-201", "201", 0, 1) });
      const storage = readFailure(PENDING_KEY);
      await renderLoadedBoard();
      expect(banner()).toBeInTheDocument();

      storage.recover();
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await waitFor(() => expect(banner()).not.toBeInTheDocument());
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
      expect(postCount()).toBe(0);
    });

    it("a copy of the same write in both records is one warning, and a write of this page still on the wire is not doubled", async () => {
      const user = userEvent.setup();
      const { from, to } = await probeRange();
      const token = beginPendingWrite(sessionStorage, { kind: "block", entry: blockEntry(from, to, "room-201", "201", 0, 1) })!;
      persistUncertainWrites(sessionStorage, [], [{ ...blockEntry(from, to, "room-201", "201", 0, 1), intent: token }]);
      const storage = readFailure(UNCERTAIN_KEY);
      await renderLoadedBoard();
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);

      storage.recover();
      await user.click(within(banner()!).getByRole("button", { name: "Check storage again" }));
      await waitFor(() => expect(banner()).not.toBeInTheDocument());
      expect(screen.getAllByTestId("uncertain-block-notice")).toHaveLength(1);
    });
  });
});
