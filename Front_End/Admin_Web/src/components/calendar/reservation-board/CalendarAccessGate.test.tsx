/**
 * PMS-ADMIN-AUTH-001-CP06 evidence groups 1, 4, 5 and 9: what stands in front of
 * the Reservation Board on /calendar.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSessionResult } from "@/lib/api/staff";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/api/staff", () => ({ fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createReservationAssignment: vi.fn(),
  moveReservationAssignment: vi.fn(),
  unassignReservationAssignment: vi.fn(),
  createOperationalBlock: vi.fn(),
  cancelOperationalBlock: vi.fn(),
}));

import CalendarAccessGate from "./CalendarAccessGate";
import { addDaysIso } from "./dateMath";
import { restoreUncertainWrites, tabStorage } from "./uncertainWriteStorage";
import { fetchStaffSession, staffLogout, type StaffLogoutOutcome } from "@/lib/api/staff";
import {
  cancelOperationalBlock,
  createOperationalBlock,
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
  unassignReservationAssignment,
} from "@/lib/api/client";
import type { ReservationBoardResponse } from "@/lib/api/types";

const mockedMe = vi.mocked(fetchStaffSession);
const mockedLogout = vi.mocked(staffLogout);
const mockedCatalog = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);
const mockedCreate = vi.mocked(createReservationAssignment);
const mockedMove = vi.mocked(moveReservationAssignment);
const mockedUnassign = vi.mocked(unassignReservationAssignment);
const mockedBlockCreate = vi.mocked(createOperationalBlock);
const mockedBlockCancel = vi.mocked(cancelOperationalBlock);

const SESSION = {
  staffAccountId: "11111111-1111-1111-1111-111111111111",
  email: "desk@example.com",
  memberships: [{ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }],
};

function emptyBoard(propertyId: string, from: string, to: string) {
  return {
    ok: true as const,
    data: {
      property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
      from,
      to,
      roomTypes: [{ id: "type-standard", code: "STD", name: "Standard", isActive: true }],
      physicalRooms: [{ id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" }],
      stays: [],
      operationalBlocks: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  sessionStorage.clear();
  replace.mockReset();
  for (const mock of [mockedMe, mockedLogout, mockedCatalog, mockedBoard, mockedCreate, mockedMove, mockedUnassign, mockedBlockCreate, mockedBlockCancel]) {
    mock.mockReset();
  }
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve(emptyBoard(propertyId, from, to)));
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});

afterEach(() => vi.unstubAllEnvs());

describe("CalendarAccessGate", () => {
  it("an invalid mode shows a configuration error and sends nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staf");
    render(<CalendarAccessGate />);
    expect(screen.getByTestId("calendar-config-error")).toHaveTextContent(/must be exactly LocalGate or Staff/);
    expect(mockedMe).not.toHaveBeenCalled();
    expect(mockedCatalog).not.toHaveBeenCalled();
    expect(mockedBoard).not.toHaveBeenCalled();
  });

  it("LocalGate: the board as before — public catalog, no session check", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    mockedCatalog.mockResolvedValue({ ok: true, data: [{ id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" }] });
    render(<CalendarAccessGate />);
    await waitFor(() => expect(mockedBoard).toHaveBeenCalled());
    expect(mockedCatalog).toHaveBeenCalledTimes(1);
    expect(mockedMe).not.toHaveBeenCalled();
  });

  it("Staff: nothing of the board — and no board or catalog request — before me confirms a session", async () => {
    const me = deferred<StaffSessionResult>();
    mockedMe.mockReturnValue(me.promise);
    render(<CalendarAccessGate />);
    expect(screen.getByTestId("staff-session-checking")).toBeInTheDocument();
    expect(mockedBoard).not.toHaveBeenCalled();
    expect(mockedCatalog).not.toHaveBeenCalled();
    await act(async () => me.resolve({ kind: "authenticated", session: SESSION }));
    expect(screen.getByTestId("staff-identity")).toHaveTextContent("Signed in as desk@example.com");
    await waitFor(() => expect(mockedBoard).toHaveBeenCalledTimes(1));
    expect(mockedBoard.mock.calls[0][0]).toBe("prop-a");
    expect(mockedCatalog).not.toHaveBeenCalled();
  });

  it("Staff without a session goes to /signin once and reads no board", async () => {
    mockedMe.mockResolvedValue({ kind: "unauthenticated" });
    render(<CalendarAccessGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(mockedMe).toHaveBeenCalledTimes(1);
    expect(mockedBoard).not.toHaveBeenCalled();
  });

  it("a failed check is an error with Retry — never a redirect, never LocalGate", async () => {
    mockedMe.mockResolvedValueOnce({ kind: "error", message: "Could not reach the Admin API to check your Staff session." });
    render(<CalendarAccessGate />);
    expect(await screen.findByTestId("staff-session-error")).toHaveTextContent(/Could not reach the Admin API/);
    expect(replace).not.toHaveBeenCalled();
    expect(mockedCatalog).not.toHaveBeenCalled();
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: SESSION });
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("staff-identity")).toBeInTheDocument();
  });

  it("Sign out: a confirmed logout closes the board and goes to /signin", async () => {
    const user = userEvent.setup();
    mockedMe.mockResolvedValue({ kind: "authenticated", session: SESSION });
    mockedLogout.mockResolvedValue({ kind: "logged-out" });
    render(<CalendarAccessGate />);
    await waitFor(() => expect(mockedBoard).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-session-required")).toHaveTextContent("You have signed out.");
  });

  it("Sign out: an unconfirmed logout says so and keeps the session as it is", async () => {
    const user = userEvent.setup();
    mockedMe.mockResolvedValue({ kind: "authenticated", session: SESSION });
    mockedLogout.mockResolvedValue({ kind: "unconfirmed", message: "The Admin API did not confirm sign-out (HTTP 403). Your session may still be active." });
    render(<CalendarAccessGate />);
    await waitFor(() => expect(mockedBoard).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await within(screen.getByTestId("staff-identity")).findByRole("alert")).toHaveTextContent(/did not confirm sign-out/);
    expect(replace).not.toHaveBeenCalled();
  });

  it("a board read 401 ends the session once and goes to /signin — no loop", async () => {
    mockedMe.mockResolvedValue({ kind: "authenticated", session: SESSION });
    mockedBoard.mockResolvedValue({ ok: false, error: { kind: "http", status: 401, message: "Authentication required" } });
    render(<CalendarAccessGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(screen.getByTestId("staff-session-required")).toHaveTextContent("Your Staff session has ended.");
    expect(mockedBoard).toHaveBeenCalledTimes(1);
    expect(mockedMe).toHaveBeenCalledTimes(1);
  });
});

/** CP06-C1: a board with something for each of the five writes (prop-a). */
const BLOCK_REASON = "Leaking pipe";
function staffBoard(propertyId: string, from: string, to: string): ReservationBoardResponse {
  return {
    property: { id: propertyId, name: "Property A", timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
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
    stays: [
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
    ],
    operationalBlocks: [
      { roomBlockId: "block-1", segmentId: "seg-block", segmentVersion: 1, physicalRoomId: "room-102", startDate: addDaysIso(from, 6), endDate: addDaysIso(from, 8), reason: BLOCK_REASON },
    ],
  };
}

type User = ReturnType<typeof userEvent.setup>;
const stayBar = () => screen.getByTitle("Nguyen Van A — CNF-100");
const signOutButton = () => within(screen.getByTestId("staff-identity")).getByRole("button", { name: /Sign(ing)? out/ });
const dialogNamed = (name: string) => screen.getByRole("dialog", { name });

/** Each write: how to get to its final submit button, and its API mock. */
const WRITES = {
  "create assignment": {
    mock: () => mockedCreate,
    async open(user: User, from: string) {
      await user.click(screen.getByRole("button", { name: `Assign room: Nguyen Van A, CNF-100, unassigned ${from} to ${addDaysIso(from, 2)}` }));
      await user.click(within(dialogNamed("Assign room")).getByLabelText(/Room 102/));
      return within(dialogNamed("Assign room")).getByRole("button", { name: "Assign room 102" });
    },
  },
  "move assignment": {
    mock: () => mockedMove,
    async open(user: User) {
      await user.click(stayBar());
      await user.click(within(dialogNamed("Reservation details")).getByRole("button", { name: "Move room" }));
      await user.click(within(dialogNamed("Move room")).getByLabelText(/Room 102/));
      return within(dialogNamed("Move room")).getByRole("button", { name: "Move to room 102" });
    },
  },
  unassign: {
    mock: () => mockedUnassign,
    async open(user: User) {
      await user.click(stayBar());
      await user.click(within(dialogNamed("Reservation details")).getByRole("button", { name: "Remove room assignment" }));
      return within(dialogNamed("Remove room assignment")).getByRole("button", { name: "Remove room 101 assignment" });
    },
  },
  "create block": {
    mock: () => mockedBlockCreate,
    async open(user: User) {
      await user.click(screen.getByRole("button", { name: "Create operational block" }));
      const view = within(dialogNamed("Create operational block"));
      await user.selectOptions(view.getByLabelText("Room"), "room-101");
      await user.type(view.getByLabelText("Reason"), "Painting");
      await user.click(view.getByRole("button", { name: "Review" }));
      return within(dialogNamed("Create operational block")).getByRole("button", { name: "Create block" });
    },
    // A not-sent block returns to the form for a deliberate correction (the dialog's own rule): review again.
    async resend(user: User) {
      const view = within(dialogNamed("Create operational block"));
      await user.click(view.getByRole("button", { name: "Review" }));
      await user.click(view.getByRole("button", { name: "Create block" }));
    },
  },
  "cancel block": {
    mock: () => mockedBlockCancel,
    async open(user: User) {
      await user.click(screen.getByTitle(BLOCK_REASON));
      await user.click(within(dialogNamed("Operational block details")).getByRole("button", { name: "Cancel block" }));
      return within(dialogNamed("Cancel operational block")).getByRole("button", { name: /^Cancel block on room/ });
    },
  },
} as const;
type WriteName = keyof typeof WRITES;
const WRITE_NAMES = Object.keys(WRITES) as WriteName[];

/** What each write's API answers on success. */
const SUCCESS: Record<WriteName, unknown> = {
  "create assignment": { kind: "created", segment: null },
  "move assignment": { kind: "moved", segments: null },
  unassign: { kind: "unassigned", segments: null },
  "create block": { kind: "created", block: null },
  "cancel block": { kind: "cancelled", segment: null },
};

async function renderSignedIn() {
  mockedMe.mockResolvedValue({ kind: "authenticated", session: SESSION });
  mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true as const, data: staffBoard(propertyId, from, to) }));
  render(<CalendarAccessGate />);
  await waitFor(() => expect(stayBar()).toBeInTheDocument());
  const [, from] = mockedBoard.mock.calls.at(-1)!;
  return { user: userEvent.setup(), from };
}

