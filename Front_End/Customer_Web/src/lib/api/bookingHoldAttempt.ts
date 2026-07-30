import { AvailabilityQuery } from "./availabilityTypes";
import { CreateBookingHoldRequest, BookingHoldDto } from "./bookingHoldTypes";
import { CreateBookingHoldResult } from "./bookingHoldService";
import { BookingFieldLimits } from "./bookingHoldValidationLimits";

/** The exact live offer plus the exact submitted Availability criteria, never an unsubmitted draft. */
export interface SelectedOfferSnapshot extends AvailabilityQuery {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
}

export interface ContactInput {
  fullName: string;
  email: string;
  phone: string;
}

export interface ContactFieldErrors {
  fullName?: string;
  email?: string;
  phone?: string;
}

/** An immutable Hold-attempt snapshot: exact request body plus exact idempotency key. */
export interface BookingHoldAttemptSnapshot {
  request: CreateBookingHoldRequest;
  idempotencyKey: string;
}

export interface ActiveHoldSession {
  hold: BookingHoldDto;
  guestAccessToken: string | null;
  outcome: "created" | "replayed";
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^[0-9+(). -]{7,32}$/;

export function normalizeContact(input: ContactInput): ContactInput {
  return {
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
  };
}

/** Mirrors the backend's structural contact rules (BookingHoldRequestSecurity) for early feedback. */
export function validateContact(input: ContactInput): ContactFieldErrors | null {
  const normalized = normalizeContact(input);
  const errors: ContactFieldErrors = {};

  if (!normalized.fullName || normalized.fullName.length > BookingFieldLimits.FullName) {
    errors.fullName = `Full name is required and cannot exceed ${BookingFieldLimits.FullName} characters.`;
  }

  if (
    !normalized.email ||
    normalized.email.length > BookingFieldLimits.Email ||
    !EMAIL_PATTERN.test(normalized.email)
  ) {
    errors.email = "Enter a valid contact email.";
  }

  if (
    !normalized.phone ||
    !PHONE_PATTERN.test(normalized.phone) ||
    !/[0-9]/.test(normalized.phone)
  ) {
    errors.phone =
      "Enter a valid contact phone (7-32 characters, at least one digit; digits, spaces, +, (, ), ., or - only).";
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/** Builds the exact allowed request body from the selected offer/criteria snapshot and normalized contact. */
export function buildBookingHoldRequest(
  offer: SelectedOfferSnapshot,
  contact: ContactInput
): CreateBookingHoldRequest {
  const normalized = normalizeContact(contact);
  return {
    propertyId: offer.propertyId,
    roomTypeId: offer.roomTypeId,
    ratePlanId: offer.ratePlanId,
    checkIn: offer.checkIn,
    checkOut: offer.checkOut,
    adults: offer.adults,
    children: offer.children,
    rooms: offer.rooms,
    fullName: normalized.fullName,
    email: normalized.email,
    phone: normalized.phone,
  };
}

/** Field-by-field equality; used to decide whether a new attempt (and key) is required. */
export function requestsAreEqual(
  a: CreateBookingHoldRequest,
  b: CreateBookingHoldRequest
): boolean {
  return (
    a.propertyId === b.propertyId &&
    a.roomTypeId === b.roomTypeId &&
    a.ratePlanId === b.ratePlanId &&
    a.checkIn === b.checkIn &&
    a.checkOut === b.checkOut &&
    a.adults === b.adults &&
    a.children === b.children &&
    a.rooms === b.rooms &&
    a.fullName === b.fullName &&
    a.email === b.email &&
    a.phone === b.phone
  );
}

/**
 * Applies the guest-token retention rule: if a previous in-memory session
 * already holds a non-null token for the same Hold, a later response whose
 * `guestAccessToken` is null (a replay) must not overwrite it. A `200`
 * replay with no matching retained token stays honestly tokenless — it
 * cannot recover anonymous access.
 */
export function mergeHoldSession(
  previous: ActiveHoldSession | null,
  next: CreateBookingHoldResult
): ActiveHoldSession {
  const retainedToken =
    previous && previous.hold.holdId === next.hold.holdId ? previous.guestAccessToken : null;

  return {
    hold: next.hold,
    outcome: next.outcome,
    guestAccessToken: next.hold.guestAccessToken ?? retainedToken,
  };
}
