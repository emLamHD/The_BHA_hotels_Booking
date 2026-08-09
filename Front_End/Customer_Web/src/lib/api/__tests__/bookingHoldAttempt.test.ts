import { describe, expect, it } from "vitest";
import {
  ActiveHoldSession,
  SelectedOfferSnapshot,
  buildBookingHoldRequest,
  mergeHoldSession,
  normalizeContact,
  requestsAreEqual,
  validateContact,
} from "../bookingHoldAttempt";
import { CreateBookingHoldResult } from "../bookingHoldService";
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

const VALID_CONTACT = {
  fullName: "  Jane Doe  ",
  email: "  jane.doe@example.com  ",
  phone: " +1 555 123 4567 ",
};

describe("normalizeContact", () => {
  it("trims whitespace from every field", () => {
    expect(normalizeContact(VALID_CONTACT)).toEqual({
      fullName: "Jane Doe",
      email: "jane.doe@example.com",
      phone: "+1 555 123 4567",
    });
  });
});

describe("validateContact", () => {
  it("accepts a valid, already-trimmed contact", () => {
    expect(validateContact(VALID_CONTACT)).toBeNull();
  });

  it("rejects a blank full name", () => {
    const errors = validateContact({ ...VALID_CONTACT, fullName: "   " });
    expect(errors?.fullName).toBeTruthy();
  });

  it("rejects a full name over 200 characters", () => {
    const errors = validateContact({ ...VALID_CONTACT, fullName: "a".repeat(201) });
    expect(errors?.fullName).toBeTruthy();
  });

  it("accepts a full name at exactly the 200-character boundary", () => {
    const errors = validateContact({ ...VALID_CONTACT, fullName: "a".repeat(200) });
    expect(errors?.fullName).toBeUndefined();
  });

  it("rejects a malformed email", () => {
    const errors = validateContact({ ...VALID_CONTACT, email: "not-an-email" });
    expect(errors?.email).toBeTruthy();
  });

  it("rejects an email over 256 characters", () => {
    const longLocal = "a".repeat(250);
    const errors = validateContact({ ...VALID_CONTACT, email: `${longLocal}@example.com` });
    expect(errors?.email).toBeTruthy();
  });

  it("rejects a phone shorter than 7 characters", () => {
    const errors = validateContact({ ...VALID_CONTACT, phone: "12345" });
    expect(errors?.phone).toBeTruthy();
  });

  it("rejects a phone longer than 32 characters", () => {
    const errors = validateContact({ ...VALID_CONTACT, phone: "1".repeat(33) });
    expect(errors?.phone).toBeTruthy();
  });

  it("rejects a phone with no ASCII digit", () => {
    const errors = validateContact({ ...VALID_CONTACT, phone: "+-().  -" });
    expect(errors?.phone).toBeTruthy();
  });

  it("rejects a phone containing characters outside the allowed set", () => {
    const errors = validateContact({ ...VALID_CONTACT, phone: "555-123-4567x99!" });
    expect(errors?.phone).toBeTruthy();
  });

  it("accepts a phone at the 7-character boundary", () => {
    const errors = validateContact({ ...VALID_CONTACT, phone: "1234567" });
    expect(errors?.phone).toBeUndefined();
  });

  it("accepts a valid email at exactly the 256-character boundary", () => {
    const email = `${"a".repeat(244)}@example.com`;
    expect(email).toHaveLength(256);

    const errors = validateContact({ ...VALID_CONTACT, email });
    expect(errors?.email).toBeUndefined();
  });

  it("accepts a valid phone at exactly the 32-character boundary", () => {
    const phone = "1".repeat(32);
    expect(phone).toHaveLength(32);

    const errors = validateContact({ ...VALID_CONTACT, phone });
    expect(errors?.phone).toBeUndefined();
  });
});

