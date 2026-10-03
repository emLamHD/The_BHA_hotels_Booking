/**
 * PMS-ADMIN-AUTH-001-CP06: the three Staff session routes of the API (CP03).
 *
 * Every call sends the browser's `.TheBha.Staff` cookie (`credentials:
 * "include"`) — the cookie is HttpOnly, so this code never sees it — and
 * nothing here is kept in storage, the URL or the console. The browser adds
 * the `Origin` header itself; it is never set by hand.
 */

import { describeApiBaseUrlError, getApiBaseUrl } from "./env";
import { getAccessMode } from "./accessMode";

export type StaffRole = "FrontDesk" | "Manager";

/** One Property membership, exactly as `GET /api/admin/v1/me` returns it. */
export interface StaffMembership {
  propertyId: string;
  propertyName: string;
  timeZone: string;
  /** The server's role string; an unrecognised one grants nothing in this UI. */
  role: string;
}

export interface StaffSession {
  staffAccountId: string;
  email: string;
  memberships: StaffMembership[];
}

export type StaffLoginOutcome =
  | { kind: "signed-in" }
  | { kind: "invalid-credentials" }
  | { kind: "rate-limited" }
  | { kind: "invalid-request" }
  | { kind: "refused"; status: number }
  | { kind: "network" }
  | { kind: "config"; message: string };

export type StaffSessionResult =
  | { kind: "authenticated"; session: StaffSession }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

export type StaffLogoutOutcome =
  | { kind: "logged-out" }
  | { kind: "session-ended" }
  | { kind: "unconfirmed"; message: string };

type Endpoint = { ok: true; url: string } | { ok: false; message: string };

function endpoint(path: string): Endpoint {
  const mode = getAccessMode();
  if (!mode.ok) return { ok: false, message: mode.message };
  const base = getApiBaseUrl();
  if (!base.ok) return { ok: false, message: describeApiBaseUrlError(base.reason) };
  return { ok: true, url: `${base.baseUrl}${path}` };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * The `me` body, checked field by field. Anything else — a missing field, a
 * wrong type, an extra wrapper — is rejected, because a session the UI cannot
 * read must not open the board.
 */
export function parseStaffSession(data: unknown): StaffSession | null {
  if (data === null || typeof data !== "object") return null;
  const candidate = data as Record<string, unknown>;
  if (!isString(candidate.staffAccountId) || candidate.staffAccountId === "") return null;
  if (!isString(candidate.email)) return null;
  if (!Array.isArray(candidate.memberships)) return null;
  const memberships: StaffMembership[] = [];
  for (const entry of candidate.memberships) {
    if (entry === null || typeof entry !== "object") return null;
    const membership = entry as Record<string, unknown>;
    if (
      !isString(membership.propertyId) ||
      membership.propertyId === "" ||
      !isString(membership.propertyName) ||
      !isString(membership.timeZone) ||
      !isString(membership.role)
    ) {
      return null;
    }
    memberships.push({
      propertyId: membership.propertyId,
      propertyName: membership.propertyName,
      timeZone: membership.timeZone,
      role: membership.role,
    });
  }
  return { staffAccountId: candidate.staffAccountId, email: candidate.email, memberships };
}

/**
 * `POST /api/admin/v1/auth/login`. One attempt, never retried. The password is
 * sent exactly as typed. A `200` only says the cookie was issued; the caller
 * confirms the session with {@link fetchStaffSession} before opening anything.
 */
export async function staffLogin(email: string, password: string): Promise<StaffLoginOutcome> {
  const target = endpoint("/api/admin/v1/auth/login");
  if (!target.ok) return { kind: "config", message: target.message };
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return { kind: "network" };
  }

  switch (response.status) {
    case 200:
      return { kind: "signed-in" };
    case 401:
      return { kind: "invalid-credentials" };
    case 429:
      return { kind: "rate-limited" };
    case 400:
      return { kind: "invalid-request" };
    default:
      return { kind: "refused", status: response.status };
  }
}

/**
 * `GET /api/admin/v1/me`. Only `401` means "no valid session"; a network,
 * CORS, configuration or server failure is an error, never mistaken for a
 * signed-out state, and a `200` the UI cannot read is an error too.
 */
export async function fetchStaffSession(signal?: AbortSignal): Promise<StaffSessionResult> {
  const target = endpoint("/api/admin/v1/me");
  if (!target.ok) return { kind: "error", message: target.message };
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    return { kind: "error", message: "Could not reach the Admin API to check your Staff session." };
  }

  if (response.status === 401) return { kind: "unauthenticated" };
  if (response.status !== 200) {
    return { kind: "error", message: `The Admin API could not check your Staff session (HTTP ${response.status}).` };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { kind: "error", message: "The Admin API returned an unreadable Staff session." };
  }

  const session = parseStaffSession(data);
  return session
    ? { kind: "authenticated", session }
    : { kind: "error", message: "The Admin API returned a Staff session this page cannot read, so access stays closed." };
}

/**
 * `POST /api/admin/v1/auth/logout`. `204` is a confirmed logout and `401` means
 * the session had already ended; anything else — a network failure, a `403`
 * Origin refusal — leaves it unconfirmed, and is reported as such.
 */
export async function staffLogout(): Promise<StaffLogoutOutcome> {
  const target = endpoint("/api/admin/v1/auth/logout");
  if (!target.ok) return { kind: "unconfirmed", message: target.message };
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return { kind: "unconfirmed", message: "Could not reach the Admin API, so sign-out was not confirmed." };
  }

  if (response.status === 204) return { kind: "logged-out" };
  if (response.status === 401) return { kind: "session-ended" };
  return {
    kind: "unconfirmed",
    message: `The Admin API did not confirm sign-out (HTTP ${response.status}). Your session may still be active.`,
  };
}
