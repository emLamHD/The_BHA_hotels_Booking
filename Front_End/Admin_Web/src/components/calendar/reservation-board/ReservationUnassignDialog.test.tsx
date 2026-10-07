import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReservationUnassignDialog from "./ReservationUnassignDialog";
import type { UnassignAssignmentOutcome } from "@/lib/api/client";
import type { UnassignTarget } from "./unassignTarget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// The segment (2026-08-20 → 2026-09-25) runs past both edges of the board
// window (2026-09-01 → 2026-09-15): the dialog must show the full range.
function buildTarget(): UnassignTarget {
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
      checkIn: "2026-08-20",
      checkOut: "2026-09-25",
      coverageStatus: "FullyAssigned",
      assignments: [],
      unassignedRanges: [],
    },
    segment: {
      segmentId: "seg-1",
      segmentVersion: 2,
      physicalRoomId: "room-201",
      actualRoomTypeId: "type-deluxe",
      startDate: "2026-08-20",
      endDate: "2026-09-25",
    },
    soldRoomTypeName: "Standard",
    currentRoomNumber: "201",
    currentRoomTypeName: "Deluxe",
  };
}

const dialog = () => screen.getByRole("dialog", { name: "Remove room assignment" });
const confirmButton = () => within(dialog()).queryByRole("button", { name: /^(Remove room 201 assignment|Removing…)$/ });
const renderDialog = (onSubmit = vi.fn(), onClose = vi.fn()) => {
  render(<ReservationUnassignDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
};

describe("ReservationUnassignDialog (PMS-CAL-001.2-CP04D.4B)", () => {
  it("1. shows Property, guest, confirmation, unit, sold RoomType, current room and the full un-clipped range", () => {
    renderDialog();
    const d = within(dialog());
    expect(d.getByText("Nguyen Van A")).toBeInTheDocument();
    expect(d.getByText("CNF-001")).toBeInTheDocument();
    expect(d.getByText("unit-1")).toBeInTheDocument();
    expect(d.getByText("Property A")).toBeInTheDocument();
    expect(d.getByText("Standard")).toBeInTheDocument();
    expect(d.getByText("201 (Deluxe)")).toBeInTheDocument();
    expect(d.getByText("[2026-08-20, 2026-09-25) · 36 nights")).toBeInTheDocument();
  });

  it("2. says only the room assignment is removed and the reservation, dates and rates are untouched — never cancel/delete wording", () => {
    renderDialog();
    expect(dialog()).toHaveAccessibleDescription(/removes only the room assignment of this segment/);
    expect(dialog()).toHaveAccessibleDescription(/reservation still exists/);
    expect(dialog()).toHaveAccessibleDescription(/stay dates, rates and commercial snapshot are not changed/);
    expect(dialog().textContent).not.toMatch(/cancel reservation|delete booking|delete reservation/i);
    expect(within(dialog()).getByRole("heading", { name: "Remove room assignment" })).toBeInTheDocument();
    expect(confirmButton()).toHaveAccessibleName("Remove room 201 assignment");
    expect(within(dialog()).getByLabelText("Reason (optional)")).toBeInTheDocument();
  });

  it("3. omits an empty or whitespace-only reason and trims a non-empty one", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "rejected", status: 400, category: "validation", detail: "bad" });
    renderDialog(onSubmit);

    await user.click(confirmButton()!);
    await within(dialog()).findByRole("alert");
    await user.type(within(dialog()).getByLabelText("Reason (optional)"), "   ");
    await user.click(confirmButton()!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0]).toEqual([undefined]);
    expect(onSubmit.mock.calls[1]).toEqual([undefined]);

    await user.clear(within(dialog()).getByLabelText("Reason (optional)"));
    await user.type(within(dialog()).getByLabelText("Reason (optional)"), "  guest asked to leave  ");
    await user.click(confirmButton()!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]).toEqual(["guest asked to leave"]);
  });

  it("4. a double click, repeated Enter, or several submits in the same tick call onSubmit once", async () => {
    const user = userEvent.setup();
    const pendingRequest = deferred<UnassignAssignmentOutcome>();
    const onSubmit = vi.fn().mockImplementation(() => pendingRequest.promise);
    renderDialog(onSubmit);

    const submit = confirmButton()!;
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
    await act(async () => pendingRequest.resolve({ kind: "unassigned", segments: null }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("5. while pending, Close, Escape and the backdrop are inert, a second submit is refused, and pending is announced", async () => {
    const user = userEvent.setup();
    const pendingRequest = deferred<UnassignAssignmentOutcome>();
    const onSubmit = vi.fn().mockImplementation(() => pendingRequest.promise);
    const { onClose } = renderDialog(onSubmit);

    await user.click(confirmButton()!);
    await user.keyboard("{Escape}");
    for (const closeButton of within(dialog()).getAllByRole("button", { name: "Close" })) await user.click(closeButton);
    fireEvent.mouseDown(dialog().parentElement!);

    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("status")).toHaveTextContent(/stays open until the server responds/);
    expect(dialog().querySelector("form")).toHaveAttribute("aria-busy", "true");
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    expect(confirmButton()).toHaveTextContent("Removing…");
    fireEvent.submit(dialog().querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => pendingRequest.resolve({ kind: "unassigned", segments: null }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("6. once the promise has settled the dialog can be closed, and onClose fires exactly once", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "unassigned", segments: null });
    const { onClose } = renderDialog(onSubmit);

    await user.click(confirmButton()!);
    await within(dialog()).findByRole("status", { name: "" });
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" })[1]);
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog().parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("7. not-sent and validation outcomes keep Confirm available and allow another submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ kind: "not-sent", message: "not configured" })
      .mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "Reason is too long." });
    renderDialog(onSubmit);

    await user.click(confirmButton()!);
    await within(dialog()).findByText(/request was not sent/);
    await user.click(confirmButton()!);
    await within(dialog()).findByText("Reason is too long.");
    expect(confirmButton()).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("8. success, conflict and unknown each lock resubmit — Confirm disappears and a stray submit is refused", async () => {
    for (const outcome of [
      { kind: "unassigned", segments: null } as const,
      { kind: "rejected", status: 409, category: "conflict", detail: "stale" } as const,
      { kind: "unknown", reason: "timeout" } as const,
    ]) {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(outcome);
      const { unmount } = render(
        <ReservationUnassignDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />
      );

      await user.click(confirmButton()!);
      await waitFor(() => expect(within(dialog()).queryByRole("alert") ?? within(dialog()).queryByRole("status")).toBeTruthy());
      expect(confirmButton()).not.toBeInTheDocument();
      fireEvent.submit(dialog().querySelector("form")!);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("9. a throwing onSubmit is shown as an unconfirmed result — not a failure, cancellation or rollback — and locks resubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("socket hang up"));
    renderDialog(onSubmit);

    await user.click(confirmButton()!);
    const alert = await within(dialog()).findByRole("alert");
    const text = alert.textContent!.toLowerCase();
    expect(text).toContain("could not be confirmed");
    expect(text).toContain("may or may not have been removed");
    expect(text).toContain("not retried");
    expect(text).not.toMatch(/success|fail|cancel|roll(ed)?.?back|socket hang up/);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("10. starts focus on Close, never on the destructive action, and keeps Tab / Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    const [headerClose] = within(dialog()).getAllByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(headerClose);
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    // Shift+Tab from the first control wraps to the last (Confirm); Tab from it wraps back to the first.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirmButton());
    await user.tab();
    expect(document.activeElement).toBe(headerClose);
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
  });

  it("11. Escape while idle calls onClose exactly once", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard("{Escape}{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("12. the result takes focus; a confirmed success is a polite status, a warning or error is an alert", async () => {
    for (const [outcome, role] of [
      [{ kind: "unassigned", segments: null }, "status"],
      [{ kind: "rejected", status: 409, category: "conflict" }, "alert"],
      [{ kind: "rejected", status: 415, category: "refused" }, "alert"],
    ] as const) {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(outcome);
      const { unmount } = render(
        <ReservationUnassignDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />
      );

      await user.click(confirmButton()!);
      const result = await within(dialog()).findByRole(role, { name: "" });
      await waitFor(() => expect(document.activeElement).toBe(result));
      unmount();
    }
  });

  it("13. has no cross-RoomType or authorization wording, checkbox or field — even for an anomalous cross-RoomType outcome", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({
      kind: "rejected",
      status: 403,
      category: "cross-room-type-confirmation-required",
      detail: "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.",
    });
    renderDialog(onSubmit);

    expect(dialog().textContent).not.toMatch(/cross|authori[sz]|different room type|confirmCrossRoomType/i);
    expect(within(dialog()).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("radio")).not.toBeInTheDocument();

    await user.click(confirmButton()!);
    const alert = await within(dialog()).findByRole("alert");
    expect(alert.textContent).not.toMatch(/cross|authori[sz]|room.?type|confirm|reason/i);
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it("14. does not import or call the API client, a board loader or a reconciliation mutation itself", () => {
    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "ReservationUnassignDialog.tsx"), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    const clientImports = imports.filter((line) => line.includes("@/lib/api/client"));
    expect(clientImports.every((line) => line.startsWith("import type"))).toBe(true);
    expect(imports.join("\n")).not.toMatch(/reconciliation|moveTarget|ReservationBoard"|fetchReservationBoard/);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\bfetch\(|unassignReservationAssignment|fetchReservationBoard|settleReconciliations|expectedVersion/);
  });
});
