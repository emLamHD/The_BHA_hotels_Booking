import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "@/lib/api/bookingHoldFlow";
import { BookingHoldConfirmationAttemptSnapshot, SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import { BookingHoldDto, ReservationDto } from "@/lib/api/bookingHoldTypes";
import { ConfirmBookingHoldResult } from "@/lib/api/bookingHoldService";
import { formatCurrencyAmount } from "@/lib/api/availabilityPresentation";

const mockedFlow = vi.hoisted(() => ({ state: null as unknown }));

vi.mock("@/app/BookingHoldProvider", () => ({
  useBookingHoldFlow: () => ({
    state: mockedFlow.state,
    updateContact: () => undefined,
    submit: () => undefined,
    retryExact: () => undefined,
    confirmHold: () => undefined,
    retryConfirmationExact: () => undefined,
  }),
}));

import BookingHoldPanel from "../BookingHoldPanel";

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

const CONTACT = {
  fullName: ["contact", "name", "sentinel"].join("-"),
  email: ["contact", "email", "sentinel"].join("-"),
  phone: ["contact", "phone", "sentinel"].join("-"),
};

const ATTEMPT = {
  request: {
    ...OFFER,
    ...CONTACT,
  },
  idempotencyKey: ["attempt", "key", "sentinel"].join("-"),
};

function holdFixture(overrides: Partial<BookingHoldDto> = {}): BookingHoldDto {
  return {
    holdId: "aaaaaaaa-0000-0000-0000-000000000099",
    status: "Active",
    propertyId: "10000000-0000-0000-0000-000000000099",
    roomTypeId: "30000000-0000-0000-0000-000000000099",
    ratePlanId: "60000000-0000-0000-0000-000000000099",
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    adults: 3,
    children: 1,
    rooms: 2,
    currencyCode: "VND",
    totalAmount: 6200000,
    createdAtUtc: "2026-07-30T10:00:00.000Z",
    expiresAtUtc: "2026-07-30T10:15:00.000Z",
    nights: [
      { stayDate: "2026-08-10", rooms: 2, unitAmount: 1500000, nightTotal: 3000000 },
      { stayDate: "2026-08-11", rooms: 2, unitAmount: 1600000, nightTotal: 3200000 },
    ],
    guestAccessToken: ["guest", "token", "sentinel"].join("-"),
    ...overrides,
  };
}

function selectedState(): BookingHoldFlowState {
  let state = bookingHoldFlowReducer(initialBookingHoldFlowState, {
    type: "offer-selected",
    offer: OFFER,
    label: "Selected offer label",
  });
  state = bookingHoldFlowReducer(state, { type: "contact-changed", contact: CONTACT });
  return state;
}

function successfulState(outcome: "created" | "replayed"): BookingHoldFlowState {
  let state = bookingHoldFlowReducer(selectedState(), {
    type: "submit-requested",
    attempt: ATTEMPT,
    operationId: 1,
  });
  state = bookingHoldFlowReducer(state, {
    type: "attempt-succeeded",
    operationId: 1,
    result: { hold: holdFixture(), outcome },
  });
  return state;
}

function matchingConfirmationAttempt(state: BookingHoldFlowState): BookingHoldConfirmationAttemptSnapshot {
  return { holdId: state.session!.hold.holdId, guestAccessToken: state.session!.guestAccessToken };
}

function confirmingState(): BookingHoldFlowState {
  const active = successfulState("created");
  return bookingHoldFlowReducer(active, {
    type: "confirmation-requested",
    attempt: matchingConfirmationAttempt(active),
    operationId: 2,
  });
}

function confirmKnownErrorState(message = "The Hold has expired and cannot be confirmed."): BookingHoldFlowState {
  return bookingHoldFlowReducer(confirmingState(), {
    type: "confirmation-known-error",
    operationId: 2,
    message,
  });
}

function confirmUncertainState(): BookingHoldFlowState {
  return bookingHoldFlowReducer(confirmingState(), { type: "confirmation-uncertain", operationId: 2 });
}

function reservationFixture(overrides: Partial<ReservationDto> = {}): ReservationDto {
  return {
    reservationId: "bbbbbbbb-0000-0000-0000-000000000099",
    confirmationNumber: "BHA2QK7X9F3M8N1P5R7T2V4W6",
    status: "Confirmed",
    propertyId: OFFER.propertyId,
    roomTypeId: OFFER.roomTypeId,
    ratePlanId: OFFER.ratePlanId,
    fullName: ["reservation", "name", "sentinel"].join("-"),
    email: ["reservation", "email", "sentinel"].join("-"),
    phone: ["reservation", "phone", "sentinel"].join("-"),
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    adults: 3,
    children: 1,
    rooms: 2,
    currencyCode: "VND",
    totalAmount: 6200000,
    confirmedAtUtc: "2026-07-30T10:20:00.000Z",
    cancelledAtUtc: null,
    cancellationReason: null,
    nights: [
      { stayDate: "2026-08-10", rooms: 2, unitAmount: 1500000, nightTotal: 3000000 },
      { stayDate: "2026-08-11", rooms: 2, unitAmount: 1600000, nightTotal: 3200000 },
    ],
    ...overrides,
  };
}

function confirmationResult(
  outcome: "confirmed" | "replayed" = "confirmed",
  overrides: Partial<ReservationDto> = {}
): ConfirmBookingHoldResult {
  return { reservation: reservationFixture(overrides), outcome };
}

function reservationResultState(
  outcome: "confirmed" | "replayed" = "confirmed",
  overrides: Partial<ReservationDto> = {}
): BookingHoldFlowState {
  return bookingHoldFlowReducer(confirmingState(), {
    type: "confirmation-succeeded",
    operationId: 2,
    result: confirmationResult(outcome, overrides),
  });
}

function renderPanel(state: BookingHoldFlowState): string {
  mockedFlow.state = state;
  return renderToStaticMarkup(React.createElement(BookingHoldPanel));
}

describe("BookingHoldPanel production render decision", () => {
  it("renders a scrubbed active session without an offer", () => {
    const state = successfulState("created");

    expect(state.phase).toBe("active-session");
    expect(state.offer).toBeNull();
    expect(state.offerLabel).toBeNull();
    expect(state.contact).toEqual({ fullName: "", email: "", phone: "" });
    expect(state.attempt).toBeNull();
    expect(state.session).not.toBeNull();

    const markup = renderPanel(state);
    expect(markup.length > 0).toBe(true);
    expect(markup.includes("Hold created")).toBe(true);
    expect(markup.includes(state.session!.hold.holdId)).toBe(true);
  });

  it("renders the created-Hold presentation from a created session", () => {
    const markup = renderPanel(successfulState("created"));

    expect(markup.includes("Hold created")).toBe(true);
    expect(markup.includes("Hold already exists")).toBe(false);
  });

  it("renders the replayed-Hold presentation from a replayed session", () => {
    const markup = renderPanel(successfulState("replayed"));

    expect(markup.includes("Hold already exists")).toBe(true);
    expect(markup.includes("Hold created")).toBe(false);
  });

  it("renders sanitized server-backed Hold fields after reducer scrubbing", () => {
    const state = successfulState("created");
    const markup = renderPanel(state);
    const hold = state.session!.hold;

    for (const expected of [
      hold.holdId,
      hold.status,
      hold.checkIn,
      hold.checkOut,
      hold.nights![0].stayDate,
      hold.nights![1].stayDate,
      formatCurrencyAmount(hold.nights![0].nightTotal, hold.currencyCode),
      formatCurrencyAmount(hold.nights![1].nightTotal, hold.currencyCode),
      formatCurrencyAmount(hold.totalAmount, hold.currencyCode),
      "Created",
      "Expires",
    ]) {
      expect(markup.includes(expected)).toBe(true);
    }
    expect(markup.includes(OFFER.checkIn)).toBe(false);
    expect(markup.includes("role=\"status\"")).toBe(true);
    expect(markup.includes("aria-live=\"polite\"")).toBe(true);
    expect(markup.includes("tabindex=\"-1\"")).toBe(true);
  });

  it("does not render retained guest-token or submitted contact values and removes form actions", () => {
    const state = successfulState("created");
    const markup = renderPanel(state);
    const sensitiveValues = [
      state.session!.guestAccessToken!,
      state.session!.hold.guestAccessToken!,
      CONTACT.fullName,
      CONTACT.email,
      CONTACT.phone,
      ATTEMPT.idempotencyKey,
    ];

    expect(sensitiveValues.some((value) => markup.includes(value))).toBe(false);
    expect(markup.includes("Full name")).toBe(false);
    expect(markup.includes("Confirm Hold")).toBe(false);
    expect(markup.includes("Retry exact request")).toBe(false);
  });

  it("keeps idle with no session hidden", () => {
    expect(renderPanel(initialBookingHoldFlowState)).toBe("");
  });

  it.each([
    ["selected", selectedState(), "Create 15-minute Hold"],
    [
      "submitting",
      bookingHoldFlowReducer(selectedState(), {
        type: "submit-requested",
        attempt: ATTEMPT,
        operationId: 1,
      }),
      "Creating your 15-minute Hold",
    ],
    [
      "known-error",
      bookingHoldFlowReducer(
        bookingHoldFlowReducer(selectedState(), {
          type: "submit-requested",
          attempt: ATTEMPT,
          operationId: 1,
        }),
        { type: "attempt-known-error", operationId: 1, message: "Known failure" }
      ),
      "Known failure",
    ],
    [
      "uncertain",
      bookingHoldFlowReducer(
        bookingHoldFlowReducer(selectedState(), {
          type: "submit-requested",
          attempt: ATTEMPT,
          operationId: 1,
        }),
        { type: "attempt-uncertain", operationId: 1 }
      ),
      "Retry exact request",
    ],
  ])("retains the existing %s presentation", (_phase, state, expectedText) => {
    expect(renderPanel(state).includes(expectedText)).toBe(true);
  });
});

describe("BookingHoldPanel confirmation lifecycle (P3)", () => {
  it("an active Hold renders the Confirm reservation action", () => {
    const markup = renderPanel(successfulState("created"));
    expect(markup.includes("Confirm reservation")).toBe(true);
  });

  it("an active Hold does not render its retained guest token", () => {
    const state = successfulState("created");
    const markup = renderPanel(state);
    expect(markup.includes(state.session!.guestAccessToken!)).toBe(false);
  });

  it("confirming retains the Hold summary and renders the confirming status", () => {
    const state = confirmingState();
    const markup = renderPanel(state);
    expect(markup.includes(state.session!.hold.holdId)).toBe(true);
    expect(markup.includes("Confirming your reservation")).toBe(true);
  });

  it("confirming does not render a retry action or the Create Hold form", () => {
    const markup = renderPanel(confirmingState());
    expect(markup.includes("Retry confirmation")).toBe(false);
    expect(markup.includes("Retry exact confirmation")).toBe(false);
    expect(markup.includes("Full name")).toBe(false);
    expect(markup.includes("Create 15-minute Hold")).toBe(false);
  });

  it("confirm-known-error renders the customer-safe error as an alert", () => {
    const message = "The Hold has expired and cannot be confirmed.";
    const markup = renderPanel(confirmKnownErrorState(message));
    expect(markup.includes(message)).toBe(true);
    expect(markup.includes('role="alert"')).toBe(true);
  });

  it("confirm-known-error renders the Retry confirmation action", () => {
    const markup = renderPanel(confirmKnownErrorState());
    expect(markup.includes("Retry confirmation")).toBe(true);
  });

  it("confirm-uncertain uses honest ambiguous-result wording, not a failure claim", () => {
    const markup = renderPanel(confirmUncertainState());
    expect(markup.includes("confirm whether your reservation was completed")).toBe(true);
    expect(markup.includes("resends the exact same confirmation")).toBe(true);
    expect(markup.includes("second reservation")).toBe(true);
    expect(markup.includes("confirmation failed")).toBe(false);
  });

  it("confirm-uncertain renders the Retry exact confirmation action", () => {
    const markup = renderPanel(confirmUncertainState());
    expect(markup.includes("Retry exact confirmation")).toBe(true);
  });

  it("reservation-result renders the confirmation number and Reservation status", () => {
    const state = reservationResultState("confirmed");
    const markup = renderPanel(state);
    const reservation = state.reservationResult!.reservation;
    expect(markup.includes(reservation.confirmationNumber!)).toBe(true);
    expect(markup.includes(reservation.status)).toBe(true);
    expect(markup.includes("Reservation confirmed")).toBe(true);
  });

  it("renders check-in/check-out, rooms, adults, and children", () => {
    const state = reservationResultState("confirmed");
    const markup = renderPanel(state);
    const reservation = state.reservationResult!.reservation;
    for (const expected of [
      reservation.checkIn,
      reservation.checkOut,
      `${reservation.rooms} room`,
      `${reservation.adults} adult`,
      `${reservation.children} child`,
    ]) {
      expect(markup.includes(expected)).toBe(true);
    }
  });

  it("renders every nightly stay date, unit price, and night total", () => {
    const state = reservationResultState("confirmed");
    const markup = renderPanel(state);
    const { nights, currencyCode } = state.reservationResult!.reservation;
    for (const night of nights!) {
      expect(markup.includes(night.stayDate)).toBe(true);
      expect(markup.includes(formatCurrencyAmount(night.unitAmount, currencyCode))).toBe(true);
      expect(markup.includes(formatCurrencyAmount(night.nightTotal, currencyCode))).toBe(true);
    }
  });

  it("renders the server-supplied currency/total and confirmation time", () => {
    const state = reservationResultState("confirmed");
    const markup = renderPanel(state);
    const reservation = state.reservationResult!.reservation;
    expect(
      markup.includes(formatCurrencyAmount(reservation.totalAmount, reservation.currencyCode))
    ).toBe(true);
    expect(markup.includes("Confirmed")).toBe(true);
  });

  it("preserves a first-confirmation (outcome 'confirmed') result without a replay note", () => {
    const state = reservationResultState("confirmed");
    const markup = renderPanel(state);
    expect(state.reservationResult!.outcome).toBe("confirmed");
    expect(
      markup.includes("This reservation was already confirmed. Here is the existing confirmation.")
    ).toBe(false);
  });

  it("renders the replay-specific customer message for outcome 'replayed'", () => {
    const state = reservationResultState("replayed");
    const markup = renderPanel(state);
    expect(state.reservationResult!.outcome).toBe("replayed");
    expect(
      markup.includes("This reservation was already confirmed. Here is the existing confirmation.")
    ).toBe(true);
  });

  it("handles null nights honestly without crashing or inventing nightly values", () => {
    const state = reservationResultState("confirmed", { nights: null });
    expect(() => renderPanel(state)).not.toThrow();
    const markup = renderPanel(state);
    expect(markup.includes("Nightly pricing details are not available")).toBe(true);
  });

  it("handles empty nights honestly without crashing or inventing nightly values", () => {
    const state = reservationResultState("confirmed", { nights: [] });
    expect(() => renderPanel(state)).not.toThrow();
    const markup = renderPanel(state);
    expect(markup.includes("Nightly pricing details are not available")).toBe(true);
  });

  it("never renders the guest token across confirming/confirm-known-error/confirm-uncertain", () => {
    for (const state of [confirmingState(), confirmKnownErrorState(), confirmUncertainState()]) {
      const markup = renderPanel(state);
      expect(markup.includes(state.session!.guestAccessToken!)).toBe(false);
      expect(markup.includes(state.confirmationAttempt!.guestAccessToken!)).toBe(false);
    }
  });

  it("reservation-result never renders old contact/idempotency sentinels or Reservation contact fields", () => {
    const state = reservationResultState("confirmed");
    const markup = renderPanel(state);
    const reservation = state.reservationResult!.reservation;

    const sensitiveValues = [
      CONTACT.fullName,
      CONTACT.email,
      CONTACT.phone,
      ATTEMPT.idempotencyKey,
      reservation.fullName!,
      reservation.email!,
      reservation.phone!,
    ];
    expect(sensitiveValues.some((value) => markup.includes(value))).toBe(false);
  });

  it("no lifecycle phase renders the Create Hold contact form", () => {
    for (const state of [
      successfulState("created"),
      confirmingState(),
      confirmKnownErrorState(),
      confirmUncertainState(),
      reservationResultState("confirmed"),
    ]) {
      const markup = renderPanel(state);
      expect(markup.includes("Full name")).toBe(false);
      expect(markup.includes('id="hold-email"')).toBe(false);
      expect(markup.includes('id="hold-phone"')).toBe(false);
    }
  });

  it("reservation-result heading remains programmatically focusable and uses a polite live region", () => {
    const markup = renderPanel(reservationResultState("confirmed"));
    expect(markup.includes('tabindex="-1"')).toBe(true);
    expect(markup.includes('role="status"')).toBe(true);
    expect(markup.includes('aria-live="polite"')).toBe(true);
  });

  it("confirmation lifecycle actions use type=button, never an implicit form submit", () => {
    expect(renderPanel(successfulState("created")).includes('type="button"')).toBe(true);
    expect(renderPanel(confirmKnownErrorState()).includes('type="button"')).toBe(true);
    expect(renderPanel(confirmUncertainState()).includes('type="button"')).toBe(true);
  });
});
