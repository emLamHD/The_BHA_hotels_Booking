/**
 * PMS-CAL-001.2-CP03A: board-level behaviour of the same-RoomType assignment
 * flow — the dialog, the one create request, and the authoritative re-read.
 *
 * The API client is mocked here, so these tests prove the UI's decisions
 * (what is sent, when, how often, and what is shown); they do not replace the
 * browser acceptance run against the real HTTPS backend and PostgreSQL.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard, { todayInTimeZone } from "./ReservationBoard";
import { addDaysIso, buildVisibleRange, computeVisibleStartFromAnchor } from "./dateMath";
import type { AssignmentCreateOutcome } from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse, ReservationBoardStay } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createReservationAssignment: vi.fn(),
  moveReservationAssignment: vi.fn(),
}));

import {
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
} from "@/lib/api/client";
import type { MoveAssignmentOutcome } from "@/lib/api/client";

const mockedFetchActiveProperties = vi.mocked(fetchActiveProperties);
const mockedFetchReservationBoard = vi.mocked(fetchReservationBoard);
const mockedCreate = vi.mocked(createReservationAssignment);
const mockedMove = vi.mocked(moveReservationAssignment);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const propertyB: ApiProperty = { id: "prop-b", name: "Property B", timeZone: "Asia/Ho_Chi_Minh" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A stay that starts before and ends after the board window, with one assigned
 * stretch in the middle — so the board returns two window-clipped, partial
 * unassigned ranges for a single Unit.
 */
function stayFor(from: string, to: string, assignedFirstRange = false): ReservationBoardStay {
  const firstRange = { startDate: from, endDate: addDaysIso(from, 2) };
  const secondRange = { startDate: addDaysIso(from, 4), endDate: to };
  return {
    reservationId: "res-1",
    reservationUnitId: "unit-1",
    confirmationNumber: "CNF-100",
    guestDisplayName: "Nguyen Van A",
    soldRoomTypeId: "type-standard",
    checkIn: addDaysIso(from, -3),
    checkOut: addDaysIso(to, 5),
    coverageStatus: "PartiallyAssigned",
    assignments: [
      {
        segmentId: "seg-existing",
        segmentVersion: 1,
        physicalRoomId: "room-101",
        actualRoomTypeId: "type-standard",
        startDate: addDaysIso(from, 2),
        endDate: addDaysIso(from, 4),
      },
      ...(assignedFirstRange
        ? [
            {
              segmentId: "seg-new",
              segmentVersion: 1,
              physicalRoomId: "room-102",
              actualRoomTypeId: "type-standard",
              startDate: firstRange.startDate,
              endDate: firstRange.endDate,
            },
          ]
        : []),
    ],
    unassignedRanges: assignedFirstRange ? [secondRange] : [firstRange, secondRange],
  };
}

function boardFor(propertyId: string, from: string, to: string, assignedFirstRange = false): ReservationBoardResponse {
  return {
    property: {
      id: propertyId,
      name: propertyId === "prop-a" ? "Property A" : "Property B",
      timeZone: "Asia/Ho_Chi_Minh",
      localToday: from,
      checkInTime: "14:00",
      checkOutTime: "12:00",
    },
    from,
    to,
    roomTypes: [
      { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
      { id: "type-standard", code: "STD", name: "Standard", isActive: true },
    ],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
      { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
    ],
    stays: propertyId === "prop-a" ? [stayFor(from, to, assignedFirstRange)] : [],
    operationalBlocks: [],
  };
}

/** Renders the board and waits for the first load; returns the loaded window. */
async function renderLoadedBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(2));
  const [propertyId, from, to] = mockedFetchReservationBoard.mock.calls.at(-1)!;
  return { propertyId, from, to };
}

function firstRangeBar(from: string) {
  return screen.getByRole("button", {
    name: `Assign room: Nguyen Van A, CNF-100, unassigned ${from} to ${addDaysIso(from, 2)}`,
  });
}

function dialog() {
  return screen.getByRole("dialog", { name: "Assign room" });
}

beforeEach(() => {
  mockedFetchActiveProperties.mockReset();
  mockedFetchReservationBoard.mockReset();
  mockedCreate.mockReset();
  mockedMove.mockReset();
  mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
  mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) })
  );
});

