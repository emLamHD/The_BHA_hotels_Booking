import {
  BookingHoldAttemptSnapshot,
  ContactInput,
  SelectedOfferSnapshot,
  buildBookingHoldRequest,
  validateContact,
} from "./bookingHoldAttempt";
import { BookingHoldFlowAction, BookingHoldFlowState } from "./bookingHoldFlow";
import { createBookingHold } from "./bookingHoldService";
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
  /** Abandons an idle/selected/known-error selection; a locked flow ignores this. */
  resetSearchSelection: () => void;
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

  return {
    selectOffer(offer, label) {
      const phase = getState().phase;
      if (phase === "submitting" || phase === "uncertain" || phase === "active-session") {
        return;
      }
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

    resetSearchSelection() {
      const phase = getState().phase;
      if (phase === "submitting" || phase === "uncertain" || phase === "active-session") {
        return;
      }
      dispatch({ type: "search-reset" });
    },
  };
}
