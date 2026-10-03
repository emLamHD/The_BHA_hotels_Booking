/**
 * PMS-ADMIN-AUTH-001-CP06: which backend access mode this Admin build talks to.
 *
 * `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE` mirrors the API's
 * `AdminCalendar:AccessMode`:
 *
 * - not set → `LocalGate` (the CP06 default; the API's default is the same);
 * - exactly `LocalGate` or `Staff` → that mode;
 * - anything else, an empty value included → a configuration error. No
 *   Calendar request is sent, and the mode is never guessed, probed for, or
 *   downgraded from `Staff` to `LocalGate`.
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
  "NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE must be exactly LocalGate or Staff (or left unset for LocalGate). Nothing was sent.";

export function resolveAccessMode(rawValue: string | undefined | null): AccessModeResult {
  if (rawValue === undefined || rawValue === null) return { ok: true, mode: "LocalGate" };
  if (rawValue === "LocalGate" || rawValue === "Staff") return { ok: true, mode: rawValue };
  return { ok: false, message: ACCESS_MODE_ERROR_MESSAGE };
}

export function getAccessMode(): AccessModeResult {
  // Referenced literally so Next.js inlines it at build time.
  return resolveAccessMode(process.env.NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE);
}
