import {
  BookingHoldAttemptSnapshot,
  BookingHoldConfirmationAttemptSnapshot,
  ContactInput,
  SelectedOfferSnapshot,
  buildBookingHoldRequest,
  validateContact,
} from "./bookingHoldAttempt";
import { BookingHoldFlowAction, BookingHoldFlowState, bookingHoldFlowReducer } from "./bookingHoldFlow";
import { confirmBookingHold, createBookingHold } from "./bookingHoldService";
import { generateIdempotencyKey } from "./idempotencyKey";
import { ApiConfigError, ApiHttpError, ApiNetworkError, ApiValidationError } from "./errors";
import { apiErrorKey } from "./errorMessages";
import { isRequestCancelledError } from "./httpClient";

/** The pack key of the message the visitor reads (see `errorMessages.ts`); the panel translates it when it renders. */
function describeError(error: unknown): string {
  return apiErrorKey(error, "shared.apiError.holdGeneric");
}

export interface BookingHoldFlowController {
  selectOffer: (offer: SelectedOfferSnapshot, label: string) => void;
  updateContact: (contact: ContactInput) => void;
  submit: () => void;
  retryExact: () => void;
  /**
   * Confirms the retained active Hold session (`active-session` only),
   * reusing exactly `session.hold.holdId` and `session.guestAccessToken` —
   * the latter, not `session.hold.guestAccessToken`, so a retained token
   * from an earlier same-Hold replay-null is still used.
   */
  confirmHold: () => void;
  /** Exact confirmation retry, reusing the identical retained attempt from `confirm-uncertain`/`confirm-known-error`. */
  retryConfirmationExact: () => void;
  /**
   * The single authoritative, synchronous decision point for whether an
   * explicit Availability operation (a fresh search or "Retry last
   * search") may begin. Callers must call this *before* any Availability
   * side effect (aborting/replacing the current request, bumping request
   * identity, mutating local search state, or calling the search service)
   * and must perform none of those side effects if it returns `false`.
   * On `true`, the current Hold offer selection has already been
   * synchronously invalidated — a same-tick Hold submit afterward cannot
   * create a Hold from the now-obsolete offer.
   */
  tryBeginAvailabilitySearch: () => boolean;
  /**
   * Read-only synchronous authorization check backed by the exact same
   * lock predicate as `tryBeginAvailabilitySearch` — but it never commits
   * anything (no dispatch, no offer invalidation). Callers must consult
   * this *before* any Availability-form side effect, including draft
   * validation and field-error state, so a same-tick lock rejection is a
   * complete no-op regardless of whether the current draft is valid or
   * invalid.
   */
  isAvailabilitySearchLocked: () => boolean;
  /**
   * CUST-WEB-001-CP01b: the explicit, local "done with this receipt". Accepted only for the current
   * `reservation-result` of exactly `expectedReservationId`, with nothing in flight and no Customer
   * identity change under way; then it scrubs the receipt and every PII-bearing field and returns the
   * flow to idle. No HTTP: it is not a cancellation, a payment or a confirmation. Returns whether it ran.
   */
  finishBooking: (expectedReservationId: string) => boolean;
}

/** Why a Customer identity change may not start now. */
export type IdentityChangeBlockReason = "booking-in-progress" | "receipt-not-finished";

/**
 * The booking side of the identity-change guard (CUST-WEB-001-CP01b). Only the identity coordinator
 * uses it, through the binding the provider registers; it is deliberately not part of the public flow API.
 */
export interface BookingIdentityGuard {
  /** Synchronous, from the controller's own live view (not from a React snapshot). Null when a change may start. */
  identityChangeBlockReason: () => IdentityChangeBlockReason | null;
  /** Discards the draft synchronously. A no-op returning false unless `identityChangeBlockReason()` is null. */
  scrubForIdentityChange: () => boolean;
}

export interface BookingHoldFlowControllerInternal extends BookingHoldFlowController {
  identityGuard: BookingIdentityGuard;
}

