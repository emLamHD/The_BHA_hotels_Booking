import type { CustomerIdentity } from "@/lib/api/authService";
import { ApiHttpError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";

/**
 * What the app knows about the Customer session, read from `GET /api/v1/auth/me` and nowhere else.
 *  - loading: a read is in flight; no identity is published meanwhile.
 *  - anonymous: the API answered 401 — there is no valid session.
 *  - authenticated: the API answered 200 with a well-formed identity.
 *  - unknown: the read failed (network, config, 5xx, 403, malformed response). Not "anonymous", and an
 *    earlier identity is not kept: nothing is known.
 */
export type CustomerSessionState =
  | { status: "loading"; customer: null }
  | { status: "anonymous"; customer: null }
  | { status: "authenticated"; customer: CustomerIdentity }
  | { status: "unknown"; customer: null };

export const LOADING_SESSION: CustomerSessionState = { status: "loading", customer: null };

/**
 * How a read ended. `superseded` means this read did not publish (a newer read, an identity change or
 * `stop` took over, or the request was cancelled): it says nothing about the session.
 */
export type SessionReadOutcome = "authenticated" | "anonymous" | "unknown" | "superseded";

export interface CustomerSessionController {
  getState: () => CustomerSessionState;
  subscribe: (listener: () => void) => () => void;
  /** Reads the session again; supersedes any read still in flight. A no-op while stopped. */
  refresh: () => void;
  /** The same read as `refresh`, resolving with how it ended once it has published (or not). */
  read: () => Promise<SessionReadOutcome>;
  /**
   * CUST-WEB-001-CP01b: an identity operation is starting. Supersedes (aborts) any read in flight so an
   * older answer can never publish, and clears the public identity (state becomes loading) without
   * reading. Returns false, doing nothing, while stopped.
   */
  beginIdentityChange: () => boolean;
  /** Starts the controller (first read). Call again after `stop` to resume, as React StrictMode does. */
  start: () => void;
  /** Stops it: aborts the pending read and guarantees nothing more is published. */
  stop: () => void;
}

export interface CustomerSessionControllerDeps {
  readSession: (options: { signal: AbortSignal }) => Promise<CustomerIdentity>;
  /** Drops the cached CSRF token; it is read lazily, no request is made. */
  invalidateCsrf: () => void;
}

/**
 * React-free state logic behind CustomerSessionProvider. Per instance, never module-scoped. Only the
 * most recent read may publish: a refresh supersedes the one before it, and a late success, failure or
 * settlement of an older read cannot change the state. This reads only; it has no login, register or
 * logout and starts none.
 */
export function createCustomerSessionController(deps: CustomerSessionControllerDeps): CustomerSessionController {
  let state: CustomerSessionState = LOADING_SESSION;
  let active = false;
  let readId = 0;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();

  function publish(next: CustomerSessionState): void {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function abortPending(): void {
    pending?.abort();
    pending = null;
  }

  function startRead(): Promise<SessionReadOutcome> {
    if (!active) return Promise.resolve("superseded");
    abortPending();
    const thisRead = ++readId;
    const controller = new AbortController();
    pending = controller;

    if (state !== LOADING_SESSION) publish(LOADING_SESSION);
    deps.invalidateCsrf();

    const isCurrent = () => active && thisRead === readId && !controller.signal.aborted;

    return deps
      .readSession({ signal: controller.signal })
      .then(
        (customer): SessionReadOutcome => {
          if (!isCurrent()) return "superseded";
          publish({ status: "authenticated", customer });
          return "authenticated";
        },
        (error: unknown): SessionReadOutcome => {
          if (!isCurrent() || isRequestCancelledError(error)) return "superseded";
          if (error instanceof ApiHttpError && error.status === 401) {
            publish({ status: "anonymous", customer: null });
            return "anonymous";
          }
          publish({ status: "unknown", customer: null });
          return "unknown";
        }
      )
      .finally(() => {
        if (thisRead === readId) pending = null;
      });
  }

  function refresh(): void {
    void startRead();
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    read: startRead,
    beginIdentityChange: () => {
      if (!active) return false;
      abortPending();
      readId += 1;
      if (state !== LOADING_SESSION) publish(LOADING_SESSION);
      return true;
    },
    start: () => {
      if (active) return;
      active = true;
      refresh();
    },
    stop: () => {
      active = false;
      readId += 1;
      abortPending();
    },
  };
}
