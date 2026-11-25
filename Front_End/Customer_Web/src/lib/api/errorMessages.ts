import { MAX_REQUESTED_ROOMS, MAX_STAY_NIGHTS } from "./availabilityValidation";
import { BookingFieldLimits } from "./bookingHoldValidationLimits";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "./errors";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: what the visitor reads for a failed request. The API sends a stable `code`
 * (`hold.expired`, `auth.csrf-invalid`, …); the text is the pack message `shared.apiError.<code>` in the visitor's language.
 * These functions return the KEY — the component translates it when it renders, so a language switch while an error is on
 * screen re-renders it in the new language instead of leaving the old sentence behind.
 */
export const API_ERROR_PARAMS = {
  nights: MAX_STAY_NIGHTS,
  rooms: MAX_REQUESTED_ROOMS,
  max: BookingFieldLimits.FullName,
};

const UNKNOWN = "shared.apiError.error.unknown";

export function apiErrorKey(error: unknown, fallback: string = UNKNOWN): string {
  if (error instanceof ApiHttpError) return error.problem.code ? `shared.apiError.${error.problem.code}` : fallback;
  if (error instanceof ApiNetworkError) return "shared.apiError.network";
  if (error instanceof ApiConfigError) return "shared.apiError.config";
  return fallback;
}

/**
 * The Direct reservation API's codes whose text already exists under another key with the same meaning; every other
 * code reads `shared.apiError.<code>` like everywhere else.
 */
const DIRECT_CODE_ALIASES: Readonly<Record<string, string>> = {
  "reservation.rooms-unavailable": "shared.apiError.hold.rooms-unavailable",
  "reservation.pricing-unavailable": "shared.apiError.hold.pricing-unavailable",
  "booking.rate-limited": "shared.apiError.auth.rate-limited",
};

export function directApiErrorKey(error: unknown): string {
  if (error instanceof ApiHttpError && error.problem.code && DIRECT_CODE_ALIASES[error.problem.code]) {
    return DIRECT_CODE_ALIASES[error.problem.code];
  }
  return apiErrorKey(error, "shared.apiError.directGeneric");
}