describe("ReservationBoard — same-RoomType assignment (PMS-CAL-001.2-CP03A)", () => {
  it("opens the dialog for exactly the clicked partial range and offers same-RoomType rooms first, then cross-RoomType rooms", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();

    await user.click(
      screen.getByRole("button", {
        name: `Assign room: Nguyen Van A, CNF-100, unassigned ${addDaysIso(from, 4)} to ${to}`,
      })
    );

    const view = within(dialog());
    expect(view.getByText("CNF-100")).toBeInTheDocument();
    expect(view.getByText("unit-1")).toBeInTheDocument();
    expect(view.getByText("Standard")).toBeInTheDocument();
    expect(view.getByText(new RegExp(`^\\[${addDaysIso(from, 4)}, ${to}\\)`))).toBeInTheDocument();
    expect(view.getByText(/Partial assignment/)).toBeInTheDocument();
    // PMS-CAL-001.2-CP03B: same sold RoomType first (untagged), then every
    // other Active RoomType's rooms, each tagged with its own RoomType name —
    // never with the sold RoomType.
    expect(view.getAllByRole("radio").map((radio) => radio.closest("label")!.textContent)).toEqual([
      "Room 101Floor 1",
      "Room 102Floor 1",
      "Room 201DeluxeFloor 2",
    ]);
    expect(view.getByText("Deluxe")).toBeInTheDocument();
    // The cross-RoomType confirmation panel is not shown until a cross-type room is actually selected.
    expect(view.queryByLabelText(/deliberately chosen a room of a different room type/)).not.toBeInTheDocument();
    // Selecting a range opens assignment, not the read-only popover.
    expect(screen.queryByRole("dialog", { name: "Reservation details" })).not.toBeInTheDocument();
  });

  it("sends one create with the server range verbatim, then re-reads the board; the new bar comes only from that re-read", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;

    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo, true) })
    );
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith("prop-a", {
      reservationUnitId: "unit-1",
      physicalRoomId: "room-102",
      startDate: from,
      endDate: addDaysIso(from, 2),
      confirmCrossRoomType: false,
    });

    await waitFor(() => expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument());
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(mockedFetchReservationBoard.mock.calls.at(-1)).toEqual(["prop-a", from, to, expect.any(AbortSignal)]);
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
    expect(
      screen.getByText(`Room 102 assigned to Nguyen Van A (CNF-100) for [${from}, ${addDaysIso(from, 2)}).`)
    ).toBeInTheDocument();
    expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(1);
    expect(screen.getAllByTitle("Nguyen Van A — CNF-100")).toHaveLength(2);
    expect(document.activeElement?.textContent).toContain("Room 102 assigned");
  });

  it("never paints an assignment locally: if the re-read board has not changed, nothing new is drawn", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));

    await waitFor(() => expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument());
    expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(2);
    expect(screen.getAllByTitle("Nguyen Van A — CNF-100")).toHaveLength(1);
  });

  it("keeps the current board on screen while the post-write re-read is in flight, instead of the loading state", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation(() => reread.promise);
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    await waitFor(() => expect(screen.getByText("Refreshing board from the server…")).toBeInTheDocument());
    expect(screen.getByText("Saved on the server. Reloading the board…")).toBeInTheDocument();
    expect(screen.queryByText("Loading Reservation Board…")).not.toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();

    const [propertyId, requestFrom, requestTo] = mockedFetchReservationBoard.mock.calls.at(-1)!;
    await act(async () => reread.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo, true) }));
    await waitFor(() => expect(screen.queryByText("Refreshing board from the server…")).not.toBeInTheDocument());
    expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument();
  });

  it("starts only one request for a double click, repeated Enter, or several submits in the same tick", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const create = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => create.promise);

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    const submit = within(dialog()).getByRole("button", { name: "Assign room 102" });
    const form = submit.closest("form")!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.dblClick(submit);
    submit.focus();
    await user.keyboard("{Enter}{Enter}{Enter}");

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Assigning…" })).toHaveAttribute("aria-disabled", "true");
    expect(dialog().querySelector("form")).toHaveAttribute("aria-busy", "true");

    await act(async () => create.resolve({ kind: "created", segment: null }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument());
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("cannot be closed while the request is in flight — closing would not cancel the server write", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const create = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => create.promise);

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));

    await user.keyboard("{Escape}");
    for (const closeButton of within(dialog()).getAllByRole("button", { name: "Close" })) {
      await user.click(closeButton);
    }
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByText(/stays open until the server responds/)).toBeInTheDocument();

    await act(async () =>
      create.resolve({ kind: "rejected", status: 409, category: "conflict", detail: "overlap" })
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
  });

  it("on 409, explains the change, re-reads the board, never re-sends, and removes Confirm", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreate.mockResolvedValue({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The destination PhysicalRoom already has an overlapping Effective schedule entry for one or more of these dates.",
    });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not saved: the schedule has changed or the room is no longer suitable/);
    expect(alert).toHaveTextContent(/already has an overlapping Effective schedule entry/);
    await waitFor(() => expect(alert).toHaveTextContent("The board has been reloaded from the server."));
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(alert);
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.submit(dialog().querySelector("form")!);
    });
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("on a network failure or timeout, says the result is unconfirmed, re-reads the board, and does not retry", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "timeout" });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/could not be confirmed — the assignment may or may not have been saved/);
    expect(alert).toHaveTextContent(/did not respond in time/);
    expect(alert).not.toHaveTextContent(/cancel/i);
    // CP03A-C2: an unchanged re-read after a lost response is not evidence either way.
    await waitFor(() =>
      expect(alert).toHaveTextContent("The board was checked, but no matching assignment is shown yet. The result is still unknown")
    );
    expect(alert).not.toHaveTextContent("The board has been reloaded from the server.");
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/assigned to Nguyen Van A/)).not.toBeInTheDocument();
  });

  it("reports when the post-write re-read itself fails, without claiming the board is current", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedFetchReservationBoard.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "Could not reach the Admin API." },
    });
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "network" });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    const alert = await within(dialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The board could not be reloaded."));
    expect(alert).not.toHaveTextContent("The board has been reloaded from the server.");
  });

  it("when the write gate is closed (empty 404), says writes are unavailable, changes nothing, and does not re-read", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreate.mockResolvedValue({ kind: "rejected", status: 404, category: "not-permitted" });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not available or not permitted/);
    expect(alert).toHaveTextContent(/does not mean the booking was removed/);
    expect(alert).not.toHaveTextContent(/deleted|does not exist/i);
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore);
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    await user.click(within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(2);
  });

  it("on 400, shows the server's validation message and lets the operator choose again", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate
      .mockResolvedValueOnce({
        kind: "rejected",
        status: 400,
        category: "validation",
        detail: "startDate must be earlier than endDate.",
      })
      .mockResolvedValueOnce({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("startDate must be earlier than endDate.");

    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument());
    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(mockedCreate.mock.calls[1][1].physicalRoomId).toBe("room-102");
  });

  it("requires a room to be chosen and sends nothing without one", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room" }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Select a room to assign.");
    const group = within(dialog()).getByRole("radiogroup", { name: "Target room" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription("Select a room to assign.");
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("is fully keyboard operable: focus moves in, Tab stays inside, Escape closes and returns focus to the bar", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    const bar = firstRangeBar(from);
    bar.focus();
    await user.keyboard("{Enter}");

    const radios = within(dialog()).getAllByRole("radio");
    expect(document.activeElement).toBe(radios[0]);

    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog().contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(bar);
    expect(mockedCreate).not.toHaveBeenCalled();

    // And the whole flow by keyboard alone.
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(within(dialog()).getAllByRole("radio")[0]).toBeChecked();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toHaveTextContent("Assign room 101");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument());
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("explains, and offers no Confirm, when this Property has no Active room of any RoomType", async () => {
    const user = userEvent.setup();
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      return Promise.resolve({ ok: true, data: { ...board, physicalRooms: [] } });
    });
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));

    expect(within(dialog()).getByText("No active room is available on this Property to assign.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
  });

  it("PMS-CAL-001.2-CP03B: still offers cross-RoomType rooms, with no same-RoomType subheading, when the sold RoomType itself has no Active room", async () => {
    const user = userEvent.setup();
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) => {
      const board = boardFor(propertyId, from, to);
      return Promise.resolve({
        ok: true,
        data: { ...board, physicalRooms: board.physicalRooms.filter((room) => room.roomTypeId !== "type-standard") },
      });
    });
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));

    const view = within(dialog());
    expect(view.queryByText("No active room is available on this Property to assign.")).not.toBeInTheDocument();
    expect(view.queryByText(/\(sold room type\)/)).not.toBeInTheDocument();
    expect(view.getByText(/Other room types/)).toBeInTheDocument();
    expect(view.getAllByRole("radio").map((radio) => radio.closest("label")!.textContent)).toEqual([
      "Room 201DeluxeFloor 2",
    ]);
    expect(view.getByRole("button", { name: "Assign room" })).toBeInTheDocument();
  });

  it("clears the success notice when the Property changes, so it never describes another Property's board", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(screen.getByText(/Room 102 assigned to Nguyen Van A/)).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    expect(screen.queryByText(/Room 102 assigned to Nguyen Van A/)).not.toBeInTheDocument();
  });
});

