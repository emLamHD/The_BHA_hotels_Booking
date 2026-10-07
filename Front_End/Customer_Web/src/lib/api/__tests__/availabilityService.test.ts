import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { AvailabilityOfferDto, AvailabilityQuery } from "../availabilityTypes";

const apiGetMock = vi.fn();

vi.mock("../httpClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
}));

beforeEach(() => {
  apiGetMock.mockReset();
});

const QUERY: AvailabilityQuery = {
  checkIn: "2026-08-01",
  checkOut: "2026-08-03",
  adults: 2,
  children: 1,
  rooms: 1,
};

describe("searchAvailability", () => {
  it("requests the exact nested Property availability route", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValueOnce([]);

    await searchAvailability("10000000-0000-0000-0000-000000000001", QUERY);

    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/properties/10000000-0000-0000-0000-000000000001/availability",
      expect.objectContaining({
        params: {
          checkIn: "2026-08-01",
          checkOut: "2026-08-03",
          adults: 2,
          children: 1,
          rooms: 1,
        },
      })
    );
  });

  it("uses the supplied live Property ID in the route, not a fixed app ID", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValue([]);

    await searchAvailability("aaaaaaaa-0000-0000-0000-000000000001", QUERY);
    expect(apiGetMock).toHaveBeenLastCalledWith(
      "/api/v1/properties/aaaaaaaa-0000-0000-0000-000000000001/availability",
      expect.anything()
    );

    await searchAvailability("bbbbbbbb-0000-0000-0000-000000000002", QUERY);
    expect(apiGetMock).toHaveBeenLastCalledWith(
      "/api/v1/properties/bbbbbbbb-0000-0000-0000-000000000002/availability",
      expect.anything()
    );
  });

  it("passes exactly the five query params via Axios params, nothing more", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValueOnce([]);

    await searchAvailability("10000000-0000-0000-0000-000000000001", QUERY);

    const [, options] = apiGetMock.mock.calls[0];
    expect(Object.keys(options.params).sort()).toEqual([
      "adults",
      "checkIn",
      "checkOut",
      "children",
      "rooms",
    ]);
  });

  it("forwards caller options (e.g. an AbortSignal) alongside params", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValueOnce([]);
    const controller = new AbortController();

    await searchAvailability("10000000-0000-0000-0000-000000000001", QUERY, {
      signal: controller.signal,
    });

    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/properties/10000000-0000-0000-0000-000000000001/availability",
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("never adds CSRF, Idempotency-Key, or booking-access-token headers", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValueOnce([]);

    await searchAvailability("10000000-0000-0000-0000-000000000001", QUERY);

    const [, options] = apiGetMock.mock.calls[0];
    expect(options.headers).toBeUndefined();
  });

  it("accepts a fixture matching the actual AvailabilityOfferDto response shape and returns it unchanged", async () => {
    const { searchAvailability } = await import("../availabilityService");

    // Shaped exactly like the live /swagger/v1/swagger.json AvailabilityOfferDto
    // schema and the real GET .../availability response observed against the
    // Development API and seed data.
    const fixture: AvailabilityOfferDto[] = [
      {
        propertyId: "10000000-0000-0000-0000-000000000001",
        roomTypeId: "30000000-0000-0000-0000-000000000001",
        roomTypeCode: "DLX-KING",
        roomTypeName: "Deluxe King",
        roomTypeDescription: "A comfortable king room for couples and solo travellers.",
        media: [
          {
            id: "50000000-0000-0000-0000-000000000003",
            url: "https://images.example.com/the-bha/deluxe-king.jpg",
            altText: "Deluxe King room",
            mediaType: "Image",
            sortOrder: 0,
            isCover: true,
          },
        ],
        ratePlanId: "60000000-0000-0000-0000-000000000001",
        ratePlanCode: "STANDARD",
        ratePlanName: "Standard Rate",
        currencyCode: "VND",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        nights: 2,
        requestedRooms: 1,
        availableRooms: 1,
        nightlyRates: [
          { stayDate: "2026-08-01", amount: 1500000.0 },
          { stayDate: "2026-08-02", amount: 1500000.0 },
        ],
        totalAmount: 3000000.0,
      },
    ];
    apiGetMock.mockResolvedValueOnce(fixture);

    await expect(
      searchAvailability("10000000-0000-0000-0000-000000000001", QUERY)
    ).resolves.toEqual(fixture);
  });

  it("returns a real successful empty JSON array unchanged", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValueOnce([]);

    await expect(
      searchAvailability("10000000-0000-0000-0000-000000000001", QUERY)
    ).resolves.toEqual([]);
  });

  it("returns an empty array (never undefined) when the transport yields no body", async () => {
    const { searchAvailability } = await import("../availabilityService");
    apiGetMock.mockResolvedValueOnce(undefined);

    await expect(
      searchAvailability("10000000-0000-0000-0000-000000000001", QUERY)
    ).resolves.toEqual([]);
  });

  it("propagates a normalized validation error unchanged rather than wrapping it", async () => {
    const { searchAvailability } = await import("../availabilityService");
    const { ApiValidationError } = await import("../errors");
    const validationError = new ApiValidationError(400, {
      title: "Invalid availability request",
      status: 400,
      detail: "checkIn must be earlier than checkOut.",
      errors: { checkIn: ["checkIn must be earlier than checkOut."] },
    });
    apiGetMock.mockRejectedValueOnce(validationError);

    await expect(
      searchAvailability("10000000-0000-0000-0000-000000000001", QUERY)
    ).rejects.toBe(validationError);
  });

  it("propagates a normalized HTTP error unchanged rather than wrapping it", async () => {
    const { searchAvailability } = await import("../availabilityService");
    const { ApiHttpError } = await import("../errors");
    const httpError = new ApiHttpError(404, {
      title: "Property not found",
      status: 404,
      detail: "The requested active property does not exist.",
    });
    apiGetMock.mockRejectedValueOnce(httpError);

    await expect(
      searchAvailability("10000000-0000-0000-0000-000000000001", QUERY)
    ).rejects.toBe(httpError);
  });

  it("propagates a cancellation error unchanged rather than converting it to a user failure", async () => {
    const { searchAvailability } = await import("../availabilityService");
    const cancelError = new axios.CanceledError();
    apiGetMock.mockRejectedValueOnce(cancelError);

    await expect(
      searchAvailability("10000000-0000-0000-0000-000000000001", QUERY)
    ).rejects.toBe(cancelError);
  });
});
