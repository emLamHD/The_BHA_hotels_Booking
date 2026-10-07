import { submitCsrfProtectedRequest } from "./csrf";
import { BookingHoldDto, CreateBookingHoldRequest, ReservationDto } from "./bookingHoldTypes";

const BOOKING_HOLDS_PATH = "/api/v1/booking-holds";

export type BookingHoldOutcome = "created" | "replayed";

export interface CreateBookingHoldResult {
  hold: BookingHoldDto;
  outcome: BookingHoldOutcome;
}

export interface CreateBookingHoldOptions {
  signal?: AbortSignal;
}

export type ConfirmBookingHoldOutcome = "confirmed" | "replayed";

export interface ConfirmBookingHoldResult {
  reservation: ReservationDto;
  outcome: ConfirmBookingHoldOutcome;
}

export interface ConfirmBookingHoldOptions {
  signal?: AbortSignal;
}

/**
 * Calls exactly POST /api/v1/booking-holds through the shared CSRF-protected
 * unsafe path. Sends only the allowed request fields — no price, currency,
 * expiry, status, ownership, or token value is ever sent as client
 * authority. `idempotencyKey` is caller-owned; this service never fabricates
 * one. Performs no automatic retry beyond the one CSRF-refresh retry already
 * implemented by the shared CSRF helper.
 */
export async function createBookingHold(
  request: CreateBookingHoldRequest,
  idempotencyKey: string,
  options: CreateBookingHoldOptions = {}
): Promise<CreateBookingHoldResult> {
  const response = await submitCsrfProtectedRequest<BookingHoldDto>(
    BOOKING_HOLDS_PATH,
    "POST",
    {
      propertyId: request.propertyId,
      roomTypeId: request.roomTypeId,
      ratePlanId: request.ratePlanId,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      adults: request.adults,
      children: request.children,
      rooms: request.rooms,
      fullName: request.fullName,
      email: request.email,
      phone: request.phone,
    },
    {
      signal: options.signal,
      headers: { "Idempotency-Key": idempotencyKey },
    }
  );

  if (!response.data) {
    throw new Error("The server did not return a Booking Hold.");
  }

  return {
    hold: response.data,
    outcome: response.status === 201 ? "created" : "replayed",
  };
}

/**
 * Calls exactly POST /api/v1/booking-holds/{holdId}/confirm through the
 * shared CSRF-protected unsafe path. Sends no business request body — the
 * confirmation contract accepts only the `holdId` route segment and the
 * optional guest credential header. `guestAccessToken` is treated as an
 * opaque value: it is never trimmed, transformed, logged, or persisted, and
 * the `X-Booking-Access-Token` header is included only when it is a
 * non-null, non-empty string (an authenticated customer session may confirm
 * with no token at all). Never sends an `Idempotency-Key`; the confirm
 * endpoint has none.
 */
export async function confirmBookingHold(
  holdId: string,
  guestAccessToken: string | null,
  options: ConfirmBookingHoldOptions = {}
): Promise<ConfirmBookingHoldResult> {
  const headers: Record<string, string> = {};
  if (guestAccessToken) {
    headers["X-Booking-Access-Token"] = guestAccessToken;
  }

  const response = await submitCsrfProtectedRequest<ReservationDto>(
    `${BOOKING_HOLDS_PATH}/${holdId}/confirm`,
    "POST",
    undefined,
    {
      signal: options.signal,
      headers,
    }
  );

  if (!response.data) {
    throw new Error("The server did not return a Reservation.");
  }

  return {
    reservation: response.data,
    outcome: response.status === 201 ? "confirmed" : "replayed",
  };
}
