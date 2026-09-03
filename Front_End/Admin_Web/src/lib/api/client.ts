/**
 * PMS-CAL-001.1: minimal typed Admin API boundary. Every call normalizes
 * configuration, network, and HTTP/ProblemDetails failures into one safe
 * `ApiResult` shape — callers never see a raw exception, a raw fetch
 * rejection, or a raw ProblemDetails payload.
 */

import { describeApiBaseUrlError, getApiBaseUrl } from "./env";
import type { ApiProperty, ReservationBoardResponse } from "./types";

export type ApiErrorKind = "config" | "network" | "http" | "aborted";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

interface ProblemDetailsShape {
  title?: string;
  detail?: string;
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  const baseUrlResult = getApiBaseUrl();
  if (!baseUrlResult.ok) {
    return { ok: false, error: { kind: "config", message: describeApiBaseUrlError(baseUrlResult.reason) } };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrlResult.baseUrl}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      return { ok: false, error: { kind: "aborted", message: "Request was cancelled." } };
    }
    return {
      ok: false,
      error: { kind: "network", message: "Could not reach the Admin API. Check your connection and try again." },
    };
  }

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const problem = (await response.json()) as ProblemDetailsShape;
      detail = problem.detail ?? problem.title;
    } catch {
      // Response body was not JSON ProblemDetails — fall back to a generic message below.
    }
    return {
      ok: false,
      error: {
        kind: "http",
        status: response.status,
        message: detail ?? `The Admin API returned an unexpected error (HTTP ${response.status}).`,
      },
    };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: { kind: "network", message: "The Admin API returned an unreadable response." } };
  }
}

export function fetchActiveProperties(signal?: AbortSignal): Promise<ApiResult<ApiProperty[]>> {
  return requestJson<ApiProperty[]>("/api/v1/properties", signal);
}

export function fetchReservationBoard(
  propertyId: string,
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<ApiResult<ReservationBoardResponse>> {
  const query = new URLSearchParams({ from, to }).toString();
  return requestJson<ReservationBoardResponse>(
    `/api/admin/v1/properties/${propertyId}/reservation-board?${query}`,
    signal
  );
}
