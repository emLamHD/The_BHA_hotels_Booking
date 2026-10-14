import { describe, expect, it } from "vitest";
import { shouldRedirectToReceipt } from "../HoldReceiptRedirector";

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
