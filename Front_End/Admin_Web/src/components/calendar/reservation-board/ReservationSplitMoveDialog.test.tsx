import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationSplitMoveDialog, { type SplitMoveIntent } from "./ReservationSplitMoveDialog";
import type { SplitMoveAssignmentOutcome } from "@/lib/api/client";
import type { AssignmentRoomCandidate } from "./assignmentTarget";
import type { BoardReloadStatus } from "./ReservationAssignmentDialog";
import type { SplitMoveTarget } from "./splitMoveTarget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const room = (id: string, number: string, floor: number, typeId: string, typeName: string, sold: boolean): AssignmentRoomCandidate => ({
  id,
  roomNumber: number,
  floor,
  roomTypeId: typeId,
  roomTypeName: typeName,
  isSameSoldType: sold,
});
const standard102 = room("room-102", "102", 1, "type-standard", "Standard", true);
const standard103 = room("room-103", "103", 1, "type-standard", "Standard", true);
const deluxe201 = room("room-201", "201", 2, "type-deluxe", "Deluxe", false);
const deluxe202 = room("room-202", "202", 2, "type-deluxe", "Deluxe", false);

// Sold Standard, source segment in Standard room 101 for [2026-09-20, 2026-09-25), the Property's date 2026-09-22.
function buildTarget(overrides: Partial<SplitMoveTarget> = {}, segmentOverrides: Partial<SplitMoveTarget["segment"]> = {}): SplitMoveTarget {
  return {
    propertyId: "prop-a",
    boardKey: "prop-a|2026-09-01|2026-09-15",
    boardFrom: "2026-09-01",
    boardTo: "2026-09-15",
    propertyName: "Property A",
    localToday: "2026-09-22",
    stay: {
      reservationId: "res-1",
      reservationUnitId: "unit-1",
      confirmationNumber: "CNF-001",
      guestDisplayName: "Nguyen Van A",
      soldRoomTypeId: "type-standard",
      checkIn: "2026-09-18",
      checkOut: "2026-09-28",
      coverageStatus: "FullyAssigned",
      assignments: [],
      unassignedRanges: [],
    },
    segment: {
      segmentId: "seg-1",
      segmentVersion: 2,
      physicalRoomId: "room-101",
      actualRoomTypeId: "type-standard",
      startDate: "2026-09-20",
      endDate: "2026-09-25",
      ...segmentOverrides,
    },
    soldRoomTypeName: "Standard",
    currentRoomNumber: "101",
    currentRoomTypeId: "type-standard",
    currentRoomTypeName: "Standard",
    candidateRooms: [standard102, standard103, deluxe201, deluxe202],
    ...overrides,
  };
}

/** The same source segment when it sits in a Deluxe room although Standard was sold. */
const prefixCrossTarget = (overrides: Partial<SplitMoveTarget> = {}) =>
  buildTarget({ currentRoomNumber: "301", currentRoomTypeId: "type-deluxe", currentRoomTypeName: "Deluxe", ...overrides }, { physicalRoomId: "room-301", actualRoomTypeId: "type-deluxe" });

const split: SplitMoveAssignmentOutcome = { kind: "split", segments: null };

interface Props {
  target?: SplitMoveTarget;
  boardReloadStatus?: BoardReloadStatus;
  uncertainResolution?: "unresolved" | "observed" | "changed";
  assignmentWriteEnabled?: boolean;
  crossRoomTypeEnabled?: boolean;
  onSubmit?: (intent: SplitMoveIntent) => Promise<SplitMoveAssignmentOutcome>;
  onClose?: () => void;
}

const defaults = { assignmentWriteEnabled: true, crossRoomTypeEnabled: false };

