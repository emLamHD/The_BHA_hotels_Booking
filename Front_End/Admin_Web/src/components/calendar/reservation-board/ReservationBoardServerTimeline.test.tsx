import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReservationBoardServerTimeline from "./ReservationBoardServerTimeline";
import { buildVisibleRange } from "./dateMath";
import type {
  ReservationBoardOperationalBlock,
  ReservationBoardPhysicalRoom,
  ReservationBoardRoomType,
  ReservationBoardStay,
} from "@/lib/api/types";

const range = buildVisibleRange("2026-09-01", 7);

const roomTypes: ReservationBoardRoomType[] = [
  { id: "type-standard", code: "STD", name: "Standard", isActive: true },
  { id: "type-deluxe", code: "DLX", name: "Deluxe", isActive: true },
];

const physicalRooms: ReservationBoardPhysicalRoom[] = [
  { id: "room-101", roomTypeId: "type-standard", roomNumber: "101", floor: 1, operationalStatus: "Active" },
  { id: "room-201", roomTypeId: "type-deluxe", roomNumber: "201", floor: 2, operationalStatus: "Active" },
];

function baseProps() {
  return {
    range,
    todayIso: "2026-09-01",
    roomTypes,
    physicalRooms,
    stays: [] as ReservationBoardStay[],
    operationalBlocks: [] as ReservationBoardOperationalBlock[],
    showAssigned: true,
    showUnassigned: true,
    showOperationalBlocks: true,
    onSelectStay: vi.fn(),
    onSelectBlock: vi.fn(),
  };
}

