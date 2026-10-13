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

export interface CustomerSessionController {
  getState: () => CustomerSessionState;
  subscribe: (listener: () => void) => () => void;
  /** Reads the session again; supersedes any read still in flight. A no-op while stopped. */
  refresh: () => void;
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

  function refresh(): void {
    if (!active) return;
    abortPending();
    const thisRead = ++readId;
    const controller = new AbortController();
    pending = controller;

    if (state !== LOADING_SESSION) publish(LOADING_SESSION);
    deps.invalidateCsrf();

    const isCurrent = () => active && thisRead === readId && !controller.signal.aborted;

    deps
      .readSession({ signal: controller.signal })
      .then((customer) => {
        if (isCurrent()) publish({ status: "authenticated", customer });
      })
      .catch((error: unknown) => {
        if (!isCurrent() || isRequestCancelledError(error)) return;
        publish(
          error instanceof ApiHttpError && error.status === 401
            ? { status: "anonymous", customer: null }
            : { status: "unknown", customer: null }
        );
      })
      .finally(() => {
        if (thisRead === readId) pending = null;
      });
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
