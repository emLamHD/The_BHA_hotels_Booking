import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
    onSelectUnassignedRange: vi.fn(),
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
      segment: stay.assignments[0],
    });
  });

  it("PMS-CAL-001.2-CP04C.2: reports the exact clicked segment, not just the Unit, when a stay has more than one assignment", async () => {
    const user = userEvent.setup();
    const onSelectStay = vi.fn();
    const stay: ReservationBoardStay = {
      reservationId: "res-1",
      reservationUnitId: "unit-1",
      confirmationNumber: "CNF-001",
      guestDisplayName: "Nguyen Van A",
      soldRoomTypeId: "type-standard",
      checkIn: "2026-09-02",
      checkOut: "2026-09-06",
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
        {
          segmentId: "seg-2",
          segmentVersion: 3,
          physicalRoomId: "room-201",
          actualRoomTypeId: "type-deluxe",
          startDate: "2026-09-04",
          endDate: "2026-09-06",
        },
      ],
      unassignedRanges: [],
    };

    render(<ReservationBoardServerTimeline {...baseProps()} stays={[stay]} onSelectStay={onSelectStay} />);

    const bars = screen.getAllByTitle("Nguyen Van A — CNF-001");
    expect(bars).toHaveLength(2);

    await user.click(bars[0]);
    expect(onSelectStay).toHaveBeenLastCalledWith(expect.objectContaining({ segment: stay.assignments[0] }));

    await user.click(bars[1]);
    expect(onSelectStay).toHaveBeenLastCalledWith(expect.objectContaining({ segment: stay.assignments[1] }));
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

  it("renders an unassigned bar in the sold RoomType's unassigned lane and reports its exact range", async () => {
    const user = userEvent.setup();
    const onSelectStay = vi.fn();
    const onSelectUnassignedRange = vi.fn();
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
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        stays={[stay]}
        onSelectStay={onSelectStay}
        onSelectUnassignedRange={onSelectUnassignedRange}
      />
    );

    const bar = screen.getByTitle("Tran Thi B — unassigned — CNF-002");
    await user.click(bar);
    // PMS-CAL-001.2-CP03A: an unassigned bar opens room assignment for that
    // range, not the read-only stay popover.
    expect(onSelectUnassignedRange).toHaveBeenCalledWith({ stay, unassignedRange: stay.unassignedRanges[0] });
    expect(onSelectStay).not.toHaveBeenCalled();
  });

  it("keeps unassigned bars focusable but aria-disabled and inert while actions are blocked (CP03A-C1)", async () => {
    const user = userEvent.setup();
    const onSelectUnassignedRange = vi.fn();
    const stay: ReservationBoardStay = {
      reservationId: "res-9",
      reservationUnitId: "unit-9",
      confirmationNumber: "CNF-009",
      guestDisplayName: "Blocked Guest",
      soldRoomTypeId: "type-standard",
      checkIn: "2026-09-02",
      checkOut: "2026-09-04",
      coverageStatus: "FullyUnassigned",
      assignments: [],
      unassignedRanges: [{ startDate: "2026-09-02", endDate: "2026-09-04" }],
    };
    const { rerender } = render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        stays={[stay]}
        onSelectUnassignedRange={onSelectUnassignedRange}
        unassignedActionsBlocked
      />
    );

    const bar = screen.getByTitle("Blocked Guest — unassigned — CNF-009");
    expect(bar).toHaveAttribute("aria-disabled", "true");
    expect(bar).toHaveAccessibleDescription(/assignment is unavailable/);
    await user.click(bar);
    bar.focus();
    await user.keyboard("{Enter} ");
    expect(onSelectUnassignedRange).not.toHaveBeenCalled();

    rerender(
      <ReservationBoardServerTimeline {...baseProps()} stays={[stay]} onSelectUnassignedRange={onSelectUnassignedRange} />
    );
    expect(bar).not.toHaveAttribute("aria-disabled");
    await user.click(bar);
    expect(onSelectUnassignedRange).toHaveBeenCalledTimes(1);
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
      const onSelectUnassignedRange = vi.fn();
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
          onSelectUnassignedRange={onSelectUnassignedRange}
        />
      );

      expect(screen.getByText("Penthouse")).toBeInTheDocument();
      const bar = screen.getByTitle("Tran Thi B — unassigned — CNF-003");
      await user.click(bar);
      expect(onSelectUnassignedRange).toHaveBeenCalledWith({ stay, unassignedRange: stay.unassignedRanges[0] });
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

  // PMS-CAL-001.1 correction C4 — unassigned demand is not mutually exclusive.
  // Every bar used to land on its sold RoomType's single unassigned row, so
  // overlapping bars painted over one another and the covered stay became
  // invisible and unclickable. They are now packed into as few lanes as the
  // intervals allow.
  describe("overlapping unassigned stays are packed into distinct lanes", () => {
    const roomTypesWithNoActiveRoom: ReservationBoardRoomType[] = [
      ...roomTypes,
      { id: "type-penthouse", code: "PENT", name: "Penthouse", isActive: true },
    ];

    /** One fully unassigned stay; extra disjoint ranges may be appended for the same Unit. */
    function unassignedStay(
      id: string,
      soldRoomTypeId: string,
      startDate: string,
      endDate: string,
      extraRanges: { startDate: string; endDate: string }[] = []
    ): ReservationBoardStay {
      return {
        reservationId: `res-${id}`,
        reservationUnitId: `unit-${id}`,
        confirmationNumber: `CNF-${id}`,
        guestDisplayName: `Guest ${id}`,
        soldRoomTypeId,
        checkIn: startDate,
        checkOut: endDate,
        coverageStatus: "FullyUnassigned",
        assignments: [],
        unassignedRanges: [{ startDate, endDate }, ...extraRanges],
      };
    }

    const barFor = (id: string) => screen.getByTitle(`Guest ${id} — unassigned — CNF-${id}`);
    const rowOf = (id: string) => barFor(id).style.gridRow;

    it("gives two overlapping stays different rows, both rendered and independently selectable", async () => {
      const user = userEvent.setup();
      const onSelectUnassignedRange = vi.fn();
      const first = unassignedStay("A", "type-standard", "2026-09-01", "2026-09-04");
      const second = unassignedStay("B", "type-standard", "2026-09-02", "2026-09-05");

      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[first, second]}
          onSelectUnassignedRange={onSelectUnassignedRange}
        />
      );

      expect(barFor("A")).toBeInTheDocument();
      expect(barFor("B")).toBeInTheDocument();
      expect(rowOf("A")).not.toBe(rowOf("B"));
      expect(screen.getByText("Unassigned 2")).toBeInTheDocument();

      await user.click(barFor("A"));
      expect(onSelectUnassignedRange).toHaveBeenLastCalledWith({ stay: first, unassignedRange: first.unassignedRanges[0] });
      await user.click(barFor("B"));
      expect(onSelectUnassignedRange).toHaveBeenLastCalledWith({
        stay: second,
        unassignedRange: second.unassignedRanges[0],
      });
    });

    it("allocates three lanes for three mutually overlapping stays", () => {
      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[
            unassignedStay("A", "type-standard", "2026-09-01", "2026-09-05"),
            unassignedStay("B", "type-standard", "2026-09-02", "2026-09-06"),
            unassignedStay("C", "type-standard", "2026-09-03", "2026-09-07"),
          ]}
        />
      );

      const lanes = new Set([rowOf("A"), rowOf("B"), rowOf("C")]);
      expect(lanes.size).toBe(3);
      expect(screen.getByText("Unassigned 2")).toBeInTheDocument();
      expect(screen.getByText("Unassigned 3")).toBeInTheDocument();
    });

    it("reuses one lane for stays that do not overlap", () => {
      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[
            unassignedStay("A", "type-standard", "2026-09-01", "2026-09-03"),
            unassignedStay("B", "type-standard", "2026-09-04", "2026-09-06"),
          ]}
        />
      );

      expect(rowOf("A")).toBe(rowOf("B"));
      expect(screen.queryByText("Unassigned 2")).not.toBeInTheDocument();
    });

    it("reuses one lane for half-open ranges that only touch at the boundary", () => {
      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[
            unassignedStay("A", "type-standard", "2026-09-01", "2026-09-03"),
            unassignedStay("B", "type-standard", "2026-09-03", "2026-09-05"),
          ]}
        />
      );

      expect(rowOf("A")).toBe(rowOf("B"));
      expect(screen.queryByText("Unassigned 2")).not.toBeInTheDocument();
    });

    it("uses the minimum safe lane count for a transitive overlap chain, hiding nothing", () => {
      // A overlaps B, B overlaps C, but A and C are disjoint — two lanes suffice.
      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[
            unassignedStay("A", "type-standard", "2026-09-01", "2026-09-03"),
            unassignedStay("B", "type-standard", "2026-09-02", "2026-09-05"),
            unassignedStay("C", "type-standard", "2026-09-04", "2026-09-06"),
          ]}
        />
      );

      expect(rowOf("A")).toBe(rowOf("C"));
      expect(rowOf("B")).not.toBe(rowOf("A"));
      expect(screen.getByText("Unassigned 2")).toBeInTheDocument();
      expect(screen.queryByText("Unassigned 3")).not.toBeInTheDocument();
    });

    it("allocates the same lanes regardless of the order the API returned the stays in", () => {
      const a = unassignedStay("A", "type-standard", "2026-09-01", "2026-09-04");
      const b = unassignedStay("B", "type-standard", "2026-09-02", "2026-09-05");
      const c = unassignedStay("C", "type-standard", "2026-09-03", "2026-09-06");

      const { unmount } = render(
        <ReservationBoardServerTimeline {...baseProps()} stays={[a, b, c]} />
      );
      const inOrder = { a: rowOf("A"), b: rowOf("B"), c: rowOf("C") };
      unmount();

      render(<ReservationBoardServerTimeline {...baseProps()} stays={[c, a, b]} />);
      expect({ a: rowOf("A"), b: rowOf("B"), c: rowOf("C") }).toEqual(inOrder);
    });

    it("keeps both bars of a single Unit's two disjoint unassigned ranges, sharing one lane", async () => {
      const user = userEvent.setup();
      const onSelectUnassignedRange = vi.fn();
      const split = unassignedStay("A", "type-standard", "2026-09-01", "2026-09-03", [
        { startDate: "2026-09-05", endDate: "2026-09-07" },
      ]);

      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[split]}
          onSelectUnassignedRange={onSelectUnassignedRange}
        />
      );

      const bars = screen.getAllByTitle("Guest A — unassigned — CNF-A");
      expect(bars).toHaveLength(2);
      expect(bars[0].style.gridRow).toBe(bars[1].style.gridRow);
      expect(screen.queryByText("Unassigned 2")).not.toBeInTheDocument();

      // Each bar selects exactly its own range — never the Unit's first or whole stay.
      await user.click(bars[1]);
      expect(onSelectUnassignedRange).toHaveBeenLastCalledWith({
        stay: split,
        unassignedRange: { startDate: "2026-09-05", endDate: "2026-09-07" },
      });
      await user.click(bars[0]);
      expect(onSelectUnassignedRange).toHaveBeenLastCalledWith({
        stay: split,
        unassignedRange: { startDate: "2026-09-01", endDate: "2026-09-03" },
      });
      expect(screen.getByRole("button", { name: "Assign room: Guest A, CNF-A, unassigned 2026-09-05 to 2026-09-07" })).toBe(
        bars[1]
      );
    });

    it("packs each sold RoomType independently", () => {
      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          stays={[
            unassignedStay("A", "type-standard", "2026-09-01", "2026-09-04"),
            unassignedStay("B", "type-standard", "2026-09-02", "2026-09-05"),
            unassignedStay("C", "type-deluxe", "2026-09-01", "2026-09-04"),
            unassignedStay("D", "type-deluxe", "2026-09-02", "2026-09-05"),
          ]}
        />
      );

      expect(rowOf("A")).not.toBe(rowOf("B"));
      expect(rowOf("C")).not.toBe(rowOf("D"));
      // Each RoomType gets its own second lane, and the two groups never share rows.
      expect(screen.getAllByText("Unassigned 2")).toHaveLength(2);
      expect(new Set([rowOf("A"), rowOf("B"), rowOf("C"), rowOf("D")]).size).toBe(4);
    });

    it("still packs lanes for a sold RoomType that has no active PhysicalRoom", () => {
      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithNoActiveRoom}
          stays={[
            unassignedStay("A", "type-penthouse", "2026-09-01", "2026-09-04"),
            unassignedStay("B", "type-penthouse", "2026-09-02", "2026-09-05"),
          ]}
        />
      );

      expect(screen.getByText("Penthouse")).toBeInTheDocument();
      expect(rowOf("A")).not.toBe(rowOf("B"));
      expect(screen.getByText("Unassigned 2")).toBeInTheDocument();
    });

    it("removes every dynamically allocated lane when the Unassigned filter is off, leaving assigned and block rows intact", () => {
      const assigned: ReservationBoardStay = {
        reservationId: "res-assigned",
        reservationUnitId: "unit-assigned",
        confirmationNumber: "CNF-ASSIGNED",
        guestDisplayName: "Assigned Guest",
        soldRoomTypeId: "type-standard",
        checkIn: "2026-09-02",
        checkOut: "2026-09-04",
        coverageStatus: "FullyAssigned",
        assignments: [
          {
            segmentId: "seg-assigned",
            segmentVersion: 1,
            physicalRoomId: "room-101",
            actualRoomTypeId: "type-standard",
            startDate: "2026-09-02",
            endDate: "2026-09-04",
          },
        ],
        unassignedRanges: [],
      };
      const block: ReservationBoardOperationalBlock = {
        roomBlockId: "block-1",
        segmentId: "seg-block-1",
        segmentVersion: 1,
        physicalRoomId: "room-101",
        startDate: "2026-09-05",
        endDate: "2026-09-06",
        reason: "Maintenance",
      };

      render(
        <ReservationBoardServerTimeline
          {...baseProps()}
          roomTypes={roomTypesWithNoActiveRoom}
          stays={[
            assigned,
            unassignedStay("A", "type-penthouse", "2026-09-01", "2026-09-04"),
            unassignedStay("B", "type-penthouse", "2026-09-02", "2026-09-05"),
          ]}
          operationalBlocks={[block]}
          showUnassigned={false}
        />
      );

      expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
      expect(screen.queryByText("Unassigned 2")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Guest A — unassigned — CNF-A")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Guest B — unassigned — CNF-B")).not.toBeInTheDocument();
      expect(screen.queryByText("Penthouse")).not.toBeInTheDocument();
      expect(screen.getByTitle("Assigned Guest — CNF-ASSIGNED")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Maintenance" })).toBeInTheDocument();
    });
  });
});

