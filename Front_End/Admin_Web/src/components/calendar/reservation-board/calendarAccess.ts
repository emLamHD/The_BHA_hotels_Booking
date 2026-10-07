/**
 * PMS-ADMIN-AUTH-001-CP06: what the board offers at one Property, and how it
 * talks to the Staff session.
 *
 * The map mirrors the API's fixed roles (design §4): FrontDesk reads the board,
 * writes assignments and blocks; Manager also confirms a cross-RoomType
 * placement. An unknown role, no membership, or an ended session offers
 * nothing. This only shapes the UI — every request is still authorized by the
 * server, which stays the authority.
 */

import type { StaffMembership } from "@/lib/api/staff";
import type { StaffRefreshResult } from "@/components/auth/StaffSession";

export interface CalendarCapabilities {
  boardRead: boolean;
  assignmentWrite: boolean;
  blockWrite: boolean;
  crossRoomType: boolean;
}

export const NO_CAPABILITIES: CalendarCapabilities = {
  boardRead: false,
  assignmentWrite: false,
  blockWrite: false,
  crossRoomType: false,
};

/** LocalGate: everything the board offered before CP06; the local write gate decides. */
export const LOCAL_GATE_CAPABILITIES: CalendarCapabilities = {
  boardRead: true,
  assignmentWrite: true,
  blockWrite: true,
  crossRoomType: true,
};

export function capabilitiesForRole(role: string | undefined): CalendarCapabilities {
  switch (role) {
    case "FrontDesk":
      return { boardRead: true, assignmentWrite: true, blockWrite: true, crossRoomType: false };
    case "Manager":
      return { boardRead: true, assignmentWrite: true, blockWrite: true, crossRoomType: true };
    default:
      return NO_CAPABILITIES;
  }
}

export type BoardAccess =
  | { mode: "LocalGate" }
  | {
      mode: "Staff";
      /** From `GET /me`; the only source of Properties in this mode. */
      memberships: StaffMembership[];
      /** The session is no longer valid. Called only once no write of this board is on the wire. */
      onSessionExpired: () => void;
      /** Re-reads `me` after a 403, so roles and memberships reflect the server's. */
      refreshAccess: () => Promise<StaffRefreshResult>;
      /**
       * CP06-C3: that re-read could not check access. Called only once no write of
       * this board is on the wire; the page then closes access with Retry.
       */
      onAccessCheckFailed?: () => void;
      /**
       * A write of this board is (or is no longer) waiting for the server. Called
       * synchronously as the write goes on the wire and when its answer is in, so
       * Sign out can never start in between (CP06-C1).
       */
      onWriteActivityChange?: (writing: boolean) => void;
      /** CP06-C1: a sign-out is waiting for the server — for rendering. */
      signingOut?: boolean;
      /** CP06-C1: the same, live — read by a handler at the moment it would send. */
      isSigningOut?: () => boolean;
    };

export const LOCAL_GATE_ACCESS: BoardAccess = { mode: "LocalGate" };

/**
 * `writesPaused` (CP06-C1): a sign-out is waiting for the server. The board stays
 * readable, but no write may start until the sign-out is answered.
 */
export function capabilitiesFor(
  access: BoardAccess,
  propertyId: string | null,
  sessionEnded = false,
  writesPaused = false
): CalendarCapabilities {
  if (access.mode === "LocalGate") return LOCAL_GATE_CAPABILITIES;
  if (sessionEnded || propertyId === null) return NO_CAPABILITIES;
  const capabilities = capabilitiesForRole(access.memberships.find((membership) => membership.propertyId === propertyId)?.role);
  return writesPaused ? { ...NO_CAPABILITIES, boardRead: capabilities.boardRead } : capabilities;
}

/** CP06-C3: why a write was not sent while access is being checked again after a refusal. */
export const ACCESS_CHECK_MESSAGE = "Checking your access again after a refusal — this change was not sent.";

/** CP06-C1: why a write was not sent while a sign-out was waiting for the server. */
export const SIGNING_OUT_MESSAGE = "Signing out — this change was not sent. If sign-out is not confirmed, try again.";

/** The toolbar's one-line statement of what this board can do here, per mode and role. */
export function describeBoardAccess(access: BoardAccess, propertyId: string | null): string {
  if (access.mode === "LocalGate") {
    return (
      "Live data. Unassigned nights can be assigned to an Active room, of the same sold room type or, with confirmation " +
      "and a reason, a different one. An assigned segment can be moved to another Active room the same way, or " +
      "unassigned. An Active room can be blocked for a range of nights with a reason, and a block can be cancelled. " +
      "Writes need the local Development write opt-in (AccessMode=LocalGate) — no Staff sign-in in this mode."
    );
  }
  const role = access.memberships.find((membership) => membership.propertyId === propertyId)?.role;
  const capabilities = capabilitiesForRole(role);
  if (!capabilities.boardRead) {
    return "Your role at this Property does not include access to the Reservation Board.";
  }
  const placement = capabilities.crossRoomType
    ? "of the same sold room type or, with confirmation and a reason, a different one"
    : "of the same sold room type (a different room type needs a Manager)";
  return (
    `Live data. Signed in as ${role} at this Property. Unassigned nights can be assigned to an Active room ${placement}; ` +
    "an assigned segment can be moved the same way, or unassigned. Rooms can be blocked and blocks cancelled. " +
    "The server checks your permission on every request."
  );
}
