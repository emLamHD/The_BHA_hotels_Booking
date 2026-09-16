/**
 * PMS-CAL-001.1: minimal typed Admin API boundary. Every call normalizes
 * configuration, network, and HTTP/ProblemDetails failures into one safe
 * `ApiResult` shape — callers never see a raw exception, a raw fetch
 * rejection, or a raw ProblemDetails payload.
 */

import { describeApiBaseUrlError, getApiBaseUrl } from "./env";
import type {
  ApiProperty,
  CreateReservationAssignmentRequest,
  MoveReservationAssignmentRequest,
  ReservationBoardResponse,
  RoomOccupancySegment,
} from "./types";

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

/**
 * PMS-CAL-001.2-CP03A: what is actually known after one assignment-create
 * attempt. The distinction that matters to an operator is not "success vs.
 * error" but *whether the server may have written something*:
 *
 * - `created`: the server answered `201`. Proof of a write.
 * - `not-sent`: the request never left the browser (configuration). Proof of
 *   no write.
 * - `rejected`: the server answered with a `4xx`. The store refuses inside its
 *   transaction and the write gate refuses before any action runs, so a `4xx`
 *   is proof of no write.
 * - `unknown`: the request may have reached the server but no trustworthy
 *   answer came back — a network failure (including a CORS refusal the browser
 *   hides), a timeout, an abort after sending, or a `5xx` (an exception can be
 *   thrown after commit). The segment may or may not exist.
 *
 * The backend claims no idempotency, so `unknown` must never be retried
 * automatically; the caller re-reads the board instead.
 */
export type AssignmentRejectionCategory =
  | "validation"
  | "not-permitted"
  | "cross-room-type-confirmation-required"
  | "conflict"
  | "refused";

export type AssignmentCreateOutcome =
  | { kind: "created"; segment: RoomOccupancySegment | null }
  | { kind: "not-sent"; message: string }
  | { kind: "rejected"; status: number; category: AssignmentRejectionCategory; detail?: string }
  | { kind: "unknown"; reason: "network" | "timeout" | "aborted" | "server-error"; status?: number };

/**
 * PMS-CAL-001.2-CP03B: the exact `title` the backend publishes for the one
 * 403 that is actionable rather than a closed write boundary —
 * `AdminReservationAssignmentsController.Create`'s `SegmentMutationStatus
 * .Unauthorized` branch. ProblemDetails carries no machine-readable code
 * beyond this title (the `type` URI is only the generic per-status-code
 * default), so this string is the contract between the two services; it is
 * matched exactly, never fuzzily, so an unrelated 403 never misreads as this
 * one.
 */
const CROSS_ROOM_TYPE_CONFIRMATION_TITLE = "Cross-RoomType confirmation required";

export interface CreateReservationAssignmentOptions {
  /** Aborts the request; an abort after sending is reported as `unknown`, never as "cancelled". */
  signal?: AbortSignal;
  /** Client-side upper bound on waiting for the server. */
  timeoutMs?: number;
}

export const DEFAULT_ASSIGNMENT_TIMEOUT_MS = 15_000;

const MAX_PROBLEM_TEXT_LENGTH = 300;

interface ValidationProblemShape extends ProblemDetailsShape {
  errors?: unknown;
}

/** Keeps only plain, bounded, single-line text from a server-supplied field. */
function safeProblemText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length > MAX_PROBLEM_TEXT_LENGTH
    ? `${collapsed.slice(0, MAX_PROBLEM_TEXT_LENGTH - 1)}…`
    : collapsed;
}

/**
 * Reads a ProblemDetails body when there is one. A closed write gate answers
 * with an empty `404`, so an absent or non-JSON body is an expected shape here,
 * not a failure.
 */
async function readProblem(response: Response): Promise<ValidationProblemShape | undefined> {
  try {
    const text = await response.text();
    if (text.trim() === "") return undefined;
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as ValidationProblemShape) : undefined;
  } catch {
    return undefined;
  }
}

function validationDetail(problem: ValidationProblemShape | undefined): string | undefined {
  if (!problem) return undefined;
  const detail = safeProblemText(problem.detail);
  if (detail) return detail;
  if (problem.errors !== null && typeof problem.errors === "object") {
    const messages = Object.values(problem.errors as Record<string, unknown>)
      .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
      .map(safeProblemText)
      .filter((message): message is string => message !== undefined);
    const joined = safeProblemText(messages.join(" "));
    if (joined) return joined;
  }
  return safeProblemText(problem.title);
}

