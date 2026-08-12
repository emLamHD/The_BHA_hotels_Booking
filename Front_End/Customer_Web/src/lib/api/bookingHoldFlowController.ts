import {
  BookingHoldAttemptSnapshot,
  BookingHoldConfirmationAttemptSnapshot,
  ContactInput,
  SelectedOfferSnapshot,
  buildBookingHoldRequest,
  validateContact,
} from "./bookingHoldAttempt";
import { BookingHoldFlowAction, BookingHoldFlowState } from "./bookingHoldFlow";
import { confirmBookingHold, createBookingHold } from "./bookingHoldService";
import { generateIdempotencyKey } from "./idempotencyKey";
import { ApiConfigError, ApiHttpError, ApiNetworkError, ApiValidationError } from "./errors";
import { isRequestCancelledError } from "./httpClient";

function describeError(error: unknown): string {
  if (error instanceof ApiValidationError) {
    const firstFieldMessage = Object.values(error.errors).flat()[0];
    return firstFieldMessage ?? error.problem.detail ?? error.problem.title;
  }
  if (error instanceof ApiHttpError) {
    return error.problem.detail ?? error.problem.title;
  }
  if (error instanceof ApiConfigError) {
    return "The booking service is not configured correctly.";
  }
  return "Something went wrong while creating your Hold.";
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
): BookingHoldFlowController {
  const { getState, dispatch, onAttemptStart } = options;

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
    if (inFlight) {
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
      const phase = getState().phase;
      if (CONFIRMATION_LOCKED_PHASES.has(phase)) {
        return;
      }
      offerSelectionActive = true;
      dispatch({ type: "offer-selected", offer, label });
    },

    updateContact(contact) {
      const phase = getState().phase;
      if (phase !== "selected" && phase !== "known-error") {
        return;
      }
      dispatch({ type: "contact-changed", contact });
    },

    submit() {
      if (inFlight) {
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
      if (inFlight) {
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
      if (inFlight) {
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
      if (inFlight) {
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
