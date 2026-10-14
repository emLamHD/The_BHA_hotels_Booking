import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError, ApiNetworkError } from "../errors";

const apiGetMock = vi.fn();
const apiUnsafeRequestMock = vi.fn();

/** Same case-insensitive collapse as the real httpClient.mergeHeaders (see csrf.test.ts). */
function mergeHeaders(overrides?: Record<string, string>): Record<string, string> | undefined {
  if (!overrides) return undefined;
  const merged: Record<string, string> = {};
  const nameByLowerCase = new Map<string, string>();
  for (const [name, value] of Object.entries(overrides)) {
    const lowerName = name.toLowerCase();
    const existingName = nameByLowerCase.get(lowerName);
    if (existingName !== undefined) delete merged[existingName];
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

const ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY = { customerAccountId: ID, email: "a@example.test" };
const PASSWORD = "  Pa55 word!With Spaces  ";
const CSRF = { token: "csrf-1", headerName: "X-CSRF-TOKEN" };
const ANTIFORGERY = new ApiHttpError(400, {
  title: "Invalid antiforgery token",
  status: 400,
  detail: "A valid antiforgery token is required for this operation.",
});
const http = (status: number) => new ApiHttpError(status, { title: "x", status });

beforeEach(async () => {
  apiGetMock.mockReset();
  apiUnsafeRequestMock.mockReset();
  (await import("../csrf")).resetCsrfStateForTests();
});

describe("getCustomerSession", () => {
  it("reads exactly GET /api/v1/auth/me, forwards the signal and returns the identity", async () => {
    const { getCustomerSession } = await import("../authService");
    const controller = new AbortController();
    apiGetMock.mockResolvedValueOnce({ ...IDENTITY, extra: "ignored" });

    await expect(getCustomerSession({ signal: controller.signal })).resolves.toEqual(IDENTITY);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/auth/me", { signal: controller.signal });
    expect(apiUnsafeRequestMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", undefined],
    ["null", null],
    ["a string", "ok"],
    ["an empty object", {}],
    ["an array", [IDENTITY]],
    ["an empty id", { customerAccountId: "", email: "a@example.test" }],
    ["the empty GUID", { customerAccountId: "00000000-0000-0000-0000-000000000000", email: "a@example.test" }],
    ["a non-GUID id", { customerAccountId: "not-a-guid", email: "a@example.test" }],
    ["a numeric id", { customerAccountId: 1, email: "a@example.test" }],
    ["an empty email", { customerAccountId: ID, email: "" }],
    ["a blank email", { customerAccountId: ID, email: "   " }],
    ["a non-string email", { customerAccountId: ID, email: 5 }],
  ])("never turns %s into an identity", async (_name, payload) => {
    const { getCustomerSession, AuthContractError } = await import("../authService");
    apiGetMock.mockResolvedValueOnce(payload);
    await expect(getCustomerSession()).rejects.toBeInstanceOf(AuthContractError);
  });

  it("passes a 401, a network failure and a cancellation through unchanged, without retrying", async () => {
    const { getCustomerSession } = await import("../authService");
    for (const error of [http(401), new ApiNetworkError(), { __cancel__: true }]) {
      apiGetMock.mockReset();
      apiGetMock.mockRejectedValueOnce(error);
      await expect(getCustomerSession()).rejects.toBe(error);
      expect(apiGetMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe("registerCustomer", () => {
  it("posts exactly email and password to /auth/register with no CSRF, no Idempotency-Key and no other request", async () => {
    const { registerCustomer } = await import("../authService");
    const controller = new AbortController();
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 201, data: IDENTITY });

    const result = await registerCustomer({ email: "a@example.test", password: PASSWORD }, { signal: controller.signal });

    expect(result).toEqual(IDENTITY);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    expect(apiUnsafeRequestMock).toHaveBeenCalledWith(
      "/api/v1/auth/register",
      "POST",
      { email: "a@example.test", password: PASSWORD },
      { signal: controller.signal }
    );
    expect(Object.keys(apiUnsafeRequestMock.mock.calls[0][2])).toEqual(["email", "password"]);
    // register is not a session: no csrf fetch, no login, no me
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("does not call a 201 with an unusable body a registration, and a 200 is not a registration", async () => {
    const { registerCustomer, AuthContractError } = await import("../authService");
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 201, data: { customerAccountId: "", email: "" } });
    await expect(registerCustomer({ email: "a@example.test", password: PASSWORD })).rejects.toBeInstanceOf(AuthContractError);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 200, data: IDENTITY });
    await expect(registerCustomer({ email: "a@example.test", password: PASSWORD })).rejects.toBeInstanceOf(AuthContractError);
  });

  it.each([400, 409, 429, 500])("surfaces a %d once, without a retry", async (status) => {
    const { registerCustomer } = await import("../authService");
    const error = http(status);
    apiUnsafeRequestMock.mockRejectedValueOnce(error);
    await expect(registerCustomer({ email: "a@example.test", password: PASSWORD })).rejects.toBe(error);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not touch the CSRF cache", async () => {
    const { registerCustomer } = await import("../authService");
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValue(CSRF);
    apiUnsafeRequestMock.mockResolvedValue({ status: 201, data: IDENTITY });
    await submitCsrfProtectedRequest("/api/v1/x", "POST", undefined);
    await registerCustomer({ email: "a@example.test", password: PASSWORD });
    await submitCsrfProtectedRequest("/api/v1/x", "POST", undefined);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
});

describe("loginCustomer", () => {
  it("posts exactly email and password (password untouched) to /auth/login with no CSRF or Idempotency-Key", async () => {
    const { loginCustomer } = await import("../authService");
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 200, data: IDENTITY });

    await expect(loginCustomer({ email: "a@example.test", password: PASSWORD })).resolves.toEqual(IDENTITY);

    expect(apiUnsafeRequestMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      "POST",
      { email: "a@example.test", password: PASSWORD },
      { signal: undefined }
    );
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it.each([
    ["401", http(401)],
    ["429", http(429)],
    ["a network failure", new ApiNetworkError()],
  ])("sends once and does not retry on %s", async (_name, error) => {
    const { loginCustomer } = await import("../authService");
    apiUnsafeRequestMock.mockRejectedValueOnce(error);
    await expect(loginCustomer({ email: "a@example.test", password: PASSWORD })).rejects.toBe(error);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-200 or malformed success instead of reporting an identity", async () => {
    const { loginCustomer, AuthContractError } = await import("../authService");
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 204, data: undefined });
    await expect(loginCustomer({ email: "a@example.test", password: PASSWORD })).rejects.toBeInstanceOf(AuthContractError);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 200, data: { customerAccountId: ID } });
    await expect(loginCustomer({ email: "a@example.test", password: PASSWORD })).rejects.toBeInstanceOf(AuthContractError);
  });

  it.each([
    ["success", () => Promise.resolve({ status: 200, data: IDENTITY })],
    ["401", () => Promise.reject(http(401))],
    ["a lost response", () => Promise.reject(new ApiNetworkError())],
  ])("drops the cached CSRF token after %s, without requesting or resending anything itself", async (_name, outcome) => {
    const { loginCustomer } = await import("../authService");
    const { submitCsrfProtectedRequest } = await import("../csrf");
    apiGetMock.mockResolvedValue(CSRF);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 204, data: undefined });
    await submitCsrfProtectedRequest("/api/v1/x", "POST", undefined);
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    apiUnsafeRequestMock.mockImplementationOnce(outcome);
    await loginCustomer({ email: "a@example.test", password: PASSWORD }).catch(() => undefined);
    expect(apiGetMock).toHaveBeenCalledTimes(1); // invalidation requests no token
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(2); // and resends nothing

    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 204, data: undefined });
    await submitCsrfProtectedRequest("/api/v1/x", "POST", undefined);
    expect(apiGetMock).toHaveBeenCalledTimes(2); // the next protected request reacquires
  });

  it("never puts the password in an error it raises", async () => {
    const { loginCustomer } = await import("../authService");
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 200, data: { customerAccountId: "x", email: "y" } });
    const error = await loginCustomer({ email: "a@example.test", password: PASSWORD }).catch((e) => e);
    expect(String(error.message)).not.toContain("Pa55");
  });
});

