/**
 * PMS-ADMIN-AUTH-001-CP06 evidence group 1: the access mode is read, never guessed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_MODE_ERROR_MESSAGE, getAccessMode, resolveAccessMode } from "./accessMode";

afterEach(() => vi.unstubAllEnvs());

describe("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", () => {
  it("is LocalGate when it is not set", () => {
    expect(resolveAccessMode(undefined)).toEqual({ ok: true, mode: "LocalGate" });
    expect(resolveAccessMode(null)).toEqual({ ok: true, mode: "LocalGate" });
  });

  it("accepts exactly LocalGate or Staff", () => {
    expect(resolveAccessMode("LocalGate")).toEqual({ ok: true, mode: "LocalGate" });
    expect(resolveAccessMode("Staff")).toEqual({ ok: true, mode: "Staff" });
  });

  it.each(["", " ", "staff", "STAFF", "localgate", " Staff", "Staff ", "1", "Both", "LocalGate,Staff"])(
    "refuses a declared value that is not exactly a mode: %j",
    (value) => {
      expect(resolveAccessMode(value)).toEqual({ ok: false, message: ACCESS_MODE_ERROR_MESSAGE });
    }
  );

  it("reads the build variable", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
    expect(getAccessMode()).toEqual({ ok: true, mode: "Staff" });
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "");
    expect(getAccessMode().ok).toBe(false);
  });
});
