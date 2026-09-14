import { describe, expect, it } from "vitest";
import { describeAssignmentOutcome } from "./assignmentOutcome";
import type { AssignmentCreateOutcome } from "@/lib/api/client";

const cases: Array<[string, AssignmentCreateOutcome, { reloadBoard: boolean; allowResubmit: boolean }]> = [
  ["created", { kind: "created", segment: null }, { reloadBoard: true, allowResubmit: false }],
  ["not-sent", { kind: "not-sent", message: "not configured" }, { reloadBoard: false, allowResubmit: true }],
  ["400", { kind: "rejected", status: 400, category: "validation", detail: "bad" }, { reloadBoard: false, allowResubmit: true }],
  ["403", { kind: "rejected", status: 403, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
  ["404", { kind: "rejected", status: 404, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
  [
    "403 cross-room-type",
    { kind: "rejected", status: 403, category: "cross-room-type-confirmation-required", detail: "needs reason" },
    { reloadBoard: false, allowResubmit: true },
  ],
  ["409", { kind: "rejected", status: 409, category: "conflict", detail: "overlap" }, { reloadBoard: true, allowResubmit: false }],
  ["415", { kind: "rejected", status: 415, category: "refused" }, { reloadBoard: false, allowResubmit: false }],
  ["network", { kind: "unknown", reason: "network" }, { reloadBoard: true, allowResubmit: false }],
  ["timeout", { kind: "unknown", reason: "timeout" }, { reloadBoard: true, allowResubmit: false }],
  ["aborted", { kind: "unknown", reason: "aborted" }, { reloadBoard: true, allowResubmit: false }],
  ["5xx", { kind: "unknown", reason: "server-error", status: 503 }, { reloadBoard: true, allowResubmit: false }],
];

describe("describeAssignmentOutcome (PMS-CAL-001.2-CP03A/B)", () => {
  it.each(cases)("%s → reload/resubmit policy", (_name, outcome, expected) => {
    const view = describeAssignmentOutcome(outcome);
    expect({ reloadBoard: view.reloadBoard, allowResubmit: view.allowResubmit }).toEqual(expected);
  });

  it("only a 201 is ever described as success", () => {
    for (const [, outcome] of cases) {
      const view = describeAssignmentOutcome(outcome);
      expect(view.tone === "success").toBe(outcome.kind === "created");
      if (outcome.kind !== "created") {
        expect(`${view.title} ${view.detail ?? ""}`).not.toMatch(
          /successfully|room assigned|assignment (was|has been) saved|saved on the server/i
        );
      }
    }
  });

  it("offers a resubmit only when the server proved nothing was written and another choice could succeed", () => {
    for (const [, outcome] of cases) {
      const view = describeAssignmentOutcome(outcome);
      if (view.allowResubmit) {
        expect(
          outcome.kind === "not-sent" ||
            (outcome.kind === "rejected" &&
              (outcome.category === "validation" || outcome.category === "cross-room-type-confirmation-required"))
        ).toBe(true);
      }
    }
  });

  it("never words 403/404 as the booking being deleted or missing", () => {
    for (const status of [403, 404] as const) {
      const view = describeAssignmentOutcome({ kind: "rejected", status, category: "not-permitted" });
      const text = `${view.title} ${view.detail ?? ""}`.toLowerCase();
      expect(text).toMatch(/not available or not permitted/);
      expect(text).not.toMatch(/deleted|does not exist|no longer exists|not found/);
    }
  });

  it("never describes an unconfirmed result as failed or cancelled, and says it was not retried", () => {
    for (const reason of ["network", "timeout", "aborted", "server-error"] as const) {
      const view = describeAssignmentOutcome({ kind: "unknown", reason });
      const text = `${view.title} ${view.detail ?? ""}`.toLowerCase();
      expect(text).toContain("could not be confirmed");
      expect(text).toContain("may or may not have been saved");
      expect(text).toContain("not retried");
      expect(text).not.toMatch(/cancel|failed to save|was not saved/);
    }
  });

  it("says a conflict was not saved and points back to the reloaded board", () => {
    const view = describeAssignmentOutcome({ kind: "rejected", status: 409, category: "conflict", detail: "overlap" });
    expect(view.title).toMatch(/not saved/);
    expect(view.title).toMatch(/reloaded board/);
    expect(view.detail).toBe("overlap");
  });

  it("PMS-CAL-001.2-CP03B: says a cross-room-type rejection was not confirmed/saved, never that the booking was deleted, and allows resubmit", () => {
    const view = describeAssignmentOutcome({
      kind: "rejected",
      status: 403,
      category: "cross-room-type-confirmation-required",
      detail: "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.",
    });
    const text = `${view.title} ${view.detail ?? ""}`.toLowerCase();
    expect(text).toMatch(/not confirmed/);
    expect(text).toMatch(/nothing was saved/);
    expect(text).not.toMatch(/deleted|does not exist|no longer exists|not found/);
    expect(view.allowResubmit).toBe(true);
    expect(view.reloadBoard).toBe(false);
  });
});
