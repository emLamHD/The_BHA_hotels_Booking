import { describe, expect, it } from "vitest";
import { shouldRedirectToReceipt } from "../HoldReceiptRedirector";
import { describeDraftProblem } from "../StaySearchProvider";

describe("shouldRedirectToReceipt", () => {
  it("redirects only on the submitting -> active-session transition that carries a session", () => {
    expect(shouldRedirectToReceipt("submitting", "active-session", true)).toBe(true);
  });

  it.each([
    ["idle", "active-session"],
    ["active-session", "active-session"],
    ["submitting", "known-error"],
    ["submitting", "unknown-outcome"],
    ["submitting", "idle"],
    ["confirming", "active-session"],
  ])("does not redirect %s -> %s", (was, now) => {
    expect(shouldRedirectToReceipt(was, now, true)).toBe(false);
  });

  it("does not redirect without a session to show", () => {
    expect(shouldRedirectToReceipt("submitting", "active-session", false)).toBe(false);
  });
});

describe("describeDraftProblem", () => {
  it("asks for both dates when the check-in is missing or the range is incomplete", () => {
    expect(describeDraftProblem({ checkIn: "Check-in is required." } as never)).toBe("Chọn ngày nhận phòng và trả phòng.");
    expect(describeDraftProblem({ checkOut: "Check-out is required." } as never)).toBe("Chọn ngày nhận phòng và trả phòng.");
  });

  it("passes another field message through and has a fallback", () => {
    expect(describeDraftProblem({ adults: "Adults must be 1-10." } as never)).toBe("Adults must be 1-10.");
    expect(describeDraftProblem({} as never)).toBe("Kiểm tra lại ngày và số khách.");
  });
});
