import { describe, expect, it, afterEach, vi } from "vitest";
import { describeApiBaseUrlError, getApiBaseUrl, resolveApiBaseUrl } from "./env";

describe("resolveApiBaseUrl", () => {
  it("accepts a plain https URL and normalizes no trailing slash", () => {
    const result = resolveApiBaseUrl("https://localhost:7145");
    expect(result).toEqual({ ok: true, baseUrl: "https://localhost:7145" });
  });

  it("strips a trailing slash", () => {
    const result = resolveApiBaseUrl("https://localhost:7145/");
    expect(result).toEqual({ ok: true, baseUrl: "https://localhost:7145" });
  });

  it("strips a trailing slash from a sub-path", () => {
    const result = resolveApiBaseUrl("https://api.example.com/admin/");
    expect(result).toEqual({ ok: true, baseUrl: "https://api.example.com/admin" });
  });

  it("rejects a missing value", () => {
    expect(resolveApiBaseUrl(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(resolveApiBaseUrl(null)).toEqual({ ok: false, reason: "missing" });
    expect(resolveApiBaseUrl("")).toEqual({ ok: false, reason: "missing" });
    expect(resolveApiBaseUrl("   ")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a malformed URL", () => {
    expect(resolveApiBaseUrl("not-a-url")).toEqual({ ok: false, reason: "invalid-url" });
  });

  it("rejects plain http, including http://localhost", () => {
    expect(resolveApiBaseUrl("http://api.example.com")).toEqual({ ok: false, reason: "not-https" });
    expect(resolveApiBaseUrl("http://localhost:7145")).toEqual({ ok: false, reason: "not-https" });
  });

  it("rejects a URL carrying credentials", () => {
    expect(resolveApiBaseUrl("https://user:pass@localhost:7145")).toEqual({
      ok: false,
      reason: "has-credentials-or-query-or-fragment",
    });
  });

  it("rejects a URL carrying a query string", () => {
    expect(resolveApiBaseUrl("https://localhost:7145?token=abc")).toEqual({
      ok: false,
      reason: "has-credentials-or-query-or-fragment",
    });
  });

  it("rejects a URL carrying a fragment", () => {
    expect(resolveApiBaseUrl("https://localhost:7145#section")).toEqual({
      ok: false,
      reason: "has-credentials-or-query-or-fragment",
    });
  });
});

describe("describeApiBaseUrlError", () => {
  it("returns a distinct human-readable message per reason", () => {
    const reasons = ["missing", "invalid-url", "not-https", "has-credentials-or-query-or-fragment"] as const;
    const messages = reasons.map((reason) => describeApiBaseUrlError(reason));
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe("getApiBaseUrl", () => {
  const originalValue = process.env.NEXT_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalValue;
    vi.unstubAllEnvs();
  });

  it("reads NEXT_PUBLIC_API_BASE_URL from process.env", () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://localhost:7145";
    expect(getApiBaseUrl()).toEqual({ ok: true, baseUrl: "https://localhost:7145" });
  });

  it("reports missing when unset", () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(getApiBaseUrl()).toEqual({ ok: false, reason: "missing" });
  });
});
