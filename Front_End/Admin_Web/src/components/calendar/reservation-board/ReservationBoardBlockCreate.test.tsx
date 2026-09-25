/**
 * PMS-CAL-001.3-CP03: board-level wiring for creating one operational block —
 * toolbar button → `ReservationBlockCreateDialog` → the one create request →
 * the authoritative re-read. The API client is mocked, so these tests prove
 * the UI's decisions; they do not replace a live HTTPS/PostgreSQL run.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import type { OperationalBlockCreateOutcome } from "@/lib/api/client";
import type { ApiProperty, ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";
import { addDaysIso } from "./dateMath";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createOperationalBlock: vi.fn(),
}));

import { createOperationalBlock, fetchActiveProperties, fetchReservationBoard } from "@/lib/api/client";

const mockedFetchActiveProperties = vi.mocked(fetchActiveProperties);
const mockedFetchReservationBoard = vi.mocked(fetchReservationBoard);
const mockedCreateBlock = vi.mocked(createOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const REASON = "Burst pipe";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function boardFor(
  propertyId: string,
  from: string,
  to: string,
  blocks: ReservationBoardOperationalBlock[] = [],
  roomStatus = "Active"
): ReservationBoardResponse {
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from,
    to,
    roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: roomStatus },
      { id: "room-oos", roomTypeId: "type-standard", roomNumber: "199", floor: 1, operationalStatus: "OutOfService" },
    ],
    stays: [],
    operationalBlocks: blocks,
  };
}

function blockOn(from: string): ReservationBoardOperationalBlock {
  return {
    roomBlockId: "block-1",
    segmentId: "seg-block-1",
    segmentVersion: 1,
    physicalRoomId: "room-101",
    startDate: from,
    endDate: addDaysIso(from, 1),
    reason: REASON,
  };
}

/** Serves the board without the block until `blockExists()` says it is on the server. */
function serveBoards(blockExists: () => boolean) {
  mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve({ ok: true, data: boardFor(propertyId, from, to, blockExists() ? [blockOn(from)] : []) })
  );
}

async function renderLoadedBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(createButton()).toBeEnabled());
  const [propertyId, from, to] = mockedFetchReservationBoard.mock.calls.at(-1)!;
  return { propertyId, from, to };
}

const createButton = () => screen.getByRole("button", { name: "Create operational block" });
const blockDialog = () => screen.getByRole("dialog", { name: "Create operational block" });
const queryBlockDialog = () => screen.queryByRole("dialog", { name: "Create operational block" });

/** Opens the dialog and reviews room 101 for the dialog's default first night of the board. */
async function openAndReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(createButton());
  const view = within(blockDialog());
  await user.selectOptions(view.getByLabelText("Room"), "room-101");
  await user.type(view.getByLabelText("Reason"), `  ${REASON}  `);
  await user.click(view.getByRole("button", { name: "Review" }));
}

beforeEach(() => {
  mockedFetchActiveProperties.mockReset();
  mockedFetchReservationBoard.mockReset();
  mockedCreateBlock.mockReset();
  mockedFetchActiveProperties.mockResolvedValue({ ok: true, data: [propertyA] });
  serveBoards(() => false);
});

