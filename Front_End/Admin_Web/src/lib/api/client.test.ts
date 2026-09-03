import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActiveProperties, fetchReservationBoard } from "./client";

const BASE_URL = "https://localhost:7145";

describe("api client", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a config error and never calls fetch when the base URL is invalid", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:7145";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchActiveProperties();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("config");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requests the exact active-properties path", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "p1", name: "Demo", timeZone: "Asia/Ho_Chi_Minh" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchActiveProperties();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(`${BASE_URL}/api/v1/properties`);
    expect(calledInit.method).toBe("GET");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([{ id: "p1", name: "Demo", timeZone: "Asia/Ho_Chi_Minh" }]);
    }
  });

  it("requests the reservation board with exact propertyId/from/to query params, no timezone shift", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          property: {
            id: "p1",
            name: "Demo",
            timeZone: "Asia/Ho_Chi_Minh",
            localToday: "2026-09-01",
            checkInTime: "14:00",
            checkOutTime: "12:00",
          },
          from: "2026-09-01",
          to: "2026-09-15",
          roomTypes: [],
          physicalRooms: [],
          stays: [],
          operationalBlocks: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchReservationBoard("p1", "2026-09-01", "2026-09-15");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(`${BASE_URL}/api/admin/v1/properties/p1/reservation-board?from=2026-09-01&to=2026-09-15`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.from).toBe("2026-09-01");
      expect(result.data.to).toBe("2026-09-15");
    }
  });

  it("maps a network failure (fetch rejection) to a network ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    const result = await fetchActiveProperties();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
    }
  });

  it("maps an AbortError to an aborted ApiError, distinct from network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"))
    );

    const result = await fetchActiveProperties();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("aborted");
    }
  });

  it("maps a non-ok response with ProblemDetails JSON to an http ApiError carrying the detail message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: "Not Found", detail: "Property does not exist." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await fetchReservationBoard("missing", "2026-09-01", "2026-09-15");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("http");
      expect(result.error.status).toBe(404);
      expect(result.error.message).toBe("Property does not exist.");
    }
  });

  it("maps a non-ok response with a non-JSON body to a generic http ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("plain text failure", { status: 500 }))
    );

    const result = await fetchActiveProperties();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("http");
      expect(result.error.status).toBe(500);
      expect(result.error.message).toContain("500");
    }
  });

  it("maps an unreadable ok response body to a network ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))
    );

    const result = await fetchActiveProperties();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
    }
  });
});
