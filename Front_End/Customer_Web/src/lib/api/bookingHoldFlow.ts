import {
  ActiveHoldSession,
  BookingHoldAttemptSnapshot,
  BookingHoldConfirmationAttemptSnapshot,
  ContactFieldErrors,
  ContactInput,
  SelectedOfferSnapshot,
  mergeHoldSession,
} from "./bookingHoldAttempt";
import { ConfirmBookingHoldResult, CreateBookingHoldResult } from "./bookingHoldService";
import type { PriceQuote } from "./availabilityTypes";

/**
 * The authoritative Booking Hold mutation phases. Equivalent to
 * idle/selected, submitting, known-error, uncertain, and active-session, plus
 * the confirmation-lifecycle phases confirming/confirm-known-error/
 * confirm-uncertain/reservation-result — enforced here in the reducer, not
 * only by disabled button styling, so a stale render or a bypassed UI
 * control can never move the flow through an invalid transition.
 */
export type BookingHoldFlowPhase =
  | "idle"
  | "selected"
  | "submitting"
  | "known-error"
  | "uncertain"
  | "active-session"
  | "confirming"
  | "confirm-known-error"
  | "confirm-uncertain"
  | "reservation-result";

export interface BookingHoldFlowState {
  phase: BookingHoldFlowPhase;
  offer: SelectedOfferSnapshot | null;
  offerLabel: string | null;
  contact: ContactInput;
  fieldErrors: ContactFieldErrors | null;
  /** The immutable in-flight/retryable attempt: exact body plus exact Idempotency-Key. */
  attempt: BookingHoldAttemptSnapshot | null;
  errorMessage: string | null;
  /**
   * `hold.price-changed`: the price now, for the guest to confirm again. While it is set no hold can be asked for (a known refusal,
   * nothing was held); accepting it replaces the offer's confirmed price and clears it. Never set by an unknown result.
   */
  priceChange: PriceQuote | null;
  session: ActiveHoldSession | null;
  /** Monotonic identity of the current/most-recent operation; rejects stale completions. */
  operationId: number;
  /** The immutable in-flight/retryable confirmation attempt: exact Hold ID plus exact guest credential. */
  confirmationAttempt: BookingHoldConfirmationAttemptSnapshot | null;
  reservationResult: ConfirmBookingHoldResult | null;
}

export const initialContact: ContactInput = { fullName: "", email: "", phone: "" };

export const initialBookingHoldFlowState: BookingHoldFlowState = {
  phase: "idle",
  offer: null,
  offerLabel: null,
  contact: initialContact,
  fieldErrors: null,
  attempt: null,
  errorMessage: null,
  priceChange: null,
  session: null,
  operationId: 0,
  confirmationAttempt: null,
  reservationResult: null,
};

export type BookingHoldFlowAction =
  | { type: "offer-selected"; offer: SelectedOfferSnapshot; label: string }
  | { type: "contact-changed"; contact: ContactInput }
  | { type: "validation-failed"; errors: ContactFieldErrors }
  | { type: "submit-requested"; attempt: BookingHoldAttemptSnapshot; operationId: number }
  | { type: "retry-requested"; operationId: number }
  | { type: "attempt-succeeded"; operationId: number; result: CreateBookingHoldResult }
  | { type: "attempt-known-error"; operationId: number; message: string }
  | { type: "price-changed"; operationId: number; quote: PriceQuote }
  | { type: "price-change-accepted" }
  | { type: "attempt-uncertain"; operationId: number }
  | { type: "search-reset" }
  | {
      type: "confirmation-requested";
      attempt: BookingHoldConfirmationAttemptSnapshot;
      operationId: number;
    }
  | { type: "confirmation-retry-requested"; operationId: number }
  | { type: "confirmation-succeeded"; operationId: number; result: ConfirmBookingHoldResult }
  | { type: "confirmation-known-error"; operationId: number; message: string }
  | { type: "confirmation-uncertain"; operationId: number }
  /** CUST-WEB-001-CP01b: an accepted Customer identity change discards the draft; only idle/selected/known-error. */
  | { type: "identity-change-scrub" }
  /** CUST-WEB-001-CP01b: the explicit local "done with the receipt"; only for the receipt of that reservation. */
  | { type: "booking-finished"; reservationId: string };

/** Contact is editable and a fresh, newly keyed submit is allowed. */
const EDITABLE_PHASES: ReadonlySet<BookingHoldFlowPhase> = new Set<BookingHoldFlowPhase>([
  "selected",
  "known-error",
]);

/** Search, offer switching, and fresh submit are all blocked in these phases. */
const LOCKED_PHASES: ReadonlySet<BookingHoldFlowPhase> = new Set<BookingHoldFlowPhase>([
  "submitting",
  "uncertain",
  "active-session",
  "confirming",
  "confirm-known-error",
  "confirm-uncertain",
  "reservation-result",
]);

