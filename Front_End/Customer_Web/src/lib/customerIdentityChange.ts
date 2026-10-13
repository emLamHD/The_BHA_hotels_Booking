import type { CustomerCredentials } from "@/lib/api/authService";
import type { BookingIdentityGuard, IdentityChangeBlockReason } from "@/lib/api/bookingHoldFlowController";
import { ApiHttpError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import type { SessionReadOutcome } from "@/lib/customerSession";

/**
 * CUST-WEB-001-CP01b. The one place where a Customer identity change (login/logout) is serialized with the
 * booking lifecycle and with the session reader. Per provider instance, no module state, synchronous:
 * React renders are presentation, never authority. It guarantees only what one tab's app commands can: it
 * cannot stop a cookie expiring, a direct call to the API, or another tab or device.
 *
 * Lifetime of the lock (`phase !== "idle"`): claimed synchronously before any await, held across the auth
 * request, and kept through the canonical `me` read that follows it. Only a valid `me` answer (200 or 401)
 * of the current operation releases it; a failed read leaves it held (`recovery-unresolved`) until
 * `requestRefresh` reads again.
 */

export type IdentityChangePhase = "idle" | "transport" | "recovering" | "recovery-unresolved";

export interface IdentityChangeState {
  phase: IdentityChangePhase;
}

/** Why a command was refused. A refused command has no effect: no request, no state change. */
export type IdentityCommandBlockReason =
  | IdentityChangeBlockReason
  | "session-inactive"
  | "booking-unbound"
  | "identity-change-in-progress";

/** What the auth request itself did. Distinct from, and never a substitute for, the verified session. */
export type AuthTransportOutcome = "succeeded" | "refused" | "lost";

export type IdentityCommandResult =
  | { status: "blocked"; reason: IdentityCommandBlockReason }
  /** The auth request settled and `me` then answered 200/401 for this operation: the lock is released. */
  | {
      status: "settled";
      transport: AuthTransportOutcome;
      session: "authenticated" | "anonymous";
      transportError?: unknown;
    }
  /** The `me` read failed. The lock is still held; `requestRefresh` retries the read (nothing else is resent). */
  | { status: "recovery-unresolved"; transport: AuthTransportOutcome; transportError?: unknown }
  /** The session layer stopped while the command ran; nothing was published and no rollback is implied. */
  | { status: "aborted" };

export interface IdentitySessionPort {
  /** Supersedes reads in flight and clears the public identity; false while the session layer is stopped. */
  beginIdentityChange: () => boolean;
  /** One read of `GET /auth/me`, resolving with how it ended. */
  read: () => Promise<SessionReadOutcome>;
  /** An ordinary, fire-and-forget read. */
  refresh: () => void;
}

export interface CustomerIdentityCoordinatorDeps {
  session: IdentitySessionPort;
  login: (credentials: CustomerCredentials, options: { signal: AbortSignal }) => Promise<unknown>;
  logout: (options: { signal: AbortSignal }) => Promise<unknown>;
}

export interface CustomerIdentityCoordinator {
  getState: () => IdentityChangeState;
  subscribe: (listener: () => void) => () => void;
  /** True from the moment a command is accepted until `me` is verified. Read by the booking mutations. */
  isIdentityChangeLocked: () => boolean;
  /**
   * Registers the booking side. The returned function unbinds only that registration, so a stale or late
   * cleanup (StrictMode, unmount) never removes a newer binding. Without a binding, commands are refused.
   */
  bindBooking: (guard: BookingIdentityGuard) => () => void;
  login: (credentials: CustomerCredentials) => Promise<IdentityCommandResult>;
  logout: () => Promise<IdentityCommandResult>;
  /**
   * The read-only retry/refresh. Idle: an ordinary read. While the auth request or the recovery read is in
   * flight: coalesced into it (nothing is read early, nothing is superseded). After a failed recovery read:
   * reads again, still holding the lock until `me` answers.
   */
  requestRefresh: () => void;
  /** The session layer is running. Deactivating aborts the auth request and discards late completions. */
  activate: () => void;
  deactivate: () => void;
}

function transportOutcomeOf(error: unknown): AuthTransportOutcome {
  // A definite HTTP refusal (401, 429, 400…) is "refused". Anything else (lost response, malformed
  // success, configuration) may or may not have changed the server session: only `me` can tell.
  return error instanceof ApiHttpError ? "refused" : "lost";
}

export function createCustomerIdentityCoordinator(deps: CustomerIdentityCoordinatorDeps): CustomerIdentityCoordinator {
  const { session } = deps;
  let state: IdentityChangeState = { phase: "idle" };
  let active = false;
  let operation = 0;
  let transportAbort: AbortController | null = null;
  // One object per registration, so a stale cleanup of an earlier registration (even of the very same guard)
  // can never remove a later one.
  let booking: { guard: BookingIdentityGuard } | null = null;
  const listeners = new Set<() => void>();

  function setPhase(phase: IdentityChangePhase): void {
    if (state.phase === phase) return;
    state = { phase };
    listeners.forEach((listener) => listener());
  }

  const isCurrent = (op: number) => active && op === operation;

  /** Claims the lock synchronously, or says why not. The booking check and the lock are one atomic step. */
  function claim(): IdentityCommandBlockReason | null {
    if (!active) return "session-inactive";
    if (!booking) return "booking-unbound";
    if (state.phase !== "idle") return "identity-change-in-progress";
    const blocked = booking.guard.identityChangeBlockReason();
    if (blocked) return blocked;
    if (!session.beginIdentityChange()) return "session-inactive";
    setPhase("transport");
    // Discards the draft (offer, contact, errors, attempt) before any request leaves, so no PII of the
    // previous identity can reach the next one. The booking side is locked from here on.
    booking.guard.scrubForIdentityChange();
    return null;
  }

  /** The canonical read; `me` 200/401 of this operation releases the lock, anything else keeps it. */
  async function recover(op: number): Promise<"verified-authenticated" | "verified-anonymous" | "unresolved" | "stale"> {
    setPhase("recovering");
    const outcome = await session.read();
    if (!isCurrent(op)) return "stale";
    if (outcome === "authenticated") {
      setPhase("idle");
      return "verified-authenticated";
    }
    if (outcome === "anonymous") {
      setPhase("idle");
      return "verified-anonymous";
    }
    setPhase("recovery-unresolved");
    return "unresolved";
  }

  async function run(send: (signal: AbortSignal) => Promise<unknown>): Promise<IdentityCommandResult> {
    const refusal = claim();
    if (refusal) return { status: "blocked", reason: refusal };

    const op = ++operation;
    const abort = new AbortController();
    transportAbort = abort;

    let transport: AuthTransportOutcome = "succeeded";
    let transportError: unknown;
    try {
      await send(abort.signal);
    } catch (error) {
      if (isRequestCancelledError(error) && !isCurrent(op)) return { status: "aborted" };
      transport = transportOutcomeOf(error);
      transportError = error;
    }
    if (!isCurrent(op)) return { status: "aborted" };
    if (transportAbort === abort) transportAbort = null;

    const verdict = await recover(op);
    if (verdict === "stale") return { status: "aborted" };
    if (verdict === "unresolved") return { status: "recovery-unresolved", transport, transportError };
    return {
      status: "settled",
      transport,
      session: verdict === "verified-authenticated" ? "authenticated" : "anonymous",
      transportError,
    };
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isIdentityChangeLocked: () => state.phase !== "idle",
    bindBooking: (guard) => {
      const registration = { guard };
      booking = registration;
      return () => {
        if (booking === registration) booking = null;
      };
    },
    login: (credentials) => run((signal) => deps.login(credentials, { signal })),
    logout: () => run((signal) => deps.logout({ signal })),
    requestRefresh: () => {
      if (!active) return;
      switch (state.phase) {
        case "idle":
          session.refresh();
          return;
        case "recovery-unresolved": {
          const op = ++operation;
          void recover(op);
          return;
        }
        default:
          // "transport" / "recovering": the read that follows the request serves this refresh.
          return;
      }
    },
    activate: () => {
      active = true;
    },
    deactivate: () => {
      active = false;
      operation += 1;
      transportAbort?.abort();
      transportAbort = null;
      setPhase("idle");
    },
  };
}
