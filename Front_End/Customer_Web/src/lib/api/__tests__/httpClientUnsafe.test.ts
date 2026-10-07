import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetApiBaseUrlCacheForTests } from "../env";
import { apiUnsafeRequest, resetApiClientForTests } from "../httpClient";
import { ApiHttpError, ApiNetworkError, ApiValidationError } from "../errors";

const ENV_VAR_NAME = "NEXT_PUBLIC_API_BASE_URL";

function mockAxiosInstance(requestImpl: (config: Record<string, unknown>) => unknown) {
  const request = vi.fn(requestImpl);
  vi.spyOn(axios, "create").mockReturnValue({ request } as never);
  return request;
}

beforeEach(() => {
  process.env[ENV_VAR_NAME] = "https://localhost:7145";
  resetApiBaseUrlCacheForTests();
  resetApiClientForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiUnsafeRequest", () => {
  it("uses the existing Axios client with credentials", async () => {
    const request = mockAxiosInstance(async () => ({ status: 201, data: { id: "1" } }));

    await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 });

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://localhost:7145", withCredentials: true })
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ withCredentials: true, method: "POST", url: "/api/v1/booking-holds" })
    );
  });

  it("sends the exact JSON body and adds Content-Type only when a body exists", async () => {
    const request = mockAxiosInstance(async () => ({ status: 201, data: {} }));

    await apiUnsafeRequest("/api/v1/booking-holds", "POST", { propertyId: "p1" });

    const config = request.mock.calls[0][0] as Record<string, unknown>;
    expect(config.data).toEqual({ propertyId: "p1" });
    expect((config.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("omits Content-Type when no body is supplied", async () => {
    const request = mockAxiosInstance(async () => ({ status: 200, data: undefined }));

    await apiUnsafeRequest("/api/v1/booking-holds/1/cancel", "POST", undefined);

    const config = request.mock.calls[0][0] as Record<string, unknown>;
    expect(config.headers).toBeUndefined();
  });

  it("forwards caller headers and an AbortSignal", async () => {
    const request = mockAxiosInstance(async () => ({ status: 201, data: {} }));
    const controller = new AbortController();

    await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }, {
      headers: { "Idempotency-Key": "key-1" },
      signal: controller.signal,
    });

    const config = request.mock.calls[0][0] as Record<string, unknown>;
    expect((config.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(config.signal).toBe(controller.signal);
  });

  it("collapses case-only duplicate caller headers, keeping the last value", async () => {
    const request = mockAxiosInstance(async () => ({ status: 201, data: {} }));

    await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }, {
      headers: { "X-CSRF-TOKEN": "first", "x-csrf-token": "second" },
    });

    const config = request.mock.calls[0][0] as Record<string, unknown>;
    const headers = config.headers as Record<string, string>;
    const csrfKeys = Object.keys(headers).filter((key) => key.toLowerCase() === "x-csrf-token");
    expect(csrfKeys).toHaveLength(1);
    expect(headers[csrfKeys[0]]).toBe("second");
  });

  it("exposes status 201 to distinguish Created from Replayed", async () => {
    mockAxiosInstance(async () => ({ status: 201, data: { holdId: "h1" } }));

    const result = await apiUnsafeRequest<{ holdId: string }>(
      "/api/v1/booking-holds",
      "POST",
      { a: 1 }
    );
    expect(result.status).toBe(201);
    expect(result.data).toEqual({ holdId: "h1" });
  });

  it("exposes status 200 for a replayed response", async () => {
    mockAxiosInstance(async () => ({ status: 200, data: { holdId: "h1" } }));

    const result = await apiUnsafeRequest<{ holdId: string }>(
      "/api/v1/booking-holds",
      "POST",
      { a: 1 }
    );
    expect(result.status).toBe(200);
  });

  it("resolves 204 responses to undefined data", async () => {
    mockAxiosInstance(async () => ({ status: 204, data: "" }));

    const result = await apiUnsafeRequest("/api/v1/booking-holds/1/cancel", "POST", undefined);
    expect(result.status).toBe(204);
    expect(result.data).toBeUndefined();
  });

  it("normalizes an ordinary ProblemDetails HTTP error", async () => {
    mockAxiosInstance(async () => {
      throw {
        isAxiosError: true,
        response: {
          status: 409,
          data: { title: "Booking Hold conflict", status: 409, detail: "Stop-sell applies." },
        },
      };
    });

    const error = await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(409);
  });

  it("normalizes a validation ProblemDetails HTTP error", async () => {
    mockAxiosInstance(async () => {
      throw {
        isAxiosError: true,
        response: {
          status: 400,
          data: { title: "Invalid booking Hold request", status: 400, errors: { email: ["bad"] } },
        },
      };
    });

    const error = await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiValidationError);
  });

  it("distinguishes a network failure from an HTTP failure", async () => {
    mockAxiosInstance(async () => {
      throw { isAxiosError: true, response: undefined };
    });

    const error = await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiNetworkError);
  });

  it("propagates cancellation unchanged", async () => {
    const cancelError = new axios.CanceledError();
    mockAxiosInstance(async () => {
      throw cancelError;
    });

    const error = await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch((e) => e);
    expect(error).toBe(cancelError);
  });

  it("performs no automatic retry itself after a failure", async () => {
    const request = mockAxiosInstance(async () => {
      throw { isAxiosError: true, response: { status: 500, data: {} } };
    });

    await apiUnsafeRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch(() => undefined);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