describe("PMS-CAL-001.2-CP03A-C1 corrections", () => {
  const created: AssignmentCreateOutcome = { kind: "created", segment: null };

  function secondRangeBar(from: string, to: string) {
    return screen.getByRole("button", {
      name: `Assign room: Nguyen Van A, CNF-100, unassigned ${addDaysIso(from, 4)} to ${to}`,
    });
  }

  async function assignFirstRangeToRoom102(from: string) {
    const user = userEvent.setup();
    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));
    return user;
  }

  // ---- Finding 1: stale unassigned bars during the authoritative re-read ----

  it("blocks stale unassigned bars by click and keyboard while the post-write re-read runs, then re-enables them", async () => {
    const { from, to } = await renderLoadedBoard();
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation(() => reread.promise);
    mockedCreate.mockResolvedValue(created);

    const user = await assignFirstRangeToRoom102(from);
    await waitFor(() => expect(screen.getByText("Refreshing board from the server…")).toBeInTheDocument());

    const staleSecond = secondRangeBar(from, to);
    const staleFirst = firstRangeBar(from);
    for (const bar of [staleFirst, staleSecond]) {
      expect(bar).toHaveAttribute("aria-disabled", "true");
      expect(bar).toHaveAccessibleDescription(/assignment is unavailable until the latest board has loaded/);
    }

    await user.click(staleFirst);
    await user.click(staleSecond);
    staleSecond.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    const [propertyId, requestFrom, requestTo] = mockedFetchReservationBoard.mock.calls.at(-1)!;
    await act(async () => reread.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo, true) }));
    await waitFor(() => expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument());

    const freshSecond = secondRangeBar(from, to);
    expect(freshSecond).not.toHaveAttribute("aria-disabled");
    freshSecond.focus();
    await user.keyboard("{Enter}");
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByText(new RegExp(`^\\[${addDaysIso(from, 4)}, ${to}\\)`))).toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale bar activated in the same tick the write resolves, before React has re-rendered the board", async () => {
    const { from, to } = await renderLoadedBoard();
    const create = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => create.promise);
    mockedFetchReservationBoard.mockImplementation(() => new Promise(() => {}));

    await assignFirstRangeToRoom102(from);
    const staleSecond = secondRangeBar(from, to);
    expect(staleSecond).not.toHaveAttribute("aria-disabled");

    await act(async () => {
      create.resolve(created);
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      // Still the pre-write render: only a synchronous guard can refuse this.
      fireEvent.click(staleSecond);
    });

    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  // ---- Finding 2: reconciliation is scoped to the written board's identity ----

  it("never reports the written board as reloaded when the date range changes mid re-read, and drops its late response", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const nextFrom = to;
    const staleReread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      requestFrom === from
        ? staleReread.promise
        : Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo) })
    );
    mockedCreate.mockResolvedValue(created);

    await assignFirstRangeToRoom102(from);
    await waitFor(() => expect(screen.getByText("Saved on the server. Reloading the board…")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(firstRangeBar(nextFrom)).toBeInTheDocument());

    const notice = screen.getByText(/Room 102 assigned to Nguyen Van A/).closest("[role=status]")!;
    expect(notice).toHaveTextContent(`board for [${from}, ${to}) has not been reloaded since the view changed`);
    expect(notice).not.toHaveTextContent("The board has been reloaded from the server");
    expect(firstRangeBar(nextFrom)).not.toHaveAttribute("aria-disabled");

    // The abandoned read of the written board finally answers: it must neither
    // replace the board now on screen nor confirm anything.
    await act(async () => staleReread.resolve({ ok: true, data: boardFor("prop-a", from, to, true) }));
    expect(firstRangeBar(nextFrom)).toBeInTheDocument();
    expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(2);
    expect(notice).toHaveTextContent("has not been reloaded since the view changed");

    // Only a fresh read of the written board itself confirms it.
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await waitFor(() => expect(notice).toHaveTextContent("The board has been reloaded from the server"));
    expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(1);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("clears the notice on a Property change mid re-read and never lets the old Property's response overwrite the new board", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const staleReread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      propertyId === "prop-a"
        ? staleReread.promise
        : Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo) })
    );
    mockedCreate.mockResolvedValue(created);

    await assignFirstRangeToRoom102(from);
    await waitFor(() => expect(screen.getByText(/Room 102 assigned to Nguyen Van A/)).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    await waitFor(() => expect(screen.getByText("101")).toBeInTheDocument());
    expect(screen.queryByText(/Room 102 assigned to Nguyen Van A/)).not.toBeInTheDocument();

    await act(async () => staleReread.resolve({ ok: true, data: boardFor("prop-a", from, to, true) }));
    expect(screen.queryByTitle(/Nguyen Van A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/has been reloaded from the server/)).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  // ---- Finding 3 (CP03A-C1): the toolbar states the actual capability.
  // PMS-CAL-001.2-CP03B: the capability itself grew (cross-RoomType assignment
  // with confirmation/reason is now offered), so the banner is updated to say
  // so — the invariant this test protects is accuracy, not a fixed wording.
  // PMS-CAL-001.2-CP04C.5-C1: the capability grew again (same-sold-RoomType
  // move is now a real write); this test now also pins the negative claims —
  // cross-RoomType move is not offered, and the local write opt-in is never
  // described as authentication or a permission grant — so either direction
  // of drift (claiming too little or too much) fails it.
  // PMS-CAL-001.2-CP04C.6B: the capability grew again (a move may now also
  // target a cross-RoomType destination, with confirmation and a reason),
  // so the banner's negative claim flips — it must now say cross-RoomType
  // move *is* offered, and must no longer list it among the read-only items.
  // PMS-CAL-001.3-CP03: unassign and operational-block create are live, so
  // neither may be listed as read-only; block cancel still is.

  it("describes exactly what the board can write, without claiming everything is read-only or promising unbuilt capability", async () => {
    await renderLoadedBoard();
    const capabilities = screen.getByTestId("reservation-board-capabilities");

    expect(capabilities).toHaveTextContent(
      "Unassigned nights can be assigned to an Active room, of the same sold room type or, with confirmation and a reason, a different one."
    );
    expect(capabilities).toHaveTextContent(
      "An assigned segment can be moved to another Active room, of the same sold room type or, with confirmation and a reason, a different one."
    );
    expect(capabilities).toHaveTextContent("It can also be unassigned.");
    expect(capabilities).toHaveTextContent("An Active room can be blocked for a range of nights with a reason.");
    expect(capabilities).toHaveTextContent("Cancelling blocks and other lifecycle actions are read-only.");
    expect(capabilities).not.toHaveTextContent(/unassign.{0,40}read-only/i);
    expect(capabilities).not.toHaveTextContent(/operational blocks.{0,40}read-only/i);
    expect(capabilities).toHaveTextContent("local Development write opt-in");
    expect(capabilities).toHaveTextContent("no production sign-in or permissions yet");
    expect(capabilities).not.toHaveTextContent(/no assignment/i);
    // Never claims every move is read-only (stale as of this checkpoint)...
    expect(capabilities).not.toHaveTextContent("Move, unassign, blocks and lifecycle actions are read-only.");
    // ...and never claims cross-RoomType move is still read-only (stale as of CP04C.6B).
    expect(capabilities).not.toHaveTextContent(/cross-roomtype move.{0,40}read-only/i);
    // The local write opt-in is an environment flag, never authentication/RBAC/permissions granted to the operator.
    expect(capabilities).not.toHaveTextContent(/authenticat|\bRBAC\b|signed in|logged in/i);
  });
});

