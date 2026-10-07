import { describe, expect, it } from "vitest";
import {
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "../bookingHoldFlow";
import { BookingHoldConfirmationAttemptSnapshot, SelectedOfferSnapshot } from "../bookingHoldAttempt";
import { BookingHoldDto, ReservationDto } from "../bookingHoldTypes";
import { ConfirmBookingHoldResult } from "../bookingHoldService";

const OFFER: SelectedOfferSnapshot = {
  propertyId: "10000000-0000-0000-0000-000000000001",
  roomTypeId: "30000000-0000-0000-0000-000000000001",
  ratePlanId: "60000000-0000-0000-0000-000000000001",
  checkIn: "2026-08-01",
  checkOut: "2026-08-03",
  adults: 2,
  children: 0,
  rooms: 1,
};

const OTHER_OFFER: SelectedOfferSnapshot = { ...OFFER, roomTypeId: "30000000-0000-0000-0000-000000000002" };

const CONTACT = { fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567" };

const ATTEMPT = {
  request: {
    propertyId: OFFER.propertyId,
    roomTypeId: OFFER.roomTypeId,
    ratePlanId: OFFER.ratePlanId,
    checkIn: OFFER.checkIn,
    checkOut: OFFER.checkOut,
    adults: OFFER.adults,
    children: OFFER.children,
    rooms: OFFER.rooms,
    fullName: CONTACT.fullName,
    email: CONTACT.email,
    phone: CONTACT.phone,
  },
  idempotencyKey: "bha-hold-fixed-key-1",
};

function holdFixture(overrides: Partial<BookingHoldDto> = {}): BookingHoldDto {
  return {
    holdId: "aaaaaaaa-0000-0000-0000-000000000001",
    status: "Active",
    propertyId: OFFER.propertyId,
    roomTypeId: OFFER.roomTypeId,
    ratePlanId: OFFER.ratePlanId,
    checkIn: OFFER.checkIn,
    checkOut: OFFER.checkOut,
    adults: OFFER.adults,
    children: OFFER.children,
    rooms: OFFER.rooms,
    currencyCode: "VND",
    totalAmount: 3000000,
    createdAtUtc: "2026-07-30T01:59:50.389Z",
    expiresAtUtc: "2026-07-30T02:14:50.389Z",
    nights: [],
    guestAccessToken: null,
    ...overrides,
  };
}

function selected(): BookingHoldFlowState {
  return bookingHoldFlowReducer(initialBookingHoldFlowState, {
    type: "offer-selected",
    offer: OFFER,
    label: "Deluxe King · Standard Rate at The BHA Hotel",
  });
}

/** Reaches active-session with a retained guest token via the real submit/success path. */
function activeSessionState(overrides: { guestAccessToken?: string | null } = {}): BookingHoldFlowState {
  const guestAccessToken = overrides.guestAccessToken ?? "guest-token-value";
  let state = bookingHoldFlowReducer(selected(), {
    type: "submit-requested",
    attempt: ATTEMPT,
    operationId: 1,
  });
  state = bookingHoldFlowReducer(state, {
    type: "attempt-succeeded",
    operationId: 1,
    result: { hold: holdFixture({ guestAccessToken }), outcome: "created" },
  });
  return state;
}

function matchingConfirmationAttempt(state: BookingHoldFlowState): BookingHoldConfirmationAttemptSnapshot {
  return { holdId: state.session!.hold.holdId, guestAccessToken: state.session!.guestAccessToken };
}

function confirmingState(): BookingHoldFlowState {
  const active = activeSessionState();
  return bookingHoldFlowReducer(active, {
    type: "confirmation-requested",
    attempt: matchingConfirmationAttempt(active),
    operationId: 2,
  });
}

function confirmKnownErrorState(): BookingHoldFlowState {
  return bookingHoldFlowReducer(confirmingState(), {
    type: "confirmation-known-error",
    operationId: 2,
    message: "Booking Hold cannot be confirmed.",
  });
}

function confirmUncertainState(): BookingHoldFlowState {
  return bookingHoldFlowReducer(confirmingState(), { type: "confirmation-uncertain", operationId: 2 });
}

function reservationFixture(overrides: Partial<ReservationDto> = {}): ReservationDto {
  return {
    reservationId: "bbbbbbbb-0000-0000-0000-000000000001",
    confirmationNumber: "BHA2QK7X9F3M8N1P5R7T2V4W6",
    status: "Confirmed",
    propertyId: OFFER.propertyId,
    roomTypeId: OFFER.roomTypeId,
    ratePlanId: OFFER.ratePlanId,
    fullName: CONTACT.fullName,
    email: CONTACT.email,
    phone: CONTACT.phone,
    checkIn: OFFER.checkIn,
    checkOut: OFFER.checkOut,
    adults: OFFER.adults,
    children: OFFER.children,
    rooms: OFFER.rooms,
    currencyCode: "VND",
    totalAmount: 3000000,
    confirmedAtUtc: "2026-07-30T02:00:10.123Z",
    cancelledAtUtc: null,
    cancellationReason: null,
    nights: [],
    ...overrides,
  };
}

function confirmationResult(outcome: "confirmed" | "replayed" = "confirmed"): ConfirmBookingHoldResult {
  return { reservation: reservationFixture(), outcome };
}

function reservationResultState(): BookingHoldFlowState {
  return bookingHoldFlowReducer(confirmingState(), {
    type: "confirmation-succeeded",
    operationId: 2,
    result: confirmationResult(),
  });
}

describe("bookingHoldFlowReducer — offer selection", () => {
  it("idle -> selected sets the offer/label and clears prior attempt/errors", () => {
    const state = selected();
    expect(state.phase).toBe("selected");
    expect(state.offer).toEqual(OFFER);
    expect(state.attempt).toBeNull();
    expect(state.fieldErrors).toBeNull();
  });

  it("is a no-op while submitting", () => {
    const submitting = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const result = bookingHoldFlowReducer(submitting, {
      type: "offer-selected",
      offer: OTHER_OFFER,
      label: "other",
    });
    expect(result).toBe(submitting);
    expect(result.offer).toEqual(OFFER);
  });

  it("is a no-op while uncertain", () => {
    const uncertain = bookingHoldFlowReducer(
      bookingHoldFlowReducer(selected(), { type: "submit-requested", attempt: ATTEMPT, operationId: 1 }),
      { type: "attempt-uncertain", operationId: 1 }
    );
    const result = bookingHoldFlowReducer(uncertain, {
      type: "offer-selected",
      offer: OTHER_OFFER,
      label: "other",
    });
    expect(result).toBe(uncertain);
  });

  it("is a no-op while an active session exists (no second Hold)", () => {
    const active = bookingHoldFlowReducer(
      bookingHoldFlowReducer(selected(), { type: "submit-requested", attempt: ATTEMPT, operationId: 1 }),
      { type: "attempt-succeeded", operationId: 1, result: { hold: holdFixture(), outcome: "created" } }
    );
    const result = bookingHoldFlowReducer(active, {
      type: "offer-selected",
      offer: OTHER_OFFER,
      label: "other",
    });
    expect(result).toBe(active);
  });
});

describe("bookingHoldFlowReducer — contact editing", () => {
  it("updates contact while selected", () => {
    const result = bookingHoldFlowReducer(selected(), { type: "contact-changed", contact: CONTACT });
    expect(result.contact).toEqual(CONTACT);
  });

  it("is a no-op while idle (no offer selected)", () => {
    const result = bookingHoldFlowReducer(initialBookingHoldFlowState, {
      type: "contact-changed",
      contact: CONTACT,
    });
    expect(result).toBe(initialBookingHoldFlowState);
  });

  it("is a no-op while submitting or uncertain", () => {
    const submitting = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const result = bookingHoldFlowReducer(submitting, {
      type: "contact-changed",
      contact: { ...CONTACT, fullName: "Changed" },
    });
    expect(result).toBe(submitting);
  });
});

describe("bookingHoldFlowReducer — submit/retry transitions", () => {
  it("submit-requested moves selected -> submitting with the exact attempt", () => {
    const result = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 7,
    });
    expect(result.phase).toBe("submitting");
    expect(result.attempt).toEqual(ATTEMPT);
    expect(result.operationId).toBe(7);
  });

  it("submit-requested is a no-op while already submitting", () => {
    const submitting = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const result = bookingHoldFlowReducer(submitting, {
      type: "submit-requested",
      attempt: { ...ATTEMPT, idempotencyKey: "different-key" },
      operationId: 2,
    });
    expect(result).toBe(submitting);
  });

  it("submit-requested is a no-op while uncertain (must use exact retry instead)", () => {
    const uncertain = bookingHoldFlowReducer(
      bookingHoldFlowReducer(selected(), { type: "submit-requested", attempt: ATTEMPT, operationId: 1 }),
      { type: "attempt-uncertain", operationId: 1 }
    );
    const result = bookingHoldFlowReducer(uncertain, {
      type: "submit-requested",
      attempt: { ...ATTEMPT, idempotencyKey: "new-key-should-be-rejected" },
      operationId: 99,
    });
    expect(result).toBe(uncertain);
    expect(result.attempt).toEqual(ATTEMPT);
  });

  it("retry-requested moves uncertain -> submitting reusing the retained attempt", () => {
    const uncertain = bookingHoldFlowReducer(
      bookingHoldFlowReducer(selected(), { type: "submit-requested", attempt: ATTEMPT, operationId: 1 }),
      { type: "attempt-uncertain", operationId: 1 }
    );
    const result = bookingHoldFlowReducer(uncertain, { type: "retry-requested", operationId: 2 });
    expect(result.phase).toBe("submitting");
    expect(result.attempt).toEqual(ATTEMPT);
    expect(result.operationId).toBe(2);
  });

  it("retry-requested is a no-op outside uncertain", () => {
    const input = selected();
    const result = bookingHoldFlowReducer(input, { type: "retry-requested", operationId: 2 });
    expect(result).toBe(input);
  });
});