function renderDialog(props: Props = {}) {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(split);
  const onClose = props.onClose ?? vi.fn();
  const build = (next: Props) => (
    <ReservationSplitMoveDialog
      target={next.target ?? buildTarget()}
      boardReloadStatus={next.boardReloadStatus ?? "idle"}
      uncertainResolution={next.uncertainResolution}
      assignmentWriteEnabled={next.assignmentWriteEnabled ?? defaults.assignmentWriteEnabled}
      crossRoomTypeEnabled={next.crossRoomTypeEnabled ?? defaults.crossRoomTypeEnabled}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
  const view = render(build(props));
  return {
    onSubmit: onSubmit as ReturnType<typeof vi.fn>,
    onClose: onClose as ReturnType<typeof vi.fn>,
    rerender: (next: Props) => view.rerender(build({ ...props, ...next })),
    unmount: view.unmount,
  };
}

const dialog = () => screen.getByRole("dialog", { name: "Move from a date" });
const form = () => dialog().querySelector("form")!;
const dateInput = () => screen.getByLabelText("Destination room takes over from") as HTMLInputElement;
const roomRadio = (number: string) => screen.getByLabelText(new RegExp(`Room ${number}`)) as HTMLInputElement;
const confirmButton = () => screen.queryByRole("button", { name: /^(Split and move|Splitting)/ });
const crossCheckbox = () => screen.getByLabelText(/deliberately chosen/) as HTMLInputElement;
const pastCheckbox = () => screen.getByLabelText(/already passed/) as HTMLInputElement;
const reasonBox = () => screen.getByLabelText(/^Reason/) as HTMLTextAreaElement;
const setDate = (value: string) => fireEvent.change(dateInput(), { target: { value } });
const setReason = (value: string) => fireEvent.change(reasonBox(), { target: { value } });
const pick = (number: string) => fireEvent.click(roomRadio(number));
const submitForm = () => fireEvent.submit(form());
// The header icon button and the footer button are both named "Close".
const closeButtons = () => screen.getAllByRole("button", { name: "Close" });
const footerClose = () => closeButtons()[1];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ReservationSplitMoveDialog — summary, bounds and preview (PMS-CAL-002-CP04)", () => {
  it("is a labelled modal dialog that summarises the guest, the Property, the sold type and the segment's own range", () => {
    renderDialog();
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(dialog()).toHaveAccessibleDescription(/stay dates, prices and booking are not changed/);
    const view = within(dialog());
    expect(view.getByText("Nguyen Van A")).toBeInTheDocument();
    expect(view.getByText("CNF-001")).toBeInTheDocument();
    expect(view.getByText("Property A")).toBeInTheDocument();
    expect(view.getByText("101 (Standard)")).toBeInTheDocument();
    expect(view.getByText("[2026-09-20, 2026-09-25) · 5 nights")).toBeInTheDocument();
    expect(view.getByText("2026-09-22")).toBeInTheDocument(); // the Property's date, as a fact
  });

  it("bounds the date picker to start + 1 … end - 1 of the segment, not the visible window", () => {
    renderDialog({ target: buildTarget({ boardFrom: "2026-09-21", boardTo: "2026-09-23" }) });
    expect(dateInput()).toHaveAttribute("min", "2026-09-21");
    expect(dateInput()).toHaveAttribute("max", "2026-09-24");
  });

  it("defaults to the Property's date when it lies strictly inside, and previews both parts as half-open ranges", () => {
    renderDialog();
    expect(dateInput().value).toBe("2026-09-22");
    pick("102");
    const preview = screen.getByRole("region", { name: "Split preview" });
    expect(preview).toHaveTextContent("Room 101 keeps 2 nights");
    expect(preview).toHaveTextContent("[2026-09-20, 2026-09-22) · last night 2026-09-21");
    expect(preview).toHaveTextContent("Room 102 takes 3 nights");
    expect(preview).toHaveTextContent("[2026-09-22, 2026-09-25)");
  });

  it("takes the default from the Property's date, not from the browser clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2040-06-15T12:00:00Z"));
    renderDialog();
    expect(dateInput().value).toBe("2026-09-22");
  });

  it.each([
    ["before the segment", "2026-09-19"],
    ["on the segment's start", "2026-09-20"],
    ["on the segment's end", "2026-09-25"],
    ["after the segment", "2030-01-01"],
  ])("leaves the date empty — never clamped — when the Property's date is %s", (_name, localToday) => {
    renderDialog({ target: buildTarget({ localToday }) });
    expect(dateInput().value).toBe("");
    expect(screen.getByRole("region", { name: "Split preview" })).toHaveTextContent("Choose a split date");
  });

  it.each([
    ["the start", "2026-09-20"],
    ["the end", "2026-09-25"],
    ["a day before the start", "2026-09-19"],
    ["a day after the end", "2026-09-26"],
    ["a year later", "2027-09-22"],
  ])("refuses %s as the split date — the handler re-checks, not only min/max — and sends nothing", (_name, value) => {
    const { onSubmit } = renderDialog();
    pick("102");
    setDate(value);
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("The split date must be from 2026-09-21 to 2026-09-24, so both rooms keep at least one night.")).toBeInTheDocument();
    expect(dateInput()).toHaveAttribute("aria-invalid", "true");
    expect(dateInput()).toHaveFocus();
  });

  it("accepts the nearest interior dates on both sides", async () => {
    for (const value of ["2026-09-21", "2026-09-24"]) {
      const { onSubmit, unmount } = renderDialog({ target: buildTarget({ localToday: "2026-01-01" }) });
      pick("102");
      setDate(value);
      await act(async () => {
        fireEvent.click(confirmButton()!);
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0].splitDate).toBe(value);
      unmount();
    }
  });

  it("a two-night source has exactly one selectable date", async () => {
    const target = buildTarget({ localToday: "2026-01-01" }, { startDate: "2026-09-26", endDate: "2026-09-28" });
    const { onSubmit } = renderDialog({ target });
    expect(dateInput()).toHaveAttribute("min", "2026-09-27");
    expect(dateInput()).toHaveAttribute("max", "2026-09-27");
    pick("102");
    setDate("2026-09-27");
    expect(screen.getByRole("region", { name: "Split preview" })).toHaveTextContent("Room 101 keeps 1 night");
    expect(screen.getByRole("region", { name: "Split preview" })).toHaveTextContent("Room 102 takes 1 night");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    setDate("2026-09-26");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["real month, year and leap-day changes", "2026-12-30", "2027-01-03", "2027-01-01", 2, 2],
    ["the 0099/0100 boundary", "0099-12-30", "0100-01-03", "0100-01-01", 2, 2],
    ["a leap day in 0004", "0004-02-27", "0004-03-02", "0004-02-29", 2, 2],
    ["no leap day in 0100", "0100-02-27", "0100-03-03", "0100-03-01", 2, 2],
    ["the first year", "0001-01-01", "0001-01-04", "0001-01-02", 1, 2],
    ["the last year", "9999-12-28", "9999-12-31", "9999-12-30", 2, 1],
  ])("carries the server's strings unchanged across %s", async (_name, start, end, splitDate, prefixNights, suffixNights) => {
    const target = buildTarget({ localToday: splitDate }, { startDate: start, endDate: end });
    const { onSubmit } = renderDialog({ target });
    expect(dateInput().value).toBe(splitDate);
    pick("102");
    const preview = screen.getByRole("region", { name: "Split preview" });
    expect(preview).toHaveTextContent(`Room 101 keeps ${prefixNights} night`);
    expect(preview).toHaveTextContent(`Room 102 takes ${suffixNights} night`);
    expect(preview).toHaveTextContent(`[${start}, ${splitDate})`);
    expect(preview).toHaveTextContent(`[${splitDate}, ${end})`);
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0].splitDate).toBe(splitDate);
  });

  it.each([
    ["a one-night source", buildTarget({}, { startDate: "2026-09-25", endDate: "2026-09-26" }), /only one night/],
    ["a one-night source across 0099/0100", buildTarget({}, { startDate: "0099-12-31", endDate: "0100-01-01" }), /only one night/],
    ["a reversed range", buildTarget({}, { startDate: "2026-09-25", endDate: "2026-09-20" }), /range is not valid/],
    ["year 0000", buildTarget({}, { startDate: "0000-12-31", endDate: "0001-01-03" }), /range is not valid/],
    ["a day that does not exist", buildTarget({}, { startDate: "2026-02-28", endDate: "2026-02-30" }), /range is not valid/],
    ["a Property date that is not a date", buildTarget({ localToday: "2026-09-22\n" }), /Property's date is not valid/],
    ["a Property date that does not exist", buildTarget({ localToday: "2026-02-30" }), /Property's date is not valid/],
    ["an empty Property date", buildTarget({ localToday: "" }), /Property's date is not valid/],
  ])("fails closed for %s: a notice, no form, no Confirm, focus on Close, nothing sent", (_name, target, message) => {
    const { onSubmit } = renderDialog({ target });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByLabelText("Destination room takes over from")).not.toBeInTheDocument();
    expect(confirmButton()).not.toBeInTheDocument();
    expect(closeButtons()[0]).toHaveFocus();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not fetch, store or reconcile anything itself", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { onSubmit } = renderDialog();
    pick("102");
    fireEvent.click(confirmButton()!);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1); // the caller's callback is the only way out
    vi.unstubAllGlobals();
  });

  it("source: imports no client function, performs no network or storage access, is mounted nowhere", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const source = readFileSync(path.join(dir, "ReservationSplitMoveDialog.tsx"), "utf8");
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
    expect(importLines).not.toMatch(/import \{[^}]*splitMoveReservationAssignment/);
    expect(importLines).toContain('import type { SplitMoveAssignmentOutcome } from "@/lib/api/client"');
    expect(source).not.toMatch(/\bfetch\(|localStorage|sessionStorage|Date\.now|new Date\(/);
    expect(source).not.toContain("dateMath");
    for (const file of ["ReservationBoard.tsx", "ReservationBoardStayPopover.tsx", "ReservationBoardServerTimeline.tsx"]) {
      expect(readFileSync(path.join(dir, file), "utf8")).not.toContain("ReservationSplitMoveDialog");
    }
  });
});

