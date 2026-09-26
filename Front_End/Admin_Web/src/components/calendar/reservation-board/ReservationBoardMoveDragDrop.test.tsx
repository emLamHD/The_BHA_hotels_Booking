/**
 * PMS-CAL-001.4-CP01: dragging an assigned segment onto another room's row on
 * the real (server-backed) Reservation Board. The API client is mocked, so
 * these tests prove the UI's decisions; they do not replace a live HTTPS run.
 *
 * The rules under test:
 * - a drop only chooses the destination room and opens the existing Move room
 *   dialog for review; nothing is sent until Confirm;
 * - the request carries the segment's own full `[startDate, endDate)` and its
 *   version, never anything derived from the column under the pointer;
 * - every refused drop (same room, a room that is not Active, a row that is not
 *   a room, a stale or locked source, another board) opens nothing and writes
 *   nothing;
 * - the popover's Move room action keeps working as the keyboard/touch path.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// PMS-CAL-001.5-CP02: unconfirmed writes survive a reload in this tab; no test may inherit another's.
beforeEach(() => sessionStorage.clear());
import ReservationBoard from "./ReservationBoard";
import type { MoveAssignmentOutcome } from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse } from "@/lib/api/types";
import { addDaysIso } from "./dateMath";

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
  createOperationalBlock,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
} from "@/lib/api/client";

const mockedProperties = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedMove = vi.mocked(moveReservationAssignment);
const mockedCreateBlock = vi.mocked(createOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const propertyB: ApiProperty = { id: "prop-b", name: "Property B", timeZone: "Asia/Ho_Chi_Minh" };

const BAR_TITLE = "Nguyen Van A — CNF-100";
const SEGMENT_ID = "seg-1";
const VERSION = 2;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/**
 * Standard rooms 101/102 (Active) and 103 (OutOfService), Deluxe room 201.
 * One stay sold as Standard, assigned to room 101 over `[from-2, from+3)` — it
 * starts two nights BEFORE the visible window, so its bar is clipped at the
 * left edge and any use of the clipped range instead of the segment's own is
 * visible as a failure. Room 102 also carries an unrelated block later on.
 * `movedTo` serves the state the server reports after a committed move.
 */
function boardFor(propertyId: string, from: string, to: string, movedTo: string | null = null): ReservationBoardResponse {
  const isA = propertyId === "prop-a";
  return {
    property: {
      id: propertyId,
      name: isA ? "Property A" : "Property B",
      timeZone: "Asia/Ho_Chi_Minh",
      localToday: from,
      checkInTime: "14:00",
      checkOutTime: "12:00",
    },
    from,
    to,
    roomTypes: [
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
    ],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
      { id: "room-103", roomTypeId: "type-standard", roomNumber: "103", floor: 1, operationalStatus: "OutOfService" },
      { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
    ],
    stays: isA
      ? [
          {
            reservationId: "res-1",
            reservationUnitId: "unit-1",
            confirmationNumber: "CNF-100",
            guestDisplayName: "Nguyen Van A",
            soldRoomTypeId: "type-standard",
            checkIn: addDaysIso(from, -2),
            checkOut: addDaysIso(from, 3),
            coverageStatus: "FullyAssigned",
            assignments: [
              movedTo
                ? {
                    segmentId: "seg-2",
                    segmentVersion: 1,
                    physicalRoomId: movedTo,
                    actualRoomTypeId: movedTo === "room-201" ? "type-deluxe" : "type-standard",
                    startDate: addDaysIso(from, -2),
                    endDate: addDaysIso(from, 3),
                  }
                : {
                    segmentId: SEGMENT_ID,
                    segmentVersion: VERSION,
                    physicalRoomId: "room-101",
                    actualRoomTypeId: "type-standard",
                    startDate: addDaysIso(from, -2),
                    endDate: addDaysIso(from, 3),
                  },
            ],
            unassignedRanges: [],
          },
        ]
      : [],
    operationalBlocks: isA
      ? [
          {
            roomBlockId: "block-1",
            segmentId: "seg-block-1",
            segmentVersion: 1,
            physicalRoomId: "room-102",
            startDate: addDaysIso(from, 8),
            endDate: addDaysIso(from, 9),
            reason: "Paint",
          },
        ]
      : [],
  };
}