export interface CreateBookingHoldFlowControllerOptions {
  getState: () => BookingHoldFlowState;
  dispatch: (action: BookingHoldFlowAction) => void;
  /**
   * Invoked synchronously with the AbortController for each network attempt
   * so an app-level owner (e.g. the root provider) can retain it for its
   * own teardown — a page/panel unmounting must never abort it.
   */
  onAttemptStart?: (controller: AbortController) => void;
  /**
   * True while a Customer identity operation or its session recovery is unresolved. Read synchronously
   * before every booking mutation/draft command, which are refused outright while it is true.
   */
  isIdentityChangeLocked?: () => boolean;
}

/**
 * The React-free Booking Hold mutation coordinator. Owns the synchronous
 * in-flight lock and the operation-identity stale-result guard, and drives
 * the pure reducer via `dispatch`/`getState`. Extracted out of React so the
 * same-tick double-submit and stale-completion races are fully covered by
 * Node-environment Vitest without jsdom/RTL. `BookingHoldProvider` is a thin
 * wrapper that supplies `useReducer`'s `dispatch` and a ref-backed
 * `getState`.
 */
export function createBookingHoldFlowController(
  options: CreateBookingHoldFlowControllerOptions
): BookingHoldFlowControllerInternal {
  const { getState, dispatch: dispatchToReact, onAttemptStart, isIdentityChangeLocked } = options;
  const identityLocked = () => isIdentityChangeLocked?.() === true;

  // CUST-WEB-001-CP01b: the controller's own synchronous view of the flow. `getState()` is a React
  // snapshot and only reflects a dispatch after the next render, so an identity decision made between a
  // response settling and React committing it would otherwise see a stale phase. Every dispatch goes
  // through `dispatch` below, which applies the same pure reducer to this mirror in the same tick.
  let live: BookingHoldFlowState = getState();
  const dispatch = (action: BookingHoldFlowAction): void => {
    live = bookingHoldFlowReducer(live, action);
    dispatchToReact(action);
  };

  // Synchronous in-flight guard: set before the first `await`/microtask and
  // before control returns to the caller, so two same-tick submits/retries
  // can never both generate a key or both call the service. A plain
  // closure variable (not React state), so it is unaffected by React's
  // render/commit timing.
  let inFlight = false;
  // Monotonic operation identity; a completion may update the flow only if
  // it still matches the operation that is current when it settles.
  let operationId = 0;
  // Synchronously mirrors "is there a live, submittable offer selection
  // right now" — set true by an accepted selectOffer and false by an
  // accepted tryBeginAvailabilitySearch. `getState()`/`stateRef` only
  // reflect a dispatch after React re-renders (one tick later), so submit()
  // cannot rely on `getState().offer` alone to reject a same-tick submit
  // that follows a just-accepted Availability search; this flag closes that
  // gap without depending on React's render/commit timing.
  let offerSelectionActive = false;

  // Every phase from active-session onward (the Hold confirmation lifecycle
  // and its terminal Reservation result) locks Availability exactly like
  // submitting/uncertain — shared by the availability gate, `selectOffer`,
  // and the confirmation entry points below so the set is never duplicated.
  const CONFIRMATION_LOCKED_PHASES: ReadonlySet<BookingHoldFlowState["phase"]> = new Set<
    BookingHoldFlowState["phase"]
  >(["submitting", "uncertain", "active-session", "confirming", "confirm-known-error", "confirm-uncertain", "reservation-result"]);

  // The one lock predicate shared by both the read-only authorization check
  // and the committing gate below — never duplicated, never re-derived.
  function isFlowLockedForAvailability(): boolean {
    if (inFlight || identityLocked()) {
      return true;
    }
    return CONFIRMATION_LOCKED_PHASES.has(getState().phase);
  }

  function runAttempt(attempt: BookingHoldAttemptSnapshot, kind: "submit" | "retry"): void {
    const thisOperationId = ++operationId;
    dispatch({
      type: kind === "submit" ? "submit-requested" : "retry-requested",
      attempt,
      operationId: thisOperationId,
    });

    const controller = new AbortController();
    onAttemptStart?.(controller);

    createBookingHold(attempt.request, attempt.idempotencyKey, { signal: controller.signal })
      .then((result) => {
        if (operationId !== thisOperationId) {
          return; // superseded by a newer operation; ignore this stale success
        }
        dispatch({ type: "attempt-succeeded", operationId: thisOperationId, result });
      })
      .catch((error) => {
        if (operationId !== thisOperationId) {
          return; // superseded by a newer operation; ignore this stale failure
        }
        if (isRequestCancelledError(error)) {
          return;
        }
        if (error instanceof ApiNetworkError) {
          dispatch({ type: "attempt-uncertain", operationId: thisOperationId });
          return;
        }
        if (
          error instanceof ApiValidationError ||
          error instanceof ApiHttpError ||
          error instanceof ApiConfigError
        ) {
          dispatch({
            type: "attempt-known-error",
            operationId: thisOperationId,
            message: describeError(error),
          });
          return;
        }
        // Unclassified failure: honestly ambiguous rather than falsely "known".
        dispatch({ type: "attempt-uncertain", operationId: thisOperationId });
      })
      .finally(() => {
        // Only the operation that is still current releases the lock; a
        // superseded operation's completion must not unlock a newer one.
        if (operationId === thisOperationId) {
          inFlight = false;
        }
      });
  }

  function runConfirmationAttempt(
    attempt: BookingHoldConfirmationAttemptSnapshot,
    kind: "confirm" | "retry"
  ): void {
    const thisOperationId = ++operationId;
    dispatch(
      kind === "confirm"
        ? { type: "confirmation-requested", attempt, operationId: thisOperationId }
        : { type: "confirmation-retry-requested", operationId: thisOperationId }
    );

    const controller = new AbortController();
    onAttemptStart?.(controller);

    confirmBookingHold(attempt.holdId, attempt.guestAccessToken, { signal: controller.signal })
      .then((result) => {
        if (operationId !== thisOperationId) {
          return; // superseded by a newer operation; ignore this stale success
        }
        dispatch({ type: "confirmation-succeeded", operationId: thisOperationId, result });
      })
      .catch((error) => {
        if (operationId !== thisOperationId) {
          return; // superseded by a newer operation; ignore this stale failure
        }
        if (isRequestCancelledError(error)) {
          return;
        }
        if (error instanceof ApiNetworkError) {
          dispatch({ type: "confirmation-uncertain", operationId: thisOperationId });
          return;
        }
        if (
          error instanceof ApiValidationError ||
          error instanceof ApiHttpError ||
          error instanceof ApiConfigError
        ) {
          dispatch({
            type: "confirmation-known-error",
            operationId: thisOperationId,
            message: describeError(error),
          });
          return;
        }
        // Unclassified failure (including an ambiguous successful response
        // with no usable Reservation body) — honestly ambiguous rather than
        // falsely "known".
        dispatch({ type: "confirmation-uncertain", operationId: thisOperationId });
      })
      .finally(() => {
        // Only the operation that is still current releases the lock; a
        // superseded operation's completion must not unlock a newer one.
        if (operationId === thisOperationId) {
          inFlight = false;
        }
      });
  }

  return {
    selectOffer(offer, label) {
      if (identityLocked()) {
        return;
      }
      const phase = getState().phase;
      if (CONFIRMATION_LOCKED_PHASES.has(phase)) {
        return;
      }
      offerSelectionActive = true;
      dispatch({ type: "offer-selected", offer, label });
    },

    updateContact(contact) {
      if (identityLocked()) {
        return;
      }
      const phase = getState().phase;
      if (phase !== "selected" && phase !== "known-error") {
        return;
      }
      dispatch({ type: "contact-changed", contact });
    },

    submit() {
      if (inFlight || identityLocked()) {
        return;
      }
      // Rejects a same-tick submit that follows an Availability search
      // already accepted this tick, even before `getState()` reflects the
      // reducer's eventual "search-reset" — see `offerSelectionActive`.
      if (!offerSelectionActive) {
        return;
      }
      const current = getState();
      if ((current.phase !== "selected" && current.phase !== "known-error") || !current.offer) {
        return;
      }

      const errors = validateContact(current.contact);
      if (errors) {
        dispatch({ type: "validation-failed", errors });
        return;
      }

      inFlight = true;
      const attempt: BookingHoldAttemptSnapshot = {
        request: buildBookingHoldRequest(current.offer, current.contact),
        idempotencyKey: generateIdempotencyKey(),
      };
      runAttempt(attempt, "submit");
    },

    retryExact() {
      if (inFlight || identityLocked()) {
        return;
      }
      const current = getState();
      if (current.phase !== "uncertain" || !current.attempt) {
        return;
      }

      inFlight = true;
      runAttempt(current.attempt, "retry");
    },

    confirmHold() {
      if (inFlight || identityLocked()) {
        return;
      }
      const current = getState();
      if (current.phase !== "active-session" || !current.session) {
        return;
      }

      inFlight = true;
      const attempt: BookingHoldConfirmationAttemptSnapshot = {
        holdId: current.session.hold.holdId,
        // The retained session-level token, not `session.hold.guestAccessToken`
        // — a same-Hold replay-null must not lose an earlier-retained token.
        guestAccessToken: current.session.guestAccessToken,
      };
      runConfirmationAttempt(attempt, "confirm");
    },

    retryConfirmationExact() {
      if (inFlight || identityLocked()) {
        return;
      }
      const current = getState();
      if (
        (current.phase !== "confirm-uncertain" && current.phase !== "confirm-known-error") ||
        !current.confirmationAttempt
      ) {
        return;
      }

      inFlight = true;
      runConfirmationAttempt(current.confirmationAttempt, "retry");
    },

    tryBeginAvailabilitySearch() {
      // Same-tick guard: a Hold submit/retry that has already acquired the
      // synchronous lock this tick (even before React commits `phase`)
      // must block Availability, exactly mirroring the protection
      // `inFlight` already gives Hold-vs-Hold same-tick races.
      if (isFlowLockedForAvailability()) {
        return false;
      }

      // Accepted: synchronously invalidate the current Hold selection
      // before the caller is allowed to start the Availability request, so
      // a same-tick Hold submit afterward cannot use the now-obsolete
      // offer (see `offerSelectionActive` and `submit()`).
      offerSelectionActive = false;
      dispatch({ type: "search-reset" });
      return true;
    },

    isAvailabilitySearchLocked() {
      return isFlowLockedForAvailability();
    },

    finishBooking(expectedReservationId) {
      if (inFlight || identityLocked()) {
        return false;
      }
      const current = live;
      if (
        current.phase !== "reservation-result" ||
        current.reservationResult?.reservation.reservationId !== expectedReservationId
      ) {
        return false;
      }
      // Synchronously drop the selection flag as well, so a stale same-tick submit cannot reuse the receipt's flow.
      offerSelectionActive = false;
      dispatch({ type: "booking-finished", reservationId: expectedReservationId });
      return true;
    },

    identityGuard: {
      identityChangeBlockReason() {
        if (inFlight) {
          return "booking-in-progress";
        }
        if (live.phase === "reservation-result") {
          return "receipt-not-finished";
        }
        return CONFIRMATION_LOCKED_PHASES.has(live.phase) ? "booking-in-progress" : null;
      },

      scrubForIdentityChange() {
        if (inFlight || live.phase === "reservation-result" || CONFIRMATION_LOCKED_PHASES.has(live.phase)) {
          return false;
        }
        offerSelectionActive = false;
        dispatch({ type: "identity-change-scrub" });
        return true;
      },
    },
  };
}

/**
 * Runs `performSearch` only if `tryBeginAvailabilitySearch` accepts the
 * operation; otherwise performs no side effect at all — no abort, no
 * request-identity bump, no local search-state mutation, no network call.
 * Shared verbatim between `SectionAvailabilitySearch` and its Vitest
 * coverage so the guarded path under test is the exact path the UI runs,
 * never a detached duplicate of it.
 */
export function runIfAvailabilitySearchAllowed(
  tryBeginAvailabilitySearch: () => boolean,
  performSearch: () => void
): boolean {
  if (!tryBeginAvailabilitySearch()) {
    return false;
  }
  performSearch();
  return true;
}
