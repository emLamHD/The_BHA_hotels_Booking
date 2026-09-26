/**
 * PMS-CAL-001.3-CP04: board-level wiring for cancelling one operational block —
 * block bar → details popover → Cancel block → confirm dialog → the one cancel
 * request → the authoritative re-read. The API client is mocked, so these tests
 * prove the UI's decisions; they do not replace a live HTTPS/PostgreSQL run.
 *
 * The rule under test throughout is that the board never concludes anything the
 * server did not say: a block disappears only because a GET stopped returning
 * it, a refusal is never shown as a cancellation, and a lost response is never
 * resolved by sending again.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// PMS-CAL-001.5-CP02: unconfirmed writes survive a reload in this tab; no test may inherit another's.
beforeEach(() => sessionStorage.clear());
import ReservationBoard from "./ReservationBoard";
import type { OperationalBlockCancelOutcome } from "@/lib/api/client";
import type { ApiProperty, ReservationBoardOperationalBlock, ReservationBoardResponse } from "@/lib/api/types";
import { addDaysIso } from "./dateMath";

vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createOperationalBlock: vi.fn(),
  cancelOperationalBlock: vi.fn(),
}));

import {
  cancelOperationalBlock,
  createOperationalBlock,
  fetchActiveProperties,
  fetchReservationBoard,
} from "@/lib/api/client";

const mockedProperties = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedCancel = vi.mocked(cancelOperationalBlock);
const mockedCreate = vi.mocked(createOperationalBlock);

const propertyA: ApiProperty = { id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" };
const propertyB: ApiProperty = { id: "prop-b", name: "Property B", timeZone: "Asia/Ho_Chi_Minh" };

const REASON = "Burst pipe";
const SEGMENT_ID = "seg-block-1";
const VERSION = 3;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/**
 * The tracked block sits on room 101 and deliberately starts one night BEFORE
 * the visible window and ends one night AFTER it, so any place that shows the
 * clipped bar range instead of the segment's own range is visible as a failure.
 */
function blockOn(from: string, to: string): ReservationBoardOperationalBlock {
  return {
    roomBlockId: "block-1",
    segmentId: SEGMENT_ID,
    segmentVersion: VERSION,
    physicalRoomId: "room-101",
    startDate: addDaysIso(from, -1),
    endDate: addDaysIso(to, 1),
    reason: REASON,
  };
}

function boardFor(
  propertyId: string,
  from: string,
  to: string,
  blocks: ReservationBoardOperationalBlock[]
): ReservationBoardResponse {
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
    roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-standard", roomNumber: "102", floor: 1, operationalStatus: "Active" },
    ],
    stays: [],
    operationalBlocks: blocks,
  };
}

/** Serves prop-a's board with the tracked block until `gone()` says the server dropped it. */
function serveBoards(gone: () => boolean = () => false) {
  mockedBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve({
      ok: true,
      data: boardFor(propertyId, from, to, propertyId === "prop-a" && !gone() ? [blockOn(from, to)] : []),
    })
  );
}

async function renderLoadedBoard() {
  render(<ReservationBoard />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { from, to };
}

const blockBar = () => screen.getByTitle(REASON);
const popover = () => screen.getByRole("dialog", { name: "Operational block details" });
const cancelDialog = () => screen.getByRole("dialog", { name: "Cancel operational block" });
const queryCancelDialog = () => screen.queryByRole("dialog", { name: "Cancel operational block" });
const confirmButton = () => within(cancelDialog()).getByRole("button", { name: /^Cancel block on room/ });

/** Block bar → popover → Cancel block → the confirm dialog. */
async function openCancelDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(blockBar());
  await user.click(within(popover()).getByRole("button", { name: "Cancel block" }));
  return cancelDialog();
}

beforeEach(() => {
  for (const mock of [mockedProperties, mockedBoard, mockedCancel, mockedCreate]) mock.mockReset();
  mockedProperties.mockResolvedValue({ ok: true, data: [propertyA, propertyB] });
  serveBoards();
});

