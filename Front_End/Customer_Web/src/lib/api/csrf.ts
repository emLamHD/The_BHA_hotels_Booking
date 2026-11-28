import {
  apiGet,
  apiUnsafeRequest,
  ApiRequestOptions,
  ApiUnsafeResponse,
  mergeHeaders,
} from "./httpClient";
import { ApiHttpError } from "./errors";
import { CsrfTokenResponse } from "./bookingHoldTypes";

const CSRF_PATH = "/api/v1/auth/csrf";

/**
 * The exact, stable CT-CONTRACT-002 antiforgery-failure Problem Details.
 * Matched by status/title/detail only — never by endpoint or request shape —
 * so an ordinary business-validation 400 is never mistaken for it.
 */
const ANTIFORGERY_TITLE = "Invalid antiforgery token";
const ANTIFORGERY_DETAIL = "A valid antiforgery token is required for this operation.";

interface CsrfMemory {
  token: string;
  headerName: string;
}

interface CsrfAcquisition {
  generation: number;
  promise: Promise<CsrfMemory>;
}

/**
 * Bumped by every invalidation. A token (cached or still being acquired) belongs to the generation it
 * was requested in: the server ties the antiforgery token to the identity of the session, so after the
 * session may have changed nothing from an earlier generation is cached, shared or sent.
 */
let generation = 0;
let cachedToken: CsrfMemory | undefined;
let inFlightAcquisition: CsrfAcquisition | undefined;

function isUsableString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAntiforgeryFailure(error: unknown): boolean {
  return (
    error instanceof ApiHttpError &&
    error.status === 400 &&
    error.problem.title === ANTIFORGERY_TITLE &&
    error.problem.detail === ANTIFORGERY_DETAIL
  );
}

function acquireCsrfToken(): Promise<CsrfMemory> {
  if (cachedToken) {
    return Promise.resolve(cachedToken);
  }

  if (!inFlightAcquisition || inFlightAcquisition.generation !== generation) {
    const startedIn = generation;
    const acquisition: CsrfAcquisition = {
      generation: startedIn,
      promise: (async () => {
        const data = await apiGet<CsrfTokenResponse>(CSRF_PATH);
        if (!data || !isUsableString(data.token) || !isUsableString(data.headerName)) {
          throw new Error("The CSRF token response was malformed.");
        }

        const memory: CsrfMemory = { token: data.token, headerName: data.headerName };
        // A token requested before an invalidation is returned to nobody as current and never cached.
        if (startedIn === generation) {
          cachedToken = memory;
        }
        return memory;
      })().finally(() => {
        // Only the acquisition that is still the current one is cleared; a late older one must not
        // remove a newer acquisition that other callers are sharing.
        if (inFlightAcquisition === acquisition) {
          inFlightAcquisition = undefined;
        }
      }),
    };
    inFlightAcquisition = acquisition;
  }

  return inFlightAcquisition.promise;
}

/**
 * Hands one mutation to the transport with a token of the generation that is current at that very
 * moment. `send` is called in the same synchronous continuation as the generation check, so no
 * invalidation can land between the check and the call. A caller that waited on an acquisition which an
 * invalidation overtook (it resolves, fails, or the invalidation lands while this continuation was
 * queued) reads the current generation's token instead; that is a token read (GET), never a mutation
 * retry. The outcome of `send` is returned as a value so that acquisition failures (thrown) stay
 * distinct from transport failures (returned). Nothing already handed to the transport is undone or
 * resent when the generation changes afterwards.
 */
async function dispatchWithCurrentToken<T>(
  send: (csrf: CsrfMemory) => Promise<T>,
  stillCurrent?: () => boolean,
  onHandedOver?: () => void
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  for (;;) {
    const requestedIn = generation;
    let memory: CsrfMemory;
    try {
      memory = await acquireCsrfToken();
    } catch (error) {
      if (requestedIn === generation) {
        throw error;
      }
      continue;
    }
    if (requestedIn === generation) {
      // The initiating view is asked in this same synchronous continuation, right before the hand-over: if it is gone, nothing is sent.
      if (stillCurrent && !stillCurrent()) {
        throw new RequestSupersededError();
      }
      onHandedOver?.(); // PR09-C13: the one place a request becomes "handed to the transport", marked in the same synchronous continuation as the guard above
      return send(memory).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
    }
  }
}