describe("ReservationBoardServerTimeline", () => {
  it("renders a room-type header and room row per active RoomType/PhysicalRoom, plus an unassigned lane", () => {
    render(<ReservationBoardServerTimeline {...baseProps()} />);
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Deluxe")).toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.getByText("201")).toBeInTheDocument();
    expect(screen.getAllByText("Unassigned")).toHaveLength(2);
  });

  it("does not render an unassigned lane when showUnassigned is false", () => {
    render(<ReservationBoardServerTimeline {...baseProps()} showUnassigned={false} />);
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("renders an assigned bar in the physical room's own row, preserving the sold RoomType across a cross-RoomType assignment", async () => {
    const user = userEvent.setup();
    const onSelectStay = vi.fn();
    const stay: ReservationBoardStay = {
      reservationId: "res-1",
      reservationUnitId: "unit-1",
      confirmationNumber: "CNF-001",
      guestDisplayName: "Nguyen Van A",
      soldRoomTypeId: "type-standard",
      checkIn: "2026-09-02",
      checkOut: "2026-09-04",
      coverageStatus: "FullyAssigned",
      assignments: [
        {
          segmentId: "seg-1",
          segmentVersion: 1,
          physicalRoomId: "room-201", // physically in the Deluxe room, though sold as Standard
          actualRoomTypeId: "type-deluxe",
          startDate: "2026-09-02",
          endDate: "2026-09-04",
        },
      ],
      unassignedRanges: [],
    };

    render(<ReservationBoardServerTimeline {...baseProps()} stays={[stay]} onSelectStay={onSelectStay} />);

    const bar = screen.getByTitle("Nguyen Van A — CNF-001");
    expect(bar.tagName).toBe("BUTTON");
    expect(bar.getAttribute("draggable")).not.toBe("true");

    await user.click(bar);
    expect(onSelectStay).toHaveBeenCalledWith({
      stay,
      roomTypeName: "Standard", // sold RoomType name, not the room it physically sits in
      actualRoomTypeName: "Deluxe",
    });
  });

  it("does not render assigned bars when showAssigned is false", () => {
    const stay: ReservationBoardStay = {
      reservationId: "res-1",
      reservationUnitId: "unit-1",
      confirmationNumber: "CNF-001",
      guestDisplayName: "Nguyen Van A",
      soldRoomTypeId: "type-standard",
      checkIn: "2026-09-02",
      checkOut: "2026-09-04",
      coverageStatus: "FullyAssigned",
      assignments: [
        {
          segmentId: "seg-1",
          segmentVersion: 1,
          physicalRoomId: "room-101",
          actualRoomTypeId: "type-standard",
          startDate: "2026-09-02",
          endDate: "2026-09-04",
        },
      ],
      unassignedRanges: [],
    };
    render(<ReservationBoardServerTimeline {...baseProps()} stays={[stay]} showAssigned={false} />);
    expect(screen.queryByText("Nguyen Van A")).not.toBeInTheDocument();
  });

  it("renders an unassigned bar in the sold RoomType's unassigned lane", async () => {
    const user = userEvent.setup();
    const onSelectStay = vi.fn();
    const stay: ReservationBoardStay = {
      reservationId: "res-2",
      reservationUnitId: "unit-2",
      confirmationNumber: "CNF-002",
      guestDisplayName: "Tran Thi B",
      soldRoomTypeId: "type-deluxe",
      checkIn: "2026-09-03",
      checkOut: "2026-09-05",
      coverageStatus: "FullyUnassigned",
      assignments: [],
      unassignedRanges: [{ startDate: "2026-09-03", endDate: "2026-09-05" }],
    };
    render(<ReservationBoardServerTimeline {...baseProps()} stays={[stay]} onSelectStay={onSelectStay} />);

    const bar = screen.getByTitle("Tran Thi B — unassigned — CNF-002");
    await user.click(bar);
    expect(onSelectStay).toHaveBeenCalledWith({ stay, roomTypeName: "Deluxe" });
  });

  it("renders an operational block bar and reports the room number on selection", async () => {
    const user = userEvent.setup();
    const onSelectBlock = vi.fn();
    const block: ReservationBoardOperationalBlock = {
      roomBlockId: "block-1",
      segmentId: "seg-block-1",
      segmentVersion: 1,
      physicalRoomId: "room-101",
      startDate: "2026-09-02",
      endDate: "2026-09-03",
      reason: "Maintenance",
    };
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        operationalBlocks={[block]}
        onSelectBlock={onSelectBlock}
      />
    );

    const bar = screen.getByRole("button", { name: "Maintenance" });
    await user.click(bar);
    expect(onSelectBlock).toHaveBeenCalledWith({ block, roomNumber: "101" });
  });

  it("does not render operational blocks when showOperationalBlocks is false", () => {
    const block: ReservationBoardOperationalBlock = {
      roomBlockId: "block-1",
      segmentId: "seg-block-1",
      segmentVersion: 1,
      physicalRoomId: "room-101",
      startDate: "2026-09-02",
      endDate: "2026-09-03",
      reason: "Maintenance",
    };
    render(
      <ReservationBoardServerTimeline {...baseProps()} operationalBlocks={[block]} showOperationalBlocks={false} />
    );
    expect(screen.queryByRole("button", { name: "Maintenance" })).not.toBeInTheDocument();
  });

  it("omits a RoomType row entirely when it has no active PhysicalRooms and no visible unassigned stay", () => {
    const roomTypesWithUnreferencedOne: ReservationBoardRoomType[] = [
      ...roomTypes,
      { id: "type-suite", code: "STE", name: "Suite", isActive: true },
    ];
    render(<ReservationBoardServerTimeline {...baseProps()} roomTypes={roomTypesWithUnreferencedOne} />);
    expect(screen.queryByText("Suite")).not.toBeInTheDocument();
  });

  // PMS-CAL-001.1 correction C2 — a sold RoomType with zero active
  // PhysicalRooms must still show its unassigned lane for a stay sold
  // under it, or the backend's authoritative unassignedRanges are silently
  // dropped (the row lookup used to render the bar never existed).
  describe("unassigned stays whose sold RoomType has no active PhysicalRoom", () => {
    const roomTypesWithNoActiveRoom: ReservationBoardRoomType[] = [
      ...roomTypes,
      { id: "type-penthouse", code: "PENT", name: "Penthouse", isActive: true },
    ];
    const roomTypesWithInactiveSoldType: ReservationBoardRoomType[] = [
      ...roomTypes,
      { id: "type-retired", code: "RET", name: "Retired Suite", isActive: false },
    ];

    it("keeps a fully unassigned stay visible, in the correct sold RoomType lane and dates", async () => {
      const user = userEvent.setup();
      const onSelectStay = vi.fn();
      const stay: ReservationBoardStay = {
        reservationId: "res-3",
        reservationUnitId: "unit-3",
        confirmationNumber: "CNF-003",
        guestDisplayName: "Tran Thi B",
        soldRoomTypeId: "type-penthouse",
        checkIn: "2026-09-02",
        checkOut: "2026-09-04",
        coverageStatus: "FullyUnassigned",
        assignments: [],
        unassignedRanges: [{ startDate: "2026-09-02", endDate: "2026-09-04" }],
      };

      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithNoActiveRoom}
          stays={[stay]}
          onSelectStay={onSelectStay}
        />
      );

      expect(screen.getByText("Penthouse")).toBeInTheDocument();
      const bar = screen.getByTitle("Tran Thi B — unassigned — CNF-003");
      await user.click(bar);
      expect(onSelectStay).toHaveBeenCalledWith({ stay, roomTypeName: "Penthouse" });
    });

    it("still displays a stay sold under an inactive (deactivated) RoomType", () => {
      const stay: ReservationBoardStay = {
        reservationId: "res-4",
        reservationUnitId: "unit-4",
        confirmationNumber: "CNF-004",
        guestDisplayName: "Le Van C",
        soldRoomTypeId: "type-retired",
        checkIn: "2026-09-02",
        checkOut: "2026-09-04",
        coverageStatus: "FullyUnassigned",
        assignments: [],
        unassignedRanges: [{ startDate: "2026-09-02", endDate: "2026-09-04" }],
      };

      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithInactiveSoldType}
          stays={[stay]}
        />
      );

      expect(screen.getByText("Retired Suite")).toBeInTheDocument();
      expect(screen.getByTitle("Le Van C — unassigned — CNF-004")).toBeInTheDocument();
    });

    it("renders a partially assigned stay's actual-room assignment and its sold-type unassigned range together", () => {
      const stay: ReservationBoardStay = {
        reservationId: "res-5",
        reservationUnitId: "unit-5",
        confirmationNumber: "CNF-005",
        guestDisplayName: "Pham Thi D",
        soldRoomTypeId: "type-penthouse",
        checkIn: "2026-09-02",
        checkOut: "2026-09-05",
        coverageStatus: "PartiallyAssigned",
        assignments: [
          {
            segmentId: "seg-5",
            segmentVersion: 1,
            physicalRoomId: "room-101",
            actualRoomTypeId: "type-standard",
            startDate: "2026-09-02",
            endDate: "2026-09-03",
          },
        ],
        unassignedRanges: [{ startDate: "2026-09-03", endDate: "2026-09-05" }],
      };

      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithNoActiveRoom}
          stays={[stay]}
        />
      );

      expect(screen.getByTitle("Pham Thi D — CNF-005")).toBeInTheDocument();
      expect(screen.getByTitle("Pham Thi D — unassigned — CNF-005")).toBeInTheDocument();
    });

    it("hides and restores the no-active-room unassigned lane/bar with the Unassigned filter", () => {
      const stay: ReservationBoardStay = {
        reservationId: "res-6",
        reservationUnitId: "unit-6",
        confirmationNumber: "CNF-006",
        guestDisplayName: "Vo Thi E",
        soldRoomTypeId: "type-penthouse",
        checkIn: "2026-09-02",
        checkOut: "2026-09-04",
        coverageStatus: "FullyUnassigned",
        assignments: [],
        unassignedRanges: [{ startDate: "2026-09-02", endDate: "2026-09-04" }],
      };

      const { rerender } = render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithNoActiveRoom}
          stays={[stay]}
          showUnassigned={false}
        />
      );
      expect(screen.queryByText("Penthouse")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Vo Thi E — unassigned — CNF-006")).not.toBeInTheDocument();

      rerender(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithNoActiveRoom}
          stays={[stay]}
          showUnassigned={true}
        />
      );
      expect(screen.getByText("Penthouse")).toBeInTheDocument();
      expect(screen.getByTitle("Vo Thi E — unassigned — CNF-006")).toBeInTheDocument();
    });
  });
});
