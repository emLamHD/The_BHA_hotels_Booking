import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBookingHoldRequest } from "../bookingHoldTypes";

const submitCsrfProtectedRequestMock = vi.fn();

vi.mock("../csrf", () => ({
  submitCsrfProtectedRequest: (...args: unknown[]) => submitCsrfProtectedRequestMock(...args),
}));

beforeEach(() => {
  submitCsrfProtectedRequestMock.mockReset();
});

const REQUEST: CreateBookingHoldRequest = {
  propertyId: "10000000-0000-0000-0000-000000000001",
  roomTypeId: "30000000-0000-0000-0000-000000000001",
  ratePlanId: "60000000-0000-0000-0000-000000000001",
  checkIn: "2026-08-01",
  checkOut: "2026-08-03",
  adults: 2,
  children: 0,
  rooms: 1,
  fullName: "Test Guest",
  email: "test.guest@example.com",
  phone: "+1 555 123 4567",
};

const HOLD_FIXTURE = {
  holdId: "aaaaaaaa-0000-0000-0000-000000000001",
  status: "Active" as const,
  propertyId: REQUEST.propertyId,
  roomTypeId: REQUEST.roomTypeId,
  ratePlanId: REQUEST.ratePlanId,
  checkIn: REQUEST.checkIn,
  checkOut: REQUEST.checkOut,
  adults: REQUEST.adults,
  children: REQUEST.children,
  rooms: REQUEST.rooms,
  currencyCode: "VND",
  totalAmount: 3000000,
  createdAtUtc: "2026-07-30T01:59:50.389Z",
  expiresAtUtc: "2026-07-30T02:14:50.389Z",
  nights: [
    { stayDate: "2026-08-01", rooms: 1, unitAmount: 1500000, nightTotal: 1500000 },
    { stayDate: "2026-08-02", rooms: 1, unitAmount: 1500000, nightTotal: 1500000 },
  ],
  guestAccessToken: "one-time-token",
};

describe("createBookingHold", () => {
  it("calls exactly the Booking Holds route with POST", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 201, data: HOLD_FIXTURE });

    await createBookingHold(REQUEST, "idem-key-1");

    expect(submitCsrfProtectedRequestMock).toHaveBeenCalledWith(
      "/api/v1/booking-holds",
      "POST",
      expect.any(Object),
      expect.any(Object)
    );
  });

  it("sends a request body containing only the allowed fields", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 201, data: HOLD_FIXTURE });

    await createBookingHold(REQUEST, "idem-key-1");

    const [, , body] = submitCsrfProtectedRequestMock.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(
      [
        "adults",
        "checkIn",
        "checkOut",
        "children",
        "email",
        "fullName",
        "phone",
        "propertyId",
        "ratePlanId",
        "roomTypeId",
        "rooms",
      ].sort()
    );
    expect(body).toEqual(REQUEST);
  });

  it("sends exactly one caller-supplied Idempotency-Key header", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 201, data: HOLD_FIXTURE });

    await createBookingHold(REQUEST, "idem-key-1");

    const [, , , options] = submitCsrfProtectedRequestMock.mock.calls[0];
    expect(options.headers).toEqual({ "Idempotency-Key": "idem-key-1" });
  });

  it("reports a 201 response as created and preserves the Hold response", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 201, data: HOLD_FIXTURE });

    const result = await createBookingHold(REQUEST, "idem-key-1");

    expect(result.outcome).toBe("created");
    expect(result.hold).toEqual(HOLD_FIXTURE);
  });

  it("reports a 200 response as replayed and preserves the Hold response", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    const replayed = { ...HOLD_FIXTURE, guestAccessToken: null };
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 200, data: replayed });

    const result = await createBookingHold(REQUEST, "idem-key-1");

    expect(result.outcome).toBe("replayed");
    expect(result.hold).toEqual(replayed);
  });

  it("forwards an AbortSignal", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 201, data: HOLD_FIXTURE });
    const controller = new AbortController();

    await createBookingHold(REQUEST, "idem-key-1", { signal: controller.signal });

    const [, , , options] = submitCsrfProtectedRequestMock.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });

  it("never sends a price, currency, expiry, status, ownership, or token field as client authority", async () => {
    const { createBookingHold } = await import("../bookingHoldService");
    submitCsrfProtectedRequestMock.mockResolvedValueOnce({ status: 201, data: HOLD_FIXTURE });

    await createBookingHold(REQUEST, "idem-key-1");

    const [, , body] = submitCsrfProtectedRequestMock.mock.calls[0];
    for (const forbidden of [
      "totalAmount",
      "currencyCode",
      "status",
      "holdId",
      "createdAtUtc",
      "expiresAtUtc",
      "guestAccessToken",
      "availableRooms",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body, forbidden)).toBe(false);
    }
  });
});
