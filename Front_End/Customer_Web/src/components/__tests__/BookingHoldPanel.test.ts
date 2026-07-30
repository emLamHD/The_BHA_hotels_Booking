import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "@/lib/api/bookingHoldFlow";
import { SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import { BookingHoldDto } from "@/lib/api/bookingHoldTypes";
import { formatCurrencyAmount } from "@/lib/api/availabilityPresentation";

const mockedFlow = vi.hoisted(() => ({ state: null as unknown }));

vi.mock("@/app/BookingHoldProvider", () => ({
  useBookingHoldFlow: () => ({
    state: mockedFlow.state,
    updateContact: () => undefined,
    submit: () => undefined,
    retryExact: () => undefined,
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
    ["selected", selectedState(), "Confirm Hold"],
    [
      "submitting",
      bookingHoldFlowReducer(selectedState(), {
        type: "submit-requested",
        attempt: ATTEMPT,
        operationId: 1,
      }),
      "Creating your Hold",
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