describe("ReservationSplitMoveDialog — destination, role and RoomType (D1/D2/D3)", () => {
  it("FrontDesk is offered Active same-sold-type rooms only, never the source room or another type", () => {
    renderDialog();
    expect(roomRadio("102")).toBeInTheDocument();
    expect(roomRadio("103")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Room 101/)).not.toBeInTheDocument();
    expect(screen.queryByText("Deluxe")).not.toBeInTheDocument();
  });

  it("never offers the source room even if a candidate list contains it", () => {
    renderDialog({ target: buildTarget({ candidateRooms: [room("room-101", "101", 1, "type-standard", "Standard", true), standard102] }) });
    expect(screen.queryByLabelText(/Room 101/)).not.toBeInTheDocument();
    expect(roomRadio("102")).toBeInTheDocument();
  });

  it("Manager sees the sold type first and then the other types, each tagged, in order", () => {
    renderDialog({ crossRoomTypeEnabled: true });
    const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(["room-102", "room-103", "room-201", "room-202"]);
    expect(screen.getByText("Standard (sold room type)")).toBeInTheDocument();
    expect(screen.getByText(/Other room types — requires confirmation and a reason/)).toBeInTheDocument();
  });

  it("trusts the room's own RoomType, not the callback flag, to decide what crosses", async () => {
    // A candidate whose precomputed flag claims it is the sold type, but whose RoomType is not.
    const mislabelled = room("room-203", "203", 2, "type-deluxe", "Deluxe", true);
    const { onSubmit } = renderDialog({ target: buildTarget({ candidateRooms: [standard102, mislabelled] }) });
    expect(screen.queryByLabelText(/Room 203/)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    renderDialog({ target: buildTarget({ candidateRooms: [standard102, mislabelled] }), crossRoomTypeEnabled: true });
    fireEvent.click(screen.getAllByLabelText(/Room 203/)[0]);
    expect(screen.getAllByLabelText(/deliberately chosen/).length).toBeGreaterThan(0);
  });

  it("without assignment-write permission nothing is offered to send, and a forced submit sends nothing", () => {
    const { onSubmit } = renderDialog({ assignmentWriteEnabled: false });
    expect(screen.getByRole("alert")).toHaveTextContent(/needs permission to change assignments/);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(dateInput()).toBeDisabled();
    expect(roomRadio("102")).toBeDisabled();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("defaults to no permission when the props are omitted", () => {
    const onSubmit = vi.fn();
    render(<ReservationSplitMoveDialog target={buildTarget()} boardReloadStatus="idle" onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("FrontDesk cannot split a source already in another room type, even toward a sold-type destination", () => {
    const { onSubmit } = renderDialog({ target: prefixCrossTarget() });
    expect(screen.getByRole("alert")).toHaveTextContent("A Manager must split a stay placed in a different room type than sold.");
    expect(confirmButton()).not.toBeInTheDocument();
    expect(roomRadio("102")).toBeDisabled();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a same-type split by FrontDesk needs no confirmation and its reason is optional", async () => {
    const { onSubmit } = renderDialog();
    pick("102");
    expect(screen.queryByLabelText(/deliberately chosen/)).not.toBeInTheDocument();
    expect(reasonBox()).not.toHaveAttribute("aria-required");
    expect(screen.getByText("Reason (optional)")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toStrictEqual({
      splitDate: "2026-09-22",
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: false,
      pastDateAcknowledged: false,
    });
  });

  it("a Manager choosing a different-type destination must confirm and give a reason, each reported separately", async () => {
    const { onSubmit } = renderDialog({ crossRoomTypeEnabled: true });
    pick("201");
    expect(screen.getByText("Reason (required)")).toBeInTheDocument();
    expect(screen.getByText(/later nights go to room 201 \(Deluxe\)/)).toBeInTheDocument();

    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm this cross-room-type placement to continue.")).toBeInTheDocument();
    expect(screen.getByText("Enter a reason for this cross-room-type placement.")).toBeInTheDocument();
    expect(crossCheckbox()).toHaveFocus();

    fireEvent.click(crossCheckbox());
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(reasonBox()).toHaveFocus();
    expect(reasonBox()).toHaveAttribute("aria-invalid", "true");

    setReason("   ");
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();

    setReason("  guest asked for a view  ");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0]).toStrictEqual({
      splitDate: "2026-09-22",
      destinationPhysicalRoomId: "room-201",
      confirmCrossRoomType: true,
      reason: "guest asked for a view",
      pastDateAcknowledged: false,
    });
  });

  it("D1: a Manager keeping a cross-type source on the prefix needs confirmation and a reason even toward a sold-type destination", async () => {
    const { onSubmit } = renderDialog({ target: prefixCrossTarget(), crossRoomTypeEnabled: true });
    pick("102");
    expect(screen.getByText(/earlier nights stay in room 301 \(Deluxe\)/)).toBeInTheDocument();
    expect(screen.queryByText(/later nights go to room/)).not.toBeInTheDocument();
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(crossCheckbox());
    setReason("moved on request");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0]).toStrictEqual({
      splitDate: "2026-09-22",
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: true,
      reason: "moved on request",
      pastDateAcknowledged: false,
    });
  });

  it("a prefix and a suffix that both cross are explained and need the one confirmation and reason", async () => {
    const { onSubmit } = renderDialog({ target: prefixCrossTarget(), crossRoomTypeEnabled: true });
    pick("201");
    expect(screen.getByText(/earlier nights stay in room 301/)).toBeInTheDocument();
    expect(screen.getByText(/later nights go to room 201/)).toBeInTheDocument();
    fireEvent.click(crossCheckbox());
    setReason("both");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ confirmCrossRoomType: true, reason: "both" });
  });

  it("judges the prefix against the board's room type, not the segment's actual type field", () => {
    // The selection carried a stale `actualRoomTypeId`; the board's room says Standard.
    renderDialog({ target: buildTarget({}, { actualRoomTypeId: "type-deluxe" }) });
    pick("102");
    expect(screen.queryByLabelText(/deliberately chosen/)).not.toBeInTheDocument();
  });

  it.each([
    ["exactly 500 characters", "x".repeat(500), true],
    ["501 characters", "x".repeat(501), false],
    ["500 characters padded with spaces", `  ${"x".repeat(500)}  `, true],
    ["501 characters padded with spaces", `  ${"x".repeat(501)}  `, false],
  ])("a same-type reason of %s is %s", async (_name, value, accepted) => {
    const { onSubmit } = renderDialog();
    pick("102");
    setReason(value);
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit).toHaveBeenCalledTimes(accepted ? 1 : 0);
    if (accepted) expect(onSubmit.mock.calls[0][0].reason).toBe("x".repeat(500));
    else expect(screen.getByText(/at most 500 characters \(now 501\)/)).toBeInTheDocument();
  });

  it("a blank same-type reason is absent from the intent", async () => {
    const { onSubmit } = renderDialog();
    pick("102");
    setReason("  \n ");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("reason");
  });

  it("changing the destination clears the confirmation and the reason; it is never carried to another room", () => {
    renderDialog({ crossRoomTypeEnabled: true });
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("because");
    pick("202");
    expect(crossCheckbox().checked).toBe(false);
    expect(reasonBox().value).toBe("");
    pick("102");
    expect(screen.queryByLabelText(/deliberately chosen/)).not.toBeInTheDocument();
    pick("201");
    expect(crossCheckbox().checked).toBe(false);
  });

  it("changing the date clears the confirmation too", () => {
    renderDialog({ crossRoomTypeEnabled: true, target: buildTarget({ localToday: "2026-09-22" }) });
    pick("201");
    fireEvent.click(crossCheckbox());
    setDate("2026-09-23");
    expect(crossCheckbox().checked).toBe(false);
  });

  it("permissions lowered while the dialog is open are re-checked: nothing is sent", () => {
    const { onSubmit, rerender } = renderDialog({ crossRoomTypeEnabled: true });
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("because");
    rerender({ crossRoomTypeEnabled: false });
    expect(screen.queryByLabelText(/Room 201/)).not.toBeInTheDocument();
    fireEvent.click(confirmButton()!);
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
    rerender({ crossRoomTypeEnabled: false, assignmentWriteEnabled: false });
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a Manager permission lost while a prefix-cross source is open blocks it", () => {
    const { onSubmit, rerender } = renderDialog({ target: prefixCrossTarget(), crossRoomTypeEnabled: true });
    pick("102");
    fireEvent.click(crossCheckbox());
    setReason("because");
    rerender({ crossRoomTypeEnabled: false });
    expect(screen.getByRole("alert")).toHaveTextContent(/A Manager must split/);
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a destination that stops being offered is refused, not sent", () => {
    const { onSubmit, rerender } = renderDialog();
    pick("102");
    rerender({ target: buildTarget({ candidateRooms: [standard103] }) });
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Select the room that takes the later nights.")).toBeInTheDocument();
  });

  it("with no other Active room offered there is a notice and no Confirm", () => {
    const { onSubmit } = renderDialog({ target: buildTarget({ candidateRooms: [deluxe201] }) });
    expect(screen.getByRole("alert")).toHaveTextContent(/No other Active room of the sold room type/);
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("an intent carries exactly these keys — never an identity, version, actor, role or evidence", async () => {
    const { onSubmit } = renderDialog({ crossRoomTypeEnabled: true });
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("why");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(Object.keys(onSubmit.mock.calls[0][0]).sort()).toEqual(
      ["confirmCrossRoomType", "destinationPhysicalRoomId", "pastDateAcknowledged", "reason", "splitDate"].sort()
    );
  });
});

describe("ReservationSplitMoveDialog — past dates (D4)", () => {
  // localToday 2026-09-22 in every case below.
  it("warns when the split date is before the Property's date, with an unchecked acknowledgement of its own", () => {
    renderDialog();
    expect(screen.queryByLabelText(/already passed/)).not.toBeInTheDocument();
    setDate("2026-09-21");
    expect(screen.getByText(/This date is before the Property's date \(2026-09-22\)/)).toBeInTheDocument();
    expect(pastCheckbox().checked).toBe(false);
    expect(screen.getByText("Reason (optional)")).toBeInTheDocument(); // D3 is unchanged by the date
  });

  it("without the acknowledgement nothing is sent and the checkbox is focused; with it the intent says so", async () => {
    const { onSubmit } = renderDialog();
    pick("102");
    setDate("2026-09-21");
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Acknowledge that this changes nights that have already passed.")).toBeInTheDocument();
    expect(pastCheckbox()).toHaveFocus();
    expect(pastCheckbox()).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(pastCheckbox());
    expect(onSubmit).not.toHaveBeenCalled(); // ticking is not sending
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0]).toStrictEqual({
      splitDate: "2026-09-21",
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: false,
      pastDateAcknowledged: true,
    });
  });

  it.each([
    ["the Property's date", "2026-09-22"],
    ["a later date", "2026-09-24"],
  ])("%s needs no acknowledgement", async (_name, value) => {
    const { onSubmit } = renderDialog();
    pick("102");
    setDate(value);
    expect(screen.queryByLabelText(/already passed/)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ splitDate: value, pastDateAcknowledged: false });
  });

  it("compares with the Property's date, not the browser's", () => {
    // The browser is in 2020, so 2026-09-21 is "the future" to it; the Property's date is 2026-09-22.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    renderDialog();
    setDate("2026-09-21");
    expect(screen.getByLabelText(/already passed/)).toBeInTheDocument();
    // …and a browser in 2040 does not make a later Property day look past.
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    setDate("2026-09-23");
    expect(screen.queryByLabelText(/already passed/)).not.toBeInTheDocument();
  });

  it("is judged across the 0099/0100 boundary on real dates", () => {
    renderDialog({ target: buildTarget({ localToday: "0100-01-02" }, { startDate: "0099-12-29", endDate: "0100-01-04" }) });
    setDate("0100-01-01");
    expect(screen.getByLabelText(/already passed/)).toBeInTheDocument();
    setDate("0100-01-02");
    expect(screen.queryByLabelText(/already passed/)).not.toBeInTheDocument();
  });

  it("the acknowledgement does not survive a change of date or of destination", () => {
    renderDialog();
    setDate("2026-09-21");
    fireEvent.click(pastCheckbox());
    setDate("2026-09-23");
    setDate("2026-09-21");
    expect(pastCheckbox().checked).toBe(false);
    fireEvent.click(pastCheckbox());
    pick("103");
    expect(pastCheckbox().checked).toBe(false);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ])("cross confirmation %s and past acknowledgement %s send %s — each is independent", async (cross, past, sent) => {
    const { onSubmit } = renderDialog({ crossRoomTypeEnabled: true });
    pick("201");
    setDate("2026-09-21");
    setReason("why");
    if (cross) fireEvent.click(crossCheckbox());
    if (past) fireEvent.click(pastCheckbox());
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit).toHaveBeenCalledTimes(sent ? 1 : 0);
    if (sent) expect(onSubmit.mock.calls[0][0]).toMatchObject({ confirmCrossRoomType: true, pastDateAcknowledged: true });
  });

  it("never sends by itself from the default date or from the checkboxes", () => {
    const { onSubmit } = renderDialog({ crossRoomTypeEnabled: true });
    setDate("2026-09-21");
    pick("201");
    fireEvent.click(crossCheckbox());
    fireEvent.click(pastCheckbox());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is judged at submit time against the current Property date", () => {
    const { onSubmit, rerender } = renderDialog();
    pick("102");
    setDate("2026-09-23");
    expect(screen.queryByLabelText(/already passed/)).not.toBeInTheDocument();
    rerender({ target: buildTarget({ localToday: "2026-09-24" }) }); // the Property's date moved on
    expect(screen.getByLabelText(/already passed/)).toBeInTheDocument();
    fireEvent.click(confirmButton()!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ReservationSplitMoveDialog — submission, terminal state and stale props", () => {
  it("several submits in one tick, a double click and held Enter start exactly one request", async () => {
    const user = userEvent.setup();
    const pendingRequest = deferred<SplitMoveAssignmentOutcome>();
    const { onSubmit } = renderDialog({ onSubmit: vi.fn().mockImplementation(() => pendingRequest.promise) });
    pick("102");
    const confirm = confirmButton()!;
    act(() => {
      submitForm();
      submitForm();
      submitForm();
    });
    await user.dblClick(confirm);
    confirm.focus();
    await user.keyboard("{Enter}{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    expect(form()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for the server/);
    await act(async () => pendingRequest.resolve(split));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("while pending, edits change nothing that was sent and Escape, Close and the backdrop are inert", async () => {
    const pendingRequest = deferred<SplitMoveAssignmentOutcome>();
    const { onSubmit, onClose } = renderDialog({
      crossRoomTypeEnabled: true,
      onSubmit: vi.fn().mockImplementation(() => pendingRequest.promise),
    });
    setDate("2026-09-21");
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("original");
    fireEvent.click(pastCheckbox());
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    const sent = structuredClone(onSubmit.mock.calls[0][0]);

    setDate("2026-09-23");
    pick("202");
    setReason("changed");
    fireEvent.click(crossCheckbox());
    fireEvent.click(pastCheckbox());
    expect(dateInput().value).toBe("2026-09-21");
    expect(roomRadio("201").checked).toBe(true);
    expect(reasonBox().value).toBe("original");
    expect(crossCheckbox().checked).toBe(true);
    expect(pastCheckbox().checked).toBe(true);

    fireEvent.keyDown(dialog(), { key: "Escape" });
    fireEvent.click(footerClose());
    fireEvent.mouseDown(dialog().parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => pendingRequest.resolve({ kind: "not-sent", message: "x" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(sent).toStrictEqual({
      splitDate: "2026-09-21",
      destinationPhysicalRoomId: "room-201",
      confirmCrossRoomType: true,
      reason: "original",
      pastDateAcknowledged: true,
    });
  });

  it("a pending Escape or Close does not use up the one close", async () => {
    const pendingRequest = deferred<SplitMoveAssignmentOutcome>();
    const { onClose } = renderDialog({ onSubmit: vi.fn().mockImplementation(() => pendingRequest.promise) });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    fireEvent.keyDown(dialog(), { key: "Escape" });
    fireEvent.click(footerClose());
    await act(async () => pendingRequest.resolve({ kind: "not-sent", message: "offline" }));
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("one close is one onClose call, from Escape, Close or the backdrop", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    fireEvent.click(footerClose());
    fireEvent.mouseDown(dialog().parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click inside the dialog does not close it", () => {
    const { onClose } = renderDialog();
    fireEvent.mouseDown(dialog());
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["a synchronous throw", () => {
      throw new Error("boom");
    }],
    ["a rejected promise", () => Promise.reject(new Error("boom"))],
  ])("%s from onSubmit is an unconfirmed result — never 'not sent' — and ends sending", async (_name, impl) => {
    const { onSubmit } = renderDialog({ onSubmit: vi.fn().mockImplementation(impl as () => Promise<SplitMoveAssignmentOutcome>) });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    const alert = screen.getByRole("alert", { name: "" });
    expect(alert).toHaveTextContent(/may or may not have been saved/);
    expect(alert).toHaveTextContent(/not retried automatically/);
    expect(alert).not.toHaveTextContent(/was not sent|Nothing was saved/);
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a saved result removes Confirm for good, and edits, re-renders and a board reload never bring it back", async () => {
    const { onSubmit, rerender } = renderDialog();
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Room split-move saved.");
    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveFocus();

    setDate("2026-09-23");
    pick("103");
    setReason("again");
    expect(dateInput().value).toBe("2026-09-22");
    expect(roomRadio("102").checked).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Room split-move saved.");
    rerender({ boardReloadStatus: "done" });
    rerender({ boardReloadStatus: "pending", assignmentWriteEnabled: true, crossRoomTypeEnabled: true });
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a conflict", { kind: "rejected", status: 409, category: "conflict", detail: "overlap" } as SplitMoveAssignmentOutcome],
    ["a permission refusal", { kind: "rejected", status: 403, category: "not-permitted" } as SplitMoveAssignmentOutcome],
    ["a 404", { kind: "rejected", status: 404, category: "not-permitted" } as SplitMoveAssignmentOutcome],
    ["a session end", { kind: "rejected", status: 401, category: "refused", detail: "Your session has ended." } as SplitMoveAssignmentOutcome],
    ["an unconfirmed result", { kind: "unknown", reason: "timeout" } as SplitMoveAssignmentOutcome],
  ])("%s is terminal: no second request from this dialog", async (_name, outcome) => {
    const { onSubmit } = renderDialog({ onSubmit: vi.fn().mockResolvedValue(outcome) });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    setReason("again");
    submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a request that was not sent, and a rejected 400, may be corrected and sent again by a new Confirm — and an edit clears the old result", async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ kind: "not-sent", message: "offline" })
      .mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "bad" })
      .mockResolvedValueOnce(split);
    renderDialog({ onSubmit });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("The request was not sent. Nothing was saved.");
    expect(onSubmit).toHaveBeenCalledTimes(1);

    setReason("fixed"); // an edit clears the previous correctable result
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not accept this split-move. Nothing was saved.");

    await act(async () => {
      fireEvent.click(confirmButton()!); // no edit, but still correctable: a deliberate resubmit
    });
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert")).toHaveTextContent("Room split-move saved.");
    expect(confirmButton()).not.toBeInTheDocument();
  });

  const storeCrossForbidden: SplitMoveAssignmentOutcome = {
    kind: "rejected",
    status: 403,
    category: "cross-room-type-confirmation-required",
    detail: "Confirm and give a reason.",
  };

  it("the store's cross-type 403 lets a Manager correct and send again, once explicitly", async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(storeCrossForbidden).mockResolvedValueOnce(split);
    renderDialog({ crossRoomTypeEnabled: true, onSubmit });
    pick("201");
    fireEvent.click(crossCheckbox());
    setReason("why");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("was not confirmed. Nothing was saved.");
    expect(onSubmit).toHaveBeenCalledTimes(1); // no automatic retry
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("the store's cross-type 403 for a role without crossRoomType says a Manager is needed and ends sending", async () => {
    const { onSubmit } = renderDialog({ onSubmit: vi.fn().mockResolvedValue(storeCrossForbidden) });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/A Manager must split-move this stay/);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/try again|enter a reason/i);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a segment that changed under the open dialog is refused, not sent with the old choices", () => {
    const { onSubmit, rerender } = renderDialog();
    pick("102");
    rerender({ target: buildTarget({}, { segmentVersion: 3 }) });
    expect(screen.getByRole("alert")).toHaveTextContent(/changed on the server after this dialog was opened/);
    expect(confirmButton()).not.toBeInTheDocument();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["segment id", () => buildTarget({}, { segmentId: "seg-2" })],
    ["version", () => buildTarget({}, { segmentVersion: 9 })],
    ["room", () => buildTarget({}, { physicalRoomId: "room-105" })],
    ["start date", () => buildTarget({}, { startDate: "2026-09-19" })],
    ["end date", () => buildTarget({}, { endDate: "2026-09-26" })],
    ["Property", () => buildTarget({ propertyId: "prop-b" })],
  ])("a changed %s makes the dialog stale", (_name, next) => {
    const { onSubmit, rerender } = renderDialog();
    pick("102");
    rerender({ target: next() });
    expect(screen.getByRole("alert")).toHaveTextContent(/changed on the server/);
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a different board window alone does not make it stale", () => {
    const { rerender } = renderDialog();
    rerender({ target: buildTarget({ boardKey: "prop-a|2026-09-10|2026-09-24", boardFrom: "2026-09-10", boardTo: "2026-09-24" }) });
    expect(confirmButton()).toBeInTheDocument();
  });

  it("after a saved result, the target changing on the board reload keeps the result and sends nothing", async () => {
    const { onSubmit, rerender } = renderDialog();
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    rerender({ target: buildTarget({}, { segmentVersion: 3, endDate: "2026-09-22" }), boardReloadStatus: "done" });
    expect(screen.getAllByRole("alert").some((alert) => /Room split-move saved\./.test(alert.textContent ?? ""))).toBe(true);
    submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("unmounting while a request is pending sets no state, calls no onClose and claims no cancellation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pendingRequest = deferred<SplitMoveAssignmentOutcome>();
    const { onSubmit, onClose, unmount } = renderDialog({ onSubmit: vi.fn().mockImplementation(() => pendingRequest.promise) });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    unmount();
    await act(async () => pendingRequest.resolve(split));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("ReservationSplitMoveDialog — outcome and board-reload wording", () => {
  async function renderWithOutcome(outcome: SplitMoveAssignmentOutcome, extra: Props = {}) {
    const view = renderDialog({ onSubmit: vi.fn().mockResolvedValue(outcome), ...extra });
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    return view;
  }
  const result = () => screen.getByRole("alert");
  const unknown: SplitMoveAssignmentOutcome = { kind: "unknown", reason: "network" };

  it.each([
    ["pending", "Reloading the board from the server…"],
    ["idle", "Reloading the board from the server…"],
    ["failed", "The board could not be reloaded. Close this dialog and use Retry on the board."],
    ["elsewhere", "The view changed before the board was reloaded; the result has not been re-read yet."],
    ["done", "The board has been reloaded from the server."],
  ] as const)("a saved split with the board %s says: %s", async (status, text) => {
    await renderWithOutcome(split, { boardReloadStatus: status });
    expect(result()).toHaveTextContent(text);
    expect(result()).not.toHaveTextContent(/may or may not/);
  });

  it("a saved split ignores an uncertain resolution — it was confirmed by the 200", async () => {
    await renderWithOutcome({ kind: "split", segments: null }, { boardReloadStatus: "done", uncertainResolution: "changed" });
    expect(result()).toHaveTextContent("The board has been reloaded from the server.");
    expect(result()).not.toHaveTextContent(/never confirmed/);
  });

  it("a conflict says nothing was saved and shows the reload state", async () => {
    await renderWithOutcome({ kind: "rejected", status: 409, category: "conflict", detail: "overlap" }, { boardReloadStatus: "failed" });
    expect(result()).toHaveTextContent(/was not saved/);
    expect(result()).toHaveTextContent("overlap");
    expect(result()).toHaveTextContent(/could not be reloaded/);
  });

  it("an outcome that needs no reload says nothing about the board", async () => {
    await renderWithOutcome({ kind: "not-sent", message: "offline" }, { boardReloadStatus: "pending" });
    expect(result()).not.toHaveTextContent(/Reloading|reloaded/);
  });

  it.each([
    ["pending", undefined, "Reloading the board from the server…"],
    ["failed", undefined, "The board could not be reloaded. Close this dialog and use Retry on the board."],
    ["elsewhere", undefined, "The view changed before the board was reloaded; the result has not been re-read yet."],
    ["done", undefined, "The board was reloaded, but that alone does not show whether this request was saved."],
    ["done", "unresolved", "The result is still unknown; the source room and the destination nights stay locked."],
    ["done", "observed", "matches both parts of this split-move. That does not prove this request is the one that made it."],
    ["done", "changed", "can no longer take effect. Its own result was never confirmed."],
    ["pending", "observed", "matches both parts of this split-move."],
  ] as const)("an unconfirmed result with the board %s and resolution %s says: %s", async (status, resolution, text) => {
    await renderWithOutcome(unknown, { boardReloadStatus: status, uncertainResolution: resolution });
    expect(result()).toHaveTextContent(text);
  });

  it("observed and changed never say saved or rolled back", async () => {
    for (const resolution of ["observed", "changed"] as const) {
      const { unmount } = await renderWithOutcome(unknown, { boardReloadStatus: "done", uncertainResolution: resolution });
      expect(result().textContent).not.toMatch(/split-move saved|rolled back|was saved\b/i);
      unmount();
    }
  });

  it("follows the board's status as the parent re-renders", async () => {
    const { rerender } = await renderWithOutcome(unknown, { boardReloadStatus: "pending" });
    expect(result()).toHaveTextContent("Reloading the board from the server…");
    rerender({ boardReloadStatus: "done", uncertainResolution: "unresolved" });
    expect(result()).toHaveTextContent(/stay locked/);
    rerender({ boardReloadStatus: "done", uncertainResolution: "observed" });
    expect(result()).toHaveTextContent(/matches both parts/);
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it("renders server detail as text, never as HTML", async () => {
    await renderWithOutcome({ kind: "rejected", status: 409, category: "conflict", detail: "<img src=x onerror=alert(1)>" });
    expect(result()).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(result().querySelector("img")).toBeNull();
  });
});

describe("ReservationSplitMoveDialog — focus and accessibility", () => {
  it("opens with focus on the date picker, or on Close when nothing can be edited", () => {
    renderDialog();
    expect(dateInput()).toHaveFocus();
  });

  it("opens on Close without permission", () => {
    renderDialog({ assignmentWriteEnabled: false });
    expect(closeButtons()[0]).toHaveFocus();
  });

  it("labels every control and associates each validation error with its control", () => {
    renderDialog({ crossRoomTypeEnabled: true });
    pick("201");
    setDate("");
    fireEvent.click(confirmButton()!);
    expect(dateInput()).toHaveAccessibleDescription(/Enter|Choose the date/);
    expect(dateInput()).toHaveAttribute("aria-required", "true");
    expect(crossCheckbox()).toHaveAccessibleDescription("Confirm this cross-room-type placement to continue.");
    expect(reasonBox()).toHaveAccessibleDescription(/Enter a reason for this cross-room-type placement\./);
    expect(screen.getByRole("radiogroup", { name: "Room for the later nights" })).toBeInTheDocument();
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(3);
  });

  it("associates a room error with the radio group and focuses the first room", () => {
    renderDialog();
    fireEvent.click(confirmButton()!);
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription("Select the room that takes the later nights.");
    expect(roomRadio("102")).toHaveFocus();
  });

  it("an empty date reports itself and takes focus", () => {
    renderDialog({ target: buildTarget({ localToday: "2030-01-01" }) });
    pick("102");
    fireEvent.click(confirmButton()!);
    expect(screen.getByText("Choose the date the destination room takes over.")).toBeInTheDocument();
    expect(dateInput()).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    renderDialog();
    const focusable = Array.from(dialog().querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("shows the result in a focused alert and keeps the form scrollable inside the viewport", async () => {
    renderDialog();
    pick("102");
    await act(async () => {
      fireEvent.click(confirmButton()!);
    });
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(dialog().className).toMatch(/max-h-\[calc\(100vh-2rem\)\]/);
    expect(dialog().querySelector("form > div")!.className).toMatch(/overflow-y-auto/);
  });

  it("says the rooms are candidates, not confirmed free", () => {
    renderDialog();
    expect(screen.getByText(/candidate rooms, not confirmed free/)).toBeInTheDocument();
  });
});