describe("PMS-CAL-001.2-CP03A-C2 — a create whose response was lost", () => {
  const lost: AssignmentCreateOutcome = { kind: "unknown", reason: "timeout" };

  function secondRange(from: string, to: string) {
    return screen.getByRole("button", {
      name: `Assign room: Nguyen Van A, CNF-100, unassigned ${addDaysIso(from, 4)} to ${to}`,
    });
  }

  function notice() {
    return screen.getByTestId("uncertain-write-notice");
  }

  /** The board after some other writer covered the first range with room 101 (not the lost request's room 102). */
  function boardCoveredByOtherRoom(propertyId: string, from: string, to: string) {
    const b = boardFor(propertyId, from, to, true);
    const stay = b.stays[0];
    stay.assignments = stay.assignments.map((a) => (a.segmentId === "seg-new" ? { ...a, physicalRoomId: "room-101" } : a));
    return b;
  }

  /** Sends one create for the first range to room 102 that loses its response, then closes the dialog. */
  async function loseCreateForFirstRange(from: string) {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(lost);
    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));
    const alert = await within(dialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The board was checked, but no matching assignment is shown yet"));
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    return user;
  }

  it("1. keeps the write unresolved and its nights locked after an immediate unchanged re-read, without claiming completion or re-sending", async () => {
    const { from, to } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    const user = await loseCreateForFirstRange(from);

    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(notice()).toHaveTextContent("Unconfirmed request: room 102 for Nguyen Van A (CNF-100)");
    expect(notice()).toHaveTextContent("no matching assignment is shown yet, so the result is still unknown");
    expect(notice()).not.toHaveTextContent(/reloaded from the server|assigned to/);
    expect(screen.queryByText("Refreshing board from the server…")).not.toBeInTheDocument();

    const locked = firstRangeBar(from);
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveAccessibleDescription(/unconfirmed result/);
    await user.click(locked);
    locked.focus();
    await user.keyboard("{Enter} ");
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();

    // Only the uncertain nights are locked; the Unit's other range stays actionable.
    expect(secondRange(from, to)).not.toHaveAttribute("aria-disabled");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("2. stays unresolved across repeated Check again reads that still lack the assignment — request order alone never resolves it", async () => {
    const { from } = await renderLoadedBoard();
    const user = await loseCreateForFirstRange(from);
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;

    for (let check = 1; check <= 3; check += 1) {
      await user.click(within(notice()).getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + check));
      await waitFor(() => expect(notice()).toHaveTextContent("no matching assignment is shown yet"));
    }

    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
    expect(within(notice()).queryByRole("button", { name: "Dismiss notice" })).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("3. resolves from authoritative data when a later read shows the intended assignment, with no optimistic insertion before it", async () => {
    const { from } = await renderLoadedBoard();
    const user = await loseCreateForFirstRange(from);

    // Before the server shows it, nothing was painted locally.
    expect(screen.getAllByTitle("Nguyen Van A — CNF-100")).toHaveLength(1);

    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo, true) })
    );
    await user.click(within(notice()).getByRole("button", { name: "Check again" }));

    await waitFor(() =>
      expect(notice()).toHaveTextContent(
        `An assignment matching this request — room 102 for [${from}, ${addDaysIso(from, 2)}) — is now shown on the server.`
      )
    );
    // Observed on the server — never worded as though the lost response had succeeded.
    expect(notice()).not.toHaveTextContent(/Room 102 assigned to|Saved on the server/);
    expect(screen.getAllByTitle("Nguyen Van A — CNF-100")).toHaveLength(2);
    expect(screen.getAllByTitle("Nguyen Van A — unassigned — CNF-100")).toHaveLength(1);
    expect(within(notice()).getByRole("button", { name: "Dismiss notice" })).toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("4. resolves as changed — without attributing a result — when the nights are covered by something else, and offers no duplicate create", async () => {
    const { from } = await renderLoadedBoard();
    const user = await loseCreateForFirstRange(from);

    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({ ok: true, data: boardCoveredByOtherRoom(propertyId, requestFrom, requestTo) })
    );
    await user.click(within(notice()).getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(notice()).toHaveTextContent("These nights have since changed on the server"));
    expect(notice()).toHaveTextContent("Its own result was never confirmed.");
    expect(notice()).not.toHaveTextContent(/matching this request|assigned to/);
    expect(
      screen.queryByRole("button", { name: `Assign room: Nguyen Van A, CNF-100, unassigned ${from} to ${addDaysIso(from, 2)}` })
    ).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("5a. a date-range switch and return never make the unresolved range actionable", async () => {
    const { from, to } = await renderLoadedBoard();
    const user = await loseCreateForFirstRange(from);

    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(firstRangeBar(to)).toBeInTheDocument());
    expect(notice()).toHaveTextContent(`Open a view of this Property that includes [${from}, ${addDaysIso(from, 2)}) to check again`);
    expect(within(notice()).queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await waitFor(() => expect(firstRangeBar(from)).toBeInTheDocument());
    await waitFor(() => expect(notice()).toHaveTextContent("no matching assignment is shown yet"));
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("5b. a Property switch neither resolves the write nor unlocks its nights when returning", async () => {
    const { from } = await renderLoadedBoard();
    const user = await loseCreateForFirstRange(from);

    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    await waitFor(() => expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Property"), "prop-a");
    await waitFor(() => expect(firstRangeBar(from)).toBeInTheDocument());
    await waitFor(() => expect(notice()).toHaveTextContent("no matching assignment is shown yet"));
    expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("5c. a failed read and a superseded, late read carrying the assignment never resolve the write", async () => {
    const { from, to } = await renderLoadedBoard();
    const user = await loseCreateForFirstRange(from);

    // A failed check: nothing resolves, and the board says so.
    mockedFetchReservationBoard.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network", message: "Could not reach the Admin API." },
    });
    await user.click(within(notice()).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(notice()).toHaveTextContent("The board could not be reloaded, so the result is still unknown"));

    // Retry succeeds, but its answer is held back; the operator navigates away,
    // and only then does that stale answer arrive — showing the assignment.
    const late = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      requestFrom === from ? late.promise : Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo) })
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(firstRangeBar(to)).toBeInTheDocument());
    await act(async () => late.resolve({ ok: true, data: boardFor("prop-a", from, to, true) }));

    expect(notice()).not.toHaveTextContent("is now shown on the server");
    expect(firstRangeBar(to)).toBeInTheDocument();

    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo) })
    );
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await waitFor(() => expect(firstRangeBar(from)).toHaveAttribute("aria-disabled", "true"));
    expect(notice()).toHaveTextContent("no matching assignment is shown yet");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("6. 201 and 409 still settle on their first re-read and leave no unconfirmed-request notice", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();

    mockedCreate.mockResolvedValueOnce({ kind: "rejected", status: 409, category: "conflict", detail: "overlap" });
    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));
    const alert = await within(dialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The board has been reloaded from the server."));
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(firstRangeBar(from)).not.toHaveAttribute("aria-disabled");

    mockedCreate.mockResolvedValueOnce({ kind: "created", segment: null });
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo, true) })
    );
    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument());
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(secondRange(from, to)).not.toHaveAttribute("aria-disabled");
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });
});