describe("ReservationBoardServerTimeline — drag to move (PMS-CAL-001.4-CP01)", () => {
  // Starts two days before the 7-day window, so its bar is clipped at the left edge.
  const stay: ReservationBoardStay = {
    reservationId: "res-1",
    reservationUnitId: "unit-1",
    confirmationNumber: "CNF-001",
    guestDisplayName: "Nguyen Van A",
    soldRoomTypeId: "type-standard",
    checkIn: "2026-08-30",
    checkOut: "2026-09-03",
    coverageStatus: "FullyAssigned",
    assignments: [
      {
        segmentId: "seg-1",
        segmentVersion: 4,
        physicalRoomId: "room-101",
        actualRoomTypeId: "type-standard",
        startDate: "2026-08-30",
        endDate: "2026-09-03",
      },
    ],
    unassignedRanges: [],
  };

  const transfer = () => ({ dropEffect: "none", effectAllowed: "all", setData: vi.fn(), getData: () => "", types: [] });

  function roomCells(roomId: string) {
    return Array.from(document.querySelectorAll<HTMLElement>(`div[data-drop-room-id="${roomId}"]`)).filter(
      (element) => !element.classList.contains("sticky")
    );
  }

  it("is not draggable unless the board offers drag-to-move", () => {
    render(<ReservationBoardServerTimeline {...baseProps()} stays={[stay]} />);
    expect(screen.getByTitle("Nguyen Van A — CNF-001")).not.toHaveAttribute("draggable");
  });

  it("reports only the room a drop landed in — the same for every column — plus the un-clipped segment", () => {
    const onDrop = vi.fn().mockReturnValue(null);
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        stays={[stay]}
        onAssignedSegmentDragStart={vi.fn().mockReturnValue(null)}
        getAssignedSegmentDropRefusal={vi.fn().mockReturnValue(null)}
        onAssignedSegmentDrop={onDrop}
      />
    );
    const bar = screen.getByTitle("Nguyen Van A — CNF-001");
    expect(bar).toHaveAttribute("draggable", "true");

    for (const column of [0, 3, 6]) {
      const dt = transfer();
      fireEvent.dragStart(bar, { dataTransfer: dt });
      fireEvent.dragOver(roomCells("room-201")[column], { dataTransfer: dt });
      fireEvent.drop(roomCells("room-201")[column], { dataTransfer: dt });
    }
    expect(onDrop).toHaveBeenCalledTimes(3);
    for (const call of onDrop.mock.calls) {
      expect(call).toEqual([{ stay, segment: stay.assignments[0] }, "room-201"]);
    }
  });

  it("over a row that is not a room it asks the board with null, does not accept the drop, and keeps the refusal after dragend", () => {
    const refusal = vi.fn().mockReturnValue("Drop on a room's row to move this stay.");
    const onDrop = vi.fn();
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        stays={[stay]}
        onAssignedSegmentDragStart={vi.fn().mockReturnValue(null)}
        getAssignedSegmentDropRefusal={refusal}
        onAssignedSegmentDrop={onDrop}
      />
    );
    const header = screen.getAllByText("Standard").find((element) => element.classList.contains("sticky"))!;
    const bar = screen.getByTitle("Nguyen Van A — CNF-001");
    const dt = transfer();
    fireEvent.dragStart(bar, { dataTransfer: dt });
    // Not accepted: fireEvent returns true when the handler did not preventDefault().
    expect(fireEvent.dragOver(header, { dataTransfer: dt })).toBe(true);
    expect(refusal).toHaveBeenLastCalledWith({ stay, segment: stay.assignments[0] }, null);
    // As in a real browser, a refused dragover is followed by dragend, never drop.
    fireEvent.dragEnd(bar, { dataTransfer: dt });
    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.getByTestId("board-drag-feedback")).toHaveTextContent(
      "Nothing was moved: Drop on a room's row to move this stay."
    );
  });

  it("a refused drag start cancels the drag and says why", () => {
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        stays={[stay]}
        onAssignedSegmentDragStart={vi.fn().mockReturnValue("Waiting for the board to be re-read after a change.")}
        getAssignedSegmentDropRefusal={vi.fn()}
        onAssignedSegmentDrop={vi.fn()}
      />
    );
    expect(fireEvent.dragStart(screen.getByTitle("Nguyen Van A — CNF-001"), { dataTransfer: transfer() })).toBe(false);
    expect(screen.getByTestId("board-drag-feedback")).toHaveTextContent(
      "This stay can't be moved right now: Waiting for the board to be re-read after a change."
    );
  });
});

