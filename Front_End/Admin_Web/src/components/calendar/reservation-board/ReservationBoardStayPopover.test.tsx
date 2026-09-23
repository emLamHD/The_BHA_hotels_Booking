import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
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

  describe("Remove room assignment (PMS-CAL-001.2-CP04D.4C.1)", () => {
    const assigned: { kind: "stay"; value: StaySelection } = {
      kind: "stay",
      value: { stay, roomTypeName: "Standard", segment },
    };
    const unassignButton = () => screen.queryByRole("button", { name: "Remove room assignment" });

    it("1. is offered for an assigned bar's exact segment when the caller supplies the callback", () => {
      render(<ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onUnassignRoom={vi.fn()} />);
      expect(unassignButton()).toBeInTheDocument();
      expect(unassignButton()).not.toBeDisabled();
      expect(document.body.textContent).not.toMatch(/cancel reservation|delete booking/i);
    });

    it("2. reports exactly the clicked { stay, segment } once — not the Reservation, and not another segment", async () => {
      const user = userEvent.setup();
      const onUnassignRoom = vi.fn();
      const otherSegment = { ...segment, segmentId: "seg-0", physicalRoomId: "room-102" };
      const multiSegmentStay = { ...stay, assignments: [otherSegment, segment] };
      render(
        <ReservationBoardStayPopover
          selection={{ kind: "stay", value: { stay: multiSegmentStay, roomTypeName: "Standard", segment } }}
          onClose={vi.fn()}
          onUnassignRoom={onUnassignRoom}
        />
      );

      await user.click(unassignButton()!);
      expect(onUnassignRoom).toHaveBeenCalledTimes(1);
      expect(onUnassignRoom).toHaveBeenCalledWith({ stay: multiSegmentStay, segment });
      expect(onUnassignRoom.mock.calls[0][0].segment).toBe(segment);
      expect(Object.keys(onUnassignRoom.mock.calls[0][0]).sort()).toEqual(["segment", "stay"]);
    });

    it("3. is not offered when the selection carries no segment, even with a callback", () => {
      const noSegment: { kind: "stay"; value: StaySelection } = { kind: "stay", value: { stay, roomTypeName: "Standard" } };
      render(<ReservationBoardStayPopover selection={noSegment} onClose={vi.fn()} onUnassignRoom={vi.fn()} />);
      expect(unassignButton()).not.toBeInTheDocument();
    });

    it("4. is not offered when no callback is supplied", () => {
      render(<ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onMoveRoom={vi.fn()} />);
      expect(unassignButton()).not.toBeInTheDocument();
    });

    it("5. unassignBlocked disables it natively for mouse and keyboard — the callback is never called", async () => {
      const user = userEvent.setup();
      const onUnassignRoom = vi.fn();
      render(<ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onUnassignRoom={onUnassignRoom} unassignBlocked />);

      const button = unassignButton()!;
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      await user.click(button);
      fireEvent.click(button);
      button.focus();
      await user.keyboard("{Enter} ");
      await user.tab();
      await user.keyboard("{Enter}");
      expect(onUnassignRoom).not.toHaveBeenCalled();
    });

    it("6. renders a short blocked explanation linked to the button, and none when not blocked", () => {
      const { rerender } = render(
        <ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onUnassignRoom={vi.fn()} unassignBlocked />
      );
      expect(unassignButton()).toHaveAccessibleDescription(/Refreshing from the server, or this segment already has an unresolved write/);

      rerender(<ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onUnassignRoom={vi.fn()} />);
      expect(screen.queryByText(/unresolved write/)).not.toBeInTheDocument();
      expect(unassignButton()).not.toHaveAttribute("aria-describedby");
    });

    it("7. Move and Unassign blocked states are independent, in both directions", async () => {
      const user = userEvent.setup();
      const onMoveRoom = vi.fn();
      const onUnassignRoom = vi.fn();
      const move = () => screen.getByRole("button", { name: "Move room" });
      const { rerender } = render(
        <ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onMoveRoom={onMoveRoom} onUnassignRoom={onUnassignRoom} unassignBlocked />
      );
      expect(unassignButton()).toBeDisabled();
      expect(move()).not.toBeDisabled();
      await user.click(move());
      expect(onMoveRoom).toHaveBeenCalledTimes(1);

      rerender(
        <ReservationBoardStayPopover selection={assigned} onClose={vi.fn()} onMoveRoom={onMoveRoom} onUnassignRoom={onUnassignRoom} moveBlocked />
      );
      expect(move()).toBeDisabled();
      expect(unassignButton()).not.toBeDisabled();
      await user.click(unassignButton()!);
      expect(onUnassignRoom).toHaveBeenCalledTimes(1);
      expect(onMoveRoom).toHaveBeenCalledTimes(1);
    });

    it("8. Move room still reports the same segment when Unassign is also offered, and neither action closes the popover", async () => {
      const user = userEvent.setup();
      const onMoveRoom = vi.fn();
      const onClose = vi.fn();
      render(<ReservationBoardStayPopover selection={assigned} onClose={onClose} onMoveRoom={onMoveRoom} onUnassignRoom={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Move room" }));
      await user.click(unassignButton()!);
      expect(onMoveRoom).toHaveBeenCalledWith({ stay, segment });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Reservation details" })).toBeInTheDocument();
    });

    it("9. an operational-block selection never has the action, even with callbacks and blocked flags", () => {
      const block: ReservationBoardOperationalBlock = {
        roomBlockId: "block-1",
        segmentId: "seg-b",
        segmentVersion: 1,
        physicalRoomId: "room-101",
        startDate: "2026-09-02",
        endDate: "2026-09-03",
        reason: "Maintenance",
      };
      const selection: { kind: "block"; value: BlockSelection } = { kind: "block", value: { block, roomNumber: "101" } };
      render(<ReservationBoardStayPopover selection={selection} onClose={vi.fn()} onUnassignRoom={vi.fn()} unassignBlocked />);
      expect(unassignButton()).not.toBeInTheDocument();
      expect(screen.queryByText(/unresolved write/)).not.toBeInTheDocument();
    });

    it("10. PMS-CAL-001.2-CP04D-BOARD-WIRING: the live board now wires the callback, the same way it already wires Move room", () => {
      const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "ReservationBoard.tsx"), "utf8");
      expect(source).toContain("ReservationBoardStayPopover");
      expect(source).toMatch(/onUnassignRoom={handleUnassignRoom}/);
      expect(source).toMatch(/unassignBlocked=\{/);
      expect(source).toContain("ReservationUnassignDialog");
    });
  });
});