describe("ReservationBoard — controlled cross-RoomType assignment (PMS-CAL-001.2-CP03B)", () => {
  function crossTypeRadio() {
    return within(dialog()).getByLabelText(/Room 201/);
  }
  function confirmCheckbox() {
    return within(dialog()).getByLabelText(/deliberately chosen a room of a different room type/);
  }
  function reasonField() {
    return within(dialog()).getByLabelText("Reason");
  }
  function submitButton(label = "Assign room 201") {
    return within(dialog()).getByRole("button", { name: label });
  }
  it("1. does not regress same-RoomType assignment: still sends confirmCrossRoomType:false with no reason field", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 101" }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const [, request] = mockedCreate.mock.calls[0];
    expect(request.confirmCrossRoomType).toBe(false);
    expect("reason" in request).toBe(false);
  });

  it("2. selecting a cross-RoomType room and submitting without touching confirmation or reason sends no request", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(submitButton());

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(within(dialog()).getByText("Confirm this cross-room-type placement to continue.")).toBeInTheDocument();
    expect(confirmCheckbox()).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(confirmCheckbox());
  });

  it("3. confirmed but the reason is empty or whitespace-only: sends no request", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "   ");
    await user.click(submitButton());

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(within(dialog()).getByText("Enter a reason for this cross-room-type placement.")).toBeInTheDocument();
    expect(reasonField()).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(reasonField());
    // The confirmation itself was valid — only the reason is flagged.
    expect(confirmCheckbox()).not.toHaveAttribute("aria-invalid");
  });

  it("4. a reason is entered but confirmation is not checked: sends no request", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.type(reasonField(), "Guest requested a specific view; only a Deluxe was available.");
    await user.click(submitButton());

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(within(dialog()).getByText("Confirm this cross-room-type placement to continue.")).toBeInTheDocument();
    expect(document.activeElement).toBe(confirmCheckbox());
  });

  it("5. selecting a different target room clears a previously entered confirmation and reason — never reused", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "First reason, for room 201.");
    expect(confirmCheckbox()).toBeChecked();

    // Switch to a same-RoomType room: the cross-RoomType panel disappears entirely.
    await user.click(within(dialog()).getByLabelText(/Room 101/));
    expect(within(dialog()).queryByLabelText(/deliberately chosen a room of a different room type/)).not.toBeInTheDocument();

    // Switch back to the cross-RoomType room: the panel reappears, but empty — nothing carried over.
    await user.click(crossTypeRadio());
    expect(confirmCheckbox()).not.toBeChecked();
    expect(reasonField()).toHaveValue("");

    // Submitting now without re-confirming is still blocked — proof the old state is truly gone, not just hidden.
    await user.click(submitButton());
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("6. a valid cross-RoomType submission sends exactly the six contract fields (no actor/evidence), gets 201, and reloads the board", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "  Guest requested a Deluxe; only room 201 was available.  ");
    await user.click(submitButton());

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const [propertyId, request] = mockedCreate.mock.calls[0];
    expect(propertyId).toBe("prop-a");
    expect(Object.keys(request).sort()).toEqual(
      ["confirmCrossRoomType", "endDate", "physicalRoomId", "reason", "reservationUnitId", "startDate"].sort()
    );
    expect(request).toMatchObject({
      reservationUnitId: "unit-1",
      physicalRoomId: "room-201",
      startDate: from,
      endDate: addDaysIso(from, 2),
      confirmCrossRoomType: true,
      // Sent already-trimmed — the dialog trims before calling onSubmit.
      reason: "Guest requested a Deluxe; only room 201 was available.",
    });
    expect("actorReference" in request).toBe(false);
    expect("authorizationEvidence" in request).toBe(false);

    await waitFor(() => expect(screen.getByText(/Room 201 \(Deluxe\) assigned to Nguyen Van A/)).toBeInTheDocument());
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
  });

  it("7. a cross-RoomType capacity/room conflict (409) is not saved, reloads the board, and removes Confirm", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreate.mockResolvedValue({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The destination PhysicalRoom already has an overlapping Effective schedule entry for one or more of these dates.",
    });

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "Only Deluxe available for this arrival.");
    await user.click(submitButton());

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not saved: the schedule has changed or the room is no longer suitable/);
    await waitFor(() => expect(alert).toHaveTextContent("The board has been reloaded from the server."));
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("8. the server's own 403 (a contract mismatch the dialog itself should already prevent) is shown as unconfirmed, never as a deleted booking, and allows resubmit", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate
      .mockResolvedValueOnce({
        kind: "rejected",
        status: 403,
        category: "cross-room-type-confirmation-required",
        detail: "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.",
      })
      .mockResolvedValueOnce({ kind: "created", segment: null });

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "Only Deluxe available.");
    await user.click(submitButton());

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not confirmed/);
    expect(alert).toHaveTextContent(/Nothing was saved/);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/deleted|does not exist|no longer exists/);

    // Resubmit is offered — nothing was written — and it sends a real second attempt.
    await user.click(submitButton());
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(2));
  });

  it("9. write opt-in disabled: a cross-RoomType submission mutates nothing and shows the same not-permitted message as same-RoomType", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreate.mockResolvedValue({ kind: "rejected", status: 404, category: "not-permitted" });

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "Only Deluxe available.");
    await user.click(submitButton());

    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not available or not permitted/);
    expect(alert).toHaveTextContent(/does not mean the booking was removed/);
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("10. double-click and repeated Enter on a valid cross-RoomType submission still start exactly one request", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const create = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockImplementation(() => create.promise);

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "Only Deluxe available.");
    const submit = submitButton();
    const form = submit.closest("form")!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.dblClick(submit);
    submit.focus();
    await user.keyboard("{Enter}{Enter}{Enter}");

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Assigning…" })).toHaveAttribute("aria-disabled", "true");

    await act(async () => create.resolve({ kind: "created", segment: null }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument());
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("11. an unconfirmed (lost-response) cross-RoomType create stays unresolved and locked until the server's data resolves it", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "timeout" });

    await user.click(firstRangeBar(from));
    await user.click(crossTypeRadio());
    await user.click(confirmCheckbox());
    await user.type(reasonField(), "Only Deluxe available.");
    await user.click(submitButton());

    const alert = await within(dialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The board was checked, but no matching assignment is shown yet"));
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    const lockedBar = firstRangeBar(from);
    expect(lockedBar).toHaveAttribute("aria-disabled", "true");
    expect(lockedBar).toHaveAccessibleDescription(/unconfirmed result/);
    // The Unit's other, non-overlapping range is unaffected.
    expect(
      screen.getByRole("button", { name: `Assign room: Nguyen Van A, CNF-100, unassigned ${addDaysIso(from, 4)} to ${to}` })
    ).not.toHaveAttribute("aria-disabled");

    // The server's data then shows exactly the intended cross-RoomType assignment.
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) => {
      const board = boardFor(propertyId, requestFrom, requestTo);
      const stay = board.stays[0];
      stay.assignments = [
        ...stay.assignments,
        {
          segmentId: "seg-cross",
          segmentVersion: 1,
          physicalRoomId: "room-201",
          actualRoomTypeId: "type-deluxe",
          startDate: from,
          endDate: addDaysIso(from, 2),
        },
      ];
      stay.unassignedRanges = stay.unassignedRanges.filter((range) => range.startDate !== from);
      return Promise.resolve({ ok: true, data: board });
    });
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getByTestId("uncertain-write-notice")).toHaveTextContent("is now shown on the server")
    );
    // The pre-existing assignment plus the now-observed cross-RoomType one — read from the GET, not painted locally.
    expect(screen.getAllByTitle("Nguyen Van A — CNF-100")).toHaveLength(2);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("12. is fully keyboard operable end to end: room list, confirmation checkbox, reason field and submit", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });

    const bar = firstRangeBar(from);
    bar.focus();
    await user.keyboard("{Enter}");

    const radios = within(dialog()).getAllByRole("radio");
    expect(document.activeElement).toBe(radios[0]);
    // Arrow-key navigation moves across the same-RoomType/cross-RoomType boundary
    // within the one radiogroup: 101 → 102 → 201.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(crossTypeRadio());
    expect(crossTypeRadio()).toBeChecked();

    await user.tab();
    expect(document.activeElement).toBe(confirmCheckbox());
    await user.keyboard(" ");
    expect(confirmCheckbox()).toBeChecked();

    await user.tab();
    expect(document.activeElement).toBe(reasonField());
    await user.keyboard("Only Deluxe available for this arrival.");

    // The footer's own "Close" button is the next DOM focus stop before Submit.
    await user.tab();
    expect(document.activeElement).toHaveTextContent("Close");
    await user.tab();
    expect(document.activeElement).toHaveTextContent("Assign room 201");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument());
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const [, request] = mockedCreate.mock.calls[0];
    expect(request.confirmCrossRoomType).toBe(true);
    expect(request.reason).toBe("Only Deluxe available for this arrival.");
  });
});

/**
 * PMS-CAL-001.2-CP04C.5: board-level wiring for the same-RoomType move
 * flow — assigned bar → popover → dialog → the one move request → the
 * authoritative re-read. `seg-existing` (room 101, room-101 is Standard,
 * the Unit's sold RoomType) from `stayFor()` is the segment moved throughout.
 */
