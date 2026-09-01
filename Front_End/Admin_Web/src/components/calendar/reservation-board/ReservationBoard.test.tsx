import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import type { ApiProperty, ReservationBoardResponse } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
}));

import { fetchActiveProperties, fetchReservationBoard } from "@/lib/api/client";

const mockedFetchActiveProperties = vi.mocked(fetchActiveProperties);
const mockedFetchReservationBoard = vi.mocked(fetchReservationBoard);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const propertyB: ApiProperty = { id: "prop-b", name: "Property B", timeZone: "Asia/Ho_Chi_Minh" };

function emptyBoard(propertyId: string, from: string, to: string): ReservationBoardResponse {
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
    roomTypes: [],
    physicalRooms: [],
    stays: [],
    operationalBlocks: [],
  };
}

function populatedBoard(propertyId: string, from: string, to: string): ReservationBoardResponse {
  return {
    ...emptyBoard(propertyId, from, to),
    roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
    ],
  };
}

/** A promise plus externally-callable resolve/reject, for controlling fetch timing across assertions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockedFetchActiveProperties.mockReset();
  mockedFetchReservationBoard.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReservationBoard", () => {
  it("shows a loading state, then the timeline once properties and the board resolve", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
      Promise.resolve({ ok: true, data: populatedBoard(propertyId, from, to) })
    );

    render(<ReservationBoard />);
    expect(screen.getByText("Loading properties…")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("101")).toBeInTheDocument());
    expect(screen.getByText("Standard")).toBeInTheDocument();
  });

  it("shows a Property-load error with a Retry that reloads the page", async () => {
    mockedFetchActiveProperties.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "Could not reach the Admin API." },
    });
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(<ReservationBoard />);
    await waitFor(() => expect(screen.getByText("Could not reach the Admin API.")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("shows a no-active-properties message and never calls the board endpoint", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [] });

    render(<ReservationBoard />);
    await waitFor(() =>
      expect(screen.getByText("No active properties are available.")).toBeInTheDocument()
    );
    expect(mockedFetchReservationBoard).not.toHaveBeenCalled();
  });

  it("shows an empty-board message when the Property/range has no rooms, stays, or blocks", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
      Promise.resolve({ ok: true, data: emptyBoard(propertyId, from, to) })
    );

    render(<ReservationBoard />);
    await waitFor(() =>
      expect(screen.getByText("No rooms or stays for this Property and date range.")).toBeInTheDocument()
    );
  });

  it("shows a board-load error with Retry, and Retry re-issues the request", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
    mockedFetchReservationBoard
      .mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 500, message: "Server error." } })
      .mockImplementation((propertyId, from, to) =>
        Promise.resolve({ ok: true, data: populatedBoard(propertyId, from, to) })
      );

    render(<ReservationBoard />);
    await waitFor(() => expect(screen.getByText("Server error.")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("101")).toBeInTheDocument());
    expect(mockedFetchReservationBoard).toHaveBeenCalledTimes(2);
  });

  it("requests the board with the selected Property id, and re-requests with the new Property id after a Property change — clearing the previous board first", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
      Promise.resolve({ ok: true, data: populatedBoard(propertyId, from, to) })
    );

    render(<ReservationBoard />);
    await waitFor(() =>
      expect(mockedFetchReservationBoard).toHaveBeenCalledWith(
        "prop-a",
        expect.any(String),
        expect.any(String),
        expect.anything()
      )
    );

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");

    await waitFor(() =>
      expect(mockedFetchReservationBoard).toHaveBeenCalledWith(
        "prop-b",
        expect.any(String),
        expect.any(String),
        expect.anything()
      )
    );
  });

  it("re-requests the board with a shifted date range after Next/Previous", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
      Promise.resolve({ ok: true, data: populatedBoard(propertyId, from, to) })
    );

    render(<ReservationBoard />);
    await waitFor(() => expect(mockedFetchReservationBoard).toHaveBeenCalledTimes(1));
    const [, firstFrom] = mockedFetchReservationBoard.mock.calls[0];

    await userEvent.setup().click(screen.getByRole("button", { name: "Next date range" }));

    await waitFor(() => expect(mockedFetchReservationBoard).toHaveBeenCalledTimes(2));
    const [, secondFrom] = mockedFetchReservationBoard.mock.calls[1];
    expect(secondFrom).not.toBe(firstFrom);
  });

  it("never lets a slower, superseded response overwrite the state from a newer request", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });

    const first = deferred<{ ok: true; data: ReservationBoardResponse }>();
    const second = deferred<{ ok: true; data: ReservationBoardResponse }>();
    let call = 0;
    mockedFetchReservationBoard.mockImplementation(() => {
      call += 1;
      return call === 1 ? first.promise : second.promise;
    });

    render(<ReservationBoard />);
    await waitFor(() => expect(mockedFetchReservationBoard).toHaveBeenCalledTimes(1));

    await userEvent.setup().click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedFetchReservationBoard).toHaveBeenCalledTimes(2));

    // Resolve the newer (second) request first, then the stale (first) one after.
    second.resolve({ ok: true, data: populatedBoard("prop-a", "2026-09-15", "2026-09-29") });
    await waitFor(() => expect(screen.getByText("101")).toBeInTheDocument());

    first.resolve({ ok: true, data: emptyBoard("prop-a", "2026-09-01", "2026-09-15") });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The stale response must not have replaced the populated board with the empty one.
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.queryByText("No rooms or stays for this Property and date range.")).not.toBeInTheDocument();
  });

  it("opens the read-only popover when a stay bar is selected, and closes it on demand", async () => {
    mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) => {
      const board = populatedBoard(propertyId, from, to);
      board.stays = [
        {
          reservationId: "res-1",
          reservationUnitId: "unit-1",
          confirmationNumber: "CNF-001",
          guestDisplayName: "Nguyen Van A",
          soldRoomTypeId: "type-standard",
          checkIn: from,
          checkOut: to,
          coverageStatus: "FullyAssigned",
          assignments: [
            {
              segmentId: "seg-1",
              segmentVersion: 1,
              physicalRoomId: "room-101",
              actualRoomTypeId: "type-standard",
              startDate: from,
              endDate: to,
            },
          ],
          unassignedRanges: [],
        },
      ];
      return Promise.resolve({ ok: true, data: board });
    });

    render(<ReservationBoard />);
    await waitFor(() => expect(screen.getByTitle(/Nguyen Van A — CNF-001/)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTitle(/Nguyen Van A — CNF-001/));
    expect(screen.getByRole("dialog", { name: "Reservation details" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