const storedIntents = () => {
  const stored = restoreUncertainWrites(tabStorage(), 1);
  return stored.pendingTokens.length + stored.assignments.length + stored.blocks.length;
};

describe("CP06-C1 F1: a confirmed sign-out is never undone by a refresh", () => {
  it("a board read 403 while logout is pending: logout 204 still closes the board and goes to /signin once", async () => {
    const user = userEvent.setup();
    mockedMe.mockResolvedValue({ kind: "authenticated", session: SESSION });
    const read = deferred<Awaited<ReturnType<typeof fetchReservationBoard>>>();
    mockedBoard.mockReturnValueOnce(read.promise);
    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    render(<CalendarAccessGate />);
    await waitFor(() => expect(mockedBoard).toHaveBeenCalledTimes(1));

    await user.click(signOutButton());
    await act(async () => read.resolve({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } }));
    await act(async () => logout.resolve({ kind: "logged-out" }));

    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-session-required")).toHaveTextContent("You have signed out.");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/signin");
    expect(mockedMe).toHaveBeenCalledTimes(1); // the 403's re-read never ran over the sign-out
  });
});

describe("CP06-C1 F2: no new write while sign-out is waiting for the server", () => {
  it("every write control is closed while logout is pending, and reopens when it is not confirmed", async () => {
    const { user, from } = await renderSignedIn();
    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    await user.click(signOutButton());

    expect(screen.getByRole("button", { name: "Create operational block" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: `Assign room: Nguyen Van A, CNF-100, unassigned ${from} to ${addDaysIso(from, 2)}` }));
    expect(screen.queryByRole("dialog", { name: "Assign room" })).not.toBeInTheDocument();
    await user.click(stayBar());
    expect(within(dialogNamed("Reservation details")).queryByRole("button", { name: "Move room" })).not.toBeInTheDocument();
    expect(within(dialogNamed("Reservation details")).queryByRole("button", { name: "Remove room assignment" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByTitle(BLOCK_REASON));
    expect(within(dialogNamed("Operational block details")).queryByRole("button", { name: "Cancel block" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Positive control: an unconfirmed logout gives the controls back.
    await act(async () => logout.resolve({ kind: "unconfirmed", message: "The Admin API did not confirm sign-out (HTTP 403). Your session may still be active." }));
    expect(screen.getByRole("button", { name: "Create operational block" })).toBeEnabled();
    await user.click(stayBar());
    expect(within(dialogNamed("Reservation details")).getByRole("button", { name: "Move room" })).toBeInTheDocument();
  });

  it.each(WRITE_NAMES)("%s: a dialog opened before Sign out sends nothing and records no intent once sign-out has started", async (name) => {
    const { user, from } = await renderSignedIn();
    const submit = await WRITES[name].open(user, from);
    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    await user.click(signOutButton());

    await user.click(submit);
    expect(WRITES[name].mock()).not.toHaveBeenCalled();
    expect(storedIntents()).toBe(0);
    expect(await screen.findByText(/Signing out — this change was not sent/)).toBeInTheDocument();

    // Positive control: once the logout is reported unconfirmed, the same change can be sent.
    await act(async () => logout.resolve({ kind: "unconfirmed", message: "not confirmed" }));
    WRITES[name].mock().mockResolvedValue(SUCCESS[name] as never);
    const write = WRITES[name] as { resend?: (user: User) => Promise<void> };
    if (write.resend) await write.resend(user);
    else await user.click(submit);
    await waitFor(() => expect(WRITES[name].mock()).toHaveBeenCalledTimes(1));
  });

  it.each(WRITE_NAMES)("%s: in one tick, Sign out then submit — the submit handler of the earlier render sends nothing", async (name) => {
    const { user, from } = await renderSignedIn();
    const submit = await WRITES[name].open(user, from);
    mockedLogout.mockReturnValueOnce(new Promise(() => {}));
    const button = signOutButton();
    act(() => {
      button.click();
      submit.click(); // no re-render in between: the board still holds the pre-sign-out handlers
    });
    expect(mockedLogout).toHaveBeenCalledTimes(1);
    expect(WRITES[name].mock()).not.toHaveBeenCalled();
    expect(storedIntents()).toBe(0);
  });

  it("an existing unconfirmed record is not touched by a refused write", async () => {
    const { user, from } = await renderSignedIn();
    mockedCreate.mockResolvedValueOnce({ kind: "unknown", reason: "network" });
    const first = await WRITES["create assignment"].open(user, from);
    await user.click(first);
    await waitFor(() => expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(1));
    const before = sessionStorage.getItem("thebha.adminCalendar.uncertainWrites");
    await user.keyboard("{Escape}");

    const submit = await WRITES["create block"].open(user);
    mockedLogout.mockReturnValueOnce(new Promise(() => {}));
    await user.click(signOutButton());
    await user.click(submit);
    expect(mockedBlockCreate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("thebha.adminCalendar.uncertainWrites")).toBe(before);
    expect(await screen.findByText(/Signing out — this change was not sent/)).toBeInTheDocument();
  });

  it.each([
    ["success", { kind: "created", segment: null } as const, /Saved on the server/],
    ["unknown", { kind: "unknown", reason: "network" } as const, /could not be confirmed/],
  ])("a write already on the wire holds Sign out until its %s outcome is settled", async (_label, outcome, shown) => {
    const { user, from } = await renderSignedIn();
    const answer = deferred<Awaited<ReturnType<typeof createReservationAssignment>>>();
    mockedCreate.mockReturnValueOnce(answer.promise);
    const submit = await WRITES["create assignment"].open(user, from);
    await user.click(submit);
    expect(signOutButton()).toBeDisabled();
    await user.click(signOutButton());
    expect(mockedLogout).not.toHaveBeenCalled();

    await act(async () => answer.resolve(outcome));
    expect(await screen.findAllByText(shown)).not.toHaveLength(0);
    const recorded = restoreUncertainWrites(tabStorage(), 1).assignments.length;
    expect(recorded).toBe(outcome.kind === "unknown" ? 1 : 0);

    mockedLogout.mockResolvedValueOnce({ kind: "logged-out" });
    await user.click(signOutButton());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(mockedLogout).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(recorded);
  });

  it.each(WRITE_NAMES)("%s: in one tick, submit then Sign out — the write goes, the logout does not", async (name) => {
    const { user, from } = await renderSignedIn();
    const submit = await WRITES[name].open(user, from);
    WRITES[name].mock().mockReturnValue(new Promise(() => {}) as never);
    const button = signOutButton();
    act(() => {
      submit.click();
      button.click(); // the gate has not re-rendered since the write started
    });
    expect(WRITES[name].mock()).toHaveBeenCalledTimes(1);
    expect(mockedLogout).not.toHaveBeenCalled();
  });
});

describe("CP06-C1: LocalGate is not affected", () => {
  it("writes go out with no session, sign-out or lock involved", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    mockedCatalog.mockResolvedValue({ ok: true, data: [{ id: "prop-a", name: "Property A", timeZone: "Asia/Ho_Chi_Minh" }] });
    mockedBoard.mockImplementation((propertyId, from, to) => Promise.resolve({ ok: true as const, data: staffBoard(propertyId, from, to) }));
    mockedCreate.mockResolvedValue({ kind: "created", segment: null });
    render(<CalendarAccessGate />);
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    const [, from] = mockedBoard.mock.calls.at(-1)!;
    const submit = await WRITES["create assignment"].open(userEvent.setup(), from);
    await userEvent.setup().click(submit);
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedMe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
  });
});

/** CP06-C2: a session with the given memberships (Property A/B of the staff board fixture). */
const sessionWith = (...memberships: [string, string][]) => ({
  ...SESSION,
  memberships: memberships.map(([propertyId, role]) => ({
    propertyId,
    propertyName: propertyId === "prop-a" ? "Property A" : "Property B",
    timeZone: "Asia/Ho_Chi_Minh",
    role,
  })),
});
const createBlockButton = () => screen.getByRole("button", { name: "Create operational block" });
const capabilities = () => screen.getByTestId("reservation-board-capabilities");
const propertyOptions = () => within(screen.getByLabelText("Property")).getAllByRole("option").map((option) => option.textContent);

/** Signed in with `initial`; prop-a's board loads, prop-b's read is refused (403). */
async function renderStaff(initial: ReturnType<typeof sessionWith>) {
  mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: initial });
  mockedBoard.mockImplementation((propertyId, from, to) =>
    Promise.resolve(
      propertyId === "prop-b"
        ? { ok: false as const, error: { kind: "http" as const, status: 403, message: "Access denied" } }
        : { ok: true as const, data: staffBoard(propertyId, from, to) }
    )
  );
  render(<CalendarAccessGate />);
  await waitFor(() => expect(stayBar()).toBeInTheDocument());
  const [, from] = mockedBoard.mock.calls.at(-1)!;
  return { user: userEvent.setup(), from };
}

/** A board read of prop-b is refused (a denial: the board re-reads me), then prop-a is shown again. */
async function denialViaPropertyB(user: User) {
  await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
  expect(await screen.findByText(/refused access to this Property's board/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Property"), "prop-a");
  await waitFor(() => expect(stayBar()).toBeInTheDocument());
}

describe("CP06-C2: an unconfirmed sign-out resumes writes only on roles checked again", () => {
  const unconfirmed = { kind: "unconfirmed", message: "The Admin API did not confirm sign-out (HTTP 403). Your session may still be active." } as const;

  it("F1: a 403 re-read already on the wire when Sign out is clicked is redone; writes stay closed until it answers, then follow the new role", async () => {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"]));
    mockedCreate.mockResolvedValueOnce({ kind: "rejected", status: 403, category: "not-permitted" });
    const interrupted = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(interrupted.promise);
    await user.click(await WRITES["create assignment"].open(user, from));
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2)); // the 403's re-read is on the wire

    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    await user.click(signOutButton());
    const recovery = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(recovery.promise);
    await act(async () => logout.resolve(unconfirmed));

    expect(mockedMe).toHaveBeenCalledTimes(3); // the interrupted check is redone
    expect(createBlockButton()).toBeDisabled(); // and nothing can be written meanwhile
    expect(signOutButton()).toHaveTextContent("Signing out…");

    await act(async () => recovery.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) }));
    await act(async () => interrupted.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "Manager"]) })); // stale, late
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(createBlockButton()).toBeEnabled();
    expect(signOutButton()).toHaveTextContent(/^Sign out$/);
    expect(mockedCreate).toHaveBeenCalledTimes(1); // nothing resent
  });

  it("F2: a second denial during the recovery joins it — writes stay closed until it answers, then follow the new memberships", async () => {
    const { user } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    await user.click(signOutButton());
    await denialViaPropertyB(user); // first denial: the re-read waits for the sign-out
    expect(mockedMe).toHaveBeenCalledTimes(1);

    const recovery = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(recovery.promise);
    await act(async () => logout.resolve(unconfirmed));
    expect(mockedMe).toHaveBeenCalledTimes(2);

    mockedMe.mockReturnValueOnce(new Promise(() => {})); // what a new read would get
    await denialViaPropertyB(user); // second denial, while the recovery is on the wire
    expect(mockedMe).toHaveBeenCalledTimes(2);
    expect(createBlockButton()).toBeDisabled();
    expect(signOutButton()).toHaveTextContent("Signing out…");

    await act(async () => recovery.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) }));
    expect(propertyOptions()).toEqual(["Property A"]);
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(createBlockButton()).toBeEnabled();
    expect(mockedLogout).toHaveBeenCalledTimes(1);
  });

  it("a recovery that finds no session closes the board and goes to /signin once", async () => {
    const { user } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    await user.click(signOutButton());
    await denialViaPropertyB(user);
    mockedMe.mockResolvedValueOnce({ kind: "unauthenticated" });
    await act(async () => logout.resolve(unconfirmed));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-session-required")).toHaveTextContent("Your Staff session has ended.");
  });

  it("a recovery that cannot check access closes the board — not signed out, nothing written on the old roles — and Retry restores it", async () => {
    const { user } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    const logout = deferred<StaffLogoutOutcome>();
    mockedLogout.mockReturnValueOnce(logout.promise);
    await user.click(signOutButton());
    await denialViaPropertyB(user);
    mockedMe.mockResolvedValueOnce({ kind: "error", message: "Could not reach the Admin API to check your Staff session." });
    await act(async () => logout.resolve(unconfirmed));

    const panel = await screen.findByTestId("staff-session-error");
    expect(panel).toHaveTextContent(/Sign-out was not confirmed, and your access could not be checked/);
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) });
    await user.click(within(panel).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(propertyOptions()).toEqual(["Property A"]);
  });

  it.each([
    ["204", { kind: "logged-out" } as const],
    ["401", { kind: "session-ended" } as const],
  ])("a confirmed logout (%s) with a re-read on the wire closes the board, goes to /signin once and redoes nothing", async (_status, confirmed) => {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"]));
    mockedCreate.mockResolvedValueOnce({ kind: "rejected", status: 403, category: "not-permitted" });
    const interrupted = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(interrupted.promise);
    await user.click(await WRITES["create assignment"].open(user, from));
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));
    mockedLogout.mockResolvedValueOnce(confirmed);
    await user.click(signOutButton());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    await act(async () => interrupted.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "Manager"]) }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(mockedMe).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
  });
});