function serveBoards(movedTo: () => string | null = () => null) {
  mockedBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve({ ok: true, data: boardFor(propertyId, from, to, movedTo()) })
  );
}

async function renderLoadedBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(screen.getByTitle(BAR_TITLE)).toBeInTheDocument());
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { from, to };
}

const bar = () => screen.getByTitle(BAR_TITLE);
const moveDialog = () => screen.getByRole("dialog", { name: "Move room" });
const queryMoveDialog = () => screen.queryByRole("dialog", { name: "Move room" });
const feedback = () => screen.getByTestId("board-drag-feedback");

/** A room row's own date cells, in column order (the row label is excluded). */
function roomCells(roomId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`div[data-drop-room-id="${roomId}"]`)).filter(
    (element) => !element.classList.contains("sticky")
  );
}

/** A row label that carries no room — a RoomType header or an Unassigned lane. */
function nonRoomRowLabel(text: string): HTMLElement {
  return Array.from(document.querySelectorAll<HTMLElement>("div.sticky")).find(
    (element) => element.textContent === text && !element.dataset.dropRoomId
  )!;
}

function dataTransfer() {
  const data: Record<string, string> = {};
  return {
    dropEffect: "none",
    effectAllowed: "all",
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    getData: (type: string) => data[type] ?? "",
    types: [] as string[],
  };
}

/**
 * Starts a drag on the bar and moves it over `target`. Returns whether that
 * drag-over was accepted — `fireEvent` returns `false` exactly when the handler
 * called `preventDefault()`, which is what makes a browser allow the drop.
 */
function dragOnto(target: HTMLElement) {
  const transfer = dataTransfer();
  fireEvent.dragStart(bar(), { dataTransfer: transfer });
  const accepted = !fireEvent.dragOver(target, { dataTransfer: transfer });
  return { transfer, accepted };
}

/**
 * A complete drag with the event sequence a real browser produces: `drop` is
 * dispatched only when the last `dragover` was accepted (`preventDefault()`);
 * otherwise the browser goes straight to `dragend`.
 */
function dragAndDrop(target: HTMLElement) {
  const { transfer, accepted } = dragOnto(target);
  if (accepted) fireEvent.drop(target, { dataTransfer: transfer });
  fireEvent.dragEnd(bar(), { dataTransfer: transfer });
  return accepted;
}

const refusalNotice = () => screen.getByTestId("move-refusal-notice");
const STALE_TEXT =
  "The board changed after this move was opened. Nothing was sent; start the move again from the board on screen.";

beforeEach(() => {
  for (const mock of [mockedProperties, mockedBoard, mockedMove, mockedCreateBlock]) mock.mockReset();
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
  serveBoards();
});

