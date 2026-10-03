/**
 * PMS-ADMIN-AUTH-001-CP06 evidence groups 1, 4, 5 and 9: what stands in front of
 * the Reservation Board on /calendar.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { fetchActiveProperties, fetchReservationBoard } from "@/lib/api/client";

const mockedMe = vi.mocked(fetchStaffSession);
const mockedLogout = vi.mocked(staffLogout);
const mockedCatalog = vi.mocked(fetchActiveProperties);
const mockedBoard = vi.mocked(fetchReservationBoard);

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
  for (const mock of [mockedMe, mockedLogout, mockedCatalog, mockedBoard]) mock.mockReset();
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