describe("CP06-C3: a permission re-read after a denial that cannot answer closes access with Retry", () => {
  const ERRORS = [
    ["network/CORS", "Could not reach the Admin API to check your Staff session."],
    ["5xx", "The Admin API could not check your Staff session (HTTP 503)."],
    ["unreadable 200", "The Admin API returned an unreadable Staff session."],
  ] as const;
  const notPermitted = { kind: "rejected", status: 403, category: "not-permitted" } as const;
  const accessError = () => screen.findByTestId("staff-session-error");
  const nextRange = () => screen.getByRole("button", { name: "Next date range" });

  /** A Manager at prop-a (and prop-b) whose operational-block write is refused (403). */
  async function blockWriteDenied(meAnswer: StaffSessionResult | Promise<StaffSessionResult>) {
    const view = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    mockedBlockCreate.mockResolvedValueOnce(notPermitted);
    if (meAnswer instanceof Promise) mockedMe.mockReturnValueOnce(meAnswer);
    else mockedMe.mockResolvedValueOnce(meAnswer);
    await view.user.click(await WRITES["create block"].open(view.user));
    return view;
  }

  it.each(ERRORS)("operational-block write 403, then me fails (%s): access closes with Retry — no sign-in, nothing more sent", async (_kind, message) => {
    const { user } = await blockWriteDenied({ kind: "error", message });
    const panel = await accessError();
    expect(panel).toHaveTextContent(`Your Staff access could not be checked again: ${message} Retry to check it.`);
    expect(panel).not.toHaveTextContent(/Sign-out/);
    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(mockedLogout).not.toHaveBeenCalled();
    expect(mockedBlockCreate).toHaveBeenCalledTimes(1);

    // Retry reads me again and opens only what the server grants now: a lower role, one Property fewer.
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) });
    await user.click(within(panel).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(propertyOptions()).toEqual(["Property A"]);
    expect(createBlockButton()).toBeEnabled();
  });

  it("board read 403, then me fails: the same — and Retry that fails again stays closed; Retry that finds no session goes to /signin once", async () => {
    const { user } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    mockedMe.mockResolvedValueOnce({ kind: "error", message: ERRORS[0][1] });
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b");
    expect(await accessError()).toHaveTextContent("Your Staff access could not be checked again");
    expect(replace).not.toHaveBeenCalled();

    mockedMe.mockResolvedValueOnce({ kind: "error", message: ERRORS[1][1] });
    await user.click(within(await accessError()).getByRole("button", { name: "Retry" }));
    expect(await accessError()).toHaveTextContent(ERRORS[1][1]);
    expect(screen.queryByTitle("Nguyen Van A — CNF-100")).not.toBeInTheDocument();

    mockedMe.mockResolvedValueOnce({ kind: "unauthenticated" });
    await user.click(within(await accessError()).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("while the re-read is on the wire no write can start — controls closed, and a dialog opened before the denial sends nothing", async () => {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"]));
    const submit = await WRITES["create assignment"].open(user, from); // open before the denial
    const me = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(me.promise);
    mockedBoard.mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } });
    await user.click(nextRange()); // a board read refused while the dialog stays open
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));

    await user.click(submit);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(storedIntents()).toBe(0);
    expect(await within(dialogNamed("Assign room")).findByText(/Checking your access again/)).toBeInTheDocument();
    expect(createBlockButton()).toBeDisabled();

    // Positive control: the re-read answers — the new role applies, then writes reopen on it.
    await act(async () => me.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Previous date range" }));
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(createBlockButton()).toBeEnabled();
  });

  it.each([
    ["success", { kind: "created", segment: null } as const, 0],
    ["unknown", { kind: "unknown", reason: "network" } as const, 1],
  ])("a write already on the wire when the re-read fails is settled first (%s): its record kept, then access closes", async (_label, outcome, records) => {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"]));
    const answer = deferred<Awaited<ReturnType<typeof createReservationAssignment>>>();
    mockedCreate.mockReturnValueOnce(answer.promise);
    await user.click(await WRITES["create assignment"].open(user, from));
    mockedBoard.mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } });
    mockedMe.mockResolvedValueOnce({ kind: "error", message: ERRORS[0][1] });
    await user.click(nextRange()); // denial while the write is on the wire
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument(); // not before the write is settled
    expect(restoreUncertainWrites(tabStorage(), 1).pendingTokens).toHaveLength(1);

    await act(async () => answer.resolve(outcome));
    expect(await accessError()).toHaveTextContent("Your Staff access could not be checked again");
    const stored = restoreUncertainWrites(tabStorage(), 1);
    expect(stored.pendingTokens).toHaveLength(0);
    expect(stored.assignments).toHaveLength(records);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("an unconfirmed record already in the tab survives the error, Retry and a reload, and stays locked", async () => {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"]));
    mockedCreate.mockResolvedValueOnce({ kind: "unknown", reason: "network" });
    await user.click(await WRITES["create assignment"].open(user, from));
    await waitFor(() => expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(1));
    const before = sessionStorage.getItem("thebha.adminCalendar.uncertainWrites");
    await user.keyboard("{Escape}");

    mockedBlockCreate.mockResolvedValueOnce(notPermitted);
    mockedMe.mockResolvedValueOnce({ kind: "error", message: ERRORS[0][1] });
    await user.click(await WRITES["create block"].open(user));
    await accessError();
    expect(sessionStorage.getItem("thebha.adminCalendar.uncertainWrites")).toBe(before);

    mockedMe.mockResolvedValue({ kind: "authenticated", session: sessionWith(["prop-a", "Manager"]) });
    await user.click(within(await accessError()).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("uncertain-write-notice")).toHaveTextContent(/Unconfirmed room assignment request/);
    cleanup(); // a reload: the page goes, the tab's storage stays
    render(<CalendarAccessGate />);
    expect(await screen.findByTestId("uncertain-write-notice")).toHaveTextContent(/Unconfirmed room assignment request/);
    expect(sessionStorage.getItem("thebha.adminCalendar.uncertainWrites")).toBe(before);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("an older re-read that answers after the newer one failed does not reopen access", async () => {
    const { user } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    const older = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(older.promise);
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b"); // first denial: re-read on the wire
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));
    mockedMe.mockResolvedValueOnce({ kind: "error", message: ERRORS[0][1] });
    await user.selectOptions(screen.getByLabelText("Property"), "prop-a");
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b"); // second denial: its re-read fails
    expect(await accessError()).toBeInTheDocument();
    await act(async () => older.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]) }));
    expect(screen.getByTestId("staff-session-error")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-identity")).not.toBeInTheDocument();
  });
});

