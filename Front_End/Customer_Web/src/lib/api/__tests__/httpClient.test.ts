import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetApiBaseUrlCacheForTests } from "../env";
import { apiGet, resetApiClientForTests } from "../httpClient";
import {
  ApiConfigError,
  ApiHttpError,
  ApiNetworkError,
  ApiValidationError,
} from "../errors";

const ENV_VAR_NAME = "NEXT_PUBLIC_API_BASE_URL";

function mockAxiosInstance(
  requestImpl: (config: Record<string, unknown>) => unknown
) {
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

describe("apiGet", () => {
  it("creates the Axios client with the configured base URL", async () => {
    const request = mockAxiosInstance(async () => ({ status: 200, data: {} }));
    await apiGet("/api/v1/properties");

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://localhost:7145" })
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("sends withCredentials: true on the instance and on every request", async () => {
    const request = mockAxiosInstance(async () => ({ status: 200, data: {} }));
    await apiGet("/api/v1/properties");

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ withCredentials: true })
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ withCredentials: true })
    );
  });

  it("returns a successful JSON body", async () => {
    const payload = { id: "1", name: "The BHA Hotel" };
    mockAxiosInstance(async () => ({ status: 200, data: payload }));

    await expect(apiGet("/api/v1/properties/1")).resolves.toEqual(payload);
  });

  it("returns undefined for 204 No Content", async () => {
    mockAxiosInstance(async () => ({ status: 204, data: "" }));

    await expect(apiGet("/api/v1/properties/1")).resolves.toBeUndefined();
  });

  it("preserves a successful empty array response", async () => {
    mockAxiosInstance(async () => ({ status: 200, data: [] }));

    const result = await apiGet("/api/v1/properties");
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("normalizes an ordinary ProblemDetails error body", async () => {
    mockAxiosInstance(async () => {
      throw {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            title: "Property not found",
            status: 404,
            detail: "The requested active property does not exist.",
          },
        },
      };
    });

    await expect(apiGet("/api/v1/properties/missing")).rejects.toMatchObject({
      name: "ApiHttpError",
      status: 404,
      problem: {
        title: "Property not found",
        detail: "The requested active property does not exist.",
      },
    });
  });

  it("normalizes a validation ProblemDetails error body", async () => {
    mockAxiosInstance(async () => {
      throw {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            title: "One or more validation errors occurred.",
            status: 400,
            errors: { propertyId: ["The value is not a valid GUID."] },
          },
        },
      };
    });

    const error = await apiGet("/api/v1/properties/not-a-guid").catch((e) => e);
    expect(error).toBeInstanceOf(ApiValidationError);
    expect((error as ApiValidationError).errors).toEqual({
      propertyId: ["The value is not a valid GUID."],
    });
  });

  it("falls back to a safe generic problem for a non-ProblemDetails HTTP error body", async () => {
    mockAxiosInstance(async () => {
      throw {
        isAxiosError: true,
        response: { status: 502, data: "<html>Bad Gateway</html>" },
      };
    });

    const error = await apiGet("/api/v1/properties").catch((e) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(502);
    expect((error as ApiHttpError).problem.title).toBe("Request failed");
    expect((error as ApiHttpError).problem.detail).toBeTruthy();
  });

  it("distinguishes a network failure from an HTTP failure", async () => {
    mockAxiosInstance(async () => {
      throw { isAxiosError: true, response: undefined };
    });

    const error = await apiGet("/api/v1/properties").catch((e) => e);
    expect(error).toBeInstanceOf(ApiNetworkError);
    expect(error).not.toBeInstanceOf(ApiHttpError);
  });

  it("performs no automatic retry after a failure", async () => {
    const request = mockAxiosInstance(async () => {
      throw { isAxiosError: true, response: { status: 500, data: {} } };
    });

    await apiGet("/api/v1/properties").catch(() => undefined);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("throws ApiConfigError and never attempts a request when the base URL is invalid", async () => {
    process.env[ENV_VAR_NAME] = "not-a-url";
    resetApiBaseUrlCacheForTests();
    resetApiClientForTests();
    const createSpy = vi.spyOn(axios, "create");

    const error = await apiGet("/api/v1/properties").catch((e) => e);
    expect(error).toBeInstanceOf(ApiConfigError);
    expect(createSpy).not.toHaveBeenCalled();
  });

  // PMS-CAL-001.1 correction C8: getClient() copies the validation message
  // verbatim into ApiConfigError, and that error is what a configuration-error
  // UI state renders. So the redaction has to hold at this boundary too, not
  // only inside env.ts — otherwise a token pasted into the API base would
  // surface in the browser through the client instead of through the thrower.
  it("does not carry a rejected base URL into the ApiConfigError it surfaces", async () => {
    const rejected = "https://api.example.test?token=C8_CLIENT_SENTINEL";
    process.env[ENV_VAR_NAME] = rejected;
    resetApiBaseUrlCacheForTests();
    resetApiClientForTests();
    const createSpy = vi.spyOn(axios, "create");

    const error = await apiGet("/api/v1/properties").catch((e) => e);

    expect(error).toBeInstanceOf(ApiConfigError);
    expect((error as ApiConfigError).message).toMatch(/query string or fragment/i);
    expect((error as ApiConfigError).message).not.toContain("C8_CLIENT_SENTINEL");
    expect((error as ApiConfigError).message).not.toContain(rejected);
    // The rejected base must never be dialled, so nothing can leak over the wire either.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("collapses case-only duplicate caller headers, keeping the last value", async () => {
    const request = mockAxiosInstance(async () => ({ status: 200, data: {} }));
    await apiGet("/api/v1/properties", {
      headers: { "X-Test": "first", "x-test": "second" },
    });

    const sentHeaders = request.mock.calls[0][0].headers as Record<string, string>;
    expect(Object.keys(sentHeaders)).toHaveLength(1);
    expect(Object.values(sentHeaders)[0]).toBe("second");
  });
});