/**
 * Creates one ReservationAssignment segment through the local Admin Calendar
 * write gate. Exactly one network attempt is made — this function never
 * retries.
 *
 * The request matches the write gate and its `admin-calendar-write` CORS policy
 * precisely: POST, `Content-Type: application/json` (the only non-safelisted
 * header that policy allows), no credentials (the policy is uncredentialed, and
 * a Customer session cookie must never ride along on an Admin write), no cache,
 * and no redirect following — a redirected write would be re-sent somewhere the
 * gate did not approve.
 */
export async function createReservationAssignment(
  propertyId: string,
  request: CreateReservationAssignmentRequest,
  options: CreateReservationAssignmentOptions = {}
): Promise<AssignmentCreateOutcome> {
  const baseUrlResult = getApiBaseUrl();
  if (!baseUrlResult.ok) {
    return { kind: "not-sent", message: describeApiBaseUrlError(baseUrlResult.reason) };
  }

  // Built field by field rather than spread, so nothing beyond the contract —
  // in particular no actor or authorization evidence — can reach the wire even
  // if a caller passes a wider object at runtime. `reason` is included only
  // when the caller actually set it: JSON.stringify drops an `undefined`
  // property entirely, so CP03A's same-RoomType request (no `reason` field)
  // is unchanged, and an empty-string `reason` is never silently substituted
  // for an absent one — the caller (the dialog) must already have validated
  // it non-empty before this is reached.
  const body = JSON.stringify({
    reservationUnitId: request.reservationUnitId,
    physicalRoomId: request.physicalRoomId,
    startDate: request.startDate,
    endDate: request.endDate,
    confirmCrossRoomType: request.confirmCrossRoomType,
    ...(request.reason !== undefined ? { reason: request.reason } : {}),
  });

  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_ASSIGNMENT_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetch(
        `${baseUrlResult.baseUrl}/api/admin/v1/properties/${encodeURIComponent(propertyId)}/reservation-assignments`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        }
      );
    } catch {
      if (timedOut) return { kind: "unknown", reason: "timeout" };
      if (controller.signal.aborted) return { kind: "unknown", reason: "aborted" };
      return { kind: "unknown", reason: "network" };
    }

    const status = response.status;
    if (status === 201) {
      let segment: RoomOccupancySegment | null = null;
      try {
        segment = (await response.json()) as RoomOccupancySegment;
      } catch {
        // The 201 status is the proof of the write; an unreadable body does not undo it.
      }
      return { kind: "created", segment };
    }

    if (status >= 500 || status < 400) {
      // A 5xx may follow a commit; any other unexpected status is equally unproven.
      return { kind: "unknown", reason: "server-error", status };
    }

    const problem = await readProblem(response);
    switch (status) {
      case 400:
        return { kind: "rejected", status, category: "validation", detail: validationDetail(problem) };
      case 403:
        // PMS-CAL-001.2-CP03B: the one 403 the store, not the write gate,
        // produces — the dialog already requires confirmation and a reason
        // before ever sending a cross-RoomType request, so reaching this is
        // defense in depth, not the expected path. Nothing was written: the
        // store rolls back before responding. Every other 403 (write-gate
        // origin refusal, or any body this title does not exactly match)
        // falls through to the same detail-free "not-permitted" as a closed
        // gate always has.
        if (problem?.title === CROSS_ROOM_TYPE_CONFIRMATION_TITLE) {
          return {
            kind: "rejected",
            status,
            category: "cross-room-type-confirmation-required",
            detail: safeProblemText(problem?.detail),
          };
        }
        return { kind: "rejected", status, category: "not-permitted" };
      case 404:
        // Deliberately detail-free: a closed gate's 404 has no body, and a
        // store 404/403 text must not be shown as though the booking were gone.
        return { kind: "rejected", status, category: "not-permitted" };
      case 409:
        return { kind: "rejected", status, category: "conflict", detail: safeProblemText(problem?.detail) };
      default:
        return { kind: "rejected", status, category: "refused", detail: safeProblemText(problem?.detail) };
    }
  } finally {
    clearTimeout(timeoutHandle);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * PMS-CAL-001.2-CP04C.1: what is known after one move attempt against
 * `POST .../reservation-assignments/{segmentId}/move`. Same shape and the
 * same reasoning as {@link AssignmentCreateOutcome}:
 *
 * - `moved`: the server answered `200`. Proof of a write. The body is the
 *   mutated segments (the superseded source, then its replacement) when the
 *   `200` body parsed as JSON; `null` only means that body itself could not
 *   be read, which is not evidence the move failed — the status already is.
 * - `not-sent`: the request never left the browser (configuration). Proof of
 *   no write.
 * - `rejected`: the server answered with a `4xx`. The store refuses inside
 *   its transaction and the write gate refuses before any action runs, so a
 *   `4xx` is proof of no write.
 * - `unknown`: a network failure, a timeout, an abort after sending, or a
 *   `5xx` — the source segment may or may not have been superseded. Never
 *   retried automatically; the caller re-reads the board instead.
 */
export type MoveAssignmentOutcome =
  | { kind: "moved"; segments: RoomOccupancySegment[] | null }
  | { kind: "not-sent"; message: string }
  | { kind: "rejected"; status: number; category: AssignmentRejectionCategory; detail?: string }
  | { kind: "unknown"; reason: "network" | "timeout" | "aborted" | "server-error"; status?: number };

/**
 * Moves one existing Effective ReservationAssignment segment to a different
 * PhysicalRoom over its own unchanged `[startDate, endDate)`, through the
 * same local Admin Calendar write gate and uncredentialed
 * `admin-calendar-write` CORS policy as {@link createReservationAssignment} —
 * every request-shape guarantee documented there (field-by-field body, no
 * actor/authorization evidence from the caller, no credentials, no cache, no
 * redirect following) applies here unchanged. Exactly one network attempt is
 * made; this function never retries.
 */
export async function moveReservationAssignment(
  propertyId: string,
  segmentId: string,
  request: MoveReservationAssignmentRequest,
  options: CreateReservationAssignmentOptions = {}
): Promise<MoveAssignmentOutcome> {
  const baseUrlResult = getApiBaseUrl();
  if (!baseUrlResult.ok) {
    return { kind: "not-sent", message: describeApiBaseUrlError(baseUrlResult.reason) };
  }

  // Field by field, for the identical reason as createReservationAssignment:
  // nothing beyond the CP04B move contract — in particular no actor and no
  // authorization evidence — can reach the wire even if a caller passes a
  // wider object at runtime. `reason` is included only when the caller
  // actually set it, so a same-RoomType move (no `reason` field) is
  // unchanged and an empty-string `reason` is never silently substituted.
  const body = JSON.stringify({
    expectedVersion: request.expectedVersion,
    physicalRoomId: request.physicalRoomId,
    startDate: request.startDate,
    endDate: request.endDate,
    confirmCrossRoomType: request.confirmCrossRoomType,
    ...(request.reason !== undefined ? { reason: request.reason } : {}),
  });

  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_ASSIGNMENT_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetch(
        `${baseUrlResult.baseUrl}/api/admin/v1/properties/${encodeURIComponent(propertyId)}/reservation-assignments/${encodeURIComponent(segmentId)}/move`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        }
      );
    } catch {
      if (timedOut) return { kind: "unknown", reason: "timeout" };
      if (controller.signal.aborted) return { kind: "unknown", reason: "aborted" };
      return { kind: "unknown", reason: "network" };
    }

    const status = response.status;
    if (status === 200) {
      let segments: RoomOccupancySegment[] | null = null;
      try {
        segments = (await response.json()) as RoomOccupancySegment[];
      } catch {
        // The 200 status is the proof of the write; an unreadable body does not undo it.
      }
      return { kind: "moved", segments };
    }

    if (status >= 500 || status < 400) {
      // A 5xx may follow a commit; any other unexpected status is equally unproven.
      return { kind: "unknown", reason: "server-error", status };
    }

    const problem = await readProblem(response);
    switch (status) {
      case 400:
        return { kind: "rejected", status, category: "validation", detail: validationDetail(problem) };
      case 403:
        // Same store-originated exception as createReservationAssignment's
        // 403 handling: the dialog is expected to block sending without a
        // confirmed acknowledgement and reason, so this is defense in depth.
        if (problem?.title === CROSS_ROOM_TYPE_CONFIRMATION_TITLE) {
          return {
            kind: "rejected",
            status,
            category: "cross-room-type-confirmation-required",
            detail: safeProblemText(problem?.detail),
          };
        }
        return { kind: "rejected", status, category: "not-permitted" };
      case 404:
        // Deliberately detail-free: a closed gate's 404 has no body, and a
        // store 404/403 text must not be shown as though the booking were gone.
        return { kind: "rejected", status, category: "not-permitted" };
      case 409:
        return { kind: "rejected", status, category: "conflict", detail: safeProblemText(problem?.detail) };
      default:
        return { kind: "rejected", status, category: "refused", detail: safeProblemText(problem?.detail) };
    }
  } finally {
    clearTimeout(timeoutHandle);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
