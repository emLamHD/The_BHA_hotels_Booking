import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { RoomTypeDto } from "../propertyTypes";

const apiGetMock = vi.fn();

vi.mock("../httpClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
}));

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("getRoomTypes", () => {
  it("requests the exact nested Property room-types route from the live OpenAPI document", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    apiGetMock.mockResolvedValueOnce([]);

    await getRoomTypes("10000000-0000-0000-0000-000000000001");

    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/properties/10000000-0000-0000-0000-000000000001/room-types",
      {}
    );
  });

  it("uses the supplied live Property ID in the route, not a fixed seed ID", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    apiGetMock.mockResolvedValue([]);

    await getRoomTypes("aaaaaaaa-0000-0000-0000-000000000001");
    expect(apiGetMock).toHaveBeenLastCalledWith(
      "/api/v1/properties/aaaaaaaa-0000-0000-0000-000000000001/room-types",
      {}
    );

    await getRoomTypes("bbbbbbbb-0000-0000-0000-000000000002");
    expect(apiGetMock).toHaveBeenLastCalledWith(
      "/api/v1/properties/bbbbbbbb-0000-0000-0000-000000000002/room-types",
      {}
    );
  });

  it("forwards caller options (e.g. an AbortSignal) unchanged", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    apiGetMock.mockResolvedValueOnce([]);
    const controller = new AbortController();

    await getRoomTypes("10000000-0000-0000-0000-000000000001", {
      signal: controller.signal,
    });

    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/properties/10000000-0000-0000-0000-000000000001/room-types",
      { signal: controller.signal }
    );
  });

  it("accepts a fixture matching the actual RoomTypeDto response shape and returns it unchanged", async () => {
    const { getRoomTypes } = await import("../roomTypeService");

    // Shaped exactly like the live /swagger/v1/swagger.json RoomTypeDto schema
    // and the real GET /api/v1/properties/{propertyId}/room-types response
    // observed against the Development API and seed data.
    const fixture: RoomTypeDto[] = [
      {
        id: "30000000-0000-0000-0000-000000000001",
        propertyId: "10000000-0000-0000-0000-000000000001",
        code: "DLX-KING",
        name: "Deluxe King",
        slug: "deluxe-king",
        description: "A comfortable king room for couples and solo travellers.",
        baseOccupancy: 2,
        maxOccupancy: 2,
        amenities: [
          {
            id: "20000000-0000-0000-0000-000000000004",
            code: "AIRCON",
            name: "Air Conditioning",
            category: "Room",
          },
        ],
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
      },
    ];
    apiGetMock.mockResolvedValueOnce(fixture);

    await expect(
      getRoomTypes("10000000-0000-0000-0000-000000000001")
    ).resolves.toEqual(fixture);
  });

  it("returns a real successful empty JSON array unchanged", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    apiGetMock.mockResolvedValueOnce([]);

    await expect(
      getRoomTypes("10000000-0000-0000-0000-000000000001")
    ).resolves.toEqual([]);
  });

  it("returns an empty array (never undefined) when the transport yields no body", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    apiGetMock.mockResolvedValueOnce(undefined);

    await expect(
      getRoomTypes("10000000-0000-0000-0000-000000000001")
    ).resolves.toEqual([]);
  });

  it("propagates a normalized HTTP error unchanged rather than wrapping it", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    const { ApiHttpError } = await import("../errors");
    const httpError = new ApiHttpError(404, {
      title: "Property not found",
      status: 404,
      detail: "The requested active property does not exist.",
    });
    apiGetMock.mockRejectedValueOnce(httpError);

    await expect(
      getRoomTypes("10000000-0000-0000-0000-000000000001")
    ).rejects.toBe(httpError);
  });

  it("propagates a cancellation error unchanged rather than converting it to a user failure", async () => {
    const { getRoomTypes } = await import("../roomTypeService");
    const cancelError = new axios.CanceledError();
    apiGetMock.mockRejectedValueOnce(cancelError);

    await expect(
      getRoomTypes("10000000-0000-0000-0000-000000000001")
    ).rejects.toBe(cancelError);
  });
});
