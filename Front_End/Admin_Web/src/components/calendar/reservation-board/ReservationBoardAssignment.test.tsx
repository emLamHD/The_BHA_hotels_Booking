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
import ReservationBoard from "./ReservationBoard";
import { addDaysIso } from "./dateMath";
import type { AssignmentCreateOutcome } from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse, ReservationBoardStay } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createReservationAssignment: vi.fn(),
}));

import { createReservationAssignment, fetchActiveProperties, fetchReservationBoard } from "@/lib/api/client";

const mockedFetchActiveProperties = vi.mocked(fetchActiveProperties);
const mockedFetchReservationBoard = vi.mocked(fetchReservationBoard);
const mockedCreate = vi.mocked(createReservationAssignment);

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
  mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
  mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) })
  );
});

describe("ReservationBoard — same-RoomType assignment (PMS-CAL-001.2-CP03A)", () => {
  it("opens the dialog for exactly the clicked partial range and offers only Active rooms of the sold RoomType", async () => {
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
    expect(view.getAllByRole("radio").map((radio) => radio.closest("label")!.textContent)).toEqual([
      "Room 101Floor 1",
      "Room 102Floor 1",
    ]);
    expect(view.queryByText("Room 201")).not.toBeInTheDocument();
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
    await waitFor(() => expect(alert).toHaveTextContent("The board has been reloaded from the server."));
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
    const group = within(dialog()).getByRole("radiogroup", { name: "Target room (Standard)" });
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

  it("explains, and offers no Confirm, when the sold RoomType has no Active room on the board", async () => {
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

    expect(within(dialog()).getByText("No active Standard room is available on this board to assign.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: /Assign room/ })).not.toBeInTheDocument();
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
