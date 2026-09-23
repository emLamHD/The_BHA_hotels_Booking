/**
 * PMS-CAL-001.2-CP04D-BOARD-WIRING: board-level wiring for the unassign flow
 * — assigned bar → popover → `ReservationUnassignDialog` → the one unassign
 * request → the authoritative re-read. The API client is mocked, so these
 * tests prove the UI's decisions; they do not replace the HTTPS/PostgreSQL
 * acceptance run.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import type { UnassignAssignmentOutcome } from "@/lib/api/client";
import type { ApiProperty, ReservationBoardResponse, ReservationBoardStay } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  unassignReservationAssignment: vi.fn(),
}));

import { fetchActiveProperties, fetchReservationBoard, unassignReservationAssignment } from "@/lib/api/client";

const mockedFetchActiveProperties = vi.mocked(fetchActiveProperties);
const mockedFetchReservationBoard = vi.mocked(fetchReservationBoard);
const mockedUnassign = vi.mocked(unassignReservationAssignment);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function stayFor(from: string, to: string): ReservationBoardStay {
  return {
    reservationId: "res-1",
    reservationUnitId: "unit-1",
    confirmationNumber: "CNF-100",
    guestDisplayName: "Nguyen Van A",
    soldRoomTypeId: "type-standard",
    checkIn: from,
    checkOut: to,
    coverageStatus: "FullyAssigned",
    assignments: [
      { segmentId: "seg-existing", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: from, endDate: to },
    ],
    unassignedRanges: [],
  };
}

function boardFor(propertyId: string, from: string, to: string, stays: ReservationBoardStay[]): ReservationBoardResponse {
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [{ id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" }],
    stays,
    operationalBlocks: [],
  };
}

/** Renders the board and waits for the assigned bar to appear. */
async function renderLoadedBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(screen.getByTitle("Nguyen Van A — CNF-100")).toBeInTheDocument());
  const [propertyId, from, to] = mockedFetchReservationBoard.mock.calls.at(-1)!;
  return { propertyId, from, to };
}

const assignedBar = () => screen.getByTitle("Nguyen Van A — CNF-100");
const popover = () => screen.getByRole("dialog", { name: "Reservation details" });
const unassignDialog = () => screen.getByRole("dialog", { name: "Remove room assignment" });
const confirmButton = () => within(unassignDialog()).getByRole("button", { name: "Remove room 101 assignment" });

async function openUnassignDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(assignedBar());
  await user.click(within(popover()).getByRole("button", { name: "Remove room assignment" }));
}

beforeEach(() => {
  mockedFetchActiveProperties.mockReset();
  mockedFetchReservationBoard.mockReset();
  mockedUnassign.mockReset();
  mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
  mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve({ ok: true, data: boardFor(propertyId, from, to, [stayFor(from, to)]) })
  );
});