describe("ReservationBoard — same-RoomType move (PMS-CAL-001.2-CP04C.5)", () => {
  function assignedBar() {
    return screen.getByTitle("Nguyen Van A — CNF-100");
  }

  function popover() {
    return screen.getByRole("dialog", { name: "Reservation details" });
  }

  function moveDialog() {
    return screen.getByRole("dialog", { name: "Move room" });
  }

  async function openMoveDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(assignedBar());
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
  }

  it("1&2. the assigned bar's own segment — not the whole Reservation — opens the move dialog with the exact source identity", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    await openMoveDialog(user);

    const view = within(moveDialog());
    expect(view.getByText("Nguyen Van A")).toBeInTheDocument();
    expect(view.getByText("CNF-100")).toBeInTheDocument();
    expect(view.getByText("101 (Standard)")).toBeInTheDocument();
    expect(view.getByText(new RegExp(`^\\[${addDaysIso(from, 2)}, ${addDaysIso(from, 4)}\\)`))).toBeInTheDocument();
    // Room 102 (Standard) offered as the same-sold-RoomType candidate.
    // PMS-CAL-001.2-CP04C.6B: room 201 (Deluxe) is now also offered live — see
    // the dedicated "cross-RoomType move enabled live" describe block below
    // for that destination's own confirmation/reason/payload behavior.
    expect(view.getByLabelText(/Room 102/)).toBeInTheDocument();
    expect(view.getByLabelText(/Room 201/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Reservation details" })).not.toBeInTheDocument();
  });

  it("3. submits exactly one move with the source's own version, the chosen destination, and the full un-clipped range", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(mockedMove).toHaveBeenCalledWith("prop-a", "seg-existing", {
      expectedVersion: 1,
      physicalRoomId: "room-102",
      startDate: addDaysIso(from, 2),
      endDate: addDaysIso(from, 4),
      confirmCrossRoomType: false,
    });
  });

  it("3b. a move to a same-sold-RoomType room sends confirmCrossRoomType: false even when the source segment's own current room is a different RoomType than sold (PMS-CAL-001.2-CP04C.6A)", async () => {
    // A segment already sitting in a cross-placed RoomType (room-201,
    // Deluxe) for a Unit sold as Standard — e.g. left over from an earlier
    // CP03B cross-RoomType assignment. Moving it to a Standard room must be
    // judged against the *sold* RoomType, never the segment's own current
    // one: `submitMove` must not accidentally derive "cross" from
    // `target.segment.actualRoomTypeId` instead of `target.stay.soldRoomTypeId`.
    const user = userEvent.setup();
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({
        ok: true,
        data: {
          ...boardFor(propertyId, requestFrom, requestTo),
          stays:
            propertyId === "prop-a"
              ? [
                  {
                    reservationId: "res-1",
                    reservationUnitId: "unit-1",
                    confirmationNumber: "CNF-100",
                    guestDisplayName: "Nguyen Van A",
                    soldRoomTypeId: "type-standard",
                    checkIn: addDaysIso(requestFrom, -3),
                    checkOut: addDaysIso(requestFrom, 9),
                    coverageStatus: "FullyAssigned",
                    assignments: [
                      {
                        segmentId: "seg-cross-placed",
                        segmentVersion: 3,
                        physicalRoomId: "room-201",
                        actualRoomTypeId: "type-deluxe",
                        startDate: addDaysIso(requestFrom, 2),
                        endDate: addDaysIso(requestFrom, 4),
                      },
                    ],
                    unassignedRanges: [],
                  },
                ]
              : [],
        },
      })
    );
    render(<ReservationBoard />);
    await waitFor(() => expect(screen.getByTitle("Nguyen Van A — CNF-100")).toBeInTheDocument());
    const [, from] = mockedFetchReservationBoard.mock.calls.at(-1)!;
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });

    await openMoveDialog(user);
    // The only candidate offered is the Standard room the Unit was sold as
    // (room-102) — room-201, the segment's own current room, is excluded as
    // the source itself, not because it isn't Standard.
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    expect(mockedMove).toHaveBeenCalledWith("prop-a", "seg-cross-placed", {
      expectedVersion: 3,
      physicalRoomId: "room-102",
      startDate: addDaysIso(from, 2),
      endDate: addDaysIso(from, 4),
      confirmCrossRoomType: false,
    });
  });

  it("4. a double click, repeated Enter, or several submits in the same tick start exactly one move request", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    const submit = within(moveDialog()).getByRole("button", { name: "Move to room 102" });
    const form = submit.closest("form")!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.dblClick(submit);
    submit.focus();
    await user.keyboard("{Enter}{Enter}{Enter}");

    expect(mockedMove).toHaveBeenCalledTimes(1);
    await act(async () => move.resolve({ kind: "moved", segments: null }));
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("5a. on 200, closes the dialog, reloads the board, and shows the new room", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) => {
      const movedBoard = boardFor(propertyId, requestFrom, requestTo);
      movedBoard.stays[0].assignments = movedBoard.stays[0].assignments.map((a) =>
        a.segmentId === "seg-existing" ? { ...a, physicalRoomId: "room-102" } : a
      );
      return Promise.resolve({ ok: true, data: movedBoard });
    });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument());
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(mockedFetchReservationBoard.mock.calls.at(-1)).toEqual(["prop-a", from, to, expect.any(AbortSignal)]);
    expect(screen.getByText(/Room 102 moved/)).toBeInTheDocument();
  });

  it("5a-bis. never paints a move locally: while the authoritative re-read is still pending, the bar stays in its original room's row", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation(() => reread.promise);

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument());
    // The re-read has not resolved yet, so nothing has been drawn from it.
    // Bars and room-label cells are grid siblings positioned by inline
    // gridRow, not nested in each other — the only reliable way to prove
    // which room's row a bar occupies is to compare that style, not DOM
    // containment. The bar must still be exactly where the last
    // authoritative board put it — never optimistically repositioned from
    // the "moved" outcome alone.
    const bar = assignedBar();
    expect(bar.style.gridRow).toBe(screen.getByText("101").style.gridRow);
    expect(bar.style.gridRow).not.toBe(screen.getByText("102").style.gridRow);

    await act(async () => reread.resolve({ ok: true, data: boardFor("prop-a", from, to) }));
  });

  it("5b. on 409, reports the conflict, re-reads the board, and never re-sends", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedMove.mockResolvedValue({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The segment has since changed; expectedVersion no longer matches.",
    });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    const alert = await within(moveDialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not saved: the schedule has changed/);
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(within(moveDialog()).queryByRole("button", { name: /Move (room|to room)/ })).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("5c. on an unknown (lost) response, locks the source segment, never re-sends, and Check again only re-reads", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await within(moveDialog()).findByRole("alert");
    await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    const notice = screen.getByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent(`room 102 for Nguyen Van A (CNF-100), [${addDaysIso(from, 2)}, ${addDaysIso(from, 4)})`);

    // Re-opening the popover and Move room for the very same (still locked) segment is refused.
    await user.click(assignedBar());
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
    expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    await user.click(within(notice).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("6. not-sent and a 400 validation rejection never create an uncertain write and keep the dialog resubmittable", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedMove.mockResolvedValueOnce({ kind: "not-sent", message: "not configured" });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await within(moveDialog()).findByText("The request was not sent. Nothing was saved.");
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(within(moveDialog()).getByRole("button", { name: "Move to room 102" })).toBeInTheDocument();

    mockedMove.mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "bad" });
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
    await within(moveDialog()).findByText("The server did not accept this move. Nothing was saved.");
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(within(moveDialog()).getByRole("button", { name: "Move to room 102" })).toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(2);
  });

  it("7. a stale board (awaiting its own post-write reconciliation) refuses to open a new move", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedFetchReservationBoard.mockImplementation(() => reread.promise);

    // An unrelated create write resolves, but its own authoritative re-read
    // is still pending — the board on screen is now stale.
    await user.click(firstRangeBar(from));
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(screen.getByText("Refreshing board from the server…")).toBeInTheDocument());

    await user.click(assignedBar());
    const moveButton = within(popover()).getByRole("button", { name: "Move room" });
    expect(moveButton).toBeDisabled();
    await user.click(moveButton);
    expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();

    await act(async () => reread.resolve({ ok: true, data: boardFor("prop-a", from, to, true) }));
  });

  it("8. a Property switch never lets a late move response apply to the new view's board", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    // C3: the in-flight dialog remains the owner of its request even though
    // the board underneath it changed; the late outcome must update this
    // dialog without painting the old Property's success notice on prop-b.
    expect(screen.getByRole("dialog", { name: "Move room" })).toBeInTheDocument();

    const boardCallsBeforeResolve = mockedFetchReservationBoard.mock.calls.length;
    await act(async () => move.resolve({ kind: "moved", segments: null }));

    // boardFor() seeds stays only for "prop-a" — if the stale outcome were
    // misapplied, a bar for Nguyen Van A would appear on prop-b's empty board.
    expect(screen.queryByTitle(/Nguyen Van A/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Property")).toHaveValue("prop-b");
    // PMS-CAL-001.2-CP04C.5-C2: the success text itself must never paint onto
    // prop-b's board either — it belongs only to the board the write was made
    // from (see `submitMove`'s `stillOnWrittenBoard` guard).
    expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
    // The late resolution still triggers a retry, but whatever it re-fetches
    // is for the Property/range current at that moment (prop-b) — never prop-a's.
    await waitFor(() =>
      expect(mockedFetchReservationBoard.mock.calls.length).toBeGreaterThan(boardCallsBeforeResolve)
    );
    expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-b");
  });
});

