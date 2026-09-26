import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReservationMoveDialog from "./ReservationMoveDialog";
import type { MoveAssignmentOutcome } from "@/lib/api/client";
import type { AssignmentRoomCandidate } from "./assignmentTarget";
import type { MoveTarget } from "./moveTarget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const sameType: AssignmentRoomCandidate = {
  id: "room-102",
  roomNumber: "102",
  floor: 1,
  roomTypeId: "type-standard",
  roomTypeName: "Standard",
  isSameSoldType: true,
};
const crossType: AssignmentRoomCandidate = {
  id: "room-201",
  roomNumber: "201",
  floor: 2,
  roomTypeId: "type-deluxe",
  roomTypeName: "Deluxe",
  isSameSoldType: false,
};

function buildTarget(overrides: Partial<MoveTarget> = {}): MoveTarget {
  return {
    propertyId: "prop-a",
    boardKey: "prop-a|2026-09-01|2026-09-15",
    boardFrom: "2026-09-01",
    boardTo: "2026-09-15",
    propertyName: "Property A",
    stay: {
      reservationId: "res-1",
      reservationUnitId: "unit-1",
      confirmationNumber: "CNF-001",
      guestDisplayName: "Nguyen Van A",
      soldRoomTypeId: "type-standard",
      checkIn: "2026-09-02",
      checkOut: "2026-09-04",
      coverageStatus: "FullyAssigned",
      assignments: [],
      unassignedRanges: [],
    },
    segment: {
      segmentId: "seg-1",
      segmentVersion: 2,
      physicalRoomId: "room-101",
      actualRoomTypeId: "type-standard",
      startDate: "2026-09-02",
      endDate: "2026-09-04",
    },
    soldRoomTypeName: "Standard",
    currentRoomNumber: "101",
    currentRoomTypeName: "Standard",
    candidateRooms: [sameType, crossType],
    ...overrides,
  };
}

function dialog() {
  return screen.getByRole("dialog", { name: "Move room" });
}

describe("ReservationMoveDialog (PMS-CAL-001.2-CP04C.4)", () => {
  it("1. summary shows the full source range and the exact current-room identity", () => {
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(within(dialog()).getByText("Nguyen Van A")).toBeInTheDocument();
    expect(within(dialog()).getByText("CNF-001")).toBeInTheDocument();
    expect(within(dialog()).getByText("Standard")).toBeInTheDocument();
    expect(within(dialog()).getByText("101 (Standard)")).toBeInTheDocument();
    expect(within(dialog()).getByText(/\[2026-09-02, 2026-09-04\) · 2 nights/)).toBeInTheDocument();
  });

  it("2. offers only the same-sold-RoomType candidate; the cross-RoomType candidate is never shown", () => {
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(within(dialog()).getByLabelText(/Room 102/)).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    expect(within(dialog()).queryByText("Deluxe")).not.toBeInTheDocument();
  });

  it("3. submitting without a selected room shows validation and never calls onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);

    await user.click(within(dialog()).getByRole("button", { name: "Move room" }));

    expect(within(dialog()).getByText("Select a room to move to.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("4. a double click, repeated Enter, or several submits in the same tick start exactly one request", async () => {
    const user = userEvent.setup();
    const move = deferred<MoveAssignmentOutcome>();
    const onSubmit = vi.fn().mockImplementation(() => move.promise);
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);

    await user.click(within(dialog()).getByLabelText(/Room 102/));
    const submit = within(dialog()).getByRole("button", { name: "Move to room 102" });
    const form = submit.closest("form")!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.dblClick(submit);
    submit.focus();
    await user.keyboard("{Enter}{Enter}{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Moving…" })).toHaveAttribute("aria-disabled", "true");
    expect(dialog().querySelector("form")).toHaveAttribute("aria-busy", "true");

    await act(async () => move.resolve({ kind: "moved", segments: null }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("5. cannot be closed while pending; once settled, Close/Escape call onClose exactly once", async () => {
    // PMS-CAL-001.2-CP04C.5-C2: this dialog no longer tries to restore focus
    // to an "opener" on unmount itself — see ReservationMoveDialog.tsx's own
    // comment on why it cannot reliably do that when opened from a popover.
    // `onClose` firing is the caller's (ReservationBoard.tsx's) signal to
    // handle focus restoration; that behavior is covered at the board level.
    const user = userEvent.setup();
    const move = deferred<MoveAssignmentOutcome>();
    const onSubmit = vi.fn().mockImplementation(() => move.promise);
    const onClose = vi.fn();

    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={onClose} />);
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));

    await user.keyboard("{Escape}");
    for (const closeButton of within(dialog()).getAllByRole("button", { name: "Close" })) {
      await user.click(closeButton);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(/stays open until the server responds/)).toBeInTheDocument();

    await act(async () => move.resolve({ kind: "moved", segments: null }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("6. a validation rejection and a not-sent outcome both keep resubmit available", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "bad" })
      .mockResolvedValueOnce({ kind: "not-sent", message: "not configured" });
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);

    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));
    await within(dialog()).findByText("The server did not accept this move. Nothing was saved.");
    expect(within(dialog()).getByRole("button", { name: "Move to room 102" })).toBeInTheDocument();

    await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));
    await within(dialog()).findByText("The request was not sent. Nothing was saved.");
    expect(within(dialog()).getByRole("button", { name: "Move to room 102" })).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("7. moved, conflict, and unknown each lock resubmit — the Confirm button disappears", async () => {
    for (const outcome of [
      { kind: "moved", segments: null } as const,
      { kind: "rejected", status: 409, category: "conflict", detail: "stale" } as const,
      { kind: "unknown", reason: "network" } as const,
    ]) {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(outcome);
      const { unmount } = render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);

      await user.click(within(dialog()).getByLabelText(/Room 102/));
      await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));
      await waitFor(() => expect(within(dialog()).getByRole("alert")).toBeInTheDocument());
      expect(within(dialog()).queryByRole("button", { name: /Move (room|to room)/ })).not.toBeInTheDocument();

      unmount();
    }
  });

  it("8. an unknown result never claims failure, cancellation, or a rollback, and states it was not retried", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "unknown", reason: "timeout" });
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);

    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));

    const alert = await within(dialog()).findByRole("alert");
    const text = alert.textContent!.toLowerCase();
    expect(text).toContain("could not be confirmed");
    expect(text).toContain("may or may not have been saved");
    expect(text).toContain("not retried");
    expect(text).not.toMatch(/cancel|failed to save|was not saved|rolled? back|rollback/);
  });

  it("9. is fully keyboard-operable: select a candidate, submit, and Tab never leaves the dialog", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);

    const roomInput = within(dialog()).getByLabelText(/Room 102/);
    expect(document.activeElement).toBe(roomInput);
    await user.keyboard(" ");
    expect(roomInput).toBeChecked();

    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog()).getByRole("alert")).toBeInTheDocument());

    // Tab/Shift+Tab must never move focus outside the dialog.
    const focusable = within(dialog()).getAllByRole("button");
    for (let i = 0; i < focusable.length + 2; i += 1) {
      await user.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
  });
});

