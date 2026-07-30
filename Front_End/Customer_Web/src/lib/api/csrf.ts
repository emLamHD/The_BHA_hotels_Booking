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

let cachedToken: CsrfMemory | undefined;
let inFlightAcquisition: Promise<CsrfMemory> | undefined;

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

async function acquireCsrfToken(): Promise<CsrfMemory> {
  if (cachedToken) {
    return cachedToken;
  }

  if (!inFlightAcquisition) {
    inFlightAcquisition = (async () => {
      const data = await apiGet<CsrfTokenResponse>(CSRF_PATH);
      if (!data || !isUsableString(data.token) || !isUsableString(data.headerName)) {
        throw new Error("The CSRF token response was malformed.");
      }

      const memory: CsrfMemory = { token: data.token, headerName: data.headerName };
      cachedToken = memory;
      return memory;
    })().finally(() => {
      inFlightAcquisition = undefined;
    });
  }

  return inFlightAcquisition;
}

/** Narrow memory invalidation hook, e.g. for a future login/logout transition. */
export function invalidateCsrfToken(): void {
  cachedToken = undefined;
}

/** Test-only: clears cached/in-flight CSRF state so tests start isolated. */
export function resetCsrfStateForTests(): void {
  cachedToken = undefined;
  inFlightAcquisition = undefined;
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
  const csrf = await acquireCsrfToken();
  const headers = mergeHeaders({ ...options.headers, [csrf.headerName]: csrf.token });

  try {
    return await apiUnsafeRequest<T>(path, method, body, { ...options, headers });
  } catch (error) {
    if (!isAntiforgeryFailure(error)) {
      throw error;
    }

    invalidateCsrfToken();
    const refreshed = await acquireCsrfToken();
    const retryHeaders = mergeHeaders({
      ...options.headers,
      [refreshed.headerName]: refreshed.token,
    });
    return apiUnsafeRequest<T>(path, method, body, { ...options, headers: retryHeaders });
  }
}