describe("ReservationBoard — drag an assigned segment to another room (PMS-CAL-001.4-CP01)", () => {
  it("a drop anywhere on room 102's row opens Move room for review with 102 preselected; only Confirm sends one request with the segment's own full dates", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    let movedTo: string | null = null;
    serveBoards(() => movedTo);
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);

    // Dropped ten columns to the right of where the stay sits: the column is ignored.
    expect(dragAndDrop(roomCells("room-102")[10])).toBe(true);

    const dialog = moveDialog();
    expect(mockedMove).not.toHaveBeenCalled();
    // The whole segment, not the part the window shows (it starts two nights earlier).
    expect(dialog).toHaveTextContent(`[${addDaysIso(from, -2)}, ${addDaysIso(from, 3)}) · 5 nights`);
    const room102 = within(dialog).getByLabelText(/Room 102/);
    expect(room102).toBeChecked();
    expect(document.activeElement).toBe(room102);

    await user.click(within(dialog).getByRole("button", { name: "Move to room 102" }));
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(mockedMove).toHaveBeenCalledWith("prop-a", SEGMENT_ID, {
      expectedVersion: VERSION,
      physicalRoomId: "room-102",
      startDate: addDaysIso(from, -2),
      endDate: addDaysIso(from, 3),
      confirmCrossRoomType: false,
    });
    // Nothing moves on screen until the server is re-read.
    expect(roomCells("room-101").length).toBeGreaterThan(0);
    expect(bar()).toHaveAttribute("data-drop-room-id", "room-101");

    const boardCallsBefore = mockedBoard.mock.calls.length;
    movedTo = "room-102";
    await act(async () => move.resolve({ kind: "moved", segments: null }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    await waitFor(() => expect(bar()).toHaveAttribute("data-drop-room-id", "room-102"));
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("dropping onto another booking's bar in the destination row still targets that row's room", async () => {
    await renderLoadedBoard();
    // The block bar sits in room 102's row.
    expect(dragAndDrop(screen.getByTitle("Paint"))).toBe(true);
    expect(within(moveDialog()).getByLabelText(/Room 102/)).toBeChecked();
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("a drop on another RoomType's room still requires the dialog's confirmation and reason; preselecting is not confirming", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });

    dragAndDrop(roomCells("room-201")[0]);
    const dialog = moveDialog();
    expect(within(dialog).getByLabelText(/Room 201/)).toBeChecked();
    const confirmation = within(dialog).getByRole("checkbox");
    expect(confirmation).not.toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: /^Move to room 201/ }));
    expect(mockedMove).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Confirm this cross-room-type placement to continue.")).toBeInTheDocument();

    await user.click(confirmation);
    await user.type(within(dialog).getByRole("textbox"), "  Upgrade for VIP  ");
    await user.click(within(dialog).getByRole("button", { name: /^Move to room 201/ }));
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(mockedMove).toHaveBeenCalledWith("prop-a", SEGMENT_ID, {
      expectedVersion: VERSION,
      physicalRoomId: "room-201",
      startDate: addDaysIso(from, -2),
      endDate: addDaysIso(from, 3),
      confirmCrossRoomType: true,
      reason: "Upgrade for VIP",
    });
  });

  it.each([
    ["its own room", () => roomCells("room-101")[4], "This stay is already in room 101."],
    ["a room that is not Active", () => roomCells("room-103")[1], "Room 103 is not Active."],
    ["a RoomType header row", () => nonRoomRowLabel("Standard"), "Drop on a room's row to move this stay."],
    ["an Unassigned row", () => nonRoomRowLabel("Unassigned"), "Drop on a room's row to move this stay."],
  ])("refuses a release on %s: no preview, no dialog, no request, and the reason survives dragend", async (_label, target, reason) => {
    await renderLoadedBoard();
    const element = target();

    const { transfer, accepted } = dragOnto(element);
    expect(accepted).toBe(false);
    expect(feedback()).toHaveTextContent(reason);

    // A real browser dispatches no `drop` after a refused `dragover`: only `dragend`.
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(feedback()).toHaveTextContent(`Nothing was moved: ${reason}`);
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("an allowed room accepts dragenter as well as dragover, so a quick release right after entering the row still drops (PMS-CAL-001.5-CP01)", async () => {
    await renderLoadedBoard();
    const transfer = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: transfer });
    // Chrome makes an element the drop target from a cancelled dragenter; with
    // only dragover handled, a release before Chrome processes a dragover reply
    // is dropped silently (reproduced live: 1 drop in 5 quick drags).
    const accepted = !fireEvent.dragEnter(roomCells("room-102")[6], { dataTransfer: transfer });
    expect(accepted).toBe(true);
    expect(transfer.dropEffect).toBe("move");
    fireEvent.drop(roomCells("room-102")[6], { dataTransfer: transfer });
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(within(moveDialog()).getByLabelText(/Room 102/)).toBeChecked();
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it.each([
    ["its own room", () => roomCells("room-101")[4]],
    ["a room that is not Active", () => roomCells("room-103")[1]],
    ["an Unassigned row", () => nonRoomRowLabel("Unassigned")],
  ])("%s does not accept dragenter either", async (_label, target) => {
    await renderLoadedBoard();
    const transfer = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: transfer });
    expect(fireEvent.dragEnter(target(), { dataTransfer: transfer })).toBe(true);
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(queryMoveDialog()).not.toBeInTheDocument();
  });

  it("a drop event forced onto a refused target is still refused by the board (defence in depth)", async () => {
    await renderLoadedBoard();
    const element = roomCells("room-101")[4];
    const { transfer } = dragOnto(element);
    fireEvent.drop(element, { dataTransfer: transfer });
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(feedback()).toHaveTextContent("Nothing was moved: This stay is already in room 101.");
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("a new drag clears the previous refusal, and leaving the grid forgets the last refused target", async () => {
    await renderLoadedBoard();
    dragAndDrop(roomCells("room-103")[1]);
    expect(feedback()).toHaveTextContent("Nothing was moved: Room 103 is not Active.");

    const transfer = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: transfer });
    expect(feedback()).not.toHaveTextContent("Room 103");
    fireEvent.dragOver(roomCells("room-103")[1], { dataTransfer: transfer });
    const grid = roomCells("room-103")[1].parentElement!;
    fireEvent.dragLeave(grid, { dataTransfer: transfer, relatedTarget: document.body });
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(feedback()).toHaveTextContent("Nothing was moved.");
    expect(feedback()).not.toHaveTextContent("Room 103");
  });

  it("a drag whose dragend never arrived leaves no stale reason for the next one", async () => {
    await renderLoadedBoard();
    // If the dragged bar unmounts mid-drag (a reload supersedes its segment),
    // its dragend never reaches React. The next drag must still start clean.
    const lost = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: lost });
    fireEvent.dragOver(roomCells("room-103")[1], { dataTransfer: lost });

    const next = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: next });
    fireEvent.dragEnd(bar(), { dataTransfer: next });
    expect(feedback()).toHaveTextContent("Nothing was moved.");
    expect(feedback()).not.toHaveTextContent("Room 103");
  });

  it("the feedback line exists, with a fixed height, before any drag, so starting or updating a drag inserts nothing above the rows", async () => {
    await renderLoadedBoard();
    // jsdom performs no layout, so pixel positions cannot be measured here; what
    // is provable is that no element is inserted or removed above the grid and
    // that the line's height does not depend on its text.
    const line = feedback();
    const grid = roomCells("room-102")[0].parentElement!;
    const siblingsBefore = Array.from(grid.parentElement!.children);
    expect(line).toBeEmptyDOMElement();
    expect(line).toHaveClass("h-10", "overflow-hidden");

    const transfer = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: transfer });
    fireEvent.dragOver(nonRoomRowLabel("Unassigned"), { dataTransfer: transfer });
    fireEvent.dragOver(roomCells("room-102")[1], { dataTransfer: transfer });

    expect(feedback()).toBe(line);
    expect(Array.from(grid.parentElement!.children)).toEqual(siblingsBefore);
    expect(line).toHaveClass("h-10", "overflow-hidden");
    expect(line).toHaveTextContent("Release to review moving this stay to room 102.");
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
  });

  it("a drag released nowhere, or cancelled, changes nothing", async () => {
    await renderLoadedBoard();
    const transfer = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: transfer });
    expect(feedback()).toHaveTextContent("The stay dates will not change.");
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(feedback()).toHaveTextContent("Nothing was moved.");
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("closing the dialog opened by a drop sends nothing and returns focus to the dragged bar", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    dragAndDrop(roomCells("room-102")[2]);
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(bar());
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("the popover's Move room still works without dragging, and a bar is still clickable to open details", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    expect(bar()).toHaveAttribute("draggable", "true");

    await user.click(bar());
    const popover = screen.getByRole("dialog", { name: "Reservation details" });
    await user.click(within(popover).getByRole("button", { name: "Move room" }));
    // Nothing preselected: the operator chooses the room themselves.
    const dialog = moveDialog();
    expect(within(dialog).getByLabelText(/Room 102/)).not.toBeChecked();
    expect(within(dialog).queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(mockedMove).not.toHaveBeenCalled();
  });
});