describe("logoutCustomer", () => {
  it("posts with no body and the acquired CSRF header, and resolves on 204", async () => {
    const { logoutCustomer } = await import("../authService");
    const controller = new AbortController();
    apiGetMock.mockResolvedValueOnce(CSRF);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 204, data: undefined });

    await expect(logoutCustomer({ signal: controller.signal })).resolves.toBeUndefined();

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/auth/csrf");
    const [path, method, body, options] = apiUnsafeRequestMock.mock.calls[0];
    expect([path, method, body]).toEqual(["/api/v1/auth/logout", "POST", undefined]);
    expect(options.headers["X-CSRF-TOKEN"]).toBe("csrf-1");
    expect(options.signal).toBe(controller.signal);
  });

  it("retries once, and only the helper does, for the exact antiforgery refusal", async () => {
    const { logoutCustomer } = await import("../authService");
    apiGetMock.mockResolvedValueOnce(CSRF).mockResolvedValueOnce({ token: "csrf-2", headerName: "X-CSRF-TOKEN" });
    apiUnsafeRequestMock
      .mockRejectedValueOnce(ANTIFORGERY)
      .mockResolvedValueOnce({ status: 204, data: undefined });

    await expect(logoutCustomer()).resolves.toBeUndefined();
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(2);
    expect(apiUnsafeRequestMock.mock.calls[1][3].headers["X-CSRF-TOKEN"]).toBe("csrf-2");
  });

  it("returns a 401 as an error — never as proof that a cookie was cleared — and does not retry it", async () => {
    const { logoutCustomer } = await import("../authService");
    const error = http(401);
    apiGetMock.mockResolvedValueOnce(CSRF);
    apiUnsafeRequestMock.mockRejectedValueOnce(error);
    await expect(logoutCustomer()).rejects.toBe(error);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a lost response", async () => {
    const { logoutCustomer } = await import("../authService");
    const error = new ApiNetworkError();
    apiGetMock.mockResolvedValueOnce(CSRF);
    apiUnsafeRequestMock.mockRejectedValueOnce(error);
    await expect(logoutCustomer()).rejects.toBe(error);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not report success for a status other than 204", async () => {
    const { logoutCustomer, AuthContractError } = await import("../authService");
    apiGetMock.mockResolvedValueOnce(CSRF);
    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    await expect(logoutCustomer()).rejects.toBeInstanceOf(AuthContractError);
  });

  it.each([
    ["success", () => Promise.resolve({ status: 204, data: undefined })],
    ["401", () => Promise.reject(http(401))],
    ["a lost response", () => Promise.reject(new ApiNetworkError())],
  ])("drops the cached CSRF token after %s", async (_name, outcome) => {
    const { logoutCustomer } = await import("../authService");
    apiGetMock.mockResolvedValue(CSRF);
    apiUnsafeRequestMock.mockImplementationOnce(outcome);
    await logoutCustomer().catch(() => undefined);
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    apiUnsafeRequestMock.mockResolvedValueOnce({ status: 204, data: undefined });
    await logoutCustomer();
    expect(apiGetMock).toHaveBeenCalledTimes(2); // a fresh token for the next call
  });
});
