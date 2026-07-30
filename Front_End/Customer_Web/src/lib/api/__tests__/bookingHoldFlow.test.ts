import { describe, expect, it } from "vitest";
import {
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "../bookingHoldFlow";
import { SelectedOfferSnapshot } from "../bookingHoldAttempt";
import { BookingHoldDto } from "../bookingHoldTypes";

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