/** Narrow memory invalidation hook, e.g. for a login/logout transition. Requests no token itself. */
export function invalidateCsrfToken(): void {
  generation += 1;
  cachedToken = undefined;
  inFlightAcquisition = undefined;
}

/** Test-only: clears cached/in-flight CSRF state so tests start isolated. */
export function resetCsrfStateForTests(): void {
  invalidateCsrfToken();
}

/** The CSRF token could not be read, so the mutation was never handed to the transport: nothing was sent. */
export class CsrfTokenUnavailableError extends Error {
  constructor() {
    super("The CSRF token could not be read; nothing was sent.");
    this.name = "CsrfTokenUnavailableError";
  }
}

/** The view that started the mutation changed (another account or reservation, or the page was left) before it was handed to the transport: nothing was sent. */
export class RequestSupersededError extends Error {
  constructor() {
    super("The view that started this request is gone; nothing was sent.");
    this.name = "RequestSupersededError";
  }
}

/**
 * BHA-CHECKOUT-001-PR09: the same CSRF-protected mutation, handed to the transport exactly ONCE. Nothing is ever replayed, not even
 * after the exact antiforgery failure (for a one-shot link exchange or an arrival update the caller alone decides about a resend).
 * A failure to read the token throws {@link CsrfTokenUnavailableError} (nothing was sent); on the exact antiforgery failure the cached
 * token is dropped so the caller's next, deliberate attempt reads a fresh one. Every other error is the transport's own.
 * `stillCurrent` (optional) is asked synchronously right before the hand-over, once the current generation's token is in hand: when it says the initiating view
 * is gone, nothing is sent and {@link RequestSupersededError} is thrown, distinct from a token failure ({@link CsrfTokenUnavailableError}) and from a request that was handed over.
 * `onHandedOver` (optional, PR09-C13) is called synchronously right after that check passed and right before the transport gets the request: from then on the request cannot be recalled,
 * before it the caller may still invalidate it. It is never called for a request that is not sent.
 */
export async function submitCsrfProtectedRequestOnce<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  options: ApiRequestOptions = {},
  stillCurrent?: () => boolean,
  onHandedOver?: () => void
): Promise<ApiUnsafeResponse<T>> {
  let outcome: Awaited<ReturnType<typeof dispatchWithCurrentToken<ApiUnsafeResponse<T>>>>;
  try {
    outcome = await dispatchWithCurrentToken((csrf) => sendWithToken<T>(path, method, body, options, csrf), stillCurrent, onHandedOver);
  } catch (error) {
    throw error instanceof RequestSupersededError ? error : new CsrfTokenUnavailableError();
  }
  if (outcome.ok) {
    return outcome.value;
  }
  if (isAntiforgeryFailure(outcome.error)) {
    invalidateCsrfToken();
  }
  throw outcome.error;
}

function sendWithToken<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  options: ApiRequestOptions,
  csrf: CsrfMemory
): Promise<ApiUnsafeResponse<T>> {
  return apiUnsafeRequest<T>(path, method, body, {
    ...options,
    headers: mergeHeaders({ ...options.headers, [csrf.headerName]: csrf.token }),
  });
}

/**
 * Submits an unsafe JSON request with a lazily-acquired, memory-only CSRF
 * header. The acquired header always overrides a conflicting caller-supplied
 * case variant (no duplicate CSRF headers are ever sent). Retries the exact
 * same body/headers/signal exactly once, and only for the exact
 * CT-CONTRACT-002 antiforgery Problem Details.
 */
export async function submitCsrfProtectedRequest<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  options: ApiRequestOptions = {}
): Promise<ApiUnsafeResponse<T>> {
  const send = (csrf: CsrfMemory) => sendWithToken<T>(path, method, body, options, csrf);

  const first = await dispatchWithCurrentToken(send);
  if (first.ok) {
    return first.value;
  }
  if (!isAntiforgeryFailure(first.error)) {
    throw first.error;
  }

  invalidateCsrfToken();
  const retry = await dispatchWithCurrentToken(send);
  if (retry.ok) {
    return retry.value;
  }
  throw retry.error;
}