describe("ReservationBoard — drag-to-move write safety (PMS-CAL-001.4-CP01)", () => {
  function switchToPropertyB() {
    const select = screen.getByLabelText("Property") as HTMLSelectElement;
    select.value = "prop-b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("a drag that crosses into a different board is refused over the new board, with the reason kept after dragend", async () => {
    await renderLoadedBoard();
    const transfer = dataTransfer();
    fireEvent.dragStart(bar(), { dataTransfer: transfer });
    // 7 days still shows this segment and room 102 — only the board identity changes.
    await act(async () => {
      screen.getByRole("button", { name: "7 days" }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(roomCells("room-102").length).toBe(7));
    expect(fireEvent.dragOver(roomCells("room-102")[3], { dataTransfer: transfer })).toBe(true);
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });

    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(feedback()).toHaveTextContent("Nothing was moved: The board changed during the drag.");
    expect(mockedMove).not.toHaveBeenCalled();
  });

  /** Changes only the visible range behind the still-open modal dialog. */
  async function nextRangeBehindDialog(from: string) {
    await act(async () => {
      screen.getByRole("button", { name: "Next date range" }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));
    expect(moveDialog()).toBeInTheDocument();
  }

  it("a dialog opened by a drop cannot send once the view has moved, and the refusal stays readable and focused on the board", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    dragAndDrop(roomCells("room-102")[1]);
    await nextRangeBehindDialog(from);

    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    expect(mockedMove).not.toHaveBeenCalled();
    // No dialog is left offering a Confirm for the old board's target.
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(refusalNotice()).toHaveTextContent(STALE_TEXT);
    expect(refusalNotice()).not.toHaveTextContent(/moved|saved/i);
    expect(document.activeElement).toBe(refusalNotice());

    await user.click(within(refusalNotice()).getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByTestId("move-refusal-notice")).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("the same refusal is shown for a Move room dialog opened from the popover", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await user.click(bar());
    await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Move room" }));
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await nextRangeBehindDialog(from);

    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    expect(mockedMove).not.toHaveBeenCalled();
    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(refusalNotice()).toHaveTextContent(STALE_TEXT);
    expect(document.activeElement).toBe(refusalNotice());
  });

  it("a Property switch before Confirm closes the dialog, says why, sends nothing, and leaves focus with the operator", async () => {
    await renderLoadedBoard();
    dragAndDrop(roomCells("room-102")[1]);
    const select = screen.getByLabelText("Property") as HTMLSelectElement;
    select.focus();
    await act(async () => switchToPropertyB());

    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(refusalNotice()).toHaveTextContent(STALE_TEXT);
    expect(document.activeElement).toBe(select);
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("while the board awaits a re-read after a write, a drag cannot start", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedMove.mockImplementation(async () => {
      mockedBoard.mockImplementation(() => reread.promise);
      return { kind: "rejected", status: 409, category: "conflict", detail: "Room is occupied." };
    });
    dragAndDrop(roomCells("room-102")[1]);
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await within(moveDialog()).findByRole("alert");
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    const transfer = dataTransfer();
    const started = fireEvent.dragStart(bar(), { dataTransfer: transfer });
    expect(started).toBe(false);
    expect(feedback()).toHaveTextContent("Waiting for the board to be re-read after a change.");
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("an unresolved write on the destination room's nights refuses the drop there, and leaves other rooms usable", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    // A block create on room 102 over the segment's first visible night, whose response is lost.
    mockedCreateBlock.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const create = within(screen.getByRole("dialog", { name: "Create operational block" }));
    await user.selectOptions(create.getByLabelText("Room"), "room-102");
    await user.type(create.getByLabelText("Reason"), "Leak");
    await user.click(create.getByRole("button", { name: "Review" }));
    await user.click(create.getByRole("button", { name: "Create block" }));
    await create.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
    await user.click(create.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(from).toBeTruthy();

    const { transfer, accepted } = dragOnto(roomCells("room-102")[5]);
    expect(accepted).toBe(false);
    fireEvent.dragEnd(bar(), { dataTransfer: transfer });
    expect(feedback()).toHaveTextContent(
      "Nothing was moved: An earlier change to room 102 on these nights is still unconfirmed."
    );
    expect(queryMoveDialog()).not.toBeInTheDocument();

    // Room 201 is untouched by that lock.
    expect(dragAndDrop(roomCells("room-201")[0])).toBe(true);
    expect(within(moveDialog()).getByLabelText(/Room 201/)).toBeChecked();
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it("on 409 the dialog reports the conflict and never resends", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict", detail: "Room is occupied." });
    const boardCallsBefore = mockedBoard.mock.calls.length;

    dragAndDrop(roomCells("room-102")[1]);
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    expect(await within(moveDialog()).findByRole("alert")).toHaveTextContent("Room is occupied.");
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(within(moveDialog()).queryByRole("button", { name: "Move to room 102" })).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("a lost response is never resent, and locks both the source and the destination room for those nights", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });

    dragAndDrop(roomCells("room-102")[1]);
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await within(moveDialog()).findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    // Source locked: the same segment can no longer be dragged.
    const started = fireEvent.dragStart(bar(), { dataTransfer: dataTransfer() });
    expect(started).toBe(false);
    expect(feedback()).toHaveTextContent("still unconfirmed");

    // Destination locked for the segment's nights, for every write type.
    mockedCreateBlock.mockResolvedValue({ kind: "created", block: null });
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const create = within(screen.getByRole("dialog", { name: "Create operational block" }));
    await user.selectOptions(create.getByLabelText("Room"), "room-102");
    fireEvent.change(create.getByLabelText("First blocked night"), { target: { value: from } });
    fireEvent.change(create.getByLabelText("End date (exclusive)"), { target: { value: addDaysIso(from, 1) } });
    await user.type(create.getByLabelText("Reason"), "Leak");
    await user.click(create.getByRole("button", { name: "Review" }));
    expect(create.getByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(mockedCreateBlock).not.toHaveBeenCalled();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });
});

describe("ReservationBoard — a Property switch after a move was sent (PMS-CAL-001.4-CP01-C2)", () => {
  /**
   * "Nothing was sent" may only be said when it is true. Once a request has
   * left the browser, a Property switch must keep — never overwrite — what the
   * server said, and a result that may have committed must not be presented in
   * a way that invites sending the move again.
   */
  const NOTHING_SENT = /Nothing was sent/;

  async function sendMove(user: ReturnType<typeof userEvent.setup>, outcome: MoveAssignmentOutcome) {
    mockedMove.mockResolvedValue(outcome);
    dragAndDrop(roomCells("room-102")[1]);
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    // The move dialog reports every result, success included, as role="alert".
    await within(moveDialog()).findByRole("alert");
    expect(mockedMove).toHaveBeenCalledTimes(1);
  }

  async function switchProperty(user: ReturnType<typeof userEvent.setup>, propertyId: string) {
    await user.selectOptions(screen.getByLabelText("Property"), propertyId);
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe(propertyId));
  }

  it("unknown: the dialog keeps saying the result is unknown, nothing claims it was unsent, nothing is resent, and the lock and read-only Check again remain", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    await sendMove(user, { kind: "unknown", reason: "timeout" });

    await switchProperty(user, "prop-b");

    const result = within(moveDialog()).getByRole("alert");
    expect(result).toHaveTextContent("may or may not");
    expect(screen.queryByText(NOTHING_SENT)).not.toBeInTheDocument();
    expect(screen.queryByTestId("move-refusal-notice")).not.toBeInTheDocument();
    // No way to confirm the old target again.
    expect(within(moveDialog()).queryByRole("button", { name: "Move to room 102" })).not.toBeInTheDocument();

    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    await switchProperty(user, "prop-a");
    const notice = await screen.findByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent(`room 102 for Nguyen Van A (CNF-100), [${addDaysIso(from, -2)}, ${addDaysIso(from, 3)})`);
    const boardCalls = mockedBoard.mock.calls.length;
    await user.click(within(notice).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCalls + 1));
    expect(mockedMove).toHaveBeenCalledTimes(1);
    // Still locked: this segment cannot be dragged into another move.
    expect(fireEvent.dragStart(bar(), { dataTransfer: dataTransfer() })).toBe(false);
  });

  it.each([
    ["409 conflict", { kind: "rejected", status: 409, category: "conflict", detail: "Room 102 is occupied." } as MoveAssignmentOutcome, "Room 102 is occupied."],
    ["403 not permitted", { kind: "rejected", status: 403, category: "not-permitted" } as MoveAssignmentOutcome, "not permitted"],
  ])("%s: the server's answer stays on screen after a Property switch, never replaced by an unsent claim", async (_label, outcome, text) => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    await sendMove(user, outcome);

    await switchProperty(user, "prop-b");

    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByText(NOTHING_SENT)).not.toBeInTheDocument();
    expect(screen.queryByTestId("move-refusal-notice")).not.toBeInTheDocument();
    expect(within(moveDialog()).queryByRole("button", { name: "Move to room 102" })).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("200 that arrived after a range change: the dialog keeps reporting the saved move, and no success lands on the new Property", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);
    dragAndDrop(roomCells("room-102")[1]);
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));
    await act(async () => move.resolve({ kind: "moved", segments: null }));
    expect(await within(moveDialog()).findByRole("alert")).toHaveTextContent("Room moved.");

    await switchProperty(user, "prop-b");

    expect(within(moveDialog()).getByRole("alert")).toHaveTextContent("Room moved.");
    expect(screen.queryByText(NOTHING_SENT)).not.toBeInTheDocument();
    expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("400: the dialog closes so the old target cannot be confirmed on the new board, and the notice says the server rejected it — not that nothing was sent", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    await sendMove(user, { kind: "rejected", status: 400, category: "validation", detail: "startDate is invalid." });

    await switchProperty(user, "prop-b");

    expect(queryMoveDialog()).not.toBeInTheDocument();
    const notice = screen.getByTestId("move-refusal-notice");
    expect(notice).toHaveTextContent("The server rejected the last move request, so nothing was changed.");
    expect(notice).not.toHaveTextContent(NOTHING_SENT);
    expect(document.activeElement).toBe(screen.getByLabelText("Property"));
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it.each([["the popover's Move room"], ["a new drop"]])(
    "a fresh dialog opened from %s after an earlier one got a 409 has sent nothing, so a Property switch closes it as unsent",
    async (via) => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      await sendMove(user, { kind: "rejected", status: 409, category: "conflict", detail: "Room 102 is occupied." });
      await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
      // Wait for the conflict's re-read, after which the segment may be moved again.
      await waitFor(() => expect(fireEvent.dragStart(bar(), { dataTransfer: dataTransfer() })).toBe(true));
      fireEvent.dragEnd(bar(), { dataTransfer: dataTransfer() });

      if (via === "a new drop") {
        dragAndDrop(roomCells("room-102")[1]);
      } else {
        await user.click(bar());
        await user.click(within(screen.getByRole("dialog", { name: "Reservation details" })).getByRole("button", { name: "Move room" }));
      }
      expect(within(moveDialog()).queryByRole("alert")).not.toBeInTheDocument();

      await switchProperty(user, "prop-b");

      expect(queryMoveDialog()).not.toBeInTheDocument();
      expect(screen.getByTestId("move-refusal-notice")).toHaveTextContent(STALE_TEXT);
      expect(mockedMove).toHaveBeenCalledTimes(1);
    }
  );

  it("not-sent: the dialog closes and saying nothing was sent is correct", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    await sendMove(user, { kind: "not-sent", message: "The Admin API address is not configured." });

    await switchProperty(user, "prop-b");

    expect(queryMoveDialog()).not.toBeInTheDocument();
    expect(screen.getByTestId("move-refusal-notice")).toHaveTextContent(STALE_TEXT);
    expect(document.activeElement).not.toBe(document.body);
  });
});
