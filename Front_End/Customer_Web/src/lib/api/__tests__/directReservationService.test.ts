import { beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.fn();
vi.mock("../csrf", () => ({ submitCsrfProtectedRequest: (...args: unknown[]) => submit(...args) }));

import { createDirectReservation, DirectReservationContractError } from "../directReservationService";
import { buildDirectReservationRequest } from "../directBookingAttempt";
import { TEST_QUOTE } from "../quoteTestkit";

const REQUEST = buildDirectReservationRequest(
  { propertyId: "10000000-0000-0000-0000-000000000001", roomTypeId: "r", ratePlanId: "p", checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, children: 0, rooms: 1, quote: TEST_QUOTE },
  { fullName: "Jane", email: "j@x.co", phone: "+8490000000" }
);
const RESERVATION = {
  reservationId: "bbbbbbbb-0000-0000-0000-000000000001", confirmationNumber: "BHA123", status: "Confirmed", propertyId: REQUEST.propertyId,
  checkIn: "2026-08-01", checkOut: "2026-08-03", totalAmount: 3000000, currencyCode: "VND", paymentMethod: "PayAtProperty", collectedAmount: 0, balanceDueAmount: 3000000,
};

beforeEach(() => submit.mockReset());

describe("createDirectReservation", () => {
  it("posts the exact body to /api/v1/reservations; an account sends no token", async () => {
    submit.mockResolvedValue({ status: 201, data: RESERVATION });
    const result = await createDirectReservation(REQUEST, "key-1", { kind: "account", customerAccountId: "a" });
    const [path, method, body, options] = submit.mock.calls[0];
    expect(path).toBe("/api/v1/reservations");
    expect(method).toBe("POST");
    expect(body).toEqual(REQUEST);
    expect(options.headers).toEqual({ "Idempotency-Key": "key-1" });
    expect(result).toMatchObject({ outcome: "created", reservation: { confirmationNumber: "BHA123" } });
  });
  it("a guest sends the token header; 200 is a replay", async () => {
    submit.mockResolvedValue({ status: 200, data: { ...RESERVATION, status: "Cancelled" } });
    const result = await createDirectReservation(REQUEST, "key-2", { kind: "guest", guestAccessToken: "tok" });
    expect(submit.mock.calls[0][3].headers).toEqual({ "Idempotency-Key": "key-2", "X-Booking-Access-Token": "tok" });
    expect(result).toMatchObject({ outcome: "replayed", reservation: { status: "Cancelled" } });
  });
  it.each([
    [{ status: 202, data: RESERVATION }],
    [{ status: 201, data: undefined }],
    [{ status: 201, data: { ...RESERVATION, paymentMethod: null } }],
    [{ status: 201, data: { ...RESERVATION, balanceDueAmount: "3000000" } }],
  ])("treats an unexpected success answer as unknown, never created (%#)", async (answer) => {
    submit.mockResolvedValue(answer);
    await expect(createDirectReservation(REQUEST, "k", { kind: "guest", guestAccessToken: "t" })).rejects.toBeInstanceOf(DirectReservationContractError);
  });
});
