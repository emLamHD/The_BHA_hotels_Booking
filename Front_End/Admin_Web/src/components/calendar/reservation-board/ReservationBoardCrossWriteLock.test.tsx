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
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
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
}));

import {
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
  for (const mock of [mockedProperties, mockedBoard, mockedCreate, mockedMove, mockedUnassign, mockedBlock]) mock.mockReset();
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
