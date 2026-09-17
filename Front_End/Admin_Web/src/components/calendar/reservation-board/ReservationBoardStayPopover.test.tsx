import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReservationBoardStayPopover from "./ReservationBoardStayPopover";
import type { StaySelection, BlockSelection } from "./ReservationBoardServerTimeline";
import type { ReservationBoardOperationalBlock, ReservationBoardStay } from "@/lib/api/types";

const stay: ReservationBoardStay = {
  reservationId: "res-1",
  reservationUnitId: "unit-1",
  confirmationNumber: "CNF-001",
  guestDisplayName: "Nguyen Van A",
  soldRoomTypeId: "type-standard",
  checkIn: "2026-09-02",
  checkOut: "2026-09-04",
  coverageStatus: "PartiallyAssigned",
  assignments: [],
  unassignedRanges: [],
};

describe("ReservationBoardStayPopover", () => {
  it("renders only real Reservation fields — guest, confirmation #, dates, sold room type, coverage — and a not-recorded disclaimer", () => {
    const selection: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard" },
    };
    render(<ReservationBoardStayPopover selection={selection} onClose={vi.fn()} />);

    expect(screen.getByText("Nguyen Van A")).toBeInTheDocument();
    expect(screen.getByText("CNF-001")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Partially assigned")).toBeInTheDocument();
    expect(screen.getByText(/not recorded by this read-only view/)).toBeInTheDocument();

    // No fabricated PII/source/payment/lifecycle fields.
    for (const forbidden of ["Email", "Phone", "Nationality", "Source", "Payment", "Rate", "Folio"]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it("shows the assigned RoomType only when it differs from the sold RoomType", () => {
    const sameType: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard", actualRoomTypeName: "Standard" },
    };
    const { rerender } = render(<ReservationBoardStayPopover selection={sameType} onClose={vi.fn()} />);
    expect(screen.queryByText("Assigned room type")).not.toBeInTheDocument();

    const differentType: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard", actualRoomTypeName: "Deluxe" },
    };
    rerender(<ReservationBoardStayPopover selection={differentType} onClose={vi.fn()} />);
    expect(screen.getByText("Assigned room type")).toBeInTheDocument();
    expect(screen.getByText("Deluxe")).toBeInTheDocument();
  });

  it("renders only real OperationalBlock fields — room, dates, reason", () => {
    const block: ReservationBoardOperationalBlock = {
      roomBlockId: "block-1",
      segmentId: "seg-1",
      segmentVersion: 1,
      physicalRoomId: "room-101",
      startDate: "2026-09-02",
      endDate: "2026-09-03",
      reason: "Maintenance",
    };
    const selection: { kind: "block"; value: BlockSelection } = {
      kind: "block",
      value: { block, roomNumber: "101" },
    };
    render(<ReservationBoardStayPopover selection={selection} onClose={vi.fn()} />);

    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
  });

  it("calls onClose when the close button or the backdrop is activated", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const selection: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard" },
    };
    render(<ReservationBoardStayPopover selection={selection} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the dialog content", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const selection: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard" },
    };
    render(<ReservationBoardStayPopover selection={selection} onClose={onClose} />);

    await user.click(screen.getByText("Nguyen Van A"));
    expect(onClose).not.toHaveBeenCalled();
  });

  const segment = {
    segmentId: "seg-1",
    segmentVersion: 2,
    physicalRoomId: "room-101",
    actualRoomTypeId: "type-standard",
    startDate: "2026-09-02",
    endDate: "2026-09-04",
  };

  it("PMS-CAL-001.2-CP04C.5: offers Move room only when the selection carries the exact clicked segment, and reports exactly that segment — never the whole Reservation", async () => {
    const user = userEvent.setup();
    const onMoveRoom = vi.fn();
    const selection: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard", segment },
    };
    render(<ReservationBoardStayPopover selection={selection} onClose={vi.fn()} onMoveRoom={onMoveRoom} />);

    const move = screen.getByRole("button", { name: "Move room" });
    expect(move).not.toBeDisabled();
    await user.click(move);
    expect(onMoveRoom).toHaveBeenCalledTimes(1);
    expect(onMoveRoom).toHaveBeenCalledWith({ stay, segment });
  });

  it("never offers Move room for a selection without a segment, even when onMoveRoom is supplied", () => {
    const selection: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard" },
    };
    render(<ReservationBoardStayPopover selection={selection} onClose={vi.fn()} onMoveRoom={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Move room" })).not.toBeInTheDocument();
  });

  it("disables Move room while moveBlocked is true, without calling onMoveRoom on click", async () => {
    const user = userEvent.setup();
    const onMoveRoom = vi.fn();
    const selection: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard", segment },
    };
    render(
      <ReservationBoardStayPopover selection={selection} onClose={vi.fn()} onMoveRoom={onMoveRoom} moveBlocked />
    );

    const move = screen.getByRole("button", { name: "Move room" });
    expect(move).toBeDisabled();
    await user.click(move);
    expect(onMoveRoom).not.toHaveBeenCalled();
  });
});