describe("ReservationBoard — cancel operational block (PMS-CAL-001.3-CP04)", () => {
  it("shows the segment's own full nights, sends one request with the board's expectedVersion, and drops the block only from the server's re-read", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    let gone = false;
    serveBoards(() => gone);
    const write = deferred<OperationalBlockCancelOutcome>();
    mockedCancel.mockImplementation(() => write.promise);

    const dialog = await openCancelDialog(user);
    // The whole segment, not the part the 14-day window happens to display.
    expect(dialog).toHaveTextContent(`[${addDaysIso(from, -1)}, ${addDaysIso(to, 1)})`);
    expect(dialog).toHaveTextContent(REASON);
    expect(dialog).toHaveTextContent(`${SEGMENT_ID} · v${VERSION}`);
    // Focus starts on Close, never on the destructive action.
    expect(document.activeElement).toBe(within(dialog).getAllByRole("button", { name: "Close" })[0]);

    const confirm = confirmButton();
    act(() => fireEvent.submit(confirm.closest("form")!));
    await user.dblClick(confirm);
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(mockedCancel).toHaveBeenCalledWith("prop-a", SEGMENT_ID, { expectedVersion: VERSION });
    // Nothing is removed optimistically while the request is in flight.
    expect(screen.getByTitle(REASON)).toBeInTheDocument();

    const boardCallsBefore = mockedBoard.mock.calls.length;
    gone = true;
    await act(async () => write.resolve({ kind: "cancelled", segment: null }));

    await waitFor(() => expect(queryCancelDialog()).not.toBeInTheDocument());
    expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore + 1);
    await waitFor(() => expect(screen.queryByTitle(REASON)).not.toBeInTheDocument());
    const notice = screen
      .getByText(`Block on room 101 cancelled for [${addDaysIso(from, -1)}, ${addDaysIso(to, 1)}).`)
      .closest("[role=status]")!;
    expect(notice).toHaveTextContent("The board has been reloaded from the server.");
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  it("sends a trimmed reason only when one was typed", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedCancel.mockResolvedValue({ kind: "cancelled", segment: null });

    const dialog = await openCancelDialog(user);
    await user.type(within(dialog).getByLabelText("Reason for cancelling (optional)"), "  Repair done  ");
    await user.click(confirmButton());

    expect(mockedCancel).toHaveBeenCalledWith("prop-a", SEGMENT_ID, {
      expectedVersion: VERSION,
      reason: "Repair done",
    });
  });

  it("closing the popover or the dialog before confirming sends nothing and restores focus to the block bar", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();

    await user.click(blockBar());
    await user.click(within(popover()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Operational block details" })).not.toBeInTheDocument();

    const dialog = await openCancelDialog(user);
    await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(queryCancelDialog()).not.toBeInTheDocument();
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(blockBar());

    // Escape does the same.
    await openCancelDialog(user);
    await user.keyboard("{Escape}");
    expect(queryCancelDialog()).not.toBeInTheDocument();
    expect(mockedCancel).not.toHaveBeenCalled();
  });

  it("on 409, reports the conflict, reloads the board, and never resends", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedBoard.mock.calls.length;
    mockedCancel.mockResolvedValue({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The segment version is stale.",
    });

    await openCancelDialog(user);
    await user.click(confirmButton());

    const alert = await within(cancelDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("This block was not cancelled");
    expect(alert).toHaveTextContent("The segment version is stale.");
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    expect(within(cancelDialog()).queryByRole("button", { name: /^Cancel block on room/ })).not.toBeInTheDocument();
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, "The server refused this write."],
    [404, "Writes may be disabled on this API host"],
  ])(
    "on %i, never claims the block was cancelled, keeps it on the board and sends no reload",
    async (status, detail) => {
      const user = userEvent.setup();
      await renderLoadedBoard();
      const boardCallsBefore = mockedBoard.mock.calls.length;
      mockedCancel.mockResolvedValue({ kind: "rejected", status, category: "not-permitted" });

      await openCancelDialog(user);
      await user.click(confirmButton());

      const alert = await within(cancelDialog()).findByRole("alert");
      expect(alert).toHaveTextContent("Cancelling operational blocks is not available from this Admin session.");
      expect(alert).toHaveTextContent("Nothing was changed.");
      expect(alert).toHaveTextContent(detail);
      expect(alert).not.toHaveTextContent("Operational block cancelled.");
      expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore);
      expect(screen.getByTitle(REASON)).toBeInTheDocument();
    }
  );

  it("on 400, sends no reload and allows a deliberate second attempt from the same board", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedBoard.mock.calls.length;
    mockedCancel.mockResolvedValueOnce({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "expectedVersion is required.",
    });

    await openCancelDialog(user);
    await user.click(confirmButton());
    expect(await within(cancelDialog()).findByRole("alert")).toHaveTextContent("expectedVersion is required.");
    expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore);

    mockedCancel.mockResolvedValueOnce({ kind: "cancelled", segment: null });
    await user.click(confirmButton());
    expect(mockedCancel).toHaveBeenCalledTimes(2);
  });

  it("on not-sent, nothing is written, no reload happens and the dialog stays usable", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const boardCallsBefore = mockedBoard.mock.calls.length;
    mockedCancel.mockResolvedValue({
      kind: "not-sent",
      message: "The Admin API address is not configured.",
    });

    await openCancelDialog(user);
    await user.click(confirmButton());

    const alert = await within(cancelDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("The request was not sent. Nothing was changed.");
    expect(alert).toHaveTextContent("The Admin API address is not configured.");
    expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore);
    expect(confirmButton()).toBeInTheDocument();
  });

  it("reports a failed re-read after a successful cancel instead of claiming the board was reloaded", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    mockedCancel.mockImplementation(async () => {
      mockedBoard.mockResolvedValue({
        ok: false,
        error: { kind: "network", message: "Could not reach the Admin API." },
      });
      return { kind: "cancelled", segment: null };
    });

    await openCancelDialog(user);
    await user.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText(/Saved on the server, but the board could not be reloaded/)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("ReservationBoard — a cancel whose response was lost (PMS-CAL-001.3-CP04)", () => {
  /** Confirms a cancel that never returns a verdict, then closes the dialog. */
  async function loseCancel(user: ReturnType<typeof userEvent.setup>) {
    mockedCancel.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    await openCancelDialog(user);
    await user.click(confirmButton());
    const alert = await within(cancelDialog()).findByRole("alert");
    expect(alert).toHaveTextContent("may or may not have been cancelled");
    await waitFor(() => expect(alert).toHaveTextContent("still shown unchanged"));
    await user.click(within(cancelDialog()).getAllByRole("button", { name: "Close" }).at(-1)!);
    return screen.getByTestId("uncertain-block-notice");
  }

  /**
   * C1: the notice speaks about a *cancel*. Create's wording ("no matching
   * block is shown yet", "did not prove this request created it", "is now
   * shown") would tell the operator the opposite of what the board observed.
   */
  function expectNoCreateWording(notice: HTMLElement) {
    expect(notice).not.toHaveTextContent("Unconfirmed block request");
    expect(notice).not.toHaveTextContent("no matching block is shown yet");
    expect(notice).not.toHaveTextContent("is now shown on the server");
    expect(notice).not.toHaveTextContent("created it");
  }

  /** The block's own reason is labelled as such — it is not why the cancel was requested. */
  function expectCancelTitle(notice: HTMLElement, from: string, to: string) {
    expect(notice.querySelector("p")).toHaveTextContent(
      `Unconfirmed cancel request: block on room 101, [${addDaysIso(from, -1)}, ${addDaysIso(to, 1)}) · original block reason: ${REASON}`,
      { normalizeWhitespace: true }
    );
  }

  it("never re-sends: a board that still shows the segment at the sent version keeps the result unknown, and Check again only re-reads", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();

    const notice = await loseCancel(user);
    expectCancelTitle(notice, from, to);
    expect(notice).toHaveTextContent(
      `The board was checked and this block is still shown at version ${VERSION}, the version this request targeted. That does not prove the cancel failed.`
    );
    expect(notice).toHaveTextContent("This room stays locked for these nights and the request will not be sent again.");
    expectNoCreateWording(notice);

    // Another GET still shows the segment intact: the result stays unknown and
    // the lock stays, rather than being read as a failed cancel.
    const boardCallsBefore = mockedBoard.mock.calls.length;
    await user.click(within(notice).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBe(boardCallsBefore + 1));
    const after = screen.getByTestId("uncertain-block-notice");
    expect(after).toHaveTextContent("That does not prove the cancel failed.");
    expect(within(after).getByRole("button", { name: "Check again" })).toBeInTheDocument();
    expect(within(after).queryByRole("button", { name: "Dismiss notice" })).not.toBeInTheDocument();
    expect(screen.getByTitle(REASON)).toBeInTheDocument();
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  it("reports a segment that later disappears as a schedule change, never as proof this request cancelled it", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    await loseCancel(user);

    serveBoards(() => true);
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));

    await waitFor(() =>
      expect(screen.getByTestId("uncertain-block-notice")).toHaveTextContent(
        `This block is no longer shown at version ${VERSION}, the version this request targeted. That shows the schedule changed; it does not prove this request cancelled it.`
      )
    );
    const notice = screen.getByTestId("uncertain-block-notice");
    expectCancelTitle(notice, from, to);
    expectNoCreateWording(notice);
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  it("treats a segment returning at a different version as a schedule change too, with the same cautious wording", async () => {
    const user = userEvent.setup();
    const { from, to } = await renderLoadedBoard();
    await loseCancel(user);

    mockedBoard.mockImplementation((propertyId, boardFrom, boardTo) =>
      Promise.resolve({
        ok: true,
        data: boardFor(propertyId, boardFrom, boardTo, [
          { ...blockOn(from, to), segmentVersion: VERSION + 1 },
        ]),
      })
    );
    await user.click(within(screen.getByTestId("uncertain-block-notice")).getByRole("button", { name: "Check again" }));

    await waitFor(() =>
      expect(screen.getByTestId("uncertain-block-notice")).toHaveTextContent(
        `This block is no longer shown at version ${VERSION}, the version this request targeted. That shows the schedule changed; it does not prove this request cancelled it.`
      )
    );
    const notice = screen.getByTestId("uncertain-block-notice");
    expectCancelTitle(notice, from, to);
    expectNoCreateWording(notice);
    // The re-versioned segment is still on the board; nothing claims it was lifted.
    expect(screen.getByTitle(REASON)).toBeInTheDocument();
    expect(mockedCancel).toHaveBeenCalledTimes(1);
  });

  it("locks the room and its nights against every other write type, and leaves other rooms usable", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    await loseCancel(user);

    // The same block cannot be cancelled again from a fresh popover.
    await user.click(blockBar());
    const cancelAgain = within(popover()).getByRole("button", { name: "Cancel block" });
    expect(cancelAgain).toBeDisabled();
    await user.click(within(popover()).getByRole("button", { name: "Close" }));

    // A create over the locked room's nights is refused before sending; room
    // 102 over the same nights is still offered.
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const create = within(screen.getByRole("dialog", { name: "Create operational block" }));
    await user.selectOptions(create.getByLabelText("Room"), "room-101");
    await user.type(create.getByLabelText("Reason"), "Second");
    await user.click(create.getByRole("button", { name: "Review" }));
    expect(create.getByRole("alert")).toHaveTextContent("still unconfirmed");

    await user.selectOptions(create.getByLabelText("Room"), "room-102");
    await user.click(create.getByRole("button", { name: "Review" }));
    expect(create.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe("ReservationBoard — navigating away from a cancel (PMS-CAL-001.3-CP04)", () => {
  async function startPendingCancel(user: ReturnType<typeof userEvent.setup>) {
    const write = deferred<OperationalBlockCancelOutcome>();
    mockedCancel.mockImplementation(() => write.promise);
    await openCancelDialog(user);
    await user.click(confirmButton());
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    return write;
  }

  function switchToPropertyB() {
    const select = screen.getByLabelText("Property") as HTMLSelectElement;
    select.value = "prop-b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("keeps a success on its own board: the dialog reports it, and no notice lands on the new view", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const write = await startPendingCancel(user);

    await act(async () => {
      write.resolve({ kind: "cancelled", segment: null });
      switchToPropertyB();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    const status = within(cancelDialog()).getByRole("status");
    expect(status).toHaveTextContent("Operational block cancelled.");
    expect(status).toHaveTextContent("has not been re-read yet");
    expect(screen.queryByText(/^Block on room 101 cancelled/)).not.toBeInTheDocument();
  });

  it("after a correctable result on another board, the old dialog closes and can never send again", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const write = await startPendingCancel(user);
    const boardCallsBefore = mockedBoard.mock.calls.length;

    await act(async () => switchToPropertyB());
    await waitFor(() => expect(mockedBoard.mock.calls.length).toBeGreaterThan(boardCallsBefore));
    expect(cancelDialog()).toBeInTheDocument();

    await act(async () =>
      write.resolve({ kind: "rejected", status: 400, category: "validation", detail: "bad request" })
    );

    expect(queryCancelDialog()).not.toBeInTheDocument();
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a confirm that lands in the old dialog after its 400, before React has re-rendered it, sends nothing", async () => {
    const user = userEvent.setup();
    await renderLoadedBoard();
    const write = await startPendingCancel(user);
    await act(async () => switchToPropertyB());
    // The dialog has sent a request, so navigation left it open to report it.
    const form = cancelDialog().querySelector("form")!;

    // Same act: the 400 continuation runs and releases the submit lock, then a
    // confirm reaches the dialog React has not yet removed.
    await act(async () => {
      write.resolve({ kind: "rejected", status: 400, category: "validation", detail: "bad request" });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(form.isConnected).toBe(true);
      fireEvent.submit(form);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(queryCancelDialog()).not.toBeInTheDocument();
  });

  it("a Cancel block click that lands after a lock appeared, before the button re-renders disabled, opens nothing", async () => {
    const user = userEvent.setup();
    const { from } = await renderLoadedBoard();

    // A create on the same room whose response is lost, started and left pending.
    const create = deferred<Awaited<ReturnType<typeof createOperationalBlock>>>();
    mockedCreate.mockImplementation(() => create.promise);
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const createView = within(screen.getByRole("dialog", { name: "Create operational block" }));
    await user.selectOptions(createView.getByLabelText("Room"), "room-101");
    await user.type(createView.getByLabelText("Reason"), "Leak");
    await user.click(createView.getByRole("button", { name: "Review" }));
    await user.click(createView.getByRole("button", { name: "Create block" }));
    await user.click(createView.getAllByRole("button", { name: "Close" }).at(-1)!);

    // The popover opens while the lock does not exist yet, so the action is live.
    await user.click(blockBar());
    const cancelAction = within(popover()).getByRole("button", { name: "Cancel block" });
    expect(cancelAction).toBeEnabled();

    // Same act: the lost create lands (locking room 101 for [from, from+1),
    // which overlaps this block) and the click arrives before React re-renders.
    await act(async () => {
      create.resolve({ kind: "unknown", reason: "timeout" });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      cancelAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(queryCancelDialog()).not.toBeInTheDocument();
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(from).toBeTruthy();
  });
});

describe("ReservationBoard — a lock outstanding from another range (PMS-CAL-001.3-CP04)", () => {
  /**
   * The board-awaiting check is per board identity, so on a *different* range
   * it says nothing. What must still refuse a cancel there is the room/nights
   * lock itself: an unresolved write on room 101 keeps that room's overlapping
   * nights closed to every write type, on whatever range they are viewed from.
   */
  it("keeps the same block uncancellable from a range the lost write was not made on", async () => {
    const user = userEvent.setup();
    render(<ReservationBoard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());
    const [, from, to] = mockedBoard.mock.calls.at(-1)!;
    // One fixed segment spanning this range and the start of the next one.
    const spanning: ReservationBoardOperationalBlock = {
      ...blockOn(from, to),
      startDate: from,
      endDate: addDaysIso(to, 3),
    };
    mockedBoard.mockImplementation((propertyId, boardFrom, boardTo) =>
      Promise.resolve({ ok: true, data: boardFor(propertyId, boardFrom, boardTo, [spanning]) })
    );

    // A create on room 101 over the first night, whose response is lost.
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "timeout" });
    await user.click(screen.getByRole("button", { name: "Create operational block" }));
    const createView = within(screen.getByRole("dialog", { name: "Create operational block" }));
    await user.selectOptions(createView.getByLabelText("Room"), "room-101");
    await user.type(createView.getByLabelText("Reason"), "Leak");
    await user.click(createView.getByRole("button", { name: "Review" }));
    await user.click(createView.getByRole("button", { name: "Create block" }));
    await within(screen.getByRole("dialog", { name: "Create operational block" })).findByRole("alert");
    await user.click(createView.getAllByRole("button", { name: "Close" }).at(-1)!);

    await user.click(screen.getByRole("button", { name: "Next date range" }));
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![1]).toBe(to));
    // This range was never written to, so nothing is awaiting a re-read here…
    await waitFor(() => expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled());

    // …but the block's own room and nights are still locked.
    await user.click(screen.getByTitle(REASON));
    expect(within(popover()).getByRole("button", { name: "Cancel block" })).toBeDisabled();
    expect(mockedCancel).not.toHaveBeenCalled();
  });
});
