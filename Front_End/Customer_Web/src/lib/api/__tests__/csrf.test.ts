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

/** CUST-WEB-001-CP01a: invalidation while a CSRF acquisition is still pending. */
describe("invalidateCsrfToken with an acquisition in flight", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const tokenOf = (call: unknown[]) => (call[3] as { headers: Record<string, string> }).headers["X-CSRF-TOKEN"];

  it("starts a new acquisition for a request made after the invalidation instead of reusing the old pending one", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    const oldAcquisition = deferred<typeof CSRF_RESPONSE>();
    apiGetMock
      .mockReturnValueOnce(oldAcquisition.promise)
      .mockResolvedValueOnce({ token: "token-new", headerName: "X-CSRF-TOKEN" });
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });

    const before = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    invalidateCsrfToken();
    const after = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    await after;
    expect(tokenOf(apiUnsafeRequestMock.mock.calls[0])).toBe("token-new");

    oldAcquisition.resolve({ token: "token-old", headerName: "X-CSRF-TOKEN" });
    await before;
  });

  it("never sends the old generation's token, not even to the caller that was waiting for it", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    const oldAcquisition = deferred<typeof CSRF_RESPONSE>();
    apiGetMock
      .mockReturnValueOnce(oldAcquisition.promise)
      .mockResolvedValueOnce({ token: "token-new", headerName: "X-CSRF-TOKEN" });
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });

    const waiting = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    invalidateCsrfToken();
    const fresh = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    oldAcquisition.resolve({ token: "token-old", headerName: "X-CSRF-TOKEN" });
    await Promise.all([waiting, fresh]);

    const sent = apiUnsafeRequestMock.mock.calls.map(tokenOf);
    expect(sent).toEqual(["token-new", "token-new"]);
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a late old resolution fill the cache or hide the current acquisition from later requests", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    const oldAcquisition = deferred<typeof CSRF_RESPONSE>();
    const currentAcquisition = deferred<typeof CSRF_RESPONSE>();
    apiGetMock.mockReturnValueOnce(oldAcquisition.promise).mockReturnValueOnce(currentAcquisition.promise);
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });

    const first = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    invalidateCsrfToken();
    const second = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    oldAcquisition.resolve({ token: "token-old", headerName: "X-CSRF-TOKEN" });
    await settle();
    // The old acquisition has finished; the current one is still pending and must still be shared.
    const third = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiUnsafeRequestMock).not.toHaveBeenCalled();

    currentAcquisition.resolve({ token: "token-new", headerName: "X-CSRF-TOKEN" });
    await Promise.all([first, second, third]);
    expect(apiUnsafeRequestMock.mock.calls.map(tokenOf)).toEqual(["token-new", "token-new", "token-new"]);
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it("lets a caller that waited on an old acquisition that then fails use the current generation's token", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    const oldAcquisition = deferred<typeof CSRF_RESPONSE>();
    apiGetMock
      .mockReturnValueOnce(oldAcquisition.promise)
      .mockResolvedValueOnce({ token: "token-new", headerName: "X-CSRF-TOKEN" });
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });

    const waiting = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    invalidateCsrfToken();
    const fresh = submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    await settle();
    oldAcquisition.reject(new ApiNetworkError());

    await expect(waiting).resolves.toEqual({ status: 204, data: undefined });
    await fresh;
    expect(apiUnsafeRequestMock.mock.calls.map(tokenOf)).toEqual(["token-new", "token-new"]);
  });

  it("still reports an acquisition failure of the current generation to its callers", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    const failure = new ApiNetworkError();
    apiGetMock.mockRejectedValueOnce(failure);

    await expect(submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined)).rejects.toBe(failure);
    expect(apiUnsafeRequestMock).not.toHaveBeenCalled();
  });

  it("drops a cached token on invalidation so the next request reacquires, and shares within the new generation", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    apiGetMock
      .mockResolvedValueOnce(CSRF_RESPONSE)
      .mockResolvedValueOnce({ token: "token-new", headerName: "X-CSRF-TOKEN" });
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });

    await submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined);
    invalidateCsrfToken();
    await Promise.all([
      submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined),
      submitCsrfProtectedRequest("/api/v1/auth/logout", "POST", undefined),
    ]);

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiUnsafeRequestMock.mock.calls.map(tokenOf)).toEqual(["csrf-token-1", "token-new", "token-new"]);
  });

  it("invalidating does not itself request a token or resend anything", async () => {
    const { invalidateCsrfToken } = await import("../csrf");
    invalidateCsrfToken();
    invalidateCsrfToken();
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(apiUnsafeRequestMock).not.toHaveBeenCalled();
  });
});