describe("CP06-C4: a failed check deferred behind a write belongs to that check — a newer check replaces it", () => {
  const A_ERROR = "Could not reach the Admin API to check your Staff session.";
  const B_ERROR = "The Admin API could not check your Staff session (HTTP 503).";
  const nextRange = () => screen.getByRole("button", { name: "Next date range" });
  /** W of the current test: an assignment on the wire, answered with `outcomeOf`. */
  let currentW: ReturnType<typeof deferred<Awaited<ReturnType<typeof createReservationAssignment>>>> | null = null;
  const outcomeOf = (outcome: Awaited<ReturnType<typeof createReservationAssignment>>) => currentW!.resolve(outcome);

  /**
   * W: an assignment on prop-a, on the wire. A: a board read refused (next range), its re-read fails — deferred
   * behind W. B: the board moves to prop-b, refused too, so a newer re-read starts and answers `meB`.
   */
  async function failedCheckThenNewer(meB: StaffSessionResult | Promise<StaffSessionResult>) {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    currentW = deferred();
    mockedCreate.mockReturnValueOnce(currentW.promise);
    await user.click(await WRITES["create assignment"].open(user, from));

    mockedBoard.mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } });
    mockedMe.mockResolvedValueOnce({ kind: "error", message: A_ERROR });
    await user.click(nextRange()); // check A fails while W is on the wire: its failure waits for W
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument();

    if (meB instanceof Promise) mockedMe.mockReturnValueOnce(meB);
    else mockedMe.mockResolvedValueOnce(meB);
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b"); // check B takes over
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(3));
    return { user };
  }

  it.each([
    ["success", { kind: "created", segment: null } as const, 0],
    ["unknown", { kind: "unknown", reason: "network" } as const, 1],
  ])("A fails, B succeeds, W settles (%s): the board keeps the newly verified roles — no error from A", async (_label, outcome, records) => {
    await failedCheckThenNewer({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) });
    await waitFor(() => expect(propertyOptions()).toEqual(["Property A"])); // B's memberships, B's role
    await act(async () => outcomeOf(outcome));

    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-identity")).toBeInTheDocument();
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(createBlockButton()).toBeEnabled();
    expect(mockedCreate).toHaveBeenCalledTimes(1); // nothing resent
    const stored = restoreUncertainWrites(tabStorage(), 1);
    expect(stored.pendingTokens).toHaveLength(0);
    expect(stored.assignments).toHaveLength(records);
  });
  it("A fails, B still on the wire, W settles: A's failure is not applied and writes stay closed until B answers", async () => {
    const meB = deferred<StaffSessionResult>();
    const { user } = await failedCheckThenNewer(meB.promise);
    // Back to prop-a (readable) while B is on the wire, so the re-read after W is not refused again.
    await user.selectOptions(screen.getByLabelText("Property"), "prop-a");
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(createBlockButton()).toBeDisabled(); // still checking: nothing can be written on the old roles
    await act(async () => outcomeOf({ kind: "unknown", reason: "network" }));
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument();
    expect(createBlockButton()).toBeDisabled();
    expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(1);

    await act(async () => meB.resolve({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) }));
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument();
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(createBlockButton()).toBeEnabled();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("A fails, B fails, W settles: only B's failure closes access, and its Retry works", async () => {
    const { user } = await failedCheckThenNewer({ kind: "error", message: B_ERROR });
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument(); // W is still on the wire
    await act(async () => outcomeOf({ kind: "created", segment: null }));
    const panel = await screen.findByTestId("staff-session-error");
    expect(panel).toHaveTextContent(B_ERROR);
    expect(panel).not.toHaveTextContent(A_ERROR);
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) });
    await user.click(within(panel).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
  });

  it("A fails, B finds no session, W settles: the session ends once — not an access error", async () => {
    await failedCheckThenNewer({ kind: "unauthenticated" });
    expect(replace).not.toHaveBeenCalled(); // the session waits for W
    await act(async () => outcomeOf({ kind: "unknown", reason: "network" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-session-required")).toHaveTextContent("Your Staff session has ended.");
    expect(restoreUncertainWrites(tabStorage(), 1).assignments).toHaveLength(1);
  });

  it("B takes over while A is still on the wire, then A answers late with an error: A changes nothing", async () => {
    const { user, from } = await renderStaff(sessionWith(["prop-a", "Manager"], ["prop-b", "Manager"]));
    currentW = deferred();
    mockedCreate.mockReturnValueOnce(currentW.promise);
    await user.click(await WRITES["create assignment"].open(user, from));
    const meA = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(meA.promise);
    mockedBoard.mockResolvedValueOnce({ ok: false, error: { kind: "http", status: 403, message: "Access denied" } });
    await user.click(nextRange()); // A on the wire
    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: sessionWith(["prop-a", "FrontDesk"]) });
    await user.selectOptions(screen.getByLabelText("Property"), "prop-b"); // B takes over and succeeds
    await waitFor(() => expect(propertyOptions()).toEqual(["Property A"]));
    await act(async () => meA.resolve({ kind: "error", message: A_ERROR })); // A, late
    await act(async () => outcomeOf({ kind: "created", segment: null }));
    expect(screen.queryByTestId("staff-session-error")).not.toBeInTheDocument();
    await waitFor(() => expect(stayBar()).toBeInTheDocument());
    expect(capabilities()).toHaveTextContent("Signed in as FrontDesk");
    expect(createBlockButton()).toBeEnabled();
  });
});