describe("ReservationBoardServerTimeline — a bar's label never sizes the date columns (PMS-CAL-001.5-CP01)", () => {
  /**
   * The grid is `min-w-max` with `minmax(56px, 1fr)` date columns, so every
   * item's max-content width feeds the column size and the `1fr` columns grow
   * equally to fit the widest one. `truncate` clips visually but does not
   * reduce that. Live in Chrome, one block with a 186-character reason made all
   * 14 columns 1008px wide (grid 14,331px, one day visible). Each bar must
   * therefore be `contain: inline-size`, so its label contributes no width.
   *
   * jsdom performs no layout and loads no Tailwind CSS, so this can only guard
   * the structure; the pixel evidence is the live measurement in the report.
   */
  it("every bar kind — assigned, unassigned and operational block — contains its inline size", () => {
    const longText = "x".repeat(200);
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        stays={[
          {
            reservationId: "res-1",
            reservationUnitId: "unit-1",
            confirmationNumber: "CNF-001",
            guestDisplayName: longText,
            soldRoomTypeId: "type-standard",
            checkIn: "2026-09-02",
            checkOut: "2026-09-05",
            coverageStatus: "PartiallyAssigned",
            assignments: [
              { segmentId: "seg-1", segmentVersion: 1, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: "2026-09-02", endDate: "2026-09-03" },
            ],
            unassignedRanges: [{ startDate: "2026-09-03", endDate: "2026-09-05" }],
          },
        ]}
        operationalBlocks={[
          { roomBlockId: "b-1", segmentId: "seg-b", segmentVersion: 1, physicalRoomId: "room-201", startDate: "2026-09-04", endDate: "2026-09-05", reason: longText },
        ]}
      />
    );
    const assigned = screen.getByTitle(`${longText} — CNF-001`);
    const unassigned = screen.getByTitle(`${longText} — unassigned — CNF-001`);
    const block = screen.getByTitle(longText);
    for (const bar of [assigned, unassigned, block]) {
      expect(bar).toHaveClass("[contain:inline-size]");
    }
  });
});

