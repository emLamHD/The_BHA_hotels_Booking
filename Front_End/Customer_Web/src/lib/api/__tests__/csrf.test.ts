import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError, ApiNetworkError } from "../errors";

const apiGetMock = vi.fn();
const apiUnsafeRequestMock = vi.fn();

/** Same case-insensitive collapse as the real httpClient.mergeHeaders, kept in sync for this mock. */
function mergeHeaders(overrides?: Record<string, string>): Record<string, string> | undefined {
  if (!overrides) {
    return undefined;
  }
  const merged: Record<string, string> = {};
  const nameByLowerCase = new Map<string, string>();
  for (const [name, value] of Object.entries(overrides)) {
    const lowerName = name.toLowerCase();
    const existingName = nameByLowerCase.get(lowerName);
    if (existingName !== undefined) {
      delete merged[existingName];
    }
    merged[name] = value;
    nameByLowerCase.set(lowerName, name);
  }
  return merged;
}

vi.mock("../httpClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  apiUnsafeRequest: (...args: unknown[]) => apiUnsafeRequestMock(...args),
  mergeHeaders: (overrides?: Record<string, string>) => mergeHeaders(overrides),
}));

const CSRF_RESPONSE = { token: "csrf-token-1", headerName: "X-CSRF-TOKEN" };
const ANTIFORGERY_ERROR = new ApiHttpError(400, {
  title: "Invalid antiforgery token",
  status: 400,
  detail: "A valid antiforgery token is required for this operation.",
});

beforeEach(async () => {
  apiGetMock.mockReset();
  apiUnsafeRequestMock.mockReset();
  const { resetCsrfStateForTests } = await import("../csrf");
  resetCsrfStateForTests();
});

describe("submitCsrfProtectedRequest", () => {
  it("acquires the CSRF token via the existing Axios client and sends the returned header name", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 201, data: { holdId: "h1" } });

    await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 });

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/auth/csrf");
    const [, , , options] = apiUnsafeRequestMock.mock.calls[0];
    expect(options.headers["X-CSRF-TOKEN"]).toBe("csrf-token-1");
  });

  it("reuses the in-memory token on repeated unsafe requests without a second CSRF call", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockResolvedValue({ status: 201, data: {} });

    await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 });
    await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 2 });

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(2);
  });

  it("shares one acquisition across concurrent first unsafe requests", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    let resolveCsrf: (value: typeof CSRF_RESPONSE) => void = () => {};
    apiGetMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCsrf = resolve;
      })
    );
    apiUnsafeRequestMock.mockResolvedValue({ status: 201, data: {} });

    const first = submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 });
    const second = submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 2 });

    resolveCsrf(CSRF_RESPONSE);
    await Promise.all([first, second]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("collapses a caller-supplied CSRF header case variant into exactly one header", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 201, data: {} });

    await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }, {
      headers: { "x-csrf-token": "caller-value" },
    });

    const [, , , options] = apiUnsafeRequestMock.mock.calls[0];
    const csrfKeys = Object.keys(options.headers).filter(
      (key) => key.toLowerCase() === "x-csrf-token"
    );
    expect(csrfKeys).toHaveLength(1);
  });

  it("lets the acquired CSRF header win over a conflicting caller-supplied case variant", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 201, data: {} });

    await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }, {
      headers: { "x-csrf-token": "stale-caller-value" },
    });

    const [, , , options] = apiUnsafeRequestMock.mock.calls[0];
    expect(options.headers["X-CSRF-TOKEN"]).toBe("csrf-token-1");
  });

  it("invalidates, reacquires, and retries exactly once for the exact CT-CONTRACT-002 antiforgery Problem Details", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE).mockResolvedValueOnce({
      token: "csrf-token-2",
      headerName: "X-CSRF-TOKEN",
    });
    apiUnsafeRequestMock
      .mockRejectedValueOnce(ANTIFORGERY_ERROR)
      .mockResolvedValueOnce({ status: 201, data: { holdId: "h1" } });

    const result = await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }, {
      headers: { "Idempotency-Key": "key-1" },
    });

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 201, data: { holdId: "h1" } });
  });

  it("preserves the exact body and Idempotency-Key across the CSRF retry", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE).mockResolvedValueOnce({
      token: "csrf-token-2",
      headerName: "X-CSRF-TOKEN",
    });
    apiUnsafeRequestMock
      .mockRejectedValueOnce(ANTIFORGERY_ERROR)
      .mockResolvedValueOnce({ status: 201, data: {} });

    const body = { propertyId: "p1", fullName: "A B" };
    await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", body, {
      headers: { "Idempotency-Key": "key-1" },
    });

    const firstCall = apiUnsafeRequestMock.mock.calls[0];
    const retryCall = apiUnsafeRequestMock.mock.calls[1];
    expect(retryCall[2]).toEqual(firstCall[2]);
    expect(retryCall[2]).toBe(body);
    expect(retryCall[3].headers["Idempotency-Key"]).toBe("key-1");
    expect(retryCall[3].headers["X-CSRF-TOKEN"]).toBe("csrf-token-2");
  });

  it("surfaces a second invalid-antiforgery response without attempting a third request", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValue(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockRejectedValue(ANTIFORGERY_ERROR);

    const error = await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch(
      (e) => e
    );

    expect(error).toBe(ANTIFORGERY_ERROR);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 404, 409, 429, 500])(
    "does not retry an ordinary %d that is not the exact antiforgery Problem Details",
    async (status) => {
      const { submitCsrfProtectedRequest } = await import("../csrf");
      const ordinaryError = new ApiHttpError(status, {
        title: "Some other failure",
        status,
        detail: "Not an antiforgery failure.",
      });
      apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
      apiUnsafeRequestMock.mockRejectedValueOnce(ordinaryError);

      const error = await submitCsrfProtectedRequest(
        "/api/v1/booking-holds",
        "POST",
        { a: 1 }
      ).catch((e) => e);

      expect(error).toBe(ordinaryError);
      expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    }
  );

  it("does not retry a network failure", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    const networkError = new ApiNetworkError();
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockRejectedValueOnce(networkError);

    const error = await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch(
      (e) => e
    );

    expect(error).toBe(networkError);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a cancellation", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    const cancelError = { __cancel__: true };
    apiGetMock.mockResolvedValueOnce(CSRF_RESPONSE);
    apiUnsafeRequestMock.mockRejectedValueOnce(cancelError);

    const error = await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }).catch(
      (e) => e
    );

    expect(error).toBe(cancelError);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("fails safely without sending the unsafe mutation when the CSRF payload is malformed", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValueOnce({ token: "", headerName: "X-CSRF-TOKEN" });

    await expect(
      submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 })
    ).rejects.toThrow();
    expect(apiUnsafeRequestMock).not.toHaveBeenCalled();
  });
});
