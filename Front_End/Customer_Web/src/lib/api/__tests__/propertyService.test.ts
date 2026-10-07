import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyDto } from "../propertyTypes";

const apiGetMock = vi.fn();

vi.mock("../httpClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
}));

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("getProperties", () => {
  it("requests the exact public properties route from the live OpenAPI document", async () => {
    const { getProperties } = await import("../propertyService");
    apiGetMock.mockResolvedValueOnce([]);

    await getProperties();

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/properties", {});
  });

  it("forwards caller options (e.g. an AbortSignal) unchanged", async () => {
    const { getProperties } = await import("../propertyService");
    apiGetMock.mockResolvedValueOnce([]);
    const controller = new AbortController();

    await getProperties({ signal: controller.signal });

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/properties", {
      signal: controller.signal,
    });
  });

  it("accepts a fixture matching the actual PropertyDto response shape and returns it unchanged", async () => {
    const { getProperties } = await import("../propertyService");

    // Shaped exactly like the live /swagger/v1/swagger.json PropertyDto schema
    // and the real GET /api/v1/properties response observed against the
    // Development API and seed data.
    const fixture: PropertyDto[] = [
      {
        id: "10000000-0000-0000-0000-000000000001",
        name: "The BHA Hotel",
        slug: "the-bha-hotel",
        description: "A welcoming city hotel operated independently by The BHA Hotels.",
        address: "1 BHA Avenue",
        city: "Ho Chi Minh City",
        country: "Vietnam",
        timeZone: "Asia/Ho_Chi_Minh",
        checkInTime: "14:00:00",
        checkOutTime: "12:00:00",
        amenities: [
          {
            id: "20000000-0000-0000-0000-000000000001",
            code: "WIFI",
            name: "Complimentary Wi-Fi",
            category: "Connectivity",
          },
        ],
        media: [
          {
            id: "50000000-0000-0000-0000-000000000001",
            url: "https://images.example.com/the-bha/property-cover.jpg",
            altText: "The BHA Hotel exterior",
            mediaType: "Image",
            sortOrder: 0,
            isCover: true,
          },
        ],
      },
    ];
    apiGetMock.mockResolvedValueOnce(fixture);

    await expect(getProperties()).resolves.toEqual(fixture);
  });

  it("returns an empty array (never undefined) when the transport yields no body", async () => {
    const { getProperties } = await import("../propertyService");
    apiGetMock.mockResolvedValueOnce(undefined);

    await expect(getProperties()).resolves.toEqual([]);
  });
});
