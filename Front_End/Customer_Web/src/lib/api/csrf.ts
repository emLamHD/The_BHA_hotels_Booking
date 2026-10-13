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
 * The token of the generation that is current when it is returned. A caller that waited on an
 * acquisition which an invalidation overtook (it resolves or fails) takes the current generation's
 * token instead, so no mutation ever goes out with an old one. This is a token read (GET), never a
 * mutation retry.
 */
async function acquireCurrentCsrfToken(): Promise<CsrfMemory> {
  for (;;) {
    const requestedIn = generation;
    try {
      const memory = await acquireCsrfToken();
      if (requestedIn === generation) {
        return memory;
      }
    } catch (error) {
      if (requestedIn === generation) {
        throw error;
      }
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
  const csrf = await acquireCurrentCsrfToken();
  const headers = mergeHeaders({ ...options.headers, [csrf.headerName]: csrf.token });

  try {
    return await apiUnsafeRequest<T>(path, method, body, { ...options, headers });
  } catch (error) {
    if (!isAntiforgeryFailure(error)) {
      throw error;
    }

    invalidateCsrfToken();
    const refreshed = await acquireCurrentCsrfToken();
    const retryHeaders = mergeHeaders({
      ...options.headers,
      [refreshed.headerName]: refreshed.token,
    });
    return apiUnsafeRequest<T>(path, method, body, { ...options, headers: retryHeaders });
  }
}