export function bookingHoldFlowReducer(
  state: BookingHoldFlowState,
  action: BookingHoldFlowAction
): BookingHoldFlowState {
  switch (action.type) {
    case "offer-selected": {
      if (LOCKED_PHASES.has(state.phase)) {
        return state;
      }
      return {
        ...state,
        phase: "selected",
        offer: action.offer,
        offerLabel: action.label,
        attempt: null,
        fieldErrors: null,
        errorMessage: null,
        priceChange: null,
      };
    }

    case "contact-changed": {
      if (!EDITABLE_PHASES.has(state.phase)) {
        return state;
      }
      return { ...state, contact: action.contact };
    }

    case "validation-failed": {
      if (!EDITABLE_PHASES.has(state.phase)) {
        return state;
      }
      return { ...state, fieldErrors: action.errors };
    }

    case "submit-requested": {
      if (!EDITABLE_PHASES.has(state.phase)) {
        return state;
      }
      return {
        ...state,
        phase: "submitting",
        attempt: action.attempt,
        operationId: action.operationId,
        fieldErrors: null,
        errorMessage: null,
      };
    }

    case "retry-requested": {
      if (state.phase !== "uncertain" || !state.attempt) {
        return state;
      }
      return { ...state, phase: "submitting", operationId: action.operationId };
    }

    case "attempt-succeeded": {
      if (state.phase !== "submitting" || action.operationId !== state.operationId) {
        return state;
      }
      // Deliberately constructed rather than spreading ...state: a
      // definitive success must scrub contact PII and the now-obsolete
      // offer selection, retaining only the minimal active session (and,
      // via mergeHoldSession, the guest token) required by later
      // lifecycle work.
      return {
        phase: "active-session",
        offer: null,
        offerLabel: null,
        contact: initialContact,
        fieldErrors: null,
        attempt: null,
        errorMessage: null,
        priceChange: null,
        // Reads state.session — the reducer's current state, never a stale
        // closure — so a same-Hold replay-null can never overwrite a
        // retained token from an earlier operation.
        session: mergeHoldSession(state.session, action.result),
        operationId: state.operationId,
        confirmationAttempt: null,
        reservationResult: null,
      };
    }

    case "attempt-known-error": {
      if (state.phase !== "submitting" || action.operationId !== state.operationId) {
        return state;
      }
      return { ...state, phase: "known-error", attempt: null, errorMessage: action.message };
    }

    case "price-changed": {
      if (state.phase !== "submitting" || action.operationId !== state.operationId) {
        return state;
      }
      // A known refusal: nothing was held, so the contact form stays and the guest decides on the new price.
      return { ...state, phase: "known-error", attempt: null, errorMessage: null, priceChange: action.quote };
    }

    case "price-change-accepted": {
      if (state.phase !== "known-error" || !state.priceChange || !state.offer) {
        return state;
      }
      return { ...state, offer: { ...state.offer, quote: state.priceChange }, priceChange: null, errorMessage: null };
    }

    case "attempt-uncertain": {
      if (state.phase !== "submitting" || action.operationId !== state.operationId) {
        return state;
      }
      return { ...state, phase: "uncertain", errorMessage: null };
    }

    case "search-reset": {
      // Never clears/replaces an app-retained submitting, uncertain, or
      // active-session flow — only an idle/selected/known-error selection
      // may be abandoned by a new explicit Availability search.
      if (LOCKED_PHASES.has(state.phase)) {
        return state;
      }
      return {
        ...state,
        phase: "idle",
        offer: null,
        offerLabel: null,
        attempt: null,
        fieldErrors: null,
        errorMessage: null,
        priceChange: null,
      };
    }

    case "confirmation-requested": {
      if (state.phase !== "active-session" || !state.session) {
        return state;
      }
      // The accepted attempt must exactly match the current session's Hold
      // ID and retained guest token — a stale/mismatched snapshot (e.g. from
      // a superseded session) is rejected as a no-op rather than confirming
      // the wrong Hold or credential.
      if (
        action.attempt.holdId !== state.session.hold.holdId ||
        action.attempt.guestAccessToken !== state.session.guestAccessToken
      ) {
        return state;
      }
      return {
        ...state,
        phase: "confirming",
        confirmationAttempt: action.attempt,
        operationId: action.operationId,
        errorMessage: null,
      };
    }

    case "confirmation-retry-requested": {
      if (
        (state.phase !== "confirm-uncertain" && state.phase !== "confirm-known-error") ||
        !state.confirmationAttempt
      ) {
        return state;
      }
      return { ...state, phase: "confirming", operationId: action.operationId, errorMessage: null };
    }

    case "confirmation-succeeded": {
      if (state.phase !== "confirming" || action.operationId !== state.operationId) {
        return state;
      }
      // Definitive success: scrub the now-superseded active session, guest
      // token, and confirmation attempt, and clear any leftover
      // offer/contact/error state, retaining only the Reservation result.
      return {
        phase: "reservation-result",
        offer: null,
        offerLabel: null,
        contact: initialContact,
        fieldErrors: null,
        attempt: null,
        errorMessage: null,
        priceChange: null,
        session: null,
        operationId: state.operationId,
        confirmationAttempt: null,
        reservationResult: action.result,
      };
    }

    case "confirmation-known-error": {
      if (state.phase !== "confirming" || action.operationId !== state.operationId) {
        return state;
      }
      return { ...state, phase: "confirm-known-error", errorMessage: action.message };
    }

    case "confirmation-uncertain": {
      if (state.phase !== "confirming" || action.operationId !== state.operationId) {
        return state;
      }
      return { ...state, phase: "confirm-uncertain", errorMessage: null };
    }

    case "identity-change-scrub": {
      // Only a draft (idle/selected/known-error) can be discarded; a hold, an unknown outcome or a
      // receipt is never touched by an identity change. The operation identity stays monotonic.
      if (state.phase !== "idle" && !EDITABLE_PHASES.has(state.phase)) {
        return state;
      }
      return { ...initialBookingHoldFlowState, operationId: state.operationId };
    }

    case "booking-finished": {
      if (
        state.phase !== "reservation-result" ||
        state.reservationResult?.reservation.reservationId !== action.reservationId
      ) {
        return state;
      }
      // Local only: scrubs the receipt and every PII-bearing field. Nothing is sent anywhere.
      return { ...initialBookingHoldFlowState, operationId: state.operationId };
    }

    default:
      return state;
  }
}