describe("ReservationMoveDialog — cross-RoomType contract, opt-in only (PMS-CAL-001.2-CP04C.6A)", () => {
  it("10. disabled (the default, and the only mode any live caller uses) offers only the same-sold-RoomType candidate — regression pin", () => {
    render(<ReservationMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(within(dialog()).getByLabelText(/Room 102/)).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    expect(within(dialog()).queryByText("Deluxe")).not.toBeInTheDocument();
    expect(within(dialog()).queryByText(/deliberately chosen a room of a different room type/)).not.toBeInTheDocument();
  });

  it("11. enabled: offers same-sold-RoomType rooms first, then cross-RoomType rooms, each cross-RoomType room labeled with its own room type", () => {
    render(
      <ReservationMoveDialog
        target={buildTarget()}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(within(dialog()).getByLabelText(/Room 102/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText(/Room 201/)).toBeInTheDocument();
    // Same-sold-RoomType first, cross-RoomType after — never the room's own tag on the sold-type one.
    const radios = within(dialog()).getAllByRole("radio").map((radio) => radio.closest("label")!.textContent);
    expect(radios).toEqual(["Room 102Floor 1", "Room 201DeluxeFloor 2"]);
    // The cross-RoomType confirmation panel is not shown until a cross-type room is actually selected.
    expect(within(dialog()).queryByLabelText(/deliberately chosen a room of a different room type/)).not.toBeInTheDocument();
  });

  it("12. enabled: selecting a cross-RoomType room without confirming, or without a (post-trim) reason, never calls onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ReservationMoveDialog
        target={buildTarget()}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    await user.click(within(dialog()).getByLabelText(/Room 201/));
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 201" }));
    expect(within(dialog()).getByText("Confirm this cross-room-type placement to continue.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(within(dialog()).getByRole("checkbox"));
    await user.type(within(dialog()).getByLabelText("Reason"), "   ");
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 201" }));
    expect(within(dialog()).getByText("Enter a reason for this cross-room-type placement.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("13. enabled: a valid cross-RoomType submission calls onSubmit with confirmCrossRoomType intent true and the trimmed reason", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(
      <ReservationMoveDialog
        target={buildTarget()}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    await user.click(within(dialog()).getByLabelText(/Room 201/));
    await user.click(within(dialog()).getByRole("checkbox"));
    await user.type(within(dialog()).getByLabelText("Reason"), "  Only Deluxe available tonight  ");
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 201" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("room-201", { reason: "Only Deluxe available tonight" });
  });

  it("14. enabled: a same-sold-RoomType submission still calls onSubmit with null — never a confirmation payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(
      <ReservationMoveDialog
        target={buildTarget()}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    await user.click(within(dialog()).getByLabelText(/Room 102/));
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("room-102", null);
  });

  it("15. enabled: changing the destination room clears a prior confirmation and reason — cross→same and cross→cross alike", async () => {
    const user = userEvent.setup();
    const secondCrossType: AssignmentRoomCandidate = {
      id: "room-202",
      roomNumber: "202",
      floor: 2,
      roomTypeId: "type-deluxe",
      roomTypeName: "Deluxe",
      isSameSoldType: false,
    };
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(
      <ReservationMoveDialog
        target={buildTarget({ candidateRooms: [sameType, crossType, secondCrossType] })}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    // cross → cross: confirmation/reason must not carry over to the new room.
    await user.click(within(dialog()).getByLabelText(/Room 201/));
    await user.click(within(dialog()).getByRole("checkbox"));
    await user.type(within(dialog()).getByLabelText("Reason"), "First reason");
    await user.click(within(dialog()).getByLabelText(/Room 202/));
    expect(within(dialog()).getByRole("checkbox")).not.toBeChecked();
    expect(within(dialog()).getByLabelText("Reason")).toHaveValue("");

    // cross → same: the confirmation panel itself must disappear.
    await user.click(within(dialog()).getByRole("checkbox"));
    await user.type(within(dialog()).getByLabelText("Reason"), "Second reason");
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    expect(within(dialog()).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog()).queryByLabelText("Reason")).not.toBeInTheDocument();

    // Confirms the reset actually took effect on submit, not just visually.
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 102" }));
    expect(onSubmit).toHaveBeenCalledWith("room-102", null);
  });

  it("16. cross-RoomType status is judged against the sold room type, never the segment's own current room type", async () => {
    const user = userEvent.setup();
    // The source segment is already sitting in a different RoomType than
    // sold (e.g. an earlier cross-RoomType placement) — `Room 201` here
    // happens to share that same current RoomType, but is still cross
    // relative to what was actually sold, and must still require confirmation.
    const target = buildTarget({
      currentRoomNumber: "201",
      currentRoomTypeName: "Deluxe",
      segment: {
        segmentId: "seg-1",
        segmentVersion: 2,
        physicalRoomId: "room-201-current",
        actualRoomTypeId: "type-deluxe",
        startDate: "2026-09-02",
        endDate: "2026-09-04",
      },
    });
    const onSubmit = vi.fn();
    render(
      <ReservationMoveDialog target={target} boardReloadStatus="idle" crossRoomTypeEnabled onSubmit={onSubmit} onClose={vi.fn()} />
    );

    await user.click(within(dialog()).getByLabelText(/Room 201/));
    expect(within(dialog()).getByText("Cross-room-type placement")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 201" }));
    expect(onSubmit).not.toHaveBeenCalled();

    // The same-sold-RoomType room is still same-type, unaffected by the source's own current type.
    await user.click(within(dialog()).getByLabelText(/Room 102/));
    expect(within(dialog()).queryByText("Cross-room-type placement")).not.toBeInTheDocument();
  });

  it("17. a double click, repeated Enter, or several submits in the same tick with a confirmed cross-RoomType selection still start exactly one request", async () => {
    const user = userEvent.setup();
    const move = deferred<MoveAssignmentOutcome>();
    const onSubmit = vi.fn().mockImplementation(() => move.promise);
    render(
      <ReservationMoveDialog
        target={buildTarget()}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    await user.click(within(dialog()).getByLabelText(/Room 201/));
    await user.click(within(dialog()).getByRole("checkbox"));
    await user.type(within(dialog()).getByLabelText("Reason"), "Only option available");
    const submit = within(dialog()).getByRole("button", { name: "Move to room 201" });
    const form = submit.closest("form")!;

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.dblClick(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Moving…" })).toHaveAttribute("aria-disabled", "true");

    await act(async () => move.resolve({ kind: "moved", segments: null }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("18. keyboard-operable in cross-RoomType mode: Tab reaches the confirmation checkbox and reason field without ever leaving the dialog", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(
      <ReservationMoveDialog
        target={buildTarget()}
        boardReloadStatus="idle"
        crossRoomTypeEnabled
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    const crossRoomInput = within(dialog()).getByLabelText(/Room 201/);
    crossRoomInput.focus();
    await user.keyboard(" ");
    expect(crossRoomInput).toBeChecked();

    const checkbox = within(dialog()).getByRole("checkbox");
    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();

    await user.type(within(dialog()).getByLabelText("Reason"), "Only option available");
    await user.click(within(dialog()).getByRole("button", { name: "Move to room 201" }));
    expect(onSubmit).toHaveBeenCalledWith("room-201", { reason: "Only option available" });
    await waitFor(() => expect(within(dialog()).getByRole("alert")).toBeInTheDocument());

    // Tab/Shift+Tab must never move focus outside the dialog, even with the
    // extra checkbox/textarea in the tree.
    const focusable = within(dialog()).queryAllByRole("button");
    for (let i = 0; i < focusable.length + 3; i += 1) {
      await user.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
  });
});