describe("ReservationBoard — create operational block (PMS-CAL-001.3-CP03)", () => {
  it("offers only Active rooms, sends one confirmed request, and shows the block only from the server's re-read", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    let written = false;
    serveBoards(() => written);
    const write = deferred<OperationalBlockCreateOutcome>();
    mockedCreateBlock.mockImplementation(() => write.promise);

    await user.click(createButton());
    const options = within(within(blockDialog()).getByLabelText("Room")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Choose an Active room…", "101 (Standard)"]);
    await user.click(within(blockDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(queryBlockDialog()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(createButton());

    await openAndReview(user);
    const create = within(blockDialog()).getByRole("button", { name: "Create block" });
    act(() => fireEvent.submit(create.closest("form")!));
    await user.dblClick(create);
    expect(mockedCreateBlock).toHaveBeenCalledTimes(1);
    expect(mockedCreateBlock).toHaveBeenCalledWith("prop-a", {
      physicalRoomId: "room-101",
      startDate: from,
      endDate: addDaysIso(from, 1),
      reason: REASON,
    });
    expect(screen.queryByTitle(REASON)).not.toBeInTheDocument();

    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    written = true;
    await act(async () => write.resolve({ kind: "created", block: null }));

    await waitFor(() => expect(queryBlockDialog()).not.toBeInTheDocument());
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(mockedFetchReservationBoard.mock.calls.at(-1)).toEqual(["prop-a", from, to, expect.any(AbortSignal)]);
    await waitFor(() => expect(screen.getByTitle(REASON)).toBeInTheDocument());
    const notice = screen.getByText(`Room 101 blocked for [${from}, ${addDaysIso(from, 1)}): ${REASON}`).closest("[role=status]")!;
    expect(notice).toHaveTextContent("The board has been reloaded from the server.");
    expect(mockedCreateBlock).toHaveBeenCalledTimes(1);

    // Dismissing the notice by keyboard returns focus to the toolbar button.
    within(notice as HTMLElement).getByRole("button", { name: "Dismiss notice" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(createButton());
  });

  it("on 409, reports the conflict in the dialog, reloads the board, and never resubmits", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreateBlock.mockResolvedValue({ kind: "rejected", status: 409, category: "conflict", detail: "Room is occupied." });

    await openAndReview(user);
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));

    const alert = await within(blockDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("This block was not saved");
    expect(alert).toHaveTextContent("Room is occupied.");
    await waitFor(() => expect(alert).toHaveTextContent("The board has been reloaded from the server."));
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    expect(within(blockDialog()).queryByRole("button", { name: "Create block" })).not.toBeInTheDocument();
    expect(mockedCreateBlock).toHaveBeenCalledTimes(1);
  });

  it("on 400, sends no reload and keeps the form for a deliberate correction", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    mockedCreateBlock.mockResolvedValue({ kind: "rejected", status: 400, category: "validation", detail: "reason is required." });

    await openAndReview(user);
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));

    expect(await within(blockDialog()).findByRole("alert")).toHaveTextContent("reason is required.");
    expect(within(blockDialog()).getByLabelText("Room")).toHaveValue("room-101");
    expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore);
  });

  it("on a lost response, never re-sends: Check again only re-reads the board, the room/nights stay locked, and a block later shown is reported as schedule evidence only", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();
    let onServer = false;
    serveBoards(() => onServer);
    mockedCreateBlock.mockResolvedValue({ kind: "unknown", reason: "timeout" });

    await openAndReview(user);
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    const alert = await within(blockDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("may or may not have been saved");
    await waitFor(() => expect(alert).toHaveTextContent("no matching block is shown yet"));
    await user.click(within(blockDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    const notice = screen.getByTestId("uncertain-block-notice");
    expect(notice).toHaveTextContent(`Unconfirmed block request: room 101, [${from}, ${addDaysIso(from, 1)})`);
    expect(notice).toHaveTextContent("does not prove the request failed");

    // The same room over overlapping nights cannot be sent again from a new dialog.
    await openAndReview(user);
    expect(within(blockDialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    await user.click(within(blockDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);

    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    await user.click(within(notice).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" })).toBeInTheDocument();

    onServer = true;
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getByTestId("uncertain-block-notice")).toHaveTextContent(
        "is now shown on the server. That shows the schedule; it does not prove this request created it."
      )
    );
    expect(mockedCreateBlock).toHaveBeenCalledTimes(1);
  });

  it("a range switch while the request is in flight never presents the new view as the reloaded origin board", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const write = deferred<OperationalBlockCreateOutcome>();
    mockedCreateBlock.mockImplementation(() => write.promise);

    await openAndReview(user);
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    const boardCallsBefore = mockedFetchReservationBoard.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedFetchReservationBoard.mock.calls.length).toBeGreaterThan(boardCallsBefore));

    await act(async () => write.resolve({ kind: "created", block: null }));

    // The dialog stays open to report its own result; no success notice is painted onto the new range.
    const status = await within(blockDialog()).findByRole("status");
    expect(status).toHaveTextContent("Operational block created.");
    await waitFor(() => expect(status).toHaveTextContent("the board this block was created from has not been re-read yet"));
    expect(status).not.toHaveTextContent("The board has been reloaded");
    expect(screen.queryByText(/^Room 101 blocked for/)).not.toBeInTheDocument();
  });

  it("reports a failed re-read after a successful create instead of claiming the board was reloaded", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedCreateBlock.mockImplementation(async () => {
      mockedFetchReservationBoard.mockResolvedValue({
        ok: false,
        error: { kind: "network", message: "Could not reach the Admin API." },
      });
      return { kind: "created", block: null };
    });

    await openAndReview(user);
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));

    await waitFor(() =>
      expect(screen.getByText(/Saved on the server, but the board could not be reloaded/)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("is unavailable while the board has no Active room, or is waiting for a re-read after a write", async () => {
    const user = userEvent.setup();
    mockedFetchReservationBoard.mockImplementation((propertyId, from, to) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, from, to, [], "OutOfService") })
    );
    render(<ReservationBoard />);
    await waitFor(() => expect(mockedFetchReservationBoard).toHaveBeenCalled());
    await waitFor(() => expect(createButton()).toHaveAttribute("title", "This Property has no Active rooms."));
    expect(createButton()).toBeDisabled();

    serveBoards(() => false);
    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(createButton()).toBeEnabled());

    const reread = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedCreateBlock.mockImplementation(async () => {
      mockedFetchReservationBoard.mockImplementation(() => reread.promise);
      return { kind: "rejected", status: 409, category: "conflict" };
    });
    await openAndReview(user);
    await user.click(within(blockDialog()).getByRole("button", { name: "Create block" }));
    await within(blockDialog()).findByRole("alert");
    await user.click(within(blockDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(createButton()).toBeDisabled();
    expect(createButton()).toHaveAttribute("title", "Waiting for the board to be re-read after a change.");
  });
});
