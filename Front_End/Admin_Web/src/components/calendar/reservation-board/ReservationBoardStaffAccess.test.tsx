/**
 * PMS-ADMIN-AUTH-001-CP06: the board in Staff mode — evidence groups 5–14 and 16
 * at board level. The API client is mocked: these tests prove the UI's
 * decisions (what is offered, what is sent, when the session is handed back);
 * the browser acceptance run against the real HTTPS backend proves the rest.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReservationBoard from "./ReservationBoard";
import { addDaysIso } from "./dateMath";
import { restoreUncertainWrites, tabStorage } from "./uncertainWriteStorage";
import type { BoardAccess } from "./calendarAccess";
import type { StaffMembership } from "@/lib/api/staff";
import type { ReservationBoardResponse } from "@/lib/api/types";
import type { AssignmentCreateOutcome } from "@/lib/api/client";

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
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
} from "@/lib/api/client";

const mockedCatalog = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedCreate = vi.mocked(createReservationAssignment);
const mockedMove = vi.mocked(moveReservationAssignment);
const mockedBlockCreate = vi.mocked(createOperationalBlock);

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  for (const mock of [mockedCatalog, mockedBoard, mockedCreate, mockedMove, mockedBlockCreate]) mock.mockReset();
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) }));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const BLOCK_REASON = "Leaking pipe";

function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
  return {
    property: { id: propertyId, name: propertyId === "prop-a" ? "Property A" : "Property B", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
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
    stays:
      propertyId === "prop-a"
        ? [
            {
              reservationId: "res-1",
              reservationUnitId: "unit-1",
              confirmationNumber: "CNF-100",
              guestDisplayName: "Nguyen Van A",
              soldRoomTypeId: "type-standard",
              checkIn: addDaysIso(from, -3),
              checkOut: addDaysIso(to, 5),
              coverageStatus: "PartiallyAssigned",
              assignments: [
                { segmentId: "seg-1", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: addDaysIso(from, 2), endDate: addDaysIso(from, 4) },
              ],
              unassignedRanges: [
                { startDate: from, endDate: addDaysIso(from, 2) },
                { startDate: addDaysIso(from, 4), endDate: to },
              ],
            },
          ]
        : [],
    operationalBlocks:
      propertyId === "prop-a"
        ? [{ roomBlockId: "block-1", segmentId: "seg-block", segmentVersion: 1, physicalRoomId: "room-102", startDate: addDaysIso(from, 6), endDate: addDaysIso(from, 8), reason: BLOCK_REASON }]
        : [],
  };
}

const membership = (propertyId: string, role: string): StaffMembership => ({
  propertyId,
  propertyName: propertyId === "prop-a" ? "Property A" : "Property B",
  timeZone: "Asia/Ho_Chi_Minh",
  role,
});

function staffAccess(memberships: StaffMembership[]) {
  const onSessionExpired = vi.fn();
  const refreshAccess = vi.fn().mockResolvedValue("authenticated" as const);
  const onWriteActivityChange = vi.fn();
  const access: BoardAccess = { mode: "Staff", memberships, onSessionExpired, refreshAccess, onWriteActivityChange };
  return { access, onSessionExpired, refreshAccess, onWriteActivityChange };
}

async function renderStaffBoard(memberships: StaffMembership[]) {
  const spies = staffAccess(memberships);
  const view = render(<ReservationBoard access={spies.access} />);
  await waitFor(() => expect(screen.getByTitle("Nguyen Van A — CNF-100")).toBeInTheDocument());
  const [, from, to] = mockedBoard.mock.calls.at(-1)!;
  return { ...spies, ...view, from, to };
}

const rangeBar = (from: string) =>
  screen.getByRole("button", { name: `Assign room: Nguyen Van A, CNF-100, unassigned ${from} to ${addDaysIso(from, 2)}` });
const assignDialog = () => screen.getByRole("dialog", { name: "Assign room" });
const roomLabels = () => within(assignDialog()).getAllByRole("radio").map((radio) => radio.closest("label")!.textContent);

describe("Staff mode: Properties come from the memberships only (group 6)", () => {
  it("lists the memberships, never reads the public catalog, reads the first Property's board, and switches on request", async () => {
    const user = userEvent.setup();
    await renderStaffBoard([membership("prop-a", "FrontDesk"), membership("prop-b", "Manager")]);
    expect(mockedCatalog).not.toHaveBeenCalled();
    expect(mockedBoard.mock.calls[0][0]).toBe("prop-a");
    const select = screen.getByLabelText("Property");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Property A", "Property B"]);
    await user.selectOptions(select, "prop-b");
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
  });

  it("with no membership, says so and reads no board", async () => {
    const { access } = staffAccess([]);
    render(<ReservationBoard access={access} />);
    expect(await screen.findByText(/not been granted access to any Property/)).toBeInTheDocument();
    expect(mockedBoard).not.toHaveBeenCalled();
    expect(mockedCatalog).not.toHaveBeenCalled();
  });

  it("drops the selected Property when a refreshed session no longer grants it", async () => {
    const first = await renderStaffBoard([membership("prop-a", "FrontDesk"), membership("prop-b", "FrontDesk")]);
    first.rerender(<ReservationBoard access={{ ...first.access, memberships: [membership("prop-b", "FrontDesk")] } as BoardAccess} />);
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    expect(screen.getByLabelText("Property")).toHaveValue("prop-b");
    first.rerender(<ReservationBoard access={{ ...first.access, memberships: [] } as BoardAccess} />);
    expect(await screen.findByText(/not been granted access to any Property/)).toBeInTheDocument();
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();
  });
});

describe("Staff mode: controls and handlers follow the role (groups 7, 8)", () => {
  it("an unknown role sees no board and reads none", async () => {
    const { access } = staffAccess([membership("prop-a", "Viewer")]);
    render(<ReservationBoard access={access} />);
    // Said both in the toolbar summary and in place of the board.
    expect(await screen.findAllByText(/does not include access to the Reservation Board/)).toHaveLength(2);
    expect(mockedBoard).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create operational block" })).toBeDisabled();
  });

  it("FrontDesk assigns within the sold room type only; Manager is also offered the other type", async () => {
    const user = userEvent.setup();
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    expect(screen.getByTestId("reservation-board-capabilities")).toHaveTextContent("a different room type needs a Manager");
    await user.click(rangeBar(desk.from));
    expect(roomLabels()).toEqual(["Room 101Floor 1", "Room 102Floor 1"]);
    desk.unmount();

    const manager = await renderStaffBoard([membership("prop-a", "Manager")]);
    await user.click(rangeBar(manager.from));
    expect(roomLabels()).toEqual(["Room 101Floor 1", "Room 102Floor 1", "Room 201DeluxeFloor 2"]);
  });

  it("FrontDesk's move offers no other room type; Manager's does", async () => {
    const user = userEvent.setup();
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(screen.getByRole("button", { name: "Move room" }));
    const moveDialog = () => screen.getByRole("dialog", { name: "Move room" });
    expect(within(moveDialog()).queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    desk.unmount();

    await renderStaffBoard([membership("prop-a", "Manager")]);
    await user.click(screen.getByTitle("Nguyen Van A — CNF-100"));
    await user.click(screen.getByRole("button", { name: "Move room" }));
    expect(within(moveDialog()).getByLabelText(/Room 201/)).toBeInTheDocument();
  });

  it("a role lowered while the dialog is open is refused at send time: no confirmed cross-RoomType request leaves", async () => {
    const user = userEvent.setup();
    const manager = await renderStaffBoard([membership("prop-a", "Manager")]);
    await user.click(rangeBar(manager.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 201/));
    await user.click(within(assignDialog()).getByLabelText(/deliberately chosen a room of a different room type/));
    await user.type(within(assignDialog()).getByLabelText("Reason"), "Upgrade");
    manager.rerender(<ReservationBoard access={{ ...manager.access, memberships: [membership("prop-a", "FrontDesk")] } as BoardAccess} />);
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 201" }));
    expect(await within(assignDialog()).findByText(/needs a Manager at this Property/)).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("Manager's confirmed cross-RoomType create sends exactly the allowed fields — no actor, role or evidence", async () => {
    const user = userEvent.setup();
    const manager = await renderStaffBoard([membership("prop-a", "Manager")]);
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });
    await user.click(rangeBar(manager.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 201/));
    await user.click(within(assignDialog()).getByLabelText(/deliberately chosen a room of a different room type/));
    await user.type(within(assignDialog()).getByLabelText("Reason"), "  Upgrade  ");
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 201" }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith("prop-a", {
      reservationUnitId: "unit-1",
      physicalRoomId: "room-201",
      startDate: manager.from,
      endDate: addDaysIso(manager.from, 2),
      confirmCrossRoomType: true,
      reason: "Upgrade",
    });
  });

  it("FrontDesk can block and cancel blocks; the popover offers Cancel block", async () => {
    const user = userEvent.setup();
    await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled();
    await user.click(screen.getByTitle(BLOCK_REASON));
    expect(within(screen.getByRole("dialog", { name: "Operational block details" })).getByRole("button", { name: "Cancel block" })).toBeInTheDocument();
  });
});

describe("Staff mode: 401 and 403 (groups 9, 10, 12)", () => {
  it("a board read 401 closes the board and hands the session back once — no loop, no retry", async () => {
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "http", status: 401, message: "Authentication required" } });
    const { access, onSessionExpired } = staffAccess([membership("prop-a", "FrontDesk")]);
    render(<ReservationBoard access={access} />);
    expect(await screen.findByText(/Your Staff session has ended, so this board is closed/)).toBeInTheDocument();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(mockedBoard).toHaveBeenCalledTimes(1);
  });

  it("a write 401 is settled as a rejection first — intent dropped, nothing resent — then the session is handed back", async () => {
    const user = userEvent.setup();
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    const answer = deferred<AssignmentCreateOutcome>();
    mockedCreate.mockReturnValue(answer.promise);
    await user.click(rangeBar(desk.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    // While the request is on the wire the page knows a write is pending (Sign out waits for it).
    await waitFor(() => expect(desk.onWriteActivityChange).toHaveBeenLastCalledWith(true));
    expect(restoreUncertainWrites(tabStorage(), 1).pendingTokens).toHaveLength(1);
    expect(desk.onSessionExpired).not.toHaveBeenCalled();

    await act(async () =>
      answer.resolve({ kind: "rejected", status: 401, category: "refused", detail: "Your Staff session has ended or is no longer valid. Nothing was saved. Sign in again to continue." })
    );
    expect(desk.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(desk.onWriteActivityChange).toHaveBeenLastCalledWith(false);
    const stored = restoreUncertainWrites(tabStorage(), 1);
    expect(stored.pendingTokens).toHaveLength(0);
    expect(stored.assignments).toHaveLength(0);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();
  });

  it("a successful write followed by a board 401 still says it was saved", async () => {
    const user = userEvent.setup();
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "http", status: 401, message: "Authentication required" } });
    await user.click(rangeBar(desk.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(desk.onSessionExpired).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Room 102 assigned to Nguyen Van A/)).toBeInTheDocument();
    expect(screen.getByText(/Saved on the server/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument();
  });

  it("a write 403 re-reads me once and never resends; it does not end the session", async () => {
    const user = userEvent.setup();
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    mockedCreate.mockResolvedValue({ kind: "rejected", status: 403, category: "not-permitted" });
    await user.click(rangeBar(desk.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(desk.refreshAccess).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(desk.onSessionExpired).not.toHaveBeenCalled();
    expect(within(assignDialog()).getByText(/not permitted/)).toBeInTheDocument();
  });

  it("the store's cross-RoomType 403 is not a permission problem: no me refresh", async () => {
    const user = userEvent.setup();
    const manager = await renderStaffBoard([membership("prop-a", "Manager")]);
    mockedCreate.mockResolvedValue({ kind: "rejected", status: 403, category: "cross-room-type-confirmation-required", detail: "reason" });
    await user.click(rangeBar(manager.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 201/));
    await user.click(within(assignDialog()).getByLabelText(/deliberately chosen a room of a different room type/));
    await user.type(within(assignDialog()).getByLabelText("Reason"), "Upgrade");
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 201" }));
    await waitFor(() => expect(within(assignDialog()).getByText(/was not confirmed/)).toBeInTheDocument());
    expect(manager.refreshAccess).not.toHaveBeenCalled();
  });

  it("a board read 403 shows none of that Property's data and re-reads me once", async () => {
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } });
    const { access, refreshAccess, onSessionExpired } = staffAccess([membership("prop-a", "FrontDesk")]);
    render(<ReservationBoard access={access} />);
    expect(await screen.findByText(/refused access to this Property's board/)).toBeInTheDocument();
    await waitFor(() => expect(refreshAccess).toHaveBeenCalledTimes(1));
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(mockedBoard).toHaveBeenCalledTimes(1);
  });

  it("a 403 whose me refresh finds no session ends it", async () => {
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } });
    const spies = staffAccess([membership("prop-a", "FrontDesk")]);
    spies.refreshAccess.mockResolvedValue("unauthenticated");
    render(<ReservationBoard access={spies.access} />);
    await waitFor(() => expect(spies.onSessionExpired).toHaveBeenCalledTimes(1));
  });
});

describe("Staff mode: stale answers (group 11)", () => {
  it("a board answer for the Property just left is never drawn", async () => {
    const user = userEvent.setup();
    const late = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    const { access } = staffAccess([membership("prop-a", "FrontDesk"), membership("prop-b", "FrontDesk")]);
    mockedBoard.mockImplementation((propertyId, from, to) =>
      propertyId === "prop-a" ? late.promise : Promise.resolve({ ok: true, data: boardFor(propertyId, from, to) })
    );
    render(<ReservationBoard access={access} />);
    await waitFor(() => expect(mockedBoard).toHaveBeenCalledTimes(1));
    const [, from, to] = mockedBoard.mock.calls[0];
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await waitFor(() => expect(mockedBoard.mock.calls.at(-1)![0]).toBe("prop-b"));
    await act(async () => late.resolve({ ok: true, data: boardFor("prop-a", from, to) }));
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();
  });
});

describe("Staff mode: unconfirmed writes outlive the session (groups 12, 13, 14)", () => {
  it("an unknown create stays recorded and locked across sign-out and another Staff member at the same Property", async () => {
    const user = userEvent.setup();
    const manager = await renderStaffBoard([membership("prop-a", "Manager")]);
    mockedCreate.mockResolvedValue({ kind: "unknown", reason: "network" });
    await user.click(rangeBar(manager.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    await waitFor(() => expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(1));
    manager.unmount(); // sign-out / expiry: the board goes away with the session

    // Another Staff member with no membership there: nothing about it is shown, the record stays.
    const other = staffAccess([membership("prop-b", "FrontDesk")]);
    const otherView = render(<ReservationBoard access={other.access} />);
    await waitFor(() => expect(screen.getByLabelText("Property")).toHaveValue("prop-b"));
    expect(screen.queryByTestId("uncertain-write-notice")).not.toBeInTheDocument();
    expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(1);
    otherView.unmount();

    // A FrontDesk member of the same Property sees the unconfirmed request, and cannot send it again.
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    expect(await screen.findByTestId("uncertain-write-notice")).toHaveTextContent(/Unconfirmed room assignment request/);
    await user.click(rangeBar(desk.from));
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses to send when this tab cannot record the write's intent", async () => {
    const user = userEvent.setup();
    const desk = await renderStaffBoard([membership("prop-a", "FrontDesk")]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await user.click(rangeBar(desk.from));
    await user.click(within(assignDialog()).getByLabelText(/Room 102/));
    await user.click(within(assignDialog()).getByRole("button", { name: "Assign room 102" }));
    expect(await within(assignDialog()).findByText(/could not keep the safety record/)).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe("LocalGate stays as it was (group 16)", () => {
  it("reads the public catalog, offers every room type and needs no session", async () => {
    const user = userEvent.setup();
    mockedCatalog.mockResolvedValue({ ok: true, data: [{ id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" }] });
    render(<ReservationBoard />);
    await waitFor(() => expect(screen.getByTitle("Nguyen Van A — CNF-100")).toBeInTheDocument());
    expect(mockedCatalog).toHaveBeenCalledTimes(1);
    const [, from] = mockedBoard.mock.calls.at(-1)!;
    expect(screen.getByTestId("reservation-board-capabilities")).toHaveTextContent("AccessMode=LocalGate");
    await user.click(rangeBar(from));
    expect(roomLabels()).toEqual(["Room 101Floor 1", "Room 102Floor 1", "Room 201DeluxeFloor 2"]);
  });
});