describe("bookingHoldFlowReducer — stale-operation guard", () => {
  it("ignores a stale success whose operationId no longer matches the current operation", () => {
    // Operation 1 fails known-error (operationId stays 1, but phase leaves "submitting").
    let state = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    state = bookingHoldFlowReducer(state, {
      type: "attempt-known-error",
      operationId: 1,
      message: "Invalid booking Hold request",
    });
    expect(state.phase).toBe("known-error");

    // A fresh submit starts operation 2.
    const attempt2 = { ...ATTEMPT, idempotencyKey: "bha-hold-fixed-key-2" };
    state = bookingHoldFlowReducer(state, {
      type: "submit-requested",
      attempt: attempt2,
      operationId: 2,
    });
    expect(state.phase).toBe("submitting");
    expect(state.operationId).toBe(2);

    // Operation 1's stale success arrives late and must be ignored.
    const staleResult = { hold: holdFixture({ holdId: "stale-hold" }), outcome: "created" as const };
    const afterStale = bookingHoldFlowReducer(state, {
      type: "attempt-succeeded",
      operationId: 1,
      result: staleResult,
    });
    expect(afterStale).toBe(state);
    expect(afterStale.session).toBeNull();
  });

  it("ignores a stale failure that would otherwise turn a successful session back to uncertain", () => {
    let state = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    // Operation 1 succeeds.
    const result = { hold: holdFixture({ holdId: "real-hold" }), outcome: "created" as const };
    state = bookingHoldFlowReducer(state, { type: "attempt-succeeded", operationId: 1, result });
    expect(state.phase).toBe("active-session");
    expect(state.session?.hold.holdId).toBe("real-hold");

    // A stale failure for the same (or any) prior operation must not undo the success.
    const afterStaleFailure = bookingHoldFlowReducer(state, {
      type: "attempt-uncertain",
      operationId: 1,
    });
    expect(afterStaleFailure).toBe(state);
    expect(afterStaleFailure.phase).toBe("active-session");
    expect(afterStaleFailure.session?.hold.holdId).toBe("real-hold");
  });

  it("ignores a stale known-error completion once the flow has moved to active-session", () => {
    let state = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const result = { hold: holdFixture(), outcome: "created" as const };
    state = bookingHoldFlowReducer(state, { type: "attempt-succeeded", operationId: 1, result });

    const afterStale = bookingHoldFlowReducer(state, {
      type: "attempt-known-error",
      operationId: 1,
      message: "should be ignored",
    });
    expect(afterStale).toBe(state);
  });
});