/**
 * CUST-WEB-001-CP01a-C1: the token of each dispatch must belong to the generation that is current
 * at the moment the mutation is handed to the transport (an invalidation can land between the token
 * being read and the POST being built).
 */
describe("the CSRF token at dispatch time", () => {
  const microtasks = (count: number, fn: () => void) => {
    let chain: Promise<void> = Promise.resolve();
    for (let i = 0; i < count; i += 1) chain = chain.then(() => undefined);
    void chain.then(fn);
  };
  const headerOf = (call: unknown[]) => (call[3] as { headers: Record<string, string> }).headers["X-CSRF-TOKEN"];

  /** GET /auth/csrf mock: every call issues a numbered token and remembers how many test invalidations had happened. */
  function csrfIssuer() {
    const state = { testInvalidations: 0, issuedAt: new Map<string, number>(), issued: 0 };
    apiGetMock.mockImplementation(async () => {
      state.issued += 1;
      const token = `token-${state.issued}`;
      state.issuedAt.set(token, state.testInvalidations);
      return { token, headerName: "X-CSRF-TOKEN" };
    });
    return state;
  }

  it("OC schedule: prime the cache, start a mutation, invalidate in a queued microtask — the token sent belongs to the generation current at dispatch", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    const issuer = csrfIssuer();
    const sent: { token: string; invalidationsAtSend: number }[] = [];
    apiUnsafeRequestMock.mockImplementation(async (...args: unknown[]) => {
      sent.push({ token: headerOf(args), invalidationsAtSend: issuer.testInvalidations });
      return { status: 204, data: undefined };
    });
    await submitCsrfProtectedRequest("/synthetic/prime", "POST", undefined);
    sent.length = 0;

    const pending = submitCsrfProtectedRequest("/synthetic/request", "POST", undefined);
    queueMicrotask(() => {
      issuer.testInvalidations += 1;
      invalidateCsrfToken();
    });
    await pending;

    expect(sent).toHaveLength(1);
    expect(issuer.issuedAt.get(sent[0].token)).toBe(sent[0].invalidationsAtSend);
  });

  it("control: an invalidation that is already in effect when the dispatch is reached makes it read a fresh token first", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    csrfIssuer();
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });
    await submitCsrfProtectedRequest("/synthetic/prime", "POST", undefined);
    apiUnsafeRequestMock.mockClear();

    const pending = submitCsrfProtectedRequest("/synthetic/request", "POST", undefined);
    invalidateCsrfToken(); // synchronously, before the pending request reached its dispatch
    await pending;

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    expect(headerOf(apiUnsafeRequestMock.mock.calls[0])).toBe("token-2");
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 8, 10])(
    "first dispatch never carries a token older than the latest invalidation (invalidation after %i microtasks, cache primed)",
    async (delay) => {
      const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
      const issuer = csrfIssuer();
      apiUnsafeRequestMock.mockImplementation(async (...args: unknown[]) => {
        const sent = headerOf(args);
        expect(issuer.issuedAt.get(sent)).toBe(issuer.testInvalidations);
        return { status: 204, data: undefined };
      });
      await submitCsrfProtectedRequest("/synthetic/prime", "POST", undefined);
      apiUnsafeRequestMock.mockClear();

      const pending = submitCsrfProtectedRequest("/synthetic/request", "POST", undefined);
      microtasks(delay, () => {
        issuer.testInvalidations += 1;
        invalidateCsrfToken();
      });
      await pending;
      expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([0, 1, 2, 3, 4, 6, 8])(
    "first dispatch of a cold start never carries a token older than the latest invalidation (after %i microtasks)",
    async (delay) => {
      const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
      const issuer = csrfIssuer();
      apiUnsafeRequestMock.mockImplementation(async (...args: unknown[]) => {
        expect(issuer.issuedAt.get(headerOf(args))).toBe(issuer.testInvalidations);
        return { status: 204, data: undefined };
      });
      const pending = submitCsrfProtectedRequest("/synthetic/request", "POST", undefined);
      microtasks(delay, () => {
        issuer.testInvalidations += 1;
        invalidateCsrfToken();
      });
      await pending;
      expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([0, 1, 2, 3, 4, 5, 6, 8, 10, 12])(
    "the one exact-refusal retry never carries a token older than the latest invalidation (invalidation %i microtasks after the first dispatch)",
    async (delay) => {
      const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
      const issuer = csrfIssuer();
      let posts = 0;
      apiUnsafeRequestMock.mockImplementation(async (...args: unknown[]) => {
        posts += 1;
        if (posts === 1) {
          microtasks(delay, () => {
            issuer.testInvalidations += 1;
            invalidateCsrfToken();
          });
          throw ANTIFORGERY_ERROR;
        }
        expect(issuer.issuedAt.get(headerOf(args))).toBe(issuer.testInvalidations);
        return { status: 201, data: { ok: true } };
      });

      const result = await submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 }, {
        headers: { "Idempotency-Key": "key-1" },
      });

      expect(result).toEqual({ status: 201, data: { ok: true } });
      expect(posts).toBe(2); // exactly one retry, never a third POST
      expect(apiUnsafeRequestMock.mock.calls[1][3].headers["Idempotency-Key"]).toBe("key-1");
    }
  );

  it("does not resend a mutation that already reached the transport when the generation changes afterwards", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    csrfIssuer();
    let finish!: (value: { status: number; data: unknown }) => void;
    apiUnsafeRequestMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

    const pending = submitCsrfProtectedRequest("/api/v1/booking-holds", "POST", { a: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    invalidateCsrfToken();
    finish({ status: 201, data: { held: true } });

    await expect(pending).resolves.toEqual({ status: 201, data: { held: true } });
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("with no invalidation the cached token is reused and a request never causes an extra token fetch", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    csrfIssuer();
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });
    await submitCsrfProtectedRequest("/synthetic/a", "POST", undefined);
    await submitCsrfProtectedRequest("/synthetic/b", "POST", undefined);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiUnsafeRequestMock.mock.calls.map(headerOf)).toEqual(["token-1", "token-1"]);
  });

  it("concurrent first dispatches in one generation still share one acquisition and one token", async () => {
    const { submitCsrfProtectedRequest } = await import("../csrf");
    csrfIssuer();
    apiUnsafeRequestMock.mockResolvedValue({ status: 204, data: undefined });
    await Promise.all([
      submitCsrfProtectedRequest("/synthetic/a", "POST", undefined),
      submitCsrfProtectedRequest("/synthetic/b", "POST", undefined),
    ]);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiUnsafeRequestMock.mock.calls.map(headerOf)).toEqual(["token-1", "token-1"]);
  });

  it("an ordinary HTTP error after a generation change is returned once and is not retried", async () => {
    const { submitCsrfProtectedRequest, invalidateCsrfToken } = await import("../csrf");
    csrfIssuer();
    const ordinary = new ApiHttpError(409, { title: "Conflict", status: 409 });
    apiUnsafeRequestMock.mockRejectedValue(ordinary);
    const pending = submitCsrfProtectedRequest("/synthetic/a", "POST", undefined);
    queueMicrotask(() => invalidateCsrfToken());
    await expect(pending).rejects.toBe(ordinary);
    expect(apiUnsafeRequestMock).toHaveBeenCalledTimes(1);
  });
});