describe("ReservationBoardServerTimeline — rooms that are not Active (PMS-CAL-004-CP01)", () => {
  // The API lists such a room only because an Effective block sits in it, with its real status.
  const archiveType: ReservationBoardRoomType = { id: "type-archive", code: "ARC", name: "Archive", isActive: false };
  const inactiveStandard: ReservationBoardPhysicalRoom = {
    id: "room-109",
    roomTypeId: "type-standard",
    roomNumber: "109",
    floor: 1,
    operationalStatus: "OutOfService",
  };
  const archivedRoom: ReservationBoardPhysicalRoom = {
    id: "room-901",
    roomTypeId: "type-archive",
    roomNumber: "901",
    floor: 9,
    operationalStatus: "Inactive",
  };
  const blockIn = (physicalRoomId: string, segmentId: string, reason: string): ReservationBoardOperationalBlock => ({
    roomBlockId: `header-${segmentId}`,
    segmentId,
    segmentVersion: 7,
    physicalRoomId,
    startDate: "2026-09-02",
    endDate: "2026-09-04",
    reason,
  });

  it("draws the room's row with its status and the block in it, reporting the room number on selection", async () => {
    const user = userEvent.setup();
    const onSelectBlock = vi.fn();
    const block = blockIn("room-109", "seg-109", "Pipe burst");
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        physicalRooms={[...physicalRooms, inactiveStandard]}
        operationalBlocks={[block]}
        onSelectBlock={onSelectBlock}
      />
    );

    expect(screen.getByText("109")).toBeInTheDocument();
    expect(screen.getByTestId("room-status-room-109")).toHaveTextContent("Out of service");
    // An Active room's row carries no status badge at all.
    expect(screen.queryByTestId("room-status-room-101")).not.toBeInTheDocument();
    const bar = screen.getByRole("button", { name: "Pipe burst — room 109, Out of service" });
    expect(bar).toHaveAttribute("title", "Pipe burst");
    await user.click(bar);
    expect(onSelectBlock).toHaveBeenCalledWith({ block, roomNumber: "109" });
  });

  it("says Inactive for an Inactive room and keeps an Active room's bar named by its reason alone", () => {
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        physicalRooms={[...physicalRooms, { ...inactiveStandard, id: "room-110", roomNumber: "110", operationalStatus: "Inactive" }]}
        operationalBlocks={[blockIn("room-110", "seg-110", "Closed"), blockIn("room-101", "seg-101", "Painting")]}
      />
    );
    expect(screen.getByTestId("room-status-room-110")).toHaveTextContent("Inactive");
    expect(screen.getByRole("button", { name: "Closed — room 110, Inactive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Painting" })).not.toHaveAttribute("aria-label");
  });

  it("a RoomType that has only such a room still gets its header and row, but no empty Unassigned lane of its own", () => {
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        roomTypes={[...roomTypes, archiveType]}
        physicalRooms={[...physicalRooms, archivedRoom]}
        operationalBlocks={[blockIn("room-901", "seg-901", "Archived block")]}
      />
    );
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("901")).toBeInTheDocument();
    expect(screen.getByTestId("room-status-room-901")).toHaveTextContent("Inactive");
    // Only the two Active types keep their one empty lane; the archive type adds none.
    expect(screen.getAllByText("Unassigned")).toHaveLength(2);
  });

  it("a visible unassigned stay sold under that RoomType still gets its lane by the old rule", async () => {
    const user = userEvent.setup();
    const onSelectUnassignedRange = vi.fn();
    const stay: ReservationBoardStay = {
      reservationId: "res-9",
      reservationUnitId: "unit-9",
      confirmationNumber: "CNF-009",
      guestDisplayName: "Le Van C",
      soldRoomTypeId: "type-archive",
      checkIn: "2026-09-02",
      checkOut: "2026-09-04",
      coverageStatus: "FullyUnassigned",
      assignments: [],
      unassignedRanges: [{ startDate: "2026-09-02", endDate: "2026-09-04" }],
    };
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        roomTypes={[...roomTypes, archiveType]}
        physicalRooms={[...physicalRooms, archivedRoom]}
        operationalBlocks={[blockIn("room-901", "seg-901", "Archived block")]}
        stays={[stay]}
        onSelectUnassignedRange={onSelectUnassignedRange}
      />
    );
    expect(screen.getAllByText("Unassigned")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: /Assign room: Le Van C/ }));
    expect(onSelectUnassignedRange).toHaveBeenCalledTimes(1);
  });

  it("a type with an Active room and a listed non-Active room keeps exactly one Unassigned lane", () => {
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        physicalRooms={[...physicalRooms, inactiveStandard]}
        operationalBlocks={[blockIn("room-109", "seg-109", "Pipe burst")]}
      />
    );
    expect(screen.getAllByText("Unassigned")).toHaveLength(2);
  });

  it("the filters keep their meaning: hiding blocks hides the bar, not the listed room; hiding unassigned hides the lanes", () => {
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        physicalRooms={[...physicalRooms, inactiveStandard]}
        operationalBlocks={[blockIn("room-109", "seg-109", "Pipe burst")]}
        showOperationalBlocks={false}
        showUnassigned={false}
      />
    );
    expect(screen.queryByRole("button", { name: /Pipe burst/ })).not.toBeInTheDocument();
    expect(screen.getByText("109")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("hands a drop on such a row to the board by its room id and accepts it only when the board allows it", () => {
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
        { segmentId: "seg-1", segmentVersion: 4, physicalRoomId: "room-101", actualRoomTypeId: "type-standard", startDate: "2026-09-02", endDate: "2026-09-04" },
      ],
      unassignedRanges: [],
    };
    const refusal = vi.fn().mockReturnValue("Room 109 is not Active.");
    const onDrop = vi.fn().mockReturnValue("Room 109 is not Active.");
    render(
      <ReservationBoardServerTimeline
        {...baseProps()}
        physicalRooms={[...physicalRooms, inactiveStandard]}
        operationalBlocks={[blockIn("room-109", "seg-109", "Pipe burst")]}
        stays={[stay]}
        onAssignedSegmentDragStart={() => null}
        getAssignedSegmentDropRefusal={refusal}
        onAssignedSegmentDrop={onDrop}
      />
    );
    const dataTransfer = { dropEffect: "none", effectAllowed: "all", setData: vi.fn(), getData: () => "", types: [] };
    fireEvent.dragStart(screen.getByTitle("Nguyen Van A — CNF-001"), { dataTransfer });
    const cell = Array.from(document.querySelectorAll<HTMLElement>('div[data-drop-room-id="room-109"]')).find(
      (element) => !element.classList.contains("sticky")
    )!;
    const over = fireEvent.dragOver(cell, { dataTransfer });
    // The board's refusal wins: the drop is not accepted, and the board is asked with the room's id.
    expect(over).toBe(true);
    expect(dataTransfer.dropEffect).toBe("none");
    expect(refusal).toHaveBeenLastCalledWith(expect.objectContaining({ stay }), "room-109");
    fireEvent.drop(cell, { dataTransfer });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ stay }), "room-109");
    expect(screen.getByTestId("board-drag-feedback")).toHaveTextContent("Nothing was moved: Room 109 is not Active.");
  });
});
