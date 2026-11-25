import type { SelectedOfferSnapshot, ContactInput } from "./bookingHoldAttempt";
import { normalizeContact } from "./bookingHoldAttempt";
import type { CustomerSessionState } from "@/lib/customerSession";

/** The exact `POST /api/v1/reservations` body (runbook BHA-CHECKOUT-001-direct-booking-api): these fields and no other. */
export interface DirectReservationRequest {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  fullName: string;
  email: string;
  phone: string;
  /** The VND price the guest just confirmed; the API refuses (`reservation.price-changed`) if it is no longer this. */
  expectedTotalAmount: number;
  expectedCurrencyCode: string;
  paymentMethod: "PayAtProperty";
}

/** Who owns the reservation: the signed-in account (session cookie, no token) or the guest holding the token. */
export type DirectOwnerSnapshot =
  | { kind: "account"; customerAccountId: string }
  | { kind: "guest"; guestAccessToken: string };

/** One immutable attempt: the exact owner, key and body, resent unchanged on every retry. Lives in tab memory only. */
export interface DirectAttemptSnapshot {
  request: DirectReservationRequest;
  idempotencyKey: string;
  owner: DirectOwnerSnapshot;
}

export function buildDirectReservationRequest(offer: SelectedOfferSnapshot, contact: ContactInput): DirectReservationRequest {
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
    expectedTotalAmount: offer.quote.totalAmount,
    expectedCurrencyCode: offer.quote.currencyCode,
    paymentMethod: "PayAtProperty",
  };
}

/** The owner a *verified* session stands for (`customer:<id>` / `guest`); null while it is loading or unknown. */
export function verifiedOwnerKey(session: CustomerSessionState | undefined): string | null {
  if (!session) return null;
  if (session.status === "authenticated") return `customer:${session.customer.customerAccountId.toLowerCase()}`;
  return session.status === "anonymous" ? "guest" : null;
}

export function ownerKeyOf(owner: DirectOwnerSnapshot): string {
  return owner.kind === "account" ? `customer:${owner.customerAccountId.toLowerCase()}` : "guest";
}
