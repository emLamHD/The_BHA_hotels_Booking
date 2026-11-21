/**
 * BHA-ADMIN-BADGE-001-PR13 (ADR 0011 §D "Calendar read state", PR-12 contract): the board marks the objects another person changed and says "seen" for ONE object when the Staff member opens its bar —
 * through the real Staff session, the real shared provider and the real access gate. The board read, the summary and the acknowledgement are scripted (the acknowledgement's answers are deferred
 * where order matters, and ignore any abort, as a late answer from a real transport may). What is asserted is what went to `markCalendarEntitySeen` and what the bars show.
 */
import React, { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@/components/website/websiteTestUtils";
import type { StaffSession } from "@/lib/api/staff";
import type { ReservationBoardResponse } from "@/lib/api/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (original) => ({ ...(await original<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/website/newsletterLive", () => ({ startNewsletterLive: vi.fn(() => ({ retryNow: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@/lib/api/client", () => ({
  fetchActiveProperties: vi.fn(),
  fetchReservationBoard: vi.fn(),
  createReservationAssignment: vi.fn(),
  moveReservationAssignment: vi.fn(),
  unassignReservationAssignment: vi.fn(),
  splitMoveReservationAssignment: vi.fn(),
  createOperationalBlock: vi.fn(),
  cancelOperationalBlock: vi.fn(),
  moveOperationalBlock: vi.fn(),
}));
vi.mock("@/lib/api/menuUnseen", async (original) => ({
  ...(await original<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(), markCalendarEntitySeen: vi.fn(), markMenuSeen: vi.fn(), markNewsletterSeen: vi.fn(),
}));

import CalendarAccessGate from "./CalendarAccessGate";
import { addDaysIso } from "./dateMath";
import { MenuUnseenProvider, useCalendarSeen, type CalendarAck } from "@/components/website/NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { fetchStaffSession } from "@/lib/api/staff";
import { fetchActiveProperties, fetchReservationBoard } from "@/lib/api/client";
import { fetchMenuUnseenSummary, markCalendarEntitySeen, type CalendarEntitySeenRequest } from "@/lib/api/menuUnseen";

const board = vi.mocked(fetchReservationBoard);
const summary = vi.mocked(fetchMenuUnseenSummary);
const ackCall = vi.mocked(markCalendarEntitySeen);

const member = (propertyId: string) => ({ propertyId, propertyName: `Hotel ${propertyId}`, timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" as const });
const staff = (id: string, ...properties: string[]): StaffSession => ({ staffAccountId: id, email: `${id}@example.com`, permissions: [], memberships: properties.map(member) });
const STAFF_A = staff("11111111-1111-1111-1111-111111111111", "prop-a", "prop-b");
const STAFF_B = staff("22222222-2222-2222-2222-222222222222", "prop-a", "prop-b");

/** What the scripted server says about each object's `activity`; a test changes it between reads. */
let activity: Record<string, unknown>;
const U1 = "unit-1";
const U2 = "unit-2";
const BLOCK = "block-1";

function boardFor(propertyId: string, from: string, to: string): ReservationBoardResponse {
  const stays = [
    {
      reservationId: "res-1", reservationUnitId: U1, confirmationNumber: "CNF-1", guestDisplayName: "Nguyen Van A", soldRoomTypeId: "type-std", checkIn: from, checkOut: addDaysIso(from, 6),
      coverageStatus: "PartiallyAssigned" as const,
      // one unit, two segments in two rooms, and an unassigned range: three bars of ONE object
      assignments: [
        { segmentId: "seg-1", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-std", startDate: addDaysIso(from, 2), endDate: addDaysIso(from, 4) },
        { segmentId: "seg-2", segmentVersion: 1, physicalRoomId: "room-102", actualRoomTypeId: "type-std", startDate: addDaysIso(from, 4), endDate: addDaysIso(from, 6) },
      ],
      unassignedRanges: [{ startDate: from, endDate: addDaysIso(from, 2) }],
      ...(U1 in activity ? { activity: activity[U1] } : {}),
    },
    {
      reservationId: "res-2", reservationUnitId: U2, confirmationNumber: "CNF-2", guestDisplayName: "Tran Thi B", soldRoomTypeId: "type-std", checkIn: addDaysIso(from, 8), checkOut: addDaysIso(from, 10),
      coverageStatus: "FullyAssigned" as const,
      assignments: [{ segmentId: "seg-3", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-std", startDate: addDaysIso(from, 8), endDate: addDaysIso(from, 10) }],
      unassignedRanges: [],
      ...(U2 in activity ? { activity: activity[U2] } : {}),
    },
    {
      reservationId: "res-3", reservationUnitId: "unit-3", confirmationNumber: "CNF-3", guestDisplayName: "Le Van C", soldRoomTypeId: "type-std", checkIn: addDaysIso(from, 10), checkOut: addDaysIso(from, 12),
      coverageStatus: "FullyAssigned" as const,
      assignments: [{ segmentId: "seg-4", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-std", startDate: addDaysIso(from, 10), endDate: addDaysIso(from, 12) }],
      unassignedRanges: [],
      ...("unit-3" in activity ? { activity: activity["unit-3"] } : {}),
    },
  ];
  return {
    property: { id: propertyId, name: `Hotel ${propertyId}`, timeZone: "Asia/Ho_Chi_Minh", localToday: from, checkInTime: "14:00", checkOutTime: "12:00" },
    from, to,
    roomTypes: [{ id: "type-std", code: "STD", name: "Standard", isActive: true }],
    physicalRooms: [
      { id: "room-101", roomTypeId: "type-std", roomNumber: "101", floor: 1, operationalStatus: "Active" },
      { id: "room-102", roomTypeId: "type-std", roomNumber: "102", floor: 1, operationalStatus: "Active" },
    ],
    stays,
    operationalBlocks: [
      { roomBlockId: BLOCK, segmentId: "seg-block", segmentVersion: 1, physicalRoomId: "room-102", startDate: addDaysIso(from, 6), endDate: addDaysIso(from, 8), reason: "Pipe repair", ...(BLOCK in activity ? { activity: activity[BLOCK] } : {}) },
    ],
  } as ReservationBoardResponse;
}

const unread = (watermark: string) => ({ unread: true, watermark });
const read = (watermark: string) => ({ unread: false, watermark });
const row = (propertyId: string) => ({ propertyId, count: 3, lastSeenWatermark: "0", currentWatermark: "9" });
const summaryOf = (...properties: string[]) => ({ kind: "ok" as const, data: { calendar: { count: 3 * properties.length, byProperty: properties.map(row) } } });
const answerFor = (request: CalendarEntitySeenRequest, over: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  data: { propertyId: request.propertyId, entityKind: request.entityKind, entityId: request.entityId, lastSeenWatermark: request.observedWatermark, unread: false, count: 2, currentWatermark: "9", ...over },
});

let session: ReturnType<typeof useStaffSession> | null = null;
function Probe() {
  const value = useStaffSession();
  useEffect(() => {
    session = value;
  });
  return null;
}
const mount = () =>
  render(
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Probe />
        <CalendarAccessGate />
      </MenuUnseenProvider>
    </StaffSessionProvider>,
  );
const flush = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

/** The board is on screen AND the shared provider has its first summary (an acknowledgement waits for it, by design). */
async function ready() {
  await screen.findAllByTitle("Nguyen Van A — CNF-1");
  await waitFor(() => expect(summary).toHaveBeenCalled());
  await flush();
}

const assignedBars = (name: string, confirmation: string) => screen.queryAllByTitle(`${name} — ${confirmation}`);
const unassignedBar = () => screen.getByLabelText(/^Assign room: Nguyen Van A/);
const blockBar = () => screen.getByTitle("Pipe repair");
const isMarked = (bar: HTMLElement) => bar.getAttribute("data-unread") === "true";
const sentTo = () => ackCall.mock.calls.map((call) => call[0]);

beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  for (const m of [board, summary, ackCall, vi.mocked(fetchStaffSession), vi.mocked(fetchActiveProperties)]) m.mockReset();
  session = null;
  activity = { [U1]: unread("3"), [U2]: unread("5"), [BLOCK]: unread("7") };
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
  board.mockImplementation(async (propertyId, from, to) => ({ ok: true, data: boardFor(propertyId, from, to) }));
  summary.mockImplementation((async () => summaryOf("prop-a", "prop-b")) as never);
  ackCall.mockImplementation((async (request: CalendarEntitySeenRequest) => answerFor(request)) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("what the board shows", () => {
  it("marks every bar of an unread object (all its segments and lanes), leaves the others alone, and tells assistive technology", async () => {
    mount();
    await ready();
    const unitOne = [...assignedBars("Nguyen Van A", "CNF-1"), unassignedBar()];
    expect(unitOne).toHaveLength(3);
    expect(unitOne.every(isMarked)).toBe(true);
    expect(isMarked(assignedBars("Tran Thi B", "CNF-2")[0])).toBe(true);
    expect(isMarked(blockBar())).toBe(true);
    expect(assignedBars("Le Van C", "CNF-3")[0].getAttribute("data-unread")).toBeNull();                 // no activity: an ordinary bar
    expect(screen.getAllByTestId("unread-dot")).toHaveLength(5);                                         // 3 + 1 + 1 bars, one accent
    expect(unassignedBar().getAttribute("aria-label")).toContain("Unread change");
    expect(blockBar().getAttribute("aria-label")).toBe("Pipe repair, Unread change");
    expect(assignedBars("Nguyen Van A", "CNF-1")[0].textContent).toContain("Unread change");
    expect(assignedBars("Le Van C", "CNF-3")[0].textContent).not.toContain("Unread change");
  });

  it("a bar with a read object, with no activity, or with a malformed one renders as it always did — and a click on the latter two sends nothing", async () => {
    activity = { [U1]: read("3"), [U2]: { unread: "yes", watermark: "x" }, [BLOCK]: null, "unit-3": { unread: true, watermark: 12 } };
    mount();
    await ready();
    expect(document.querySelectorAll("[data-unread]")).toHaveLength(0);
    await userEvent.click(assignedBars("Tran Thi B", "CNF-2")[0]);
    await userEvent.click(blockBar());
    await userEvent.click(assignedBars("Le Van C", "CNF-3")[0]);
    await flush();
    expect(ackCall).not.toHaveBeenCalled();
  });

  it("a board without any activity field (LocalGate-shaped) renders normally", async () => {
    activity = {};
    mount();
    await ready();
    expect(screen.getByTitle("Pipe repair")).toBeTruthy();
    expect(document.querySelectorAll("[data-unread]")).toHaveLength(0);
  });
});

describe("what says nothing", () => {
  it("opening the board, hovering, focusing, changing day or Property, and dragging a bar never send an acknowledgement", async () => {
    mount();
    await ready();
    const bar = assignedBars("Nguyen Van A", "CNF-1")[0];
    await userEvent.hover(bar);
    act(() => bar.focus());
    fireEvent.dragStart(bar);
    fireEvent.dragEnd(bar);
    await userEvent.click(screen.getByLabelText("Next date range"));
    await screen.findAllByTitle("Nguyen Van A — CNF-1");
    await userEvent.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await screen.findAllByTitle("Nguyen Van A — CNF-1");
    await flush(300);
    expect(ackCall).not.toHaveBeenCalled();
  });

  it("LocalGate: the board shows no highlight even if the server sent activity, and a click sends nothing and asks for no summary", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    vi.mocked(fetchActiveProperties).mockResolvedValue({ ok: true, data: [{ id: "prop-a", name: "Hotel prop-a", timeZone: "Asia/Ho_Chi_Minh" }] });
    render(<CalendarAccessGate />);
    await screen.findAllByTitle("Nguyen Van A — CNF-1");
    expect(document.querySelectorAll("[data-unread]")).toHaveLength(0);
    expect(screen.queryAllByTestId("unread-dot")).toHaveLength(0);
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await userEvent.click(blockBar());
    await flush(300);
    expect(ackCall).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });
});

describe("opening an unread bar says \"seen\" for that ONE object", () => {
  it("a click on one segment opens the details and sends exactly one acknowledgement — the unit, never the segment — with the board's own watermark; all of the unit's bars clear, other objects stay", async () => {
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[1]);                                     // the SECOND segment of the unit
    expect(screen.getByRole("dialog", { name: "Reservation details" })).toBeTruthy();                   // the details still open
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    expect(sentTo()).toEqual([{ propertyId: "prop-a", entityKind: "reservation-unit", entityId: U1, observedWatermark: "3" }]);
    await waitFor(() => expect([...assignedBars("Nguyen Van A", "CNF-1"), unassignedBar()].some(isMarked)).toBe(false));
    expect(isMarked(assignedBars("Tran Thi B", "CNF-2")[0])).toBe(true);
    expect(isMarked(blockBar())).toBe(true);
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });        // the badge is read again from the API, not computed here
  });

  it("the keyboard does the same: Enter on a focused bar sends one acknowledgement", async () => {
    mount();
    await ready();
    act(() => assignedBars("Tran Thi B", "CNF-2")[0].focus());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    expect(sentTo()[0]).toEqual({ propertyId: "prop-a", entityKind: "reservation-unit", entityId: U2, observedWatermark: "5" });
  });

  it("an unassigned range acknowledges its unit when the assignment opens, with the unit's watermark", async () => {
    mount();
    await ready();
    await userEvent.click(unassignedBar());
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    expect(sentTo()[0]).toEqual({ propertyId: "prop-a", entityKind: "reservation-unit", entityId: U1, observedWatermark: "3" });
  });

  it("an operational block acknowledges its RoomBlockId, not its segment", async () => {
    mount();
    await ready();
    await userEvent.click(blockBar());
    expect(screen.getByRole("dialog", { name: "Operational block details" })).toBeTruthy();
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    expect(sentTo()[0]).toEqual({ propertyId: "prop-a", entityKind: "room-block", entityId: BLOCK, observedWatermark: "7" });
  });

  it("a bar that is not unread opens as before and sends nothing", async () => {
    activity = { [U1]: read("3"), [U2]: unread("5") };
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    expect(screen.getByRole("dialog", { name: "Reservation details" })).toBeTruthy();
    await flush(100);
    expect(ackCall).not.toHaveBeenCalled();
  });

  it("a repeated click while the call is on the wire sends nothing more, even from another segment of the same unit", async () => {
    const wire = deferred<unknown>();
    ackCall.mockReturnValue(wire.promise as never);
    mount();
    await ready();
    await userEvent.dblClick(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[1]);
    await flush(100);
    expect(ackCall).toHaveBeenCalledTimes(1);
    expect(isMarked(assignedBars("Nguyen Van A", "CNF-1")[0])).toBe(true);                              // nothing is optimistic
    await act(async () => wire.resolve(answerFor(sentTo()[0])));
    await waitFor(() => expect(isMarked(assignedBars("Nguyen Van A", "CNF-1")[0])).toBe(false));
  });

  it("nothing is sent for a Property the shared summary does not list (revoked), and nothing is brought back", async () => {
    summary.mockImplementation((async () => summaryOf("prop-b")) as never);                              // the Staff member lost Calendar access to prop-a
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await flush(100);
    expect(ackCall).not.toHaveBeenCalled();
    expect(isMarked(assignedBars("Nguyen Van A", "CNF-1")[0])).toBe(true);
  });
});

describe("what the answer does", () => {
  it("an answer that says still unread keeps the highlight and makes the board read again (the next click then carries the newer watermark)", async () => {
    ackCall.mockImplementation((async (request: CalendarEntitySeenRequest) => answerFor(request, { unread: true })) as never);
    mount();
    await ready();
    const reads = board.mock.calls.length;
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(board.mock.calls.length).toBeGreaterThan(reads));
    activity = { ...activity, [U1]: unread("4") };
    await userEvent.click(screen.getByLabelText("Next date range"));
    await userEvent.click(screen.getByLabelText("Previous date range"));
    await screen.findAllByTitle("Nguyen Van A — CNF-1");
    expect(isMarked(assignedBars("Nguyen Van A", "CNF-1")[0])).toBe(true);
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(2));
    expect(sentTo()[1].observedWatermark).toBe("4");
  });

  it("an older answer that arrives after a newer board read cannot clear the bar that read shows with a higher watermark", async () => {
    const wire = deferred<unknown>();
    ackCall.mockReturnValue(wire.promise as never);
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    activity = { ...activity, [U1]: unread("4") };                                                       // somebody changed it again; the next board read shows 4
    await userEvent.click(screen.getByLabelText("Next date range"));
    await screen.findAllByTitle("Nguyen Van A — CNF-1");
    await act(async () => wire.resolve(answerFor(sentTo()[0])));                                         // the answer for watermark 3, unread:false
    await flush(50);
    expect(assignedBars("Nguyen Van A", "CNF-1").every(isMarked)).toBe(true);
  });

  it("an answer that arrives after another Property was chosen paints nothing on that Property, even for the same object id", async () => {
    const wire = deferred<unknown>();
    ackCall.mockReturnValue(wire.promise as never);
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByLabelText("Property"), "prop-b");
    await screen.findAllByTitle("Nguyen Van A — CNF-1");
    await act(async () => wire.resolve(answerFor(sentTo()[0])));
    await flush(50);
    expect(assignedBars("Nguyen Van A", "CNF-1").every(isMarked)).toBe(true);                           // prop-b's unit-1 is its own object
    expect(ackCall).toHaveBeenCalledTimes(1);
  });

  it("an answer that arrives after the Staff identity changed paints nothing (the provider drops it, whatever the transport did with the abort)", async () => {
    const wire = deferred<unknown>();
    ackCall.mockReturnValue(wire.promise as never);
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    await act(async () => { await session!.refresh(); });
    await act(async () => wire.resolve(answerFor(sentTo()[0])));
    await flush(50);
    const bars = assignedBars("Nguyen Van A", "CNF-1");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every(isMarked)).toBe(true);
  });

  it("a failed call keeps the highlight and the next click tries again; a 404 keeps it too and reads the numbers again", async () => {
    ackCall.mockResolvedValueOnce({ kind: "network", message: "down" } as never);
    mount();
    await ready();
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(1));
    await flush(50);
    expect(isMarked(assignedBars("Nguyen Van A", "CNF-1")[0])).toBe(true);
    await userEvent.click(assignedBars("Nguyen Van A", "CNF-1")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(isMarked(assignedBars("Nguyen Van A", "CNF-1")[0])).toBe(false));

    const reads = summary.mock.calls.length;
    ackCall.mockResolvedValueOnce({ kind: "refused", status: 404, message: "no" } as never);
    await userEvent.click(assignedBars("Tran Thi B", "CNF-2")[0]);
    await waitFor(() => expect(ackCall).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(reads), { timeout: 2000 });
    expect(isMarked(assignedBars("Tran Thi B", "CNF-2")[0])).toBe(true);
  });
});

describe("the shared provider's own rules for the Calendar acknowledgement", () => {
  let seenCalendar: ReturnType<typeof useCalendarSeen> | null = null;
  function SeenProbe() {
    const value = useCalendarSeen();
    useEffect(() => {
      seenCalendar = value;
    });
    return null;
  }
  const mountProvider = () =>
    render(
      <StaffSessionProvider>
        <MenuUnseenProvider>
          <Probe />
          <SeenProbe />
        </MenuUnseenProvider>
      </StaffSessionProvider>,
    );
  const request: CalendarEntitySeenRequest = { propertyId: "prop-a", entityKind: "reservation-unit", entityId: U1, observedWatermark: "3" };
  const IDENTITY_A = STAFF_A.staffAccountId;
  beforeEach(() => {
    seenCalendar = null;
  });

  it("an answer that outlives its Staff identity is `dropped`, however the transport treated the abort; a call for another identity sends nothing", async () => {
    const wire = deferred<unknown>();
    ackCall.mockReturnValue(wire.promise as never);
    mountProvider();
    await waitFor(() => expect(summary).toHaveBeenCalled());
    await flush();
    const pending = seenCalendar!(IDENTITY_A, request);
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    await act(async () => { await session!.refresh(); });
    await act(async () => wire.resolve(answerFor(request)));
    expect(await pending).toEqual({ kind: "dropped" });
    expect(await seenCalendar!(IDENTITY_A, request)).toEqual({ kind: "dropped" });                      // the previous Staff member's identity is not ours to say
    expect(ackCall).toHaveBeenCalledTimes(1);
  });

  it("one call per object at a time: the same or a lower watermark gets that call back; a higher one goes out too; a malformed watermark sends nothing", async () => {
    const first = deferred<unknown>();
    ackCall.mockReturnValueOnce(first.promise as never);
    mountProvider();
    await waitFor(() => expect(summary).toHaveBeenCalled());
    await flush();
    const one = seenCalendar!(IDENTITY_A, request);
    const same = seenCalendar!(IDENTITY_A, request);
    const lower = seenCalendar!(IDENTITY_A, { ...request, observedWatermark: "2" });
    expect(same).toBe(one);
    expect(lower).toBe(one);
    expect(ackCall).toHaveBeenCalledTimes(1);
    ackCall.mockResolvedValueOnce(answerFor({ ...request, observedWatermark: "4" }) as never);
    const higher = await seenCalendar!(IDENTITY_A, { ...request, observedWatermark: "4" });
    expect((higher as Extract<CalendarAck, { kind: "ok" }>).answer.lastSeenWatermark).toBe("4");
    expect(await seenCalendar!(IDENTITY_A, { ...request, observedWatermark: "03" })).toEqual({ kind: "dropped" });
    expect(await seenCalendar!(IDENTITY_A, { ...request, entityId: "" })).toEqual({ kind: "dropped" });
    await act(async () => first.resolve(answerFor(request)));
    expect(ackCall).toHaveBeenCalledTimes(2);
  });

  it("the call goes to the entity route only: never a segment id, the menu-level route or the summary's numbers", async () => {
    mountProvider();
    await waitFor(() => expect(summary).toHaveBeenCalled());
    await flush();
    await seenCalendar!(IDENTITY_A, request);
    expect(ackCall).toHaveBeenCalledWith(request);
    expect(JSON.stringify(ackCall.mock.calls[0][0])).not.toMatch(/seg-|currentWatermark|snapshotWatermark|"9"/);
  });
});
