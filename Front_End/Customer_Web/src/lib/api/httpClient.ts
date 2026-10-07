import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { getApiBaseUrl } from "./env";
import {
  ApiConfigError,
  ApiHttpError,
  ApiNetworkError,
  ApiValidationError,
  ProblemDetails,
  ValidationProblemDetails,
} from "./errors";

let client: AxiosInstance | undefined;

function getClient(): AxiosInstance {
  if (client) {
    return client;
  }

  let baseURL: string;
  try {
    baseURL = getApiBaseUrl();
  } catch (error) {
    throw new ApiConfigError(
      error instanceof Error ? error.message : "Invalid API configuration."
    );
  }

  client = axios.create({
    baseURL,
    withCredentials: true,
  });

  return client;
}

/** Test-only: forces the next call to rebuild the Axios instance from the current env. */
export function resetApiClientForTests(): void {
  client = undefined;
}

/**
 * Merges caller-supplied headers, collapsing case-only duplicates so the
 * later entry for a given header name wins regardless of casing. Exported
 * so other unsafe-request callers (e.g. the CSRF helper) can apply the same
 * no-duplicate-header guarantee before their own headers reach this module.
 */
export function mergeHeaders(
  overrides?: Record<string, string>
): Record<string, string> | undefined {
  if (!overrides) {
    return undefined;
  }

  const merged: Record<string, string> = {};
  const nameByLowerCase = new Map<string, string>();

  for (const [name, value] of Object.entries(overrides)) {
    const lowerName = name.toLowerCase();
    const existingName = nameByLowerCase.get(lowerName);
    if (existingName !== undefined) {
      delete merged[existingName];
    }
    merged[name] = value;
    nameByLowerCase.set(lowerName, name);
  }

  return merged;
}

function isProblemDetailsLike(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

function toProblemDetails(status: number, data: unknown): ProblemDetails {
  if (
    isProblemDetailsLike(data) &&
    (typeof data.title === "string" || typeof data.detail === "string")
  ) {
    return {
      type: typeof data.type === "string" ? data.type : undefined,
      title: typeof data.title === "string" ? data.title : "Request failed",
      status: typeof data.status === "number" ? data.status : status,
      detail: typeof data.detail === "string" ? data.detail : undefined,
      instance: typeof data.instance === "string" ? data.instance : undefined,
    };
  }

  return {
    title: "Request failed",
    status,
    detail: "The server returned an unexpected error response.",
  };
}

function toValidationProblemDetails(
  status: number,
  data: unknown
): ValidationProblemDetails | undefined {
  if (
    isProblemDetailsLike(data) &&
    typeof data.errors === "object" &&
    data.errors !== null
  ) {
    return {
      ...toProblemDetails(status, data),
      errors: data.errors as Record<string, string[]>,
    };
  }

  return undefined;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
}

/** True when the error represents a request that was intentionally aborted (stale/superseded). */
export function isRequestCancelledError(error: unknown): boolean {
  return axios.isCancel(error);
}

/** Normalizes an Axios failure into the shared error model; rethrows cancellation unchanged. */
function normalizeRequestError(error: unknown): never {
  if (axios.isCancel(error)) {
    throw error;
  }

  if (axios.isAxiosError(error)) {
    if (error.response) {
      const status = error.response.status;
      const validationProblem = toValidationProblemDetails(status, error.response.data);
      if (validationProblem) {
        throw new ApiValidationError(status, validationProblem);
      }
      throw new ApiHttpError(status, toProblemDetails(status, error.response.data));
    }

    throw new ApiNetworkError();
  }

  throw error;
}

async function apiRequest<T>(
  path: string,
  method: AxiosRequestConfig["method"],
  options: ApiRequestOptions = {}
): Promise<T | undefined> {
  const instance = getClient();

  try {
    const response = await instance.request<T>({
      url: path,
      method,
      withCredentials: true,
      headers: mergeHeaders(options.headers),
      params: options.params,
      signal: options.signal,
    });

    if (response.status === 204) {
      return undefined;
    }

    return response.data;
  } catch (error) {
    normalizeRequestError(error);
  }
}

export function apiGet<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T | undefined> {
  return apiRequest<T>(path, "GET", options);
}

export interface ApiUnsafeResponse<T> {
  data: T | undefined;
  status: number;
}

/**
 * Generic unsafe (mutating) JSON request path shared by every future unsafe
 * caller. Contains no endpoint-specific (Hold, CSRF) logic: callers own
 * their own headers (e.g. Idempotency-Key, X-CSRF-TOKEN) and are responsible
 * for any retry policy. `status` is exposed so a caller can distinguish
 * `201 Created` from `200 OK` without inferring it from the response body.
 */
export async function apiUnsafeRequest<T>(
  path: string,
  method: Exclude<AxiosRequestConfig["method"], "GET" | "HEAD">,
  body: unknown,
  options: ApiRequestOptions = {}
): Promise<ApiUnsafeResponse<T>> {
  const instance = getClient();
  const hasBody = body !== undefined;
  const headers = mergeHeaders(
    hasBody ? { "Content-Type": "application/json", ...options.headers } : options.headers
  );

  try {
    const response = await instance.request<T>({
      url: path,
      method,
      withCredentials: true,
      headers,
      data: hasBody ? body : undefined,
      params: options.params,
      signal: options.signal,
    });

    return {
      data: response.status === 204 ? undefined : response.data,
      status: response.status,
    };
  } catch (error) {
    normalizeRequestError(error);
  }
}
