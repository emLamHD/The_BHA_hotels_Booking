import { describe, expect, it } from "vitest";
import {
  describeAssignmentOutcome,
  describeBlockMoveOutcome,
  describeMoveOutcome,
  describeSplitMoveOutcome,
  describeUnassignOutcome,
} from "./assignmentOutcome";
import type {
  AssignmentCreateOutcome,
  MoveAssignmentOutcome,
  OperationalBlockMoveOutcome,
  SplitMoveAssignmentOutcome,
  UnassignAssignmentOutcome,
} from "@/lib/api/client";

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

describe("describeSplitMoveOutcome (PMS-CAL-002-CP04)", () => {
  type Policy = { reloadBoard: boolean; allowResubmit: boolean };
  const asManager = { crossRoomTypeEnabled: true };
  const asFrontDesk = { crossRoomTypeEnabled: false };
  const storeCrossTypeForbidden: SplitMoveAssignmentOutcome = {
    kind: "rejected",
    status: 403,
    category: "cross-room-type-confirmation-required",
    detail: "needs reason",
  };

  const splitCases: Array<[string, SplitMoveAssignmentOutcome, Policy]> = [
    ["200 with segments", { kind: "split", segments: [] }, { reloadBoard: true, allowResubmit: false }],
    ["200 with an unreadable body", { kind: "split", segments: null }, { reloadBoard: true, allowResubmit: false }],
    ["not-sent", { kind: "not-sent", message: "not configured" }, { reloadBoard: false, allowResubmit: true }],
    ["400", { kind: "rejected", status: 400, category: "validation", detail: "bad date" }, { reloadBoard: false, allowResubmit: true }],
    ["401 session ended", { kind: "rejected", status: 401, category: "refused", detail: "Your session has ended." }, { reloadBoard: false, allowResubmit: false }],
    ["403 permission or Origin", { kind: "rejected", status: 403, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
    ["404", { kind: "rejected", status: 404, category: "not-permitted" }, { reloadBoard: false, allowResubmit: false }],
    ["409", { kind: "rejected", status: 409, category: "conflict", detail: "overlap" }, { reloadBoard: true, allowResubmit: false }],
    ["415", { kind: "rejected", status: 415, category: "refused" }, { reloadBoard: false, allowResubmit: false }],
    ["network", { kind: "unknown", reason: "network" }, { reloadBoard: true, allowResubmit: false }],
    ["timeout", { kind: "unknown", reason: "timeout" }, { reloadBoard: true, allowResubmit: false }],
    ["aborted after send", { kind: "unknown", reason: "aborted" }, { reloadBoard: true, allowResubmit: false }],
    ["5xx", { kind: "unknown", reason: "server-error", status: 503 }, { reloadBoard: true, allowResubmit: false }],
  ];

  it.each(splitCases)("%s → reload/resubmit policy", (_name, outcome, expected) => {
    for (const context of [asManager, asFrontDesk]) {
      const view = describeSplitMoveOutcome(outcome, context);
      expect({ reloadBoard: view.reloadBoard, allowResubmit: view.allowResubmit }).toEqual(expected);
    }
  });

  it("only a 200 is ever described as saved, with or without a readable body", () => {
    for (const [, outcome] of splitCases) {
      const view = describeSplitMoveOutcome(outcome, asManager);
      expect(view.tone === "success").toBe(outcome.kind === "split");
      if (outcome.kind !== "split") {
        expect(`${view.title} ${view.detail ?? ""}`).not.toMatch(/split-move saved|successfully/i);
      }
    }
    expect(describeSplitMoveOutcome({ kind: "split", segments: null }, asManager).title).toBe("Room split-move saved.");
  });

  it("never paints successors and never offers a retry after success", () => {
    const view = describeSplitMoveOutcome({ kind: "split", segments: [] }, asManager);
    expect(view.detail).toMatch(/once it has been reloaded/i);
    expect(view.allowResubmit).toBe(false);
  });

  it("an unconfirmed result says it may or may not be saved, is not retried, and Close does not undo it", () => {
    const view = describeSplitMoveOutcome({ kind: "unknown", reason: "network" }, asManager);
    expect(view.tone).toBe("warning");
    expect(view.title).toMatch(/may or may not have been saved/);
    expect(view.title).toMatch(/not retried automatically/);
    expect(view.detail).toMatch(/does not stop or undo a request that was already sent/);
    expect(view.title).not.toMatch(/cancel|fail/i);
  });

  it("the store's cross-RoomType 403 asks a role without crossRoomType for a Manager, never to confirm and retry", () => {
    const view = describeSplitMoveOutcome(storeCrossTypeForbidden, asFrontDesk);
    expect(view.title).toMatch(/Manager must split-move/);
    expect(view.allowResubmit).toBe(false);
    expect(view.reloadBoard).toBe(false);
    expect(`${view.title} ${view.detail}`).not.toMatch(/confirm the placement|enter a reason|try again/i);
    expect(view.detail).not.toContain("needs reason"); // the server's text is not echoed to a role that cannot act on it
  });

  it("the store's cross-RoomType 403 for a role that may confirm asks to correct confirmation and reason, once more", () => {
    const view = describeSplitMoveOutcome(storeCrossTypeForbidden, asManager);
    expect(view.title).toMatch(/was not confirmed\. Nothing was saved/);
    expect(view.detail).toBe("needs reason");
    expect(view.allowResubmit).toBe(true);
    const withoutDetail = describeSplitMoveOutcome({ ...storeCrossTypeForbidden, detail: undefined } as SplitMoveAssignmentOutcome, asManager);
    expect(withoutDetail.detail).toMatch(/Confirm the placement and enter a reason/);
  });

  it("a refusal is never worded as though the booking or segment were removed", () => {
    for (const outcome of [
      { kind: "rejected", status: 403, category: "not-permitted" },
      { kind: "rejected", status: 404, category: "not-permitted" },
      { kind: "rejected", status: 401, category: "refused", detail: "Your session has ended." },
      { kind: "rejected", status: 415, category: "refused" },
    ] as SplitMoveAssignmentOutcome[]) {
      const view = describeSplitMoveOutcome(outcome, asManager);
      expect(view.title).toMatch(/Nothing was saved/);
      expect(view.title).not.toMatch(/removed|deleted|cancelled|gone/i);
    }
    expect(describeSplitMoveOutcome({ kind: "rejected", status: 404, category: "not-permitted" }, asManager).detail).toMatch(
      /does not mean the booking was removed/
    );
    expect(describeSplitMoveOutcome({ kind: "rejected", status: 401, category: "refused", detail: "Your session has ended." }, asManager).detail).toBe(
      "Your session has ended."
    );
  });

  it("existing create, move and unassign wording is unchanged", () => {
    expect(describeAssignmentOutcome({ kind: "created", segment: null }).title).toBe("Room assigned.");
    expect(describeMoveOutcome({ kind: "moved", segments: null }).title).toBe("Room moved.");
    expect(describeUnassignOutcome({ kind: "unassigned", segments: null }).title).toBe("Room assignment removed.");
  });
});

describe("describeBlockMoveOutcome (PMS-CAL-003-CP03)", () => {
  const table: Array<[string, OperationalBlockMoveOutcome, { tone: string; reloadBoard: boolean; allowResubmit: boolean }]> = [
    ["moved", { kind: "moved", segments: null }, { tone: "success", reloadBoard: true, allowResubmit: false }],
    ["moved with a readable body", { kind: "moved", segments: [] }, { tone: "success", reloadBoard: true, allowResubmit: false }],
    ["not-sent", { kind: "not-sent", message: "not configured" }, { tone: "error", reloadBoard: false, allowResubmit: true }],
    ["400", { kind: "rejected", status: 400, category: "validation", detail: "same room" }, { tone: "error", reloadBoard: false, allowResubmit: true }],
    ["403", { kind: "rejected", status: 403, category: "not-permitted" }, { tone: "error", reloadBoard: false, allowResubmit: false }],
    ["404", { kind: "rejected", status: 404, category: "not-permitted" }, { tone: "error", reloadBoard: false, allowResubmit: false }],
    ["409", { kind: "rejected", status: 409, category: "conflict", detail: "overlap" }, { tone: "warning", reloadBoard: true, allowResubmit: false }],
    ["401", { kind: "rejected", status: 401, category: "refused", detail: "Your session has ended." }, { tone: "error", reloadBoard: false, allowResubmit: false }],
    ["415", { kind: "rejected", status: 415, category: "refused" }, { tone: "error", reloadBoard: false, allowResubmit: false }],
    ["network", { kind: "unknown", reason: "network" }, { tone: "warning", reloadBoard: true, allowResubmit: false }],
    ["timeout", { kind: "unknown", reason: "timeout" }, { tone: "warning", reloadBoard: true, allowResubmit: false }],
    ["aborted", { kind: "unknown", reason: "aborted" }, { tone: "warning", reloadBoard: true, allowResubmit: false }],
    ["server-error", { kind: "unknown", reason: "server-error", status: 502 }, { tone: "warning", reloadBoard: true, allowResubmit: false }],
  ];

  it.each(table)("%s: tone, re-read and re-submit", (_name, outcome, expected) => {
    const view = describeBlockMoveOutcome(outcome);
    expect({ tone: view.tone, reloadBoard: view.reloadBoard, allowResubmit: view.allowResubmit }).toEqual(expected);
  });

  it("only a request that provably wrote nothing and that a different choice could fix may be sent again", () => {
    const resubmittable = table.filter(([, outcome]) => describeBlockMoveOutcome(outcome).allowResubmit).map(([name]) => name);
    expect(resubmittable).toEqual(["not-sent", "400"]);
  });

  it("every outcome that may have changed the schedule asks for a re-read, and none that provably did not", () => {
    for (const [name, outcome] of table) {
      const view = describeBlockMoveOutcome(outcome);
      const mayHaveWritten = outcome.kind === "moved" || outcome.kind === "unknown" || (outcome.kind === "rejected" && outcome.status === 409);
      expect(view.reloadBoard, name).toBe(mayHaveWritten);
    }
  });

  it("success never describes the resulting segments and says the block keeps its nights and reason", () => {
    const view = describeBlockMoveOutcome({ kind: "moved", segments: null });
    expect(view.title).toBe("Operational block moved.");
    expect(view.detail).toMatch(/keeps its nights and its reason/);
    expect(`${view.title} ${view.detail}`).not.toMatch(/seg-|successor|cancelled|version/i);
  });

  it("an unconfirmed result is never worded as a failure or as a success, and says both rooms stay locked and it was not sent again", () => {
    for (const reason of ["network", "timeout", "aborted", "server-error"] as const) {
      const view = describeBlockMoveOutcome({ kind: "unknown", reason });
      expect(view.title).toMatch(/may or may not have been moved/);
      expect(view.title).toMatch(/not sent again/);
      expect(view.title).toMatch(/both rooms stay locked/);
      expect(view.title).not.toMatch(/failed|was moved\.|saved/i);
    }
    expect(describeBlockMoveOutcome({ kind: "unknown", reason: "server-error", status: 502 }).detail).toContain("(HTTP 502)");
    expect(describeBlockMoveOutcome({ kind: "unknown", reason: "server-error" }).detail).not.toContain("HTTP");
  });

  it("a 409 says the block was not moved and may be a capacity refusal, without claiming which reason applied", () => {
    const view = describeBlockMoveOutcome({ kind: "rejected", status: 409, category: "conflict", detail: "x" });
    expect(view.title).toMatch(/was not moved/);
    expect(view.title).toMatch(/capacity/);
    expect(view.title).toMatch(/Review the reloaded board/);
    expect(view.detail).toBe("x");
  });

  it("a 403/404/401/415 is a refusal of this write, never a statement about the block", () => {
    for (const outcome of [
      { kind: "rejected", status: 403, category: "not-permitted" },
      { kind: "rejected", status: 404, category: "not-permitted" },
      { kind: "rejected", status: 401, category: "refused", detail: "Your Staff session has ended." },
      { kind: "rejected", status: 415, category: "refused" },
    ] as OperationalBlockMoveOutcome[]) {
      const view = describeBlockMoveOutcome(outcome);
      expect(view.title).toMatch(/Nothing was changed/);
      expect(`${view.title} ${view.detail ?? ""}`).not.toMatch(/has been moved|was moved|deleted|no longer exists/i);
    }
    expect(describeBlockMoveOutcome({ kind: "rejected", status: 404, category: "not-permitted" }).detail).toMatch(/not been reported as moved or removed/);
    expect(describeBlockMoveOutcome({ kind: "rejected", status: 401, category: "refused", detail: "Your Staff session has ended." }).detail).toBe(
      "Your Staff session has ended."
    );
    expect(describeBlockMoveOutcome({ kind: "rejected", status: 418, category: "refused" }).title).toContain("HTTP 418");
  });

  it("has no cross-room-type branch: no wording asks for a confirmation or a Manager", () => {
    for (const [, outcome] of table) {
      const view = describeBlockMoveOutcome(outcome);
      expect(`${view.title} ${view.detail ?? ""}`).not.toMatch(/Manager|confirm the placement|different room type than sold/i);
    }
  });

  it("existing block outcome wording is unchanged", () => {
    expect(describeAssignmentOutcome({ kind: "created", segment: null }).title).toBe("Room assigned.");
    expect(describeSplitMoveOutcome({ kind: "split", segments: null }, { crossRoomTypeEnabled: true }).title).toBe("Room split-move saved.");
  });
});