// PMS-CAL-001.2-CP04C.6B: the board now passes `crossRoomTypeEnabled` live to
// `ReservationMoveDialog` (merged, opt-in-only, in CP04C.6A). The dialog's own
// confirmation/reason/reset/double-submit/keyboard matrix is unchanged and
// already covered there — these tests prove only the board-level delta: the
// cross-RoomType destination is actually reachable from a live board, the
// board's own request wiring (`submitMove`) sends the same contract CP04C.6A
// already typed, and same-RoomType move is byte-identical to CP04C.5.
describe("ReservationBoard — cross-RoomType move enabled live (PMS-CAL-001.2-CP04C.6B)", () => {
  function assignedBar() {
    return screen.getByTitle("Nguyen Van A — CNF-100");
  }

  function popover() {
    return screen.getByRole("dialog", { name: "Reservation details" });
  }

  function moveDialog() {
    return screen.getByRole("dialog", { name: "Move room" });
  }

  async function openMoveDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(assignedBar());
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
  }

  it("1. offers room 201 (Deluxe) as a destination from the live board, grouped separately and requiring confirmation and a reason", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();

    await openMoveDialog(user);

    const view = within(moveDialog());
    expect(view.getByText(/other room types — requires confirmation and a reason/i)).toBeInTheDocument();
    expect(view.getByLabelText(/Room 201/)).toBeInTheDocument();
    // Same-sold-RoomType candidate is still offered too — this is additive, not a replacement.
    expect(view.getByLabelText(/Room 102/)).toBeInTheDocument();
  });

  it("2. selecting room 201 and submitting without confirming or entering a reason sends no move request", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 201/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 201" }));

    expect(mockedMove).not.toHaveBeenCalled();
    expect(within(moveDialog()).getByText("Confirm this cross-room-type placement to continue.")).toBeInTheDocument();
  });

  it("3. a valid cross-RoomType submit sends exactly one request with the exact contract fields, then reloads the board from an authoritative GET", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 201/));
    await user.click(
      within(moveDialog()).getByLabelText(/deliberately chosen a room of a different room type/)
    );
    await user.type(within(moveDialog()).getByLabelText("Reason"), "  Only a Deluxe was free for this night.  ");
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 201" }));

    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(mockedMove).toHaveBeenCalledWith("prop-a", "seg-existing", {
      expectedVersion: 1,
      physicalRoomId: "room-201",
      startDate: addDaysIso(from, 2),
      endDate: addDaysIso(from, 4),
      confirmCrossRoomType: true,
      // Sent already-trimmed — the dialog trims before calling onSubmit.
      reason: "Only a Deluxe was free for this night.",
    });
    const [, , request] = mockedMove.mock.calls[0];
    expect(Object.keys(request).sort()).toEqual(
      ["confirmCrossRoomType", "endDate", "expectedVersion", "physicalRoomId", "reason", "startDate"].sort()
    );

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument());
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(mockedFetchReservationBoard.mock.calls.at(-1)).toEqual(["prop-a", from, to, expect.any(AbortSignal)]);
  });

  it("4. a same-RoomType submit is still byte-identical to CP04C.5: confirmCrossRoomType:false and no reason field", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });

    await openMoveDialog(user);
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

    await waitFor(() => expect(mockedMove).toHaveBeenCalledTimes(1));
    expect(mockedMove).toHaveBeenCalledWith("prop-a", "seg-existing", {
      expectedVersion: 1,
      physicalRoomId: "room-102",
      startDate: addDaysIso(from, 2),
      endDate: addDaysIso(from, 4),
      confirmCrossRoomType: false,
    });
    const [, , request] = mockedMove.mock.calls[0];
    expect("reason" in request).toBe(false);
  });
});

describe("ReservationBoard — move-flow recovery, focus, and stale-view correctness (PMS-CAL-001.2-CP04C.5-C2)", () => {
  function assignedBar() {
    return screen.getByTitle("Nguyen Van A — CNF-100");
  }

  function popover() {
    return screen.getByRole("dialog", { name: "Reservation details" });
  }

  function moveDialog() {
    return screen.getByRole("dialog", { name: "Move room" });
  }

  async function openMoveDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(assignedBar());
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
  }

  /** Opens Move room via keyboard activation only — no pointer clicks. */
  async function openMoveDialogByKeyboard(user: ReturnType<typeof userEvent.setup>) {
    assignedBar().focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(popover()).toBeInTheDocument());
    const moveButton = within(popover()).getByRole("button", { name: "Move room" });
    moveButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(moveDialog()).toBeInTheDocument());
  }

  describe("Fix 1 — focus restoration after the move dialog closes", () => {
    it("1a. keyboard-open Move, closed after a validation refusal, returns focus to the assigned bar that opened it", async () => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      mockedMove.mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "bad" });

      await openMoveDialogByKeyboard(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
      await within(moveDialog()).findByText("The server did not accept this move. Nothing was saved.");

      await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
      expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(assignedBar());
    });

    it("1b. keyboard-open Move, closed after a conflict, returns focus to the assigned bar that opened it", async () => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      mockedMove.mockResolvedValue({
        kind: "rejected",
        status: 409,
        category: "conflict",
        detail: "The segment has since changed; expectedVersion no longer matches.",
      });

      await openMoveDialogByKeyboard(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
      await within(moveDialog()).findByRole("alert");

      await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
      expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(assignedBar());
    });

    it("1c. keyboard-open Move, closed after an unknown (lost) result, returns focus to the assigned bar that opened it", async () => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });

      await openMoveDialogByKeyboard(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
      await within(moveDialog()).findByRole("alert");

      await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
      expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(assignedBar());
      expect(document.activeElement).not.toBe(document.body);
    });

    it("2a. a successful move hands focus to the success notice — never to the assigned bar (now moved) or to document.body", async () => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      mockedMove.mockResolvedValue({ kind: "moved", segments: null });

      await openMoveDialogByKeyboard(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

      await waitFor(() => expect(screen.getByText(/Room 102 moved/)).toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
      expect(document.activeElement?.textContent).toContain("Room 102 moved");
      expect(document.activeElement).not.toBe(document.body);
    });

    it("2b. when the opener bar has been hidden since the dialog opened, closing after an unresolved result falls back to the Property selector, never document.body", async () => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });

      await openMoveDialogByKeyboard(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
      await within(moveDialog()).findByRole("alert");

      // Hide the opener without touching Property/range — same board, just no
      // longer rendered (an authoritative reload that supersedes a segment id,
      // or a filter change, has the same effect on `.isConnected`).
      await user.click(screen.getByRole("checkbox", { name: "Assigned" }));
      expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();

      await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
      expect(screen.queryByRole("dialog", { name: "Move room" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByLabelText("Property"));
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  describe("Fix 2 — attainable retry for a move segment longer than any board window", () => {
    /** A single fully-assigned stay whose one segment spans an arbitrary, caller-chosen range. */
    function longSegmentBoardFor(
      propertyId: string,
      from: string,
      to: string,
      segStart: string,
      segEnd: string
    ): ReservationBoardResponse {
      const base = boardFor(propertyId, from, to);
      if (propertyId === "prop-a") {
        base.stays = [
          {
            reservationId: "res-1",
            reservationUnitId: "unit-1",
            confirmationNumber: "CNF-100",
            guestDisplayName: "Nguyen Van A",
            soldRoomTypeId: "type-standard",
            checkIn: segStart,
            checkOut: segEnd,
            coverageStatus: "FullyAssigned",
            assignments: [
              {
                segmentId: "seg-existing",
                segmentVersion: 1,
                physicalRoomId: "room-101",
                actualRoomTypeId: "type-standard",
                startDate: segStart,
                endDate: segEnd,
              },
            ],
            unassignedRanges: [],
          },
        ];
      }
      return base;
    }

    it("3. an overlapping view offers Check again with move-specific guidance; a non-overlapping view asks for an overlapping one instead; Check again sends only a GET", async () => {
      const user = userEvent.setup();

      // A 45-night segment: longer than the board's own 31-night maximum
      // window, so it can never be fully contained by any view — only
      // overlapped. Anchored relative to the real initial window (computed
      // with the same pure helpers the component itself uses) so it is
      // guaranteed to be visible — and clickable — the moment the board
      // first loads.
      const todayIso = todayInTimeZone(propertyA.timeZone);
      const initialStart = computeVisibleStartFromAnchor(todayIso, 14);
      const initialRange = buildVisibleRange(initialStart, 14);
      const segStart = addDaysIso(initialRange.start, -5);
      const segEnd = addDaysIso(initialRange.start, 40);

      mockedFetchReservationBoard.mockImplementation((propertyId, reqFrom, reqTo) =>
        Promise.resolve({ ok: true, data: longSegmentBoardFor(propertyId, reqFrom, reqTo, segStart, segEnd) })
      );
      mockedMove.mockResolvedValue({ kind: "unknown", reason: "timeout" });

      render(<ReservationBoard />);
      await waitFor(() => expect(screen.getByTitle("Nguyen Van A — CNF-100")).toBeInTheDocument());

      await openMoveDialog(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
      await within(moveDialog()).findByRole("alert");
      await user.click(within(moveDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

      const notice = screen.getByTestId("uncertain-write-notice");
      const rangeText = `[${segStart}, ${segEnd})`;

      // Still in the initial (overlapping — in fact containing) window: Check
      // again is offered, and never with the create-oriented "includes" wording.
      expect(within(notice).getByRole("button", { name: "Check again" })).toBeInTheDocument();
      expect(notice).not.toHaveTextContent(`includes ${rangeText}`);

      // Navigate far enough away (3 * 14-night windows) that the visible
      // range no longer overlaps [segStart, segEnd) at all.
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await waitFor(() =>
        expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(initialRange.start, 42))
      );

      expect(within(notice).queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
      expect(notice).toHaveTextContent(`Open a view of this Property that overlaps ${rangeText} to check again`);
      // Never the create wording, and never claims a containing view is required.
      expect(notice).not.toHaveTextContent(`includes ${rangeText}`);

      // Step back one window: [start+28, start+42) overlaps [start-5, start+40)
      // without containing it — exactly the case full-containment would reject.
      await user.click(screen.getByRole("button", { name: "Previous date range" }));
      await waitFor(() =>
        expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(initialRange.start, 28))
      );
      expect(within(notice).getByRole("button", { name: "Check again" })).toBeInTheDocument();

      const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
      const moveCallsBefore = mockedMove.mock.calls.length;
      await user.click(within(notice).getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1));
      // Check again only ever reads — it must never resend the move.
      expect(mockedMove).toHaveBeenCalledTimes(moveCallsBefore);
    });

    it("4. a create reconciliation still requires full containment — an overlapping-but-not-containing view keeps the 'includes' wording and hides Check again (regression pin)", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      mockedCreate.mockResolvedValue({ kind: "unknown", reason: "timeout" });

      await user.click(firstRangeBar(from));
      await user.click(within(dialog()).getByLabelText(/Room 102/));
      await user.click(within(dialog()).getByRole("button", { name: "Assign room 102" }));
      await within(dialog()).findByRole("alert");
      await user.click(within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

      const notice = screen.getByTestId("uncertain-write-notice");
      const rangeText = `[${from}, ${addDaysIso(from, 2)})`;

      // One window forward overlaps the tail of the initial window but does
      // not contain the create's own (unclipped) [from, from+2) range.
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));

      expect(within(notice).queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
      expect(notice).toHaveTextContent(`Open a view of this Property that includes ${rangeText} to check again`);
      expect(notice).not.toHaveTextContent(`overlaps ${rangeText}`);
    });
  });

  describe("Fix 3 — no stale Property/range results from a move POST that outlives the view that started it", () => {
    it("6. changing only the visible date range (same Property) while a move POST is pending never paints the stale board's success notice on the new range", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const move = deferred<MoveAssignmentOutcome>();
      mockedMove.mockImplementation(() => move.promise);

      await openMoveDialog(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

      // Changing only the range (no Property switch) does not itself close
      // the still-pending dialog — only the late response's own handling is
      // under test here.
      await user.click(screen.getByRole("button", { name: "Next date range" }));
      await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));

      await act(async () => move.resolve({ kind: "moved", segments: null }));
      expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
    });

    it("7. returning to the Property the move was written on still resolves the write via overlap rules, once switched back", async () => {
      const user = userEvent.setup();
      const { from } = await renderLoadedBoard();
      const move = deferred<MoveAssignmentOutcome>();
      mockedMove.mockImplementation(() => move.promise);

      await openMoveDialog(user);
      await user.click(within(moveDialog()).getByLabelText(/Room 102/));
      await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));

      await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
      await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-b"));

      await act(async () => move.resolve({ kind: "unknown", reason: "timeout" }));
      // Not shown while viewing prop-b — this reconciliation belongs to prop-a.
      expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();

      // Both fixture Properties share a time zone, so switching back resets
      // the anchor to the same "today" window the write was made from.
      await user.selectOptions(screen.getByLabelText("Property"), "prop-a");
      await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-a"));

      await waitFor(() => expect(screen.getByTestId("uncertain-write-notice")).toBeInTheDocument());
      const notice = screen.getByTestId("uncertain-write-notice");
      expect(notice).toHaveTextContent(
        `room 102 for Nguyen Van A (CNF-100), [${addDaysIso(from, 2)}, ${addDaysIso(from, 4)})`
      );
      expect(within(notice).getByRole("button", { name: "Check again" })).toBeInTheDocument();
    });
  });
});