// The guest-token retention matrix itself (same-Hold replay-null,
// different-Hold isolation, no-retained-token honesty) is covered directly
// against `mergeHoldSession` in bookingHoldAttempt.test.ts; the
// stale-operation tests above already confirm the reducer's
// "attempt-succeeded" case applies that same merge to `state.session`.

describe("bookingHoldFlowReducer — definitive-success scrubbing (P2)", () => {
  it("resets contact and clears offer/offerLabel/attempt/fieldErrors/errorMessage", () => {
    let state = bookingHoldFlowReducer(selected(), {
      type: "contact-changed",
      contact: CONTACT,
    });
    state = bookingHoldFlowReducer(state, {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    // A prior validation failure should also be scrubbed, not just a
    // successful field set.
    state = { ...state, fieldErrors: { fullName: "stale error" } };

    const result = { hold: holdFixture({ guestAccessToken: "one-time-token" }), outcome: "created" as const };
    const afterSuccess = bookingHoldFlowReducer(state, {
      type: "attempt-succeeded",
      operationId: 1,
      result,
    });

    expect(afterSuccess.phase).toBe("active-session");
    expect(afterSuccess.contact).toEqual({ fullName: "", email: "", phone: "" });
    expect(afterSuccess.offer).toBeNull();
    expect(afterSuccess.offerLabel).toBeNull();
    expect(afterSuccess.attempt).toBeNull();
    expect(afterSuccess.fieldErrors).toBeNull();
    expect(afterSuccess.errorMessage).toBeNull();
  });

  it("still retains the correct server-backed active session and guest token", () => {
    const state = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const result = { hold: holdFixture({ guestAccessToken: "one-time-token" }), outcome: "created" as const };
    const afterSuccess = bookingHoldFlowReducer(state, {
      type: "attempt-succeeded",
      operationId: 1,
      result,
    });

    expect(afterSuccess.session?.hold).toEqual(holdFixture({ guestAccessToken: "one-time-token" }));
    expect(afterSuccess.session?.outcome).toBe("created");
    expect(afterSuccess.session?.guestAccessToken).toBe("one-time-token");
  });

  it("still applies the same-Hold replay-null guest-token retention rule on success", () => {
    // First success retains a real token (simulated directly, mirroring the
    // stale-operation tests' pattern of composing states by hand for a
    // scenario the reducer's own guards would not let arise sequentially).
    const firstSession = {
      hold: holdFixture({ holdId: "hold-1", guestAccessToken: null }),
      guestAccessToken: "retained-token",
      outcome: "created" as const,
    };
    const stateWithPriorSession: BookingHoldFlowState = {
      ...selected(),
      session: firstSession,
      phase: "submitting",
      attempt: ATTEMPT,
      operationId: 5,
    };

    const replay = {
      hold: holdFixture({ holdId: "hold-1", guestAccessToken: null }),
      outcome: "replayed" as const,
    };
    const afterReplay = bookingHoldFlowReducer(stateWithPriorSession, {
      type: "attempt-succeeded",
      operationId: 5,
      result: replay,
    });

    expect(afterReplay.session?.guestAccessToken).toBe("retained-token");
    expect(afterReplay.contact).toEqual({ fullName: "", email: "", phone: "" });
    expect(afterReplay.offer).toBeNull();
  });

  it("does not scrub contact/attempt while merely uncertain (retained for exact retry)", () => {
    let state = bookingHoldFlowReducer(selected(), {
      type: "contact-changed",
      contact: CONTACT,
    });
    state = bookingHoldFlowReducer(state, {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const afterUncertain = bookingHoldFlowReducer(state, {
      type: "attempt-uncertain",
      operationId: 1,
    });

    expect(afterUncertain.phase).toBe("uncertain");
    expect(afterUncertain.contact).toEqual(CONTACT);
    expect(afterUncertain.attempt).toEqual(ATTEMPT);
    expect(afterUncertain.offer).toEqual(OFFER);
  });

  it("does not scrub contact while transitioning to known-error (contact stays editable)", () => {
    let state = bookingHoldFlowReducer(selected(), {
      type: "contact-changed",
      contact: CONTACT,
    });
    state = bookingHoldFlowReducer(state, {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    const afterKnownError = bookingHoldFlowReducer(state, {
      type: "attempt-known-error",
      operationId: 1,
      message: "Invalid booking Hold request",
    });

    expect(afterKnownError.phase).toBe("known-error");
    expect(afterKnownError.contact).toEqual(CONTACT);
    expect(afterKnownError.offer).toEqual(OFFER);
  });
});

describe("bookingHoldFlowReducer — search-reset", () => {
  it("resets an idle/selected/known-error selection to idle", () => {
    const result = bookingHoldFlowReducer(selected(), { type: "search-reset" });
    expect(result.phase).toBe("idle");
    expect(result.offer).toBeNull();
  });

  it("is a no-op while submitting, uncertain, or active-session", () => {
    const submitting = bookingHoldFlowReducer(selected(), {
      type: "submit-requested",
      attempt: ATTEMPT,
      operationId: 1,
    });
    expect(bookingHoldFlowReducer(submitting, { type: "search-reset" })).toBe(submitting);

    const uncertain = bookingHoldFlowReducer(submitting, { type: "attempt-uncertain", operationId: 1 });
    expect(bookingHoldFlowReducer(uncertain, { type: "search-reset" })).toBe(uncertain);

    const active = bookingHoldFlowReducer(
      bookingHoldFlowReducer(selected(), { type: "submit-requested", attempt: ATTEMPT, operationId: 1 }),
      { type: "attempt-succeeded", operationId: 1, result: { hold: holdFixture(), outcome: "created" } }
    );
    expect(bookingHoldFlowReducer(active, { type: "search-reset" })).toBe(active);
  });
});

describe("bookingHoldFlowReducer — confirmation lifecycle (P2)", () => {
  it("active-session -> confirming stores the exact matching confirmation snapshot", () => {
    const active = activeSessionState();
    const attempt = matchingConfirmationAttempt(active);
    const result = bookingHoldFlowReducer(active, {
      type: "confirmation-requested",
      attempt,
      operationId: 2,
    });

    expect(result.phase).toBe("confirming");
    expect(result.confirmationAttempt).toEqual(attempt);
    expect(result.operationId).toBe(2);
    expect(result.session).toEqual(active.session);
  });

  it("confirmation-requested is a no-op outside active-session", () => {
    const state = selected();
    const result = bookingHoldFlowReducer(state, {
      type: "confirmation-requested",
      attempt: { holdId: "some-hold-id", guestAccessToken: null },
      operationId: 2,
    });
    expect(result).toBe(state);
  });

  it("confirmation-requested rejects a mismatched Hold ID", () => {
    const active = activeSessionState();
    const result = bookingHoldFlowReducer(active, {
      type: "confirmation-requested",
      attempt: { holdId: "mismatched-hold-id", guestAccessToken: active.session!.guestAccessToken },
      operationId: 2,
    });
    expect(result).toBe(active);
  });

  it("confirmation-requested rejects a mismatched guest token", () => {
    const active = activeSessionState();
    const result = bookingHoldFlowReducer(active, {
      type: "confirmation-requested",
      attempt: { holdId: active.session!.hold.holdId, guestAccessToken: "wrong-token" },
      operationId: 2,
    });
    expect(result).toBe(active);
  });

  it("confirmation-known-error retains the session, guest token, and exact attempt", () => {
    const confirming = confirmingState();
    const result = bookingHoldFlowReducer(confirming, {
      type: "confirmation-known-error",
      operationId: 2,
      message: "Booking Hold cannot be confirmed.",
    });

    expect(result.phase).toBe("confirm-known-error");
    expect(result.session).toEqual(confirming.session);
    expect(result.session?.guestAccessToken).toBe(confirming.session!.guestAccessToken);
    expect(result.confirmationAttempt).toEqual(confirming.confirmationAttempt);
    expect(result.errorMessage).toBe("Booking Hold cannot be confirmed.");
  });

  it("confirmation-uncertain retains the session, guest token, and exact attempt", () => {
    const confirming = confirmingState();
    const result = bookingHoldFlowReducer(confirming, { type: "confirmation-uncertain", operationId: 2 });

    expect(result.phase).toBe("confirm-uncertain");
    expect(result.session).toEqual(confirming.session);
    expect(result.session?.guestAccessToken).toBe(confirming.session!.guestAccessToken);
    expect(result.confirmationAttempt).toEqual(confirming.confirmationAttempt);
  });

  it("exact retry from confirm-uncertain returns to confirming with the unchanged attempt", () => {
    const uncertain = confirmUncertainState();
    const result = bookingHoldFlowReducer(uncertain, {
      type: "confirmation-retry-requested",
      operationId: 3,
    });

    expect(result.phase).toBe("confirming");
    expect(result.confirmationAttempt).toEqual(uncertain.confirmationAttempt);
    expect(result.operationId).toBe(3);
  });

  it("exact retry from confirm-known-error returns to confirming with the unchanged attempt", () => {
    const knownError = confirmKnownErrorState();
    const result = bookingHoldFlowReducer(knownError, {
      type: "confirmation-retry-requested",
      operationId: 3,
    });

    expect(result.phase).toBe("confirming");
    expect(result.confirmationAttempt).toEqual(knownError.confirmationAttempt);
    expect(result.operationId).toBe(3);
  });

  it("confirmation-retry-requested is a no-op outside confirm-uncertain/confirm-known-error", () => {
    const confirming = confirmingState();
    const result = bookingHoldFlowReducer(confirming, {
      type: "confirmation-retry-requested",
      operationId: 3,
    });
    expect(result).toBe(confirming);
  });

  it("confirmation-succeeded stores the Reservation result and moves to reservation-result", () => {
    const confirming = confirmingState();
    const result = confirmationResult("confirmed");
    const afterSuccess = bookingHoldFlowReducer(confirming, {
      type: "confirmation-succeeded",
      operationId: 2,
      result,
    });

    expect(afterSuccess.phase).toBe("reservation-result");
    expect(afterSuccess.reservationResult).toEqual(result);
  });

  it("confirmation-succeeded clears the active session, guest token, and confirmation attempt", () => {
    const confirming = confirmingState();
    const afterSuccess = bookingHoldFlowReducer(confirming, {
      type: "confirmation-succeeded",
      operationId: 2,
      result: confirmationResult(),
    });

    expect(afterSuccess.session).toBeNull();
    expect(afterSuccess.confirmationAttempt).toBeNull();
    expect(afterSuccess.offer).toBeNull();
    expect(afterSuccess.offerLabel).toBeNull();
    expect(afterSuccess.attempt).toBeNull();
    expect(afterSuccess.errorMessage).toBeNull();
    expect(afterSuccess.contact).toEqual({ fullName: "", email: "", phone: "" });
  });

  it.each(["confirmed", "replayed"] as const)(
    "preserves the %s confirmation outcome in the Reservation result",
    (outcome) => {
      const confirming = confirmingState();
      const result = confirmationResult(outcome);
      const afterSuccess = bookingHoldFlowReducer(confirming, {
        type: "confirmation-succeeded",
        operationId: 2,
        result,
      });
      expect(afterSuccess.reservationResult?.outcome).toBe(outcome);
      expect(afterSuccess.reservationResult?.reservation).toEqual(result.reservation);
    }
  );

  it("ignores a stale confirmation success whose operationId no longer matches", () => {
    let state = confirmingState();
    // Operation 2 fails known-error (operationId stays 2, phase leaves "confirming").
    state = bookingHoldFlowReducer(state, {
      type: "confirmation-known-error",
      operationId: 2,
      message: "Booking Hold cannot be confirmed.",
    });
    expect(state.phase).toBe("confirm-known-error");

    // A fresh retry starts operation 3.
    state = bookingHoldFlowReducer(state, { type: "confirmation-retry-requested", operationId: 3 });
    expect(state.phase).toBe("confirming");
    expect(state.operationId).toBe(3);

    // Operation 2's stale success arrives late and must be ignored.
    const staleResult = confirmationResult("confirmed");
    const afterStale = bookingHoldFlowReducer(state, {
      type: "confirmation-succeeded",
      operationId: 2,
      result: staleResult,
    });
    expect(afterStale).toBe(state);
    expect(afterStale.reservationResult).toBeNull();
  });

  it("ignores a stale confirmation known-error once the flow has reached reservation-result", () => {
    const state = reservationResultState();
    const afterStale = bookingHoldFlowReducer(state, {
      type: "confirmation-known-error",
      operationId: 2,
      message: "should be ignored",
    });
    expect(afterStale).toBe(state);
  });

  it("ignores a stale confirmation-uncertain once the flow has reached reservation-result", () => {
    const state = reservationResultState();
    const afterStale = bookingHoldFlowReducer(state, { type: "confirmation-uncertain", operationId: 2 });
    expect(afterStale).toBe(state);
  });

  it("offer-selected, contact-changed, search-reset, and submit-requested are no-ops during confirming", () => {
    const state = confirmingState();
    expect(
      bookingHoldFlowReducer(state, { type: "offer-selected", offer: OTHER_OFFER, label: "other" })
    ).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "contact-changed", contact: { ...CONTACT, fullName: "x" } })
    ).toBe(state);
    expect(bookingHoldFlowReducer(state, { type: "search-reset" })).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "submit-requested", attempt: ATTEMPT, operationId: 999 })
    ).toBe(state);
  });

  it("offer-selected, contact-changed, search-reset, and submit-requested are no-ops during confirm-known-error", () => {
    const state = confirmKnownErrorState();
    expect(
      bookingHoldFlowReducer(state, { type: "offer-selected", offer: OTHER_OFFER, label: "other" })
    ).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "contact-changed", contact: { ...CONTACT, fullName: "x" } })
    ).toBe(state);
    expect(bookingHoldFlowReducer(state, { type: "search-reset" })).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "submit-requested", attempt: ATTEMPT, operationId: 999 })
    ).toBe(state);
  });

  it("offer-selected, contact-changed, search-reset, and submit-requested are no-ops during confirm-uncertain", () => {
    const state = confirmUncertainState();
    expect(
      bookingHoldFlowReducer(state, { type: "offer-selected", offer: OTHER_OFFER, label: "other" })
    ).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "contact-changed", contact: { ...CONTACT, fullName: "x" } })
    ).toBe(state);
    expect(bookingHoldFlowReducer(state, { type: "search-reset" })).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "submit-requested", attempt: ATTEMPT, operationId: 999 })
    ).toBe(state);
  });

  it("offer-selected, contact-changed, search-reset, and submit-requested are no-ops during reservation-result", () => {
    const state = reservationResultState();
    expect(
      bookingHoldFlowReducer(state, { type: "offer-selected", offer: OTHER_OFFER, label: "other" })
    ).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "contact-changed", contact: { ...CONTACT, fullName: "x" } })
    ).toBe(state);
    expect(bookingHoldFlowReducer(state, { type: "search-reset" })).toBe(state);
    expect(
      bookingHoldFlowReducer(state, { type: "submit-requested", attempt: ATTEMPT, operationId: 999 })
    ).toBe(state);
  });
});
