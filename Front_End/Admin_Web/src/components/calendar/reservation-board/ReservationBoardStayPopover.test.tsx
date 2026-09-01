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
});