describe("ReservationBoard — reconciliation linkage and notice focus (PMS-CAL-001.2-CP04C.5-C3)", () => {
  function assignedBar() {
    return screen.getByTitle("Nguyen Van A — CNF-100");
  }

  function popover() {
    return screen.getByRole("dialog", { name: "Reservation details" });
  }

  function moveDialog() {
    return screen.getByRole("dialog", { name: "Move room" });
  }

  async function startPendingMove(user: ReturnType<typeof userEvent.setup>) {
    await user.click(assignedBar());
    await user.click(within(popover()).getByRole("button", { name: "Move room" }));
    await user.click(within(moveDialog()).getByLabelText(/Room 102/));
    await user.click(within(moveDialog()).getByRole("button", { name: "Move to room 102" }));
  }

  it("1&3. a range change keeps the pending dialog linked to its reconciliation, and the other range's GET cannot settle it", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);

    await startPendingMove(user);
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));

    await act(async () => move.resolve({ kind: "moved", segments: null }));

    const alert = await within(moveDialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The view changed before the board was reloaded"));
    expect(alert).not.toHaveTextContent("Reloading the board from the server");
    expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("2. a Property change preserves the original dialog's reconciliation state without showing its success notice on the new board", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);

    await startPendingMove(user);
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![0]).toBe("prop-b"));

    await act(async () => move.resolve({ kind: "moved", segments: null }));

    const alert = await within(moveDialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The view changed before the board was reloaded"));
    expect(alert).not.toHaveTextContent("Reloading the board from the server");
    expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Property")).toHaveValue("prop-b");
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("4. returning to an authoritative overlapping board continues uncertain move reconciliation and updates the original dialog", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    const move = deferred<MoveAssignmentOutcome>();
    mockedMove.mockImplementation(() => move.promise);

    await startPendingMove(user);
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(addDaysIso(from, 14)));

    await act(async () => move.resolve({ kind: "unknown", reason: "timeout" }));
    const alert = await within(moveDialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The view changed before the board was reloaded"));

    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) => {
      const board = boardFor(propertyId, requestFrom, requestTo);
      if (propertyId === "prop-a" && requestFrom === from) {
        board.stays[0].assignments = board.stays[0].assignments.map((assignment) =>
          assignment.segmentId === "seg-existing" ? { ...assignment, physicalRoomId: "room-102" } : assignment
        );
      }
      return Promise.resolve({ ok: true, data: board });
    });

    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.at(-1)![1]).toBe(from));
    await waitFor(() => expect(alert).toHaveTextContent("The destination now shown on the server matches this move"));
    expect(alert).not.toHaveTextContent("Reloading the board from the server");
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it.each(["{Enter}", " "])(
    "5. dismissing the focused move notice with %s restores focus to the stable Property control",
    async (dismissKey) => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      mockedMove.mockResolvedValue({ kind: "moved", segments: null });

      await startPendingMove(user);
      const noticeText = await screen.findByText(/Room 102 moved/);
      const notice = noticeText.closest('[role="status"]')!;
      await waitFor(() => expect(document.activeElement).toBe(notice));

      await user.tab();
      const dismiss = within(notice as HTMLElement).getByRole("button", { name: "Dismiss notice" });
      expect(document.activeElement).toBe(dismiss);
      await user.keyboard(dismissKey);

      expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByLabelText("Property"));
      expect(document.activeElement).not.toBe(document.body);
      expect(mockedMove).toHaveBeenCalledTimes(1);
    }
  );

  it("6. dismissing a move notice that does not own focus leaves the operator's current control focused", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedMove.mockResolvedValue({ kind: "moved", segments: null });

    await startPendingMove(user);
    const noticeText = await screen.findByText(/Room 102 moved/);
    const notice = noticeText.closest('[role="status"]')!;
    const dismiss = within(notice as HTMLElement).getByRole("button", { name: "Dismiss notice" });
    const nextRange = screen.getByRole("button", { name: "Next date range" });
    nextRange.focus();

    fireEvent.click(dismiss);

    expect(screen.queryByText(/Room 102 moved/)).not.toBeInTheDocument();
    expect(document.activeElement).toBe(nextRange);
  });
});
