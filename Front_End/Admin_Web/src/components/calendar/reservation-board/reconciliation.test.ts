import { describe, expect, it } from "vitest";
import { isBoardAwaitingReconciliation, settleReconciliations, type Reconciliation } from "./reconciliation";

const A = "prop-a|2026-09-07|2026-09-21";
const B = "prop-a|2026-09-21|2026-10-05";

function pending(overrides: Partial<Reconciliation> = {}): Reconciliation {
  return { id: 1, key: A, from: "2026-09-07", to: "2026-09-21", afterSeq: 5, status: "pending", ...overrides };
}

describe("settleReconciliations (PMS-CAL-001.2-CP03A-C1)", () => {
  it("is confirmed by a read of the same board issued after the write", () => {
    expect(settleReconciliations([pending()], A, 6, "loaded")[0].status).toBe("done");
  });

  it("is never confirmed by a read that was already in flight when the write resolved", () => {
    const list = [pending()];
    expect(settleReconciliations(list, A, 5, "loaded")).toBe(list);
    expect(settleReconciliations(list, A, 4, "loaded")).toBe(list);
  });

  it("is never confirmed by a read of another Property or date range", () => {
    const list = [pending()];
    expect(settleReconciliations(list, B, 99, "loaded")).toBe(list);
    expect(settleReconciliations(list, "prop-b|2026-09-07|2026-09-21", 99, "loaded")).toBe(list);
  });

  it("marks a failed re-read, and a later successful re-read of the same board still confirms it", () => {
    const failed = settleReconciliations([pending()], A, 6, "failed");
    expect(failed[0].status).toBe("failed");
    expect(settleReconciliations(failed, A, 7, "loaded")[0].status).toBe("done");
  });

  it("never downgrades a confirmed write when a later read fails", () => {
    const done = [pending({ status: "done" })];
    expect(settleReconciliations(done, A, 9, "failed")).toBe(done);
  });

  it("settles only the entries the read concerns", () => {
    const list = [pending({ id: 1 }), pending({ id: 2, key: B, afterSeq: 5 })];
    const settled = settleReconciliations(list, A, 6, "loaded");
    expect(settled.map((entry) => entry.status)).toEqual(["done", "pending"]);
  });
});

describe("isBoardAwaitingReconciliation", () => {
  it("blocks only the board a write has not yet been confirmed on", () => {
    expect(isBoardAwaitingReconciliation([pending()], A)).toBe(true);
    expect(isBoardAwaitingReconciliation([pending({ status: "failed" })], A)).toBe(true);
    expect(isBoardAwaitingReconciliation([pending({ status: "done" })], A)).toBe(false);
    expect(isBoardAwaitingReconciliation([pending()], B)).toBe(false);
  });
});
