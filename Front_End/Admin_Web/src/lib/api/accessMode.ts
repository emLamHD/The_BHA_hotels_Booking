/**
 * PMS-ADMIN-AUTH-001-CP06: which backend access mode this Admin build talks to.
 *
 * `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` mirrors the API's
 * `AdminCalendar:AccessMode`:
 *
 * - not set → `Staff` (CP07; the API's default is the same);
 * - exactly `Staff` → `Staff`;
 * - exactly `LocalGate` → the local development gate — refused as a
 *   configuration error in a production build (CP07), as the API refuses to
 *   start with it outside Development;
 * - anything else, an empty value included → a configuration error.
 *
 * On any configuration error no Calendar request is sent, and the mode is
 * never guessed, probed for, or downgraded to `LocalGate`.
 *
 * It is a Next.js public build variable: the value is inlined when the app is
 * built (or the dev server starts), so changing it needs a rebuild/restart. It
 * is not a secret and must never carry one.
 */

export type AdminCalendarAccessMode = "LocalGate" | "Staff";

export type AccessModeResult =
  | { ok: true; mode: AdminCalendarAccessMode }
  | { ok: false; message: string };

export const ACCESS_MODE_ERROR_MESSAGE =
  "NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE must be exactly Staff or LocalGate (or left unset for Staff). Nothing was sent.";

export const LOCAL_GATE_IN_PRODUCTION_MESSAGE =
  "NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE=LocalGate is a local development opt-in and is refused in a production build. Nothing was sent.";

/**
 * `nodeEnv` is the build's `NODE_ENV`: `production` for `next build`/`next start`,
 * `development` for `next dev`, `test` under the test runner.
 */
export function resolveAccessMode(rawValue: string | undefined | null, nodeEnv: string | undefined): AccessModeResult {
  if (rawValue === undefined || rawValue === null || rawValue === "Staff") return { ok: true, mode: "Staff" };
  if (rawValue === "LocalGate") {
    return nodeEnv === "production" ? { ok: false, message: LOCAL_GATE_IN_PRODUCTION_MESSAGE } : { ok: true, mode: "LocalGate" };
  }
  return { ok: false, message: ACCESS_MODE_ERROR_MESSAGE };
}

export function getAccessMode(): AccessModeResult {
  // Referenced literally so Next.js inlines both at build time.
  return resolveAccessMode(process.env.NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE, process.env.NODE_ENV);
}
