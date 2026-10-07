import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUnassignRequest, planUnassignReconciliation } from "./unassignSubmission";
import { describeUnassignOutcome } from "./assignmentOutcome";
import { isSegmentUnassignUnresolved, settleReconciliations } from "./reconciliation";
import type { UnassignAssignmentOutcome } from "@/lib/api/client";
import type { ReservationBoardResponse } from "@/lib/api/types";
import type { UnassignTarget } from "./unassignTarget";

// The segment (2026-08-20 → 2026-09-25) runs past both edges of the board
// window (2026-09-01 → 2026-09-15): the plan must keep the full range.
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
      segmentVersion: 7,
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const runtime = { id: 42, afterSeq: 9 };

const outcomes: Array<[string, UnassignAssignmentOutcome, "settled" | "unresolved" | null]> = [
  ["unassigned", { kind: "unassigned", segments: null }, "settled"],
  ["409 conflict", { kind: "rejected", status: 409, category: "conflict", detail: "stale" }, "settled"],
  ["network", { kind: "unknown", reason: "network" }, "unresolved"],
  ["timeout", { kind: "unknown", reason: "timeout" }, "unresolved"],
  ["post-send abort", { kind: "unknown", reason: "aborted" }, "unresolved"],
  ["5xx", { kind: "unknown", reason: "server-error", status: 503 }, "unresolved"],
  ["not-sent", { kind: "not-sent", message: "not configured" }, null],
  ["400 validation", { kind: "rejected", status: 400, category: "validation", detail: "bad" }, null],
  ["403 gate", { kind: "rejected", status: 403, category: "not-permitted" }, null],
  ["404 gate", { kind: "rejected", status: 404, category: "not-permitted" }, null],
  ["anomalous cross-room-type", { kind: "rejected", status: 403, category: "cross-room-type-confirmation-required" }, null],
  ["415 refused", { kind: "rejected", status: 415, category: "refused" }, null],
];

afterEach(() => vi.restoreAllMocks());

describe("buildUnassignRequest (PMS-CAL-001.2-CP04D.4C.2A)", () => {
  it("1. carries exactly the target's Property, segment and expected version — and nothing else", () => {
    const plan = buildUnassignRequest(buildTarget());
    expect(plan.propertyId).toBe("prop-a");
    expect(plan.segmentId).toBe("seg-1");
    expect(plan.request.expectedVersion).toBe(7);
    expect(Object.keys(plan)).toEqual(["propertyId", "segmentId", "request"]);
    expect(Object.keys(plan.request)).toEqual(["expectedVersion"]);
  });

  it("3. omits a missing or blank reason, and sends a real one trimmed", () => {
    for (const blank of [undefined, "", "   ", "\n\t"]) {
      expect(Object.keys(buildUnassignRequest(buildTarget(), blank).request)).toEqual(["expectedVersion"]);
    }
    const withReason = buildUnassignRequest(buildTarget(), "  guest asked to leave  ");
    expect(withReason.request).toEqual({ expectedVersion: 7, reason: "guest asked to leave" });
    expect(Object.keys(withReason.request).sort()).toEqual(["expectedVersion", "reason"]);
  });
});