describe("ReservationBoard — unassign room wiring (PMS-CAL-001.2-CP04D-BOARD-WIRING)", () => {
  it("opens the dialog for the exact segment; Close sends nothing; a confirmed submit sends one request with a trimmed reason", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const write = deferred<UnassignAssignmentOutcome>();
    mockedUnassign.mockImplementation(() => write.promise);

    await openUnassignDialog(user);
    const view = within(unassignDialog());
    expect(view.getByText("Nguyen Van A")).toBeInTheDocument();
    expect(view.getByText("CNF-100")).toBeInTheDocument();
    expect(view.getByText("101 (Standard)")).toBeInTheDocument();
    expect(view.getByText(new RegExp(`^\\[${from}, ${to}\\)`))).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Reservation details" })).not.toBeInTheDocument();

    await user.click(view.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(mockedUnassign).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Remove room assignment" })).not.toBeInTheDocument();

    await openUnassignDialog(user);
    await user.type(within(unassignDialog()).getByLabelText("Reason (optional)"), "  No longer needed.  ");
    const submit = confirmButton();
    act(() => fireEvent.submit(submit.closest("form")!));
    await user.dblClick(submit);

    expect(mockedUnassign).toHaveBeenCalledTimes(1);
    expect(mockedUnassign).toHaveBeenCalledWith("prop-a", "seg-existing", { expectedVersion: 1, reason: "No longer needed." });
    await act(async () => write.resolve({ kind: "unassigned", segments: null }));
    expect(mockedUnassign).toHaveBeenCalledTimes(1);
  });

  it("on 200, shows success, closes the dialog, and reloads the board from the server", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedUnassign.mockResolvedValue({ kind: "unassigned", segments: null });
    mockedFetchReservationBoard.mockImplementation((propertyId, requestFrom, requestTo) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, requestFrom, requestTo, []) })
    );

    await openUnassignDialog(user);
    await user.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove room assignment" })).not.toBeInTheDocument());
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(mockedFetchReservationBoard.mock.calls.at(-1)).toEqual(["prop-a", from, to, expect.any(AbortSignal)]);
    expect(screen.getByText(`Room 101 assignment removed for Nguyen Van A (CNF-100), [${from}, ${to}).`)).toBeInTheDocument();
    expect(screen.getByText(/The board has been reloaded from the server/)).toBeInTheDocument();
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();
  });

  it("PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: dismissing the unassign success notice by keyboard restores focus to the Property selector", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedUnassign.mockResolvedValue({ kind: "unassigned", segments: null });

    await openUnassignDialog(user);
    await user.click(confirmButton());
    await waitFor(() => expect(screen.getByText(/assignment removed/)).toBeInTheDocument());

    const dismissButton = screen.getByRole("button", { name: "Dismiss notice" });
    dismissButton.focus();
    expect(document.activeElement).toBe(dismissButton);
    await user.keyboard("{Enter}");

    expect(screen.queryByText(/assignment removed/)).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText("Property"));
  });

  it("on 409, reports the conflict inline, reloads the board, and never resubmits", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedUnassign.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict", detail: "The assignment has since changed." });

    await openUnassignDialog(user);
    await user.click(confirmButton());

    const alert = await within(unassignDialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/not saved: the room assignment has changed/);
    // PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: the dialog's own alert must say the
    // board was actually reloaded once the re-read completes, not just the
    // outer board-level notice — this line did not exist before the correction.
    await waitFor(() => expect(alert).toHaveTextContent("The board has been reloaded from the server."));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(within(unassignDialog()).queryByRole("button", { name: "Remove room 101 assignment" })).not.toBeInTheDocument();
    expect(mockedUnassign).toHaveBeenCalledTimes(1);
  });

  it("PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: a Property switch mid-flight makes the dialog report the originating board as not yet reloaded, never that it was", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const write = deferred<UnassignAssignmentOutcome>();
    mockedUnassign.mockImplementation(() => write.promise);

    await openUnassignDialog(user);
    await user.click(confirmButton());
    // A range change (no second Property needed) already changes the board
    // identity the write is judged against — the same trigger the move flow's
    // own CP04C.5-C3 regression test uses.
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBeGreaterThan(boardCallsBefore));

    await act(async () => write.resolve({ kind: "rejected", status: 409, category: "conflict", detail: "stale" }));

    const alert = await within(unassignDialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The view changed before the board was reloaded"));
    expect(alert).not.toHaveTextContent("The board has been reloaded from the server.");
    // The stale segment's own success text must never appear on the new range either.
    expect(screen.queryByText(/assignment removed/)).not.toBeInTheDocument();
  });

  it("PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: when the board re-read itself fails, the dialog says the board could not be reloaded, not that it succeeded", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedUnassign.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict", detail: "stale" });
    mockedFetchReservationBoard.mockResolvedValue({ ok: false, error: { kind: "network", message: "Could not reach the Admin API." } });

    await openUnassignDialog(user);
    await user.click(confirmButton());

    const alert = await within(unassignDialog()).findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("The board could not be reloaded."));
    expect(alert).not.toHaveTextContent("The board has been reloaded from the server.");
  });

  it("on an unknown (lost) response, locks the segment against a second unassign, and Check again only re-reads", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    mockedUnassign.mockResolvedValue({ kind: "unknown", reason: "timeout" });

    await openUnassignDialog(user);
    await user.click(confirmButton());
    const alert = await within(unassignDialog()).findByRole("alert");
    // PMS-CAL-001.2-CP04D-BOARD-WIRING-C1: once the board is re-read and the
    // source segment is still shown exactly as it was, the wording must say
    // so — never "no matching assignment", which describes a destination an
    // unassign never has.
    await waitFor(() => expect(alert).toHaveTextContent("the room assignment is still shown unchanged"));
    expect(alert).not.toHaveTextContent("no matching assignment is shown yet");
    await user.click(within(unassignDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    const notice = screen.getByTestId("uncertain-write-notice");
    expect(notice).toHaveTextContent(`room 101 for Nguyen Van A (CNF-100), [${from}, ${to})`);
    expect(notice).toHaveTextContent("the room assignment is still shown unchanged");
    expect(notice).not.toHaveTextContent("no matching assignment is shown yet");

    // Re-opening the popover for the same locked segment is refused.
    await user.click(assignedBar());
    const removeButton = within(popover()).getByRole("button", { name: "Remove room assignment" });
    expect(removeButton).toBeDisabled();
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    await user.click(within(notice).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(mockedUnassign).toHaveBeenCalledTimes(1);
  });

  it("not-sent and a 400 validation rejection never create an uncertain write and keep the dialog resubmittable", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedUnassign.mockResolvedValueOnce({ kind: "not-sent", message: "not configured" });

    await openUnassignDialog(user);
    await user.click(confirmButton());
    await within(unassignDialog()).findByText("The unassign request was not sent. Nothing was changed on the server.");
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();

    mockedUnassign.mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "bad" });
    await user.click(confirmButton());
    await within(unassignDialog()).findByText("The server did not accept this unassign request. No assignment change was saved.");
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(mockedUnassign).toHaveBeenCalledTimes(2);
  });

  it("a stale board awaiting its own reconciliation refuses to open a new unassign dialog", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedUnassign.mockResolvedValue({ kind: "unassigned", segments: null });
    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();

    await openUnassignDialog(user);
    mockedFetchReservationBoard.mockImplementation(() => reread.promise);
    await user.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove room assignment" })).not.toBeInTheDocument());

    // The re-read above has not resolved yet: the board on screen is stale.
    await user.click(assignedBar());
    expect(within(popover()).getByRole("button", { name: "Remove room assignment" })).toBeDisabled();

    await act(async () => reread.resolve({ ok: true, data: boardFor("prop-a", "2026-01-01", "2026-01-01", []) }));
  });
});
