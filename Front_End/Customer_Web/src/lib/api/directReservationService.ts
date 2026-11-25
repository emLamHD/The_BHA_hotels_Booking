import { submitCsrfProtectedRequest } from "./csrf";
import type { ReservationDto } from "./bookingHoldTypes";
import type { DirectOwnerSnapshot, DirectReservationRequest } from "./directBookingAttempt";

const RESERVATIONS_PATH = "/api/v1/reservations";

export interface DirectReservationResult {
  reservation: ReservationDto;
  outcome: "created" | "replayed";
}

/** A success status with a body that is not the documented reservation: the outcome is unknown, never "created". */
export class DirectReservationContractError extends Error {
  constructor() {
    super("The server returned an unexpected reservation response.");
    this.name = "DirectReservationContractError";
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Only a body carrying everything the receipt shows counts; the values are kept exactly as the API sent them. */
function toDirectReservation(data: unknown): ReservationDto {
  if (typeof data === "object" && data !== null) {
    const r = data as Record<string, unknown>;
    if (
      typeof r.reservationId === "string" &&
      GUID.test(r.reservationId) &&
      typeof r.confirmationNumber === "string" &&
      r.confirmationNumber !== "" &&
      (r.status === "Confirmed" || r.status === "Cancelled") &&
      typeof r.propertyId === "string" &&
      typeof r.checkIn === "string" &&
      typeof r.checkOut === "string" &&
      isNumber(r.totalAmount) &&
      r.paymentMethod === "PayAtProperty" &&
      isNumber(r.collectedAmount) &&
      isNumber(r.balanceDueAmount)
    ) {
      return data as ReservationDto;
    }
  }
  throw new DirectReservationContractError();
}

/**
 * Calls exactly POST /api/v1/reservations through the shared CSRF-protected path, with the body of the attempt and
 * nothing else. The guest token header is sent only for a guest owner; an account owner is identified by the session
 * cookie alone (the API refuses a token together with a session). `201` = created, `200` = replay of the same
 * key/owner/body. No retry happens here: the caller resends the very same attempt.
 */
export async function createDirectReservation(
  request: DirectReservationRequest,
  idempotencyKey: string,
  owner: DirectOwnerSnapshot,
  options: { signal?: AbortSignal } = {}
): Promise<DirectReservationResult> {
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  if (owner.kind === "guest") headers["X-Booking-Access-Token"] = owner.guestAccessToken;

  const response = await submitCsrfProtectedRequest<unknown>(
    RESERVATIONS_PATH,
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
      expectedTotalAmount: request.expectedTotalAmount,
      expectedCurrencyCode: request.expectedCurrencyCode,
      paymentMethod: request.paymentMethod,
    },
    { signal: options.signal, headers }
  );

  if (response.status !== 200 && response.status !== 201) throw new DirectReservationContractError();
  return { reservation: toDirectReservation(response.data), outcome: response.status === 201 ? "created" : "replayed" };
}