describe("planUnassignReconciliation (PMS-CAL-001.2-CP04D.4C.2A)", () => {
  it("2 + 8. keeps the board identity and the full segment identity, version, source room and range", () => {
    const entry = planUnassignReconciliation(buildTarget(), { kind: "unassigned", segments: null }, runtime)!;
    expect(entry).toMatchObject({
      id: 42,
      key: "prop-a|2026-09-01|2026-09-15",
      propertyId: "prop-a",
      from: "2026-09-01",
      to: "2026-09-15",
      afterSeq: 9,
      status: "pending",
    });
    expect(entry.target).toEqual({
      operation: "unassign",
      reservationUnitId: "unit-1",
      startDate: "2026-08-20", // not clipped to the board's 2026-09-01
      endDate: "2026-09-25", // not clipped to the board's 2026-09-15
      roomNumber: "201",
      guestDisplayName: "Nguyen Van A",
      confirmationNumber: "CNF-001",
      segmentId: "seg-1",
      expectedVersion: 7,
      sourcePhysicalRoomId: "room-201",
    });
    expect(entry.target).not.toHaveProperty("physicalRoomId"); // no destination room
  });

  it.each(outcomes)("4-7. %s → reconciliation policy", (_name, outcome, expected) => {
    const entry = planUnassignReconciliation(buildTarget(), outcome, runtime);
    if (expected === null) {
      expect(entry).toBeNull();
      return;
    }
    expect(entry?.resolution).toBe(expected);
    expect(entry?.certainty).toBe(expected === "unresolved" ? "uncertain" : "settled");
  });

  it("6. a lost response is uncertain and unresolved — never settled, observed or changed", () => {
    for (const [, outcome, expected] of outcomes.filter(([, o]) => o.kind === "unknown")) {
      const entry = planUnassignReconciliation(buildTarget(), outcome, runtime)!;
      expect({ certainty: entry.certainty, resolution: entry.resolution }).toEqual({
        certainty: "uncertain",
        resolution: expected,
      });
    }
  });

  it("7. follows describeUnassignOutcome's reloadBoard for every outcome — no second HTTP table", () => {
    for (const [, outcome] of outcomes) {
      expect(planUnassignReconciliation(buildTarget(), outcome, runtime) !== null).toBe(
        describeUnassignOutcome(outcome).reloadBoard
      );
    }
  });

  it("9. never mutates the target or the outcome (deep-frozen inputs, unchanged snapshots)", () => {
    const target = deepFreeze(buildTarget());
    const before = JSON.parse(JSON.stringify(target));
    for (const [, outcome] of outcomes) {
      const frozenOutcome = deepFreeze(JSON.parse(JSON.stringify(outcome)) as UnassignAssignmentOutcome);
      expect(() => planUnassignReconciliation(target, frozenOutcome, runtime)).not.toThrow();
      expect(frozenOutcome).toEqual(outcome);
    }
    expect(() => buildUnassignRequest(target, "  reason ")).not.toThrow();
    expect(target).toEqual(before);
  });

  it("10. makes no network call and has no runtime side effect", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const [, outcome] of outcomes) planUnassignReconciliation(buildTarget(), outcome, runtime);
    buildUnassignRequest(buildTarget(), "x");
    expect(fetchSpy).not.toHaveBeenCalled();

    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "unassignSubmission.ts"), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.filter((line) => line.includes("@/lib/api/client")).every((line) => line.startsWith("import type"))).toBe(true);
    expect(source.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\bfetch\(|unassignReservationAssignment|setTimeout|retry\(/);
  });

  it("the planned entries drive CP04D.3's reconciliation and lock: an uncertain unassign stays locked until the board proves the source changed", () => {
    const entry = planUnassignReconciliation(buildTarget(), { kind: "unknown", reason: "timeout" }, runtime)!;
    const boardWith = (assignments: ReservationBoardResponse["stays"][number]["assignments"]): ReservationBoardResponse => ({
      property: { id: "prop-a", name: "P", timeZone: "Asia/Ho_Chi_Minh", localToday: "2026-09-01", checkInTime: "14:00", checkOutTime: "12:00" },
      from: "2026-09-01",
      to: "2026-09-15",
      roomTypes: [],
      physicalRooms: [],
      stays: [{ ...buildTarget().stay, assignments }],
      operationalBlocks: [],
    });
    const segment = buildTarget().segment;

    let list = settleReconciliations([entry], entry.key, 10, { kind: "loaded", board: boardWith([segment]) });
    expect(list[0].resolution).toBe("unresolved");
    expect(isSegmentUnassignUnresolved(list, "prop-a", "seg-1")).toBe(true);

    list = settleReconciliations(list, entry.key, 11, { kind: "loaded", board: boardWith([]) });
    expect(list[0].resolution).toBe("changed");
    expect(isSegmentUnassignUnresolved(list, "prop-a", "seg-1")).toBe(false);
  });
});