describe("buildBookingHoldRequest", () => {
  it("uses the exact selected offer plus submitted Availability criteria, never draft edits", () => {
    const request = buildBookingHoldRequest(OFFER, VALID_CONTACT);

    expect(request).toEqual({
      propertyId: OFFER.propertyId,
      roomTypeId: OFFER.roomTypeId,
      ratePlanId: OFFER.ratePlanId,
      checkIn: OFFER.checkIn,
      checkOut: OFFER.checkOut,
      adults: OFFER.adults,
      children: OFFER.children,
      rooms: OFFER.rooms,
      fullName: "Jane Doe",
      email: "jane.doe@example.com",
      phone: "+1 555 123 4567",
    });
  });

  it("normalizes contact fields exactly once when building the request", () => {
    const request = buildBookingHoldRequest(OFFER, VALID_CONTACT);
    expect(request.fullName).toBe("Jane Doe");
  });
});

describe("requestsAreEqual", () => {
  it("returns true for two requests built from the same offer and contact", () => {
    const a = buildBookingHoldRequest(OFFER, VALID_CONTACT);
    const b = buildBookingHoldRequest(OFFER, VALID_CONTACT);
    expect(requestsAreEqual(a, b)).toBe(true);
  });

  it("returns false when the offer changes", () => {
    const a = buildBookingHoldRequest(OFFER, VALID_CONTACT);
    const b = buildBookingHoldRequest({ ...OFFER, roomTypeId: "different" }, VALID_CONTACT);
    expect(requestsAreEqual(a, b)).toBe(false);
  });

  it("returns false when the submitted criteria changes", () => {
    const a = buildBookingHoldRequest(OFFER, VALID_CONTACT);
    const b = buildBookingHoldRequest({ ...OFFER, adults: 3 }, VALID_CONTACT);
    expect(requestsAreEqual(a, b)).toBe(false);
  });

  it("returns false when contact data changes", () => {
    const a = buildBookingHoldRequest(OFFER, VALID_CONTACT);
    const b = buildBookingHoldRequest(OFFER, { ...VALID_CONTACT, email: "other@example.com" });
    expect(requestsAreEqual(a, b)).toBe(false);
  });
});

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

function resultFixture(overrides: Partial<CreateBookingHoldResult> = {}): CreateBookingHoldResult {
  return {
    hold: holdFixture(),
    outcome: "created",
    ...overrides,
  };
}

describe("mergeHoldSession", () => {
  it("retains a real token from the initial anonymous creation", () => {
    const result = resultFixture({
      hold: holdFixture({ guestAccessToken: "one-time-token" }),
      outcome: "created",
    });

    const session = mergeHoldSession(null, result);
    expect(session.guestAccessToken).toBe("one-time-token");
  });

  it("does not let a same-Hold replay's null token overwrite a retained token", () => {
    const previous: ActiveHoldSession = {
      hold: holdFixture({ guestAccessToken: null }),
      guestAccessToken: "retained-token",
      outcome: "created",
    };
    const replay = resultFixture({
      hold: holdFixture({ guestAccessToken: null }),
      outcome: "replayed",
    });

    const session = mergeHoldSession(previous, replay);
    expect(session.guestAccessToken).toBe("retained-token");
    expect(session.outcome).toBe("replayed");
  });

  it("stays honestly tokenless for a replay with no retained token", () => {
    const replay = resultFixture({
      hold: holdFixture({ guestAccessToken: null }),
      outcome: "replayed",
    });

    const session = mergeHoldSession(null, replay);
    expect(session.guestAccessToken).toBeNull();
  });

  it("does not carry a retained token across to a different Hold ID", () => {
    const previous: ActiveHoldSession = {
      hold: holdFixture({ holdId: "old-hold", guestAccessToken: null }),
      guestAccessToken: "retained-token",
      outcome: "created",
    };
    const differentHold = resultFixture({
      hold: holdFixture({ holdId: "new-hold", guestAccessToken: null }),
      outcome: "replayed",
    });

    const session = mergeHoldSession(previous, differentHold);
    expect(session.guestAccessToken).toBeNull();
  });

  it("an authenticated Hold legitimately has no token and none is fabricated", () => {
    const result = resultFixture({ hold: holdFixture({ guestAccessToken: null }), outcome: "created" });
    const session = mergeHoldSession(null, result);
    expect(session.guestAccessToken).toBeNull();
  });
});
