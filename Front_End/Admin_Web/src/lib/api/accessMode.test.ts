/**
 * PMS-ADMIN-AUTH-001-CP06 evidence group 1: the access mode is read, never guessed.
 * CP07: Staff is the default, and LocalGate is refused in a production build.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_MODE_ERROR_MESSAGE, LOCAL_GATE_IN_PRODUCTION_MESSAGE, getAccessMode, resolveAccessMode } from "./accessMode";

afterEach(() => vi.unstubAllEnvs());

describe("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", () => {
  it.each(["development", "production", "test"])("is Staff when it is not set (%s)", (nodeEnv) => {
    expect(resolveAccessMode(undefined, nodeEnv)).toEqual({ ok: true, mode: "Staff" });
    expect(resolveAccessMode(null, nodeEnv)).toEqual({ ok: true, mode: "Staff" });
    expect(resolveAccessMode("Staff", nodeEnv)).toEqual({ ok: true, mode: "Staff" });
  });

  it("accepts LocalGate outside a production build only", () => {
    expect(resolveAccessMode("LocalGate", "development")).toEqual({ ok: true, mode: "LocalGate" });
    expect(resolveAccessMode("LocalGate", "test")).toEqual({ ok: true, mode: "LocalGate" });
    expect(resolveAccessMode("LocalGate", "production")).toEqual({ ok: false, message: LOCAL_GATE_IN_PRODUCTION_MESSAGE });
  });

  it.each(["", " ", "staff", "STAFF", "localgate", " Staff", "Staff ", "1", "Both", "LocalGate,Staff"])(
    "refuses a declared value that is not exactly a mode: %j",
    (value) => {
      expect(resolveAccessMode(value, "development")).toEqual({ ok: false, message: ACCESS_MODE_ERROR_MESSAGE });
    }
  );

  it("reads the build variables", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", undefined);
    expect(getAccessMode()).toEqual({ ok: true, mode: "Staff" });
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    expect(getAccessMode()).toEqual({ ok: true, mode: "LocalGate" });
    vi.stubEnv("NODE_ENV", "production");
    expect(getAccessMode()).toEqual({ ok: false, message: LOCAL_GATE_IN_PRODUCTION_MESSAGE });
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "");
    expect(getAccessMode().ok).toBe(false);
  });
});
