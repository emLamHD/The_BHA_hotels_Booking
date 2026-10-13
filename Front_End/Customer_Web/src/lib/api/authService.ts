import { apiGet, apiUnsafeRequest } from "./httpClient";
import { invalidateCsrfToken, submitCsrfProtectedRequest } from "./csrf";

const AUTH_PATH = "/api/v1/auth";

/** The Customer account of the session, exactly as the API reports it (CustomerSessionResponse). */
export interface CustomerIdentity {
  customerAccountId: string;
  email: string;
}

export interface CustomerCredentials {
  email: string;
  password: string;
}

export interface AuthRequestOptions {
  signal?: AbortSignal;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** A response that is not the documented shape. Never carries the response, a password or a token. */
export class AuthContractError extends Error {
  constructor() {
    super("The server returned an unexpected authentication response.");
    this.name = "AuthContractError";
  }
}

/**
 * Only a well-formed identity counts. Anything else (missing body, empty id, empty email, other types)
 * is a contract failure, never an authenticated or registered customer.
 */
function toIdentity(data: unknown): CustomerIdentity {
  if (typeof data === "object" && data !== null) {
    const { customerAccountId, email } = data as Record<string, unknown>;
    if (
      typeof customerAccountId === "string" &&
      GUID.test(customerAccountId) &&
      customerAccountId !== EMPTY_GUID &&
      typeof email === "string" &&
      email.trim().length > 0
    ) {
      return { customerAccountId, email };
    }
  }
  throw new AuthContractError();
}

/**
 * GET /api/v1/auth/me — the one authority for "who is the customer": 200 with an identity, or an
 * `ApiHttpError` 401 when the request carries no valid Customer session. Read-only.
 */
export async function getCustomerSession(options: AuthRequestOptions = {}): Promise<CustomerIdentity> {
  const data = await apiGet<unknown>(`${AUTH_PATH}/me`, { signal: options.signal });
  return toIdentity(data);
}

/**
 * POST /api/v1/auth/register — creates an account and nothing else: `201` does NOT sign the customer in
 * (no session cookie is issued), so the returned identity is a registration receipt, not a session. The
 * endpoint is exempt from CSRF; the body is exactly email and password, passed through untouched.
 * No retry, no automatic login, no `me`.
 */
export async function registerCustomer(
  credentials: CustomerCredentials,
  options: AuthRequestOptions = {}
): Promise<CustomerIdentity> {
  const response = await apiUnsafeRequest<unknown>(
    `${AUTH_PATH}/register`,
    "POST",
    { email: credentials.email, password: credentials.password },
    { signal: options.signal }
  );
  if (response.status !== 201) {
    throw new AuthContractError();
  }
  return toIdentity(response.data);
}

/**
 * POST /api/v1/auth/login — `200` with the identity and, server-side, a new session cookie. Exempt from
 * CSRF, not idempotent: no retry of network failures, 401 or 429. Whatever the outcome, the cached CSRF
 * token is dropped afterwards, because a lost response may still have changed the session. The caller
 * confirms the session with `getCustomerSession`; this function never touches provider state.
 */
export async function loginCustomer(
  credentials: CustomerCredentials,
  options: AuthRequestOptions = {}
): Promise<CustomerIdentity> {
  try {
    const response = await apiUnsafeRequest<unknown>(
      `${AUTH_PATH}/login`,
      "POST",
      { email: credentials.email, password: credentials.password },
      { signal: options.signal }
    );
    if (response.status !== 200) {
      throw new AuthContractError();
    }
    return toIdentity(response.data);
  } finally {
    invalidateCsrfToken();
  }
}

/**
 * POST /api/v1/auth/logout — `204`. Needs a CSRF token (sent by the shared helper, which alone may retry
 * once, for the exact antiforgery refusal). A `401` is an error for the caller: it means no valid
 * session was presented and it is not evidence that any cookie was cleared. The cached CSRF token is
 * dropped afterwards whatever the outcome.
 */
export async function logoutCustomer(options: AuthRequestOptions = {}): Promise<void> {
  try {
    const response = await submitCsrfProtectedRequest<unknown>(`${AUTH_PATH}/logout`, "POST", undefined, {
      signal: options.signal,
    });
    if (response.status !== 204) {
      throw new AuthContractError();
    }
  } finally {
    invalidateCsrfToken();
  }
}
