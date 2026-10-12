/**
 * PMS-CAL-003-CP03: the block-move dialog on its own. It never calls the API client — it hands a validated
 * intent (destination + optional trimmed reason) to `onSubmit` and words whatever outcome comes back. These
 * tests prove what it shows (the segment's own full nights, the header reason as unchanged, no dates and no
 * confirmation), what it refuses to submit, the one-request guarantee, and that nothing but an explicit
 * correction can send again after an outcome.
 */

import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationBlockMoveDialog from "./ReservationBlockMoveDialog";
import type { OperationalBlockMoveOutcome } from "@/lib/api/client";
import type { BlockMoveIntent } from "./blockMoveSubmission";
import type { BlockMoveTarget } from "./blockMoveTarget";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";

afterEach(() => cleanup());

const target: BlockMoveTarget = {
  propertyId: "prop-a",
  propertyName: "Property A",
  boardKey: "prop-a|2026-09-01|2026-09-15",
  boardFrom: "2026-09-01",
  boardTo: "2026-09-15",
  block: {
    roomBlockId: "header-1",
    segmentId: "seg-1",
    segmentVersion: 42,
    physicalRoomId: "room-101",
    startDate: "2026-08-28",
    endDate: "2026-09-20",
    reason: "Burst pipe",
  },
  nights: 23,
  sourceRoomNumber: "101",
  sourceRoomOperationalStatus: "Active",
  sourceRoomTypeId: "type-standard",
  sourceRoomTypeName: "Standard",
  candidateRooms: [
    { id: "room-102", roomNumber: "102", floor: 1, roomTypeId: "type-standard", roomTypeName: "Standard", sameRoomTypeAsSource: true },
    { id: "room-201", roomNumber: "201", floor: 2, roomTypeId: "type-deluxe", roomTypeName: "Deluxe", sameRoomTypeAsSource: false },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

interface Options {
  target?: BlockMoveTarget;
  boardReloadStatus?: BoardReloadStatus;
  uncertainResolution?: "unresolved" | "observed" | "changed";
  blockWriteEnabled?: boolean;
  onSubmit?: (intent: BlockMoveIntent) => Promise<OperationalBlockMoveOutcome>;
  onClose?: () => void;
}

function element(options: Options = {}) {
  return (
    <ReservationBlockMoveDialog
      target={options.target ?? target}
      boardReloadStatus={options.boardReloadStatus ?? "idle"}
      uncertainResolution={options.uncertainResolution}
      blockWriteEnabled={options.blockWriteEnabled ?? true}
      onSubmit={options.onSubmit ?? (() => Promise.resolve({ kind: "moved", segments: null }))}
      onClose={options.onClose ?? (() => undefined)}
    />
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Move operational block" });
const confirm = () => within(dialog()).getByRole("button", { name: /^Move block/ });
const queryConfirm = () => within(dialog()).queryByRole("button", { name: /^Move block|^Moving…/ });
const room = (number: string) => within(dialog()).getByRole("radio", { name: new RegExp(`Room ${number}`) });

describe("ReservationBlockMoveDialog — what it shows", () => {
  it("shows the segment's own full nights, the source room and the block reason as unchanged", () => {
    render(element());
    const d = dialog();
    expect(d).toHaveTextContent("Property A");
    expect(d).toHaveTextContent("101 (Standard)");
    expect(d).toHaveTextContent("[2026-08-28, 2026-09-20) · 23 nights");
    expect(d).toHaveTextContent("Block reason (unchanged)");
    expect(d).toHaveTextContent("Burst pipe");
    expect(d).toHaveTextContent("seg-1 · v42");
    expect(d).toHaveTextContent("keeps exactly the same nights and its reason");
  });

  it("says a one-night block has one night", () => {
    render(element({ target: { ...target, block: { ...target.block, startDate: "2026-09-03", endDate: "2026-09-04" }, nights: 1 } }));
    expect(dialog()).toHaveTextContent("[2026-09-03, 2026-09-04) · 1 night");
  });

  it("says the source room is not Active when it is not, and still lets the block move", () => {
    render(element({ target: { ...target, sourceRoomOperationalStatus: "OutOfService" } }));
    expect(dialog()).toHaveTextContent("101 (Standard) · OutOfService");
    expect(confirm()).toBeInTheDocument();
  });

  it("has no date input, no cross-room-type confirmation and no past-date acknowledgement", () => {
    render(element());
    const d = dialog();
    expect(d.querySelector('input[type="date"]')).toBeNull();
    expect(d.querySelector('input[type="checkbox"]')).toBeNull();
    expect(d).not.toHaveTextContent(/confirm(ation)? .*different room type/i);
    expect(d).not.toHaveTextContent(/already passed|before the Property/i);
    expect(within(d).queryByLabelText(/required/i)).toBeNull();
  });

  it("lists the candidate rooms only (never the source), grouped by room type, and says they are not confirmed free", () => {
    render(element());
    const names = within(dialog()).getAllByRole("radio").map((radio) => radio.closest("label")!.textContent);
    expect(names).toEqual(["Room 102Floor 1", "Room 201DeluxeFloor 2"]);
    expect(within(dialog()).queryByRole("radio", { name: /Room 101/ })).toBeNull();
    expect(dialog()).toHaveTextContent("Standard (same room type as the current room)");
    expect(dialog()).toHaveTextContent("Other room types");
    expect(dialog()).toHaveTextContent("candidate rooms, not confirmed free");
    expect(dialog()).toHaveTextContent("capacity");
  });

  it("does not trust the target to leave the source room out of the list", () => {
    render(element({ target: { ...target, candidateRooms: [{ id: "room-101", roomNumber: "101", floor: 1, roomTypeId: "type-standard", roomTypeName: "Standard", sameRoomTypeAsSource: true }, ...target.candidateRooms] } }));
    expect(within(dialog()).queryByRole("radio", { name: /Room 101/ })).toBeNull();
  });

  it("puts focus on the first candidate room, or on Close when no room can be chosen", () => {
    const { unmount } = render(element());
    expect(document.activeElement).toBe(room("102"));
    unmount();
    render(element({ blockWriteEnabled: false }));
    expect(document.activeElement).toBe(within(dialog()).getAllByRole("button", { name: "Close" })[0]);
  });
});

describe("ReservationBlockMoveDialog — what it submits", () => {
  it("refuses to submit without a room, says so and focuses the first room", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(element({ onSubmit }));
    await user.click(confirm());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Select the room that takes the block.");
    expect(document.activeElement).toBe(room("102"));
  });

  it("submits only the destination when the reason is blank", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(element({ onSubmit }));
    await user.click(room("102"));
    await user.type(within(dialog()).getByLabelText("Reason for moving (optional)"), "   ");
    await user.click(confirm());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ destinationPhysicalRoomId: "room-102" });
  });

  it("submits a trimmed reason, and nothing about the block, the version, dates, confirmation or actor", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(element({ onSubmit }));
    await user.click(room("201"));
    await user.type(within(dialog()).getByLabelText("Reason for moving (optional)"), "  Repair done  ");
    await user.click(confirm());
    expect(onSubmit.mock.calls[0][0]).toEqual({ destinationPhysicalRoomId: "room-201", reason: "Repair done" });
    expect(Object.keys(onSubmit.mock.calls[0][0]).sort()).toEqual(["destinationPhysicalRoomId", "reason"]);
  });

  it("a room of another room type needs nothing more than the same fields, and says the server checks its capacity", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(element({ onSubmit }));
    await user.click(room("201"));
    expect(dialog()).toHaveTextContent("Room 201");
    await user.click(confirm());
    expect(onSubmit).toHaveBeenCalledWith({ destinationPhysicalRoomId: "room-201" });
  });

  it("accepts exactly 500 characters and refuses 501 with no submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "moved", segments: null });
    render(element({ onSubmit }));
    await user.click(room("102"));
    const reason = within(dialog()).getByLabelText("Reason for moving (optional)");
    fireEvent.change(reason, { target: { value: "x".repeat(501) } });
    await user.click(confirm());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("at most 500 characters (now 501)");
    expect(document.activeElement).toBe(reason);

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(500)}  ` } });
    await user.click(confirm());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].reason).toHaveLength(500);
  });

  it("starts exactly one request for a double click and for repeated submit events in one render", async () => {
    const user = userEvent.setup();
    const write = deferred<OperationalBlockMoveOutcome>();
    const onSubmit = vi.fn().mockImplementation(() => write.promise);
    render(element({ onSubmit }));
    await user.click(room("102"));
    const form = confirm().closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await user.dblClick(within(dialog()).getByRole("button", { name: /^Moving…/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve({ kind: "moved", segments: null }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("ReservationBlockMoveDialog — while the request is on the wire", () => {
  it("cannot be edited or closed, and says it is waiting for the server", async () => {
    const user = userEvent.setup();
    const write = deferred<OperationalBlockMoveOutcome>();
    const onClose = vi.fn();
    render(element({ onSubmit: () => write.promise, onClose }));
    await user.click(room("102"));
    await user.type(within(dialog()).getByLabelText("Reason for moving (optional)"), "first");
    await user.click(confirm());

    expect(dialog()).toHaveTextContent("Moving the block to room 102… waiting for the server");
    expect(within(dialog()).getByRole("button", { name: /^Moving…/ })).toHaveAttribute("aria-disabled", "true");

    // Edits are inert: the radios are inside a disabled fieldset and the reason does not change.
    expect(room("201")).toBeDisabled();
    expect(within(dialog()).getByLabelText("Reason for moving (optional)")).toBeDisabled();
    fireEvent.change(within(dialog()).getByLabelText("Reason for moving (optional)"), { target: { value: "second" } });
    expect(within(dialog()).getByLabelText("Reason for moving (optional)")).toHaveValue("first");

    // Neither Close control, Escape nor the backdrop close it.
    for (const close of within(dialog()).getAllByRole("button", { name: "Close" })) await user.click(close);
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog().parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();

    await act(async () => write.resolve({ kind: "moved", segments: null }));
  });

  it("an unmount while in flight sets no state and never calls onClose", async () => {
    const user = userEvent.setup();
    const write = deferred<OperationalBlockMoveOutcome>();
    const onClose = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(element({ onSubmit: () => write.promise, onClose }));
    await user.click(room("102"));
    await user.click(confirm());
    unmount();
    await act(async () => write.resolve({ kind: "unknown", reason: "network" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("treats a throwing onSubmit as an unconfirmed result, not as not-sent", async () => {
    const user = userEvent.setup();
    render(element({ onSubmit: () => Promise.reject(new Error("boom")) }));
    await user.click(room("102"));
    await user.click(confirm());
    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("could not be confirmed");
    expect(alert).not.toHaveTextContent("The request was not sent");
    expect(queryConfirm()).toBeNull();
  });
});

describe("ReservationBlockMoveDialog — outcomes", () => {
  async function submitWith(outcome: OperationalBlockMoveOutcome, options: Options = {}) {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(outcome);
    render(element({ onSubmit, ...options }));
    await user.click(room("102"));
    await user.click(confirm());
    await screen.findByText(/./, { selector: "[tabindex='-1'] p.font-medium" });
    return { user, onSubmit };
  }

  it("moved: says so, takes Confirm away for good, and edits do not bring it back", async () => {
    const { user, onSubmit } = await submitWith({ kind: "moved", segments: null });
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Operational block moved.");
    expect(within(dialog()).getByRole("status")).toHaveTextContent("keeps its nights and its reason");
    expect(queryConfirm()).toBeNull();
    await user.click(room("201"));
    fireEvent.change(within(dialog()).getByLabelText("Reason for moving (optional)"), { target: { value: "again" } });
    fireEvent.submit(dialog().querySelector("form")!);
    expect(queryConfirm()).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("moved with an unreadable body is the same success — the words never describe the segments", async () => {
    await submitWith({ kind: "moved", segments: null });
    expect(within(dialog()).getByRole("status")).not.toHaveTextContent(/seg-|successor|cancelled/i);
  });

  it("409: a warning that nothing was moved, no Confirm, and the reload text", async () => {
    await submitWith({ kind: "rejected", status: 409, category: "conflict", detail: "Stale version." }, { boardReloadStatus: "done" });
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent("This block was not moved");
    expect(alert).toHaveTextContent("capacity");
    expect(alert).toHaveTextContent("Stale version.");
    expect(alert).toHaveTextContent("The board has been reloaded from the server.");
    expect(queryConfirm()).toBeNull();
  });

  it.each([
    [403, "The server refused this write."],
    [404, "not part of this Property"],
  ])("%i: never claims the block was moved or removed, and takes Confirm away", async (status, detail) => {
    await submitWith({ kind: "rejected", status, category: "not-permitted" });
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent("Moving operational blocks is not available from this Admin session. Nothing was changed.");
    expect(alert).toHaveTextContent(detail);
    expect(alert).not.toHaveTextContent(/has been moved|was moved|deleted|no longer exists/i);
    expect(queryConfirm()).toBeNull();
  });

  it("400 and not-sent prove nothing was written: Confirm stays and a corrected submission may be made", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "Bad destination." })
      .mockResolvedValueOnce({ kind: "not-sent", message: "The Admin API address is not configured." })
      .mockResolvedValueOnce({ kind: "moved", segments: null });
    render(element({ onSubmit }));
    await user.click(room("102"));
    await user.click(confirm());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Bad destination.");
    expect(confirm()).toBeInTheDocument();

    await user.click(confirm());
    await within(dialog()).findByText(/The Admin API address is not configured\./);
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("The request was not sent. Nothing was changed.");
    expect(confirm()).toBeInTheDocument();

    await user.click(confirm());
    expect(await within(dialog()).findByRole("status")).toHaveTextContent("Operational block moved.");
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(queryConfirm()).toBeNull();
  });

  it("changing the choice clears a correctable message", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ kind: "rejected", status: 400, category: "validation", detail: "Bad destination." });
    render(element({ onSubmit }));
    await user.click(room("102"));
    await user.click(confirm());
    await within(dialog()).findByRole("alert");
    await user.click(room("201"));
    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });

  it.each([
    [{ kind: "unknown", reason: "timeout" } as const, "The server did not respond in time."],
    [{ kind: "unknown", reason: "network" } as const, "The connection to the Admin API could not be completed."],
    [{ kind: "unknown", reason: "aborted" } as const, "The request was interrupted after it was sent."],
    [{ kind: "unknown", reason: "server-error", status: 502 } as const, "(HTTP 502)"],
  ])("unknown (%o): says it may or may not have been moved, both rooms stay locked, never offers to send again", async (outcome, cause) => {
    await submitWith(outcome);
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent("the block may or may not have been moved");
    expect(alert).toHaveTextContent("both rooms stay locked");
    expect(alert).toHaveTextContent(cause);
    expect(queryConfirm()).toBeNull();
  });

  it("unknown + observed: a fact of the schedule, not proof that this request did it", async () => {
    await submitWith({ kind: "unknown", reason: "network" }, { uncertainResolution: "observed", boardReloadStatus: "done" });
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent("matches this move");
    expect(alert).toHaveTextContent("does not prove this request");
    expect(alert).not.toHaveTextContent("Operational block moved.");
  });

  it("unknown + changed: not saved, not failed — it can no longer take effect", async () => {
    await submitWith({ kind: "unknown", reason: "network" }, { uncertainResolution: "changed", boardReloadStatus: "done" });
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent("can no longer take effect");
    expect(alert).toHaveTextContent("never confirmed");
  });

  it("unknown + still unresolved after a finished read: still unknown, locked, use Check again", async () => {
    await submitWith({ kind: "unknown", reason: "network" }, { uncertainResolution: "unresolved", boardReloadStatus: "done" });
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent("still shown in its original room exactly as it was");
    expect(alert).toHaveTextContent("still unknown");
    expect(alert).toHaveTextContent("Check again");
  });

  it("words a failed or elsewhere re-read without claiming anything", async () => {
    const failed = await submitWith({ kind: "moved", segments: null }, { boardReloadStatus: "failed" });
    expect(within(dialog()).getByRole("status")).toHaveTextContent("could not be reloaded");
    expect(failed.onSubmit).toHaveBeenCalledTimes(1);
    cleanup();
    await submitWith({ kind: "moved", segments: null }, { boardReloadStatus: "elsewhere" });
    expect(within(dialog()).getByRole("status")).toHaveTextContent("The view changed before the board was reloaded");
    cleanup();
    await submitWith({ kind: "moved", segments: null }, { boardReloadStatus: "pending" });
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Reloading the board from the server…");
  });

  it("moves focus to the result", async () => {
    await submitWith({ kind: "rejected", status: 409, category: "conflict" });
    expect(document.activeElement).toBe(within(dialog()).getByRole("alert"));
  });
});

describe("ReservationBlockMoveDialog — when nothing can be sent", () => {
  it("without the permission, says so and offers no Confirm", async () => {
    const onSubmit = vi.fn();
    render(element({ blockWriteEnabled: false, onSubmit }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("needs permission to change blocks");
    expect(queryConfirm()).toBeNull();
    expect(room("102")).toBeDisabled();
    fireEvent.submit(dialog().querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("losing the permission after opening sends nothing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(element({ onSubmit }));
    await user.click(room("102"));
    rerender(element({ onSubmit, blockWriteEnabled: false }));
    fireEvent.submit(dialog().querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(queryConfirm()).toBeNull();
  });

  it("with no candidate room, says so and offers no Confirm", () => {
    const onSubmit = vi.fn();
    render(element({ target: { ...target, candidateRooms: [] }, onSubmit }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("No other Active room is available");
    expect(queryConfirm()).toBeNull();
    fireEvent.submit(dialog().querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a different segment, version, room or range handed to an open dialog sends nothing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(element({ onSubmit }));
    await user.click(room("102"));
    for (const changed of [
      { ...target, block: { ...target.block, segmentVersion: 43 } },
      { ...target, block: { ...target.block, segmentId: "seg-2" } },
      { ...target, block: { ...target.block, physicalRoomId: "room-102" } },
      { ...target, block: { ...target.block, endDate: "2026-09-21" } },
      { ...target, block: { ...target.block, roomBlockId: "header-2" } },
    ]) {
      rerender(element({ target: changed, onSubmit }));
      expect(within(dialog()).getByRole("alert")).toHaveTextContent("changed on the server after this dialog was opened");
      expect(queryConfirm()).toBeNull();
      fireEvent.submit(dialog().querySelector("form")!);
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ReservationBlockMoveDialog — closing and keyboard", () => {
  it("Escape, the backdrop and both Close controls close it once when nothing is in flight", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(element({ onClose }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog().parentElement!);
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(element());
    const focusable = () =>
      Array.from(dialog().querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
    const last = focusable().at(-1)!;
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(focusable()[0]);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(focusable().at(-1));
  });
});
