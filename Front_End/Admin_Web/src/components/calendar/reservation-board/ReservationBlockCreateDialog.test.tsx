import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OperationalBlockCreateOutcome } from "@/lib/api/client";
import ReservationBlockCreateDialog, {
  describeBlockCreateOutcome,
  type BlockCreateDialogTarget,
} from "./ReservationBlockCreateDialog";

const target: BlockCreateDialogTarget = {
  propertyId: "prop-a",
  propertyName: "Property A",
  boardKey: "prop-a|2026-09-01|2026-09-15",
  boardFrom: "2026-09-01",
  boardTo: "2026-09-15",
  rooms: [
    { id: "room-101", roomNumber: "101", roomTypeName: "Standard" },
    { id: "room-201", roomNumber: "201", roomTypeName: "Deluxe" },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof ReservationBlockCreateDialog>> = {}) {
  const props = {
    target,
    boardReloadStatus: "idle" as const,
    isRangeLocked: vi.fn(() => false),
    onSubmit: vi.fn<(request: unknown) => Promise<OperationalBlockCreateOutcome>>(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ReservationBlockCreateDialog {...props} />);
  return props;
}

const dialog = () => screen.getByRole("dialog", { name: "Create operational block" });

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { room = "room-201", start = "2026-09-03", end = "2026-09-06", reason = "  Burst pipe  " } = {}
) {
  const view = within(dialog());
  await user.selectOptions(view.getByLabelText("Room"), room);
  fireEvent.change(view.getByLabelText("First blocked night"), { target: { value: start } });
  fireEvent.change(view.getByLabelText("End date (exclusive)"), { target: { value: end } });
  if (reason) await user.type(view.getByLabelText("Reason"), reason);
}

describe("ReservationBlockCreateDialog (PMS-CAL-001.3-CP03)", () => {
  it("starts on the room field, keeps Tab inside, and Close or Escape before confirming sends nothing", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    expect(document.activeElement).toBe(within(dialog()).getByLabelText("Room"));

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog().contains(document.activeElement)).toBe(true);

    await fillForm(user);
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("refuses to review a form with no room, a blank reason, a reversed range, or nights outside the board", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    const view = within(dialog());

    fireEvent.change(view.getByLabelText("First blocked night"), { target: { value: "2026-09-05" } });
    fireEvent.change(view.getByLabelText("End date (exclusive)"), { target: { value: "2026-09-05" } });
    await user.type(view.getByLabelText("Reason"), "   ");
    await user.click(view.getByRole("button", { name: "Review" }));

    const errors = view.getByRole("alert");
    expect(errors).toHaveTextContent("Choose an Active room.");
    expect(errors).toHaveTextContent("The end date must be after the first blocked night.");
    expect(errors).toHaveTextContent("Enter a reason.");
    expect(document.activeElement).toBe(errors);

    await fillForm(user, { start: "2026-08-30", end: "2026-09-16", reason: "" });
    await user.click(view.getByRole("button", { name: "Review" }));
    expect(view.getByRole("alert")).toHaveTextContent("Choose nights within the board on screen, [2026-09-01, 2026-09-15)");

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("reviews exactly what will be sent, Back keeps the values, and one confirmed submit sends the reviewed request once", async () => {
    const user = userEvent.setup();
    const write = deferred<OperationalBlockCreateOutcome>();
    const props = renderDialog({ onSubmit: vi.fn(() => write.promise) });
    await fillForm(user);
    const view = within(dialog());

    await user.click(view.getByRole("button", { name: "Review" }));
    const review = view.getByLabelText("Review block");
    expect(document.activeElement).toBe(review);
    expect(review).toHaveTextContent("Property A");
    expect(review).toHaveTextContent("201 (Deluxe)");
    expect(review).toHaveTextContent("[2026-09-03, 2026-09-06) · 3 nights");
    expect(review).toHaveTextContent("Burst pipe");
    expect(props.onSubmit).not.toHaveBeenCalled();

    await user.click(view.getByRole("button", { name: "Back" }));
    expect(view.getByLabelText("Room")).toHaveValue("room-201");
    expect(view.getByLabelText("Reason")).toHaveValue("  Burst pipe  ");
    await user.click(view.getByRole("button", { name: "Review" }));

    const create = view.getByRole("button", { name: "Create block" });
    act(() => fireEvent.submit(create.closest("form")!));
    await user.dblClick(create);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith({
      physicalRoomId: "room-201",
      startDate: "2026-09-03",
      endDate: "2026-09-06",
      reason: "Burst pipe",
    });

    // In flight: nothing closes the dialog.
    await user.keyboard("{Escape}");
    await user.click(view.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(view.getByRole("status")).toHaveTextContent("Creating the block");

    await act(async () => write.resolve({ kind: "created", block: null }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("after a 400 returns to the form with the values kept, so a corrected request can be reviewed and sent deliberately", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(request: unknown) => Promise<OperationalBlockCreateOutcome>>()
      .mockResolvedValueOnce({ kind: "rejected", status: 400, category: "validation", detail: "reason is too long." })
      .mockResolvedValueOnce({ kind: "created", block: null });
    renderDialog({ onSubmit });
    await fillForm(user);
    const view = within(dialog());
    await user.click(view.getByRole("button", { name: "Review" }));
    await user.click(view.getByRole("button", { name: "Create block" }));

    const alert = await view.findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was saved");
    expect(alert).toHaveTextContent("reason is too long.");
    expect(view.getByLabelText("Room")).toHaveValue("room-201");

    await user.click(view.getByRole("button", { name: "Review" }));
    await user.click(view.getByRole("button", { name: "Create block" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it.each<[string, OperationalBlockCreateOutcome, RegExp]>([
    ["conflict", { kind: "rejected", status: 409, category: "conflict", detail: "Room occupied." }, /not saved/],
    ["unknown", { kind: "unknown", reason: "timeout" }, /may or may not have been saved/],
  ])("after %s the dialog can never send again, and can still be closed", async (_label, outcome, text) => {
    const user = userEvent.setup();
    const props = renderDialog({ onSubmit: vi.fn(async () => outcome) });
    await fillForm(user);
    const view = within(dialog());
    await user.click(view.getByRole("button", { name: "Review" }));
    await user.click(view.getByRole("button", { name: "Create block" }));

    const result = await view.findByRole("alert");
    expect(result).toHaveTextContent(text);
    expect(document.activeElement).toBe(result);
    expect(view.queryByRole("button", { name: "Create block" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    await user.click(view.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("refuses to review a room and range an unconfirmed earlier create still locks", async () => {
    const user = userEvent.setup();
    const isRangeLocked = vi.fn((roomId: string) => roomId === "room-201");
    const props = renderDialog({ isRangeLocked });
    await fillForm(user);
    await user.click(within(dialog()).getByRole("button", { name: "Review" }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("still unconfirmed");
    expect(isRangeLocked).toHaveBeenCalledWith("room-201", "2026-09-03", "2026-09-06");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("describes each outcome without claiming more than is known", () => {
    expect(describeBlockCreateOutcome({ kind: "created", block: null })).toMatchObject({ tone: "success", reloadBoard: true, allowResubmit: false });
    expect(describeBlockCreateOutcome({ kind: "not-sent", message: "x" })).toMatchObject({ reloadBoard: false, allowResubmit: true });
    expect(describeBlockCreateOutcome({ kind: "rejected", status: 403, category: "not-permitted" })).toMatchObject({
      reloadBoard: false,
      allowResubmit: false,
      detail: "The server refused this write.",
    });
    expect(describeBlockCreateOutcome({ kind: "rejected", status: 404, category: "not-permitted" }).detail).toMatch(
      /Writes may be disabled/
    );
    expect(describeBlockCreateOutcome({ kind: "rejected", status: 409, category: "conflict" })).toMatchObject({
      tone: "warning",
      reloadBoard: true,
      allowResubmit: false,
    });
    const unknown = describeBlockCreateOutcome({ kind: "unknown", reason: "server-error", status: 502 });
    expect(unknown).toMatchObject({ tone: "warning", reloadBoard: true, allowResubmit: false });
    expect(unknown.title).not.toMatch(/failed|cancel/i);
    expect(unknown.detail).toContain("HTTP 502");
  });
});
