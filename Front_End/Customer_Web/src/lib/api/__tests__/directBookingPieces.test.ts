import { describe, expect, it } from "vitest";
import { isDirectBookingEnabled, parseDirectBookingPropertyIds } from "../directBookingRollout";
import { generateDirectIdempotencyKey, generateGuestAccessToken } from "../directBookingCredentials";
import { createDirectAttemptMarker } from "../directAttemptMarker";
import { buildDirectReservationRequest, ownerKeyOf, verifiedOwnerKey } from "../directBookingAttempt";
import { directApiErrorKey } from "../errorMessages";
import { ApiHttpError } from "../errors";
import { TEST_QUOTE } from "../quoteTestkit";

const RIVERSIDE = "a1000000-0000-0000-0000-000000000001";

describe("rollout flag", () => {
  it.each([undefined, "", "  ", "not-a-guid", `${RIVERSIDE},oops`, `${RIVERSIDE},`])("is off for %j", (raw) => {
    expect(isDirectBookingEnabled(RIVERSIDE, raw)).toBe(false);
  });
  it("is on only for the listed properties (case-insensitive)", () => {
    expect(isDirectBookingEnabled(RIVERSIDE.toUpperCase(), ` ${RIVERSIDE} `)).toBe(true);
    expect(isDirectBookingEnabled("b1000000-0000-0000-0000-000000000002", RIVERSIDE)).toBe(false);
    expect(parseDirectBookingPropertyIds(`${RIVERSIDE},b1000000-0000-0000-0000-000000000002`).size).toBe(2);
  });
});

describe("credentials", () => {
  it("makes a 43-character base64url guest token without padding, never repeated", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateGuestAccessToken));
    expect(tokens.size).toBe(50);
    tokens.forEach((token) => expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/));
  });
  it("makes distinct idempotency keys", () => {
    expect(generateDirectIdempotencyKey()).not.toBe(generateDirectIdempotencyKey());
    expect(generateDirectIdempotencyKey()).toMatch(/^bha-direct-/);
  });
});

describe("unresolved-attempt marker", () => {
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
  };
  it("stores only a flag, survives a new instance over the same storage, and clears", () => {
    const storage = fakeStorage();
    const marker = createDirectAttemptMarker(storage);
    expect(marker.isSet()).toBe(false);
    marker.set();
    expect(Array.from(storage.data.values())).toEqual(["1"]);
    expect(createDirectAttemptMarker(storage).isSet()).toBe(true);
    marker.clear();
    expect(storage.data.size).toBe(0);
    expect(createDirectAttemptMarker(storage).isSet()).toBe(false);
  });
  it("keeps working in memory when storage throws", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    const marker = createDirectAttemptMarker(broken);
    marker.set();
    expect(marker.isSet()).toBe(true);
    marker.clear();
    expect(marker.isSet()).toBe(false);
  });
});

describe("request and owner", () => {
  it("builds exactly the documented body with the confirmed VND price", () => {
    const body = buildDirectReservationRequest(
      { propertyId: RIVERSIDE, roomTypeId: "r", ratePlanId: "p", checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, children: 1, rooms: 1, quote: TEST_QUOTE },
      { fullName: "  Jane Doe ", email: " j@x.co ", phone: " +84 90 ", }
    );
    expect(Object.keys(body).sort()).toEqual(
      ["adults", "checkIn", "checkOut", "children", "email", "expectedCurrencyCode", "expectedTotalAmount", "fullName", "paymentMethod", "phone", "propertyId", "ratePlanId", "roomTypeId", "rooms"].sort()
    );
    expect(body).toMatchObject({ fullName: "Jane Doe", expectedTotalAmount: TEST_QUOTE.totalAmount, expectedCurrencyCode: "VND", paymentMethod: "PayAtProperty" });
  });
  it("derives owner keys only from a verified session", () => {
    expect(verifiedOwnerKey({ status: "loading", customer: null })).toBeNull();
    expect(verifiedOwnerKey({ status: "unknown", customer: null })).toBeNull();
    expect(verifiedOwnerKey({ status: "anonymous", customer: null })).toBe("guest");
    expect(verifiedOwnerKey({ status: "authenticated", customer: { customerAccountId: "AAAAAAAA-0000-0000-0000-000000000001", email: "a@b.c" } })).toBe("customer:aaaaaaaa-0000-0000-0000-000000000001");
    expect(ownerKeyOf({ kind: "guest", guestAccessToken: "t" })).toBe("guest");
  });
  it("maps Direct codes onto existing texts only where the meaning is the same", () => {
    const err = (code: string) => new ApiHttpError(409, { title: "t", status: 409, code });
    expect(directApiErrorKey(err("reservation.rooms-unavailable"))).toBe("shared.apiError.hold.rooms-unavailable");
    expect(directApiErrorKey(err("booking.rate-limited"))).toBe("shared.apiError.auth.rate-limited");
    expect(directApiErrorKey(err("checkout.direct-unavailable"))).toBe("shared.apiError.checkout.direct-unavailable");
    expect(directApiErrorKey(new Error("x"))).toBe("shared.apiError.directGeneric");
  });
});
