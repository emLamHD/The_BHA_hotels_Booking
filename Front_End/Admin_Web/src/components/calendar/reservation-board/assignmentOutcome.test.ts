import { describe, expect, it } from "vitest";
import { describeAssignmentOutcome, describeMoveOutcome, describeUnassignOutcome } from "./assignmentOutcome";
import type { AssignmentCreateOutcome, MoveAssignmentOutcome, UnassignAssignmentOutcome } from "@/lib/api/client";

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

const moveCases: Array<[string, MoveAssignmentOutcome, { reloadBoard: boolean; allowResubmit: boolean }]> = [
  ["moved", { kind: "moved", segments: null }, { reloadBoard: true, allowResubmit: false }],
  ["not-sent", { kind: "not-sent", message: "not configured" }, { reloadBoard: false, allowResubmit: true }],
  ["400", { kind: "rejected", status: 400, category: "validation", detail: "bad" }, { reloadBoard: false, allowResubmit: true }],
  ["403", { kind: "rejected", status: 403, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
  ["404", { kind: "rejected", status: 404, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
  [
    "403 cross-room-type",
    { kind: "rejected", status: 403, category: "cross-room-type-confirmation-required", detail: "needs reason" },
    { reloadBoard: false, allowResubmit: true },
  ],
  ["409", { kind: "rejected", status: 409, category: "conflict", detail: "stale version" }, { reloadBoard: true, allowResubmit: false }],
  ["415", { kind: "rejected", status: 415, category: "refused" }, { reloadBoard: false, allowResubmit: false }],
  ["network", { kind: "unknown", reason: "network" }, { reloadBoard: true, allowResubmit: false }],
  ["timeout", { kind: "unknown", reason: "timeout" }, { reloadBoard: true, allowResubmit: false }],
  ["aborted", { kind: "unknown", reason: "aborted" }, { reloadBoard: true, allowResubmit: false }],
  ["5xx", { kind: "unknown", reason: "server-error", status: 503 }, { reloadBoard: true, allowResubmit: false }],
];

describe("describeMoveOutcome (PMS-CAL-001.2-CP04C.4)", () => {
  it.each(moveCases)("%s → reload/resubmit policy", (_name, outcome, expected) => {
    const view = describeMoveOutcome(outcome);
    expect({ reloadBoard: view.reloadBoard, allowResubmit: view.allowResubmit }).toEqual(expected);
  });

  it("only a moved outcome is ever described as success", () => {
    for (const [, outcome] of moveCases) {
      const view = describeMoveOutcome(outcome);
      expect(view.tone === "success").toBe(outcome.kind === "moved");
      if (outcome.kind !== "moved") {
        expect(`${view.title} ${view.detail ?? ""}`).not.toMatch(/successfully|room moved|move (was|has been) saved|saved on the server/i);
      }
    }
  });

  it("never words 403/404 as the booking being deleted or missing", () => {
    for (const status of [403, 404] as const) {
      const view = describeMoveOutcome({ kind: "rejected", status, category: "not-permitted" });
      const text = `${view.title} ${view.detail ?? ""}`.toLowerCase();
      expect(text).toMatch(/not available or not permitted/);
      expect(text).not.toMatch(/deleted|does not exist|no longer exists|not found/);
    }
  });

  it("never describes an unconfirmed result as failed, cancelled, or a rollback, and says it was not retried", () => {
    for (const reason of ["network", "timeout", "aborted", "server-error"] as const) {
      const view = describeMoveOutcome({ kind: "unknown", reason });
      const text = `${view.title} ${view.detail ?? ""}`.toLowerCase();
      expect(text).toContain("could not be confirmed");
      expect(text).toContain("may or may not have been saved");
      expect(text).toContain("not retried");
      expect(text).not.toMatch(/cancel|failed to save|was not saved|rolled? back|rollback/);
      expect(view.allowResubmit).toBe(false);
    }
  });

  it("says a conflict (stale version or unsuitable destination) was not saved, points back to the reloaded board, and locks resubmit", () => {
    const view = describeMoveOutcome({ kind: "rejected", status: 409, category: "conflict", detail: "stale version" });
    expect(view.title).toMatch(/not saved/);
    expect(view.title).toMatch(/reloaded board/);
    expect(view.detail).toBe("stale version");
    expect(view.allowResubmit).toBe(false);
  });

  it("offers a resubmit only when the server proved nothing was written and another choice could succeed", () => {
    for (const [, outcome] of moveCases) {
      const view = describeMoveOutcome(outcome);
      if (view.allowResubmit) {
        expect(
          outcome.kind === "not-sent" ||
            (outcome.kind === "rejected" &&
              (outcome.category === "validation" || outcome.category === "cross-room-type-confirmation-required"))
        ).toBe(true);
      }
    }
  });
});

const unassignCases: Array<[string, UnassignAssignmentOutcome, { reloadBoard: boolean; allowResubmit: boolean }]> = [
  ["unassigned", { kind: "unassigned", segments: [] }, { reloadBoard: true, allowResubmit: false }],
  ["unassigned, unreadable body", { kind: "unassigned", segments: null }, { reloadBoard: true, allowResubmit: false }],
  ["not-sent", { kind: "not-sent", message: "not configured" }, { reloadBoard: false, allowResubmit: true }],
  ["400", { kind: "rejected", status: 400, category: "validation", detail: "bad" }, { reloadBoard: false, allowResubmit: true }],
  ["403", { kind: "rejected", status: 403, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
  ["404", { kind: "rejected", status: 404, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
  [
    "403 cross-room-type (contract mismatch)",
    { kind: "rejected", status: 403, category: "cross-room-type-confirmation-required", detail: "needs reason" },
    { reloadBoard: false, allowResubmit: false },
  ],
  ["409", { kind: "rejected", status: 409, category: "conflict", detail: "stale version" }, { reloadBoard: true, allowResubmit: false }],
  ["415", { kind: "rejected", status: 415, category: "refused" }, { reloadBoard: false, allowResubmit: false }],
  ["network", { kind: "unknown", reason: "network" }, { reloadBoard: true, allowResubmit: false }],
  ["timeout", { kind: "unknown", reason: "timeout" }, { reloadBoard: true, allowResubmit: false }],
  ["aborted", { kind: "unknown", reason: "aborted" }, { reloadBoard: true, allowResubmit: false }],
  ["5xx", { kind: "unknown", reason: "server-error", status: 503 }, { reloadBoard: true, allowResubmit: false }],
];

const textOf = (view: { title: string; detail?: string }) => `${view.title} ${view.detail ?? ""}`.toLowerCase();

describe("describeUnassignOutcome (PMS-CAL-001.2-CP04D.4A)", () => {
  it.each(unassignCases)("%s → reload/resubmit policy", (_name, outcome, expected) => {
    const view = describeUnassignOutcome(outcome);
    expect({ reloadBoard: view.reloadBoard, allowResubmit: view.allowResubmit }).toEqual(expected);
  });

  it("only an unassigned outcome ever has the success tone or success wording", () => {
    for (const [, outcome] of unassignCases) {
      const view = describeUnassignOutcome(outcome);
      expect(view.tone === "success").toBe(outcome.kind === "unassigned");
      if (outcome.kind !== "unassigned") {
        expect(textOf(view)).not.toMatch(/successfully|room assignment removed|only this room assignment/);
      }
    }
  });

  it("describes a confirmed unassign as removing the room assignment only — even when the 200 body was unreadable", () => {
    for (const segments of [null, []]) {
      const view = describeUnassignOutcome({ kind: "unassigned", segments });
      expect(view.tone).toBe("success");
      expect(view.title).toMatch(/room assignment removed/i);
      expect(textOf(view)).not.toMatch(/cancel|delet|fail|unknown|could not be confirmed/);
    }
  });

  it("says a request that never left the browser changed nothing, and keeps the transport message", () => {
    const view = describeUnassignOutcome({ kind: "not-sent", message: "not configured" });
    expect(view.title).toMatch(/not sent/i);
    expect(view.title).toMatch(/nothing was changed/i);
    expect(view.detail).toBe("not configured");
  });

  it("says a validation rejection saved no assignment change and keeps the safe detail", () => {
    const view = describeUnassignOutcome({ kind: "rejected", status: 400, category: "validation", detail: "Reason is required." });
    expect(view.title).toMatch(/did not accept this unassign/i);
    expect(view.title).toMatch(/no assignment change was saved/i);
    expect(view.detail).toBe("Reason is required.");
  });

  it("never words 403/404 as the booking, reservation or segment being deleted, cancelled, missing or not found", () => {
    for (const status of [403, 404] as const) {
      const text = textOf(describeUnassignOutcome({ kind: "rejected", status, category: "not-permitted" }));
      expect(text).toMatch(/not available or not permitted/);
      expect(text).not.toMatch(/delet|cancel|missing|not found|does not exist|no longer exist|removed|gone/);
    }
  });

  it("treats an anomalous cross-room-type category as a plain refusal — no RoomType/reason guidance, no resubmit, server text not echoed", () => {
    const view = describeUnassignOutcome({
      kind: "rejected",
      status: 403,
      category: "cross-room-type-confirmation-required",
      detail: "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.",
    });
    expect(textOf(view)).not.toMatch(/confirm|reason|room.?type|cross|choose|try again/);
    expect(view.allowResubmit).toBe(false);
    expect(view.reloadBoard).toBe(false);
  });

  it("says a conflict was not saved because the assignment changed, points to the reloaded board, keeps the detail, and locks resubmit", () => {
    const view = describeUnassignOutcome({ kind: "rejected", status: 409, category: "conflict", detail: "stale version" });
    expect(view.title).toMatch(/not saved/);
    expect(view.title).toMatch(/changed or is no longer current/);
    expect(view.title).toMatch(/reloaded board/);
    expect(view.detail).toBe("stale version");
    expect(view.reloadBoard).toBe(true);
    expect(view.allowResubmit).toBe(false);
  });

  it("describes an unconfirmed result as may-or-may-not, not retried — never success, failure, cancellation or rollback — and reloads without resubmit", () => {
    for (const reason of ["network", "timeout", "aborted", "server-error"] as const) {
      const view = describeUnassignOutcome({ kind: "unknown", reason, status: reason === "server-error" ? 503 : undefined });
      const text = textOf(view);
      expect(text).toContain("could not be confirmed");
      expect(text).toContain("may or may not have been removed");
      expect(text).toContain("not retried");
      expect(text).not.toMatch(/success|fail|cancel|roll(ed)?.?back|not saved|nothing was/);
      expect(view.tone).toBe("warning");
      expect(view.reloadBoard).toBe(true);
      expect(view.allowResubmit).toBe(false);
    }
  });

  it("does not let closing the dialog read as cancelling an already-sent unassign", () => {
    const text = textOf(describeUnassignOutcome({ kind: "unknown", reason: "timeout" }));
    expect(text).toMatch(/closing this dialog does not stop or undo/);
  });

  it("refuses an unexpected 4xx without reload or resubmit, keeps the detail, and never implies the booking is gone", () => {
    const view = describeUnassignOutcome({ kind: "rejected", status: 415, category: "refused", detail: "Unsupported." });
    expect(view.title).toMatch(/refused the request \(HTTP 415\)/);
    expect(view.detail).toBe("Unsupported.");
    expect(view.reloadBoard).toBe(false);
    expect(view.allowResubmit).toBe(false);
    expect(textOf(view)).not.toMatch(/delet|cancel|missing|not found/);
  });

  it("offers a resubmit only when the server proved nothing was written and corrected input could succeed", () => {
    for (const [, outcome] of unassignCases) {
      if (describeUnassignOutcome(outcome).allowResubmit) {
        expect(
          outcome.kind === "not-sent" || (outcome.kind === "rejected" && outcome.category === "validation")
        ).toBe(true);
      }
    }
  });
});
