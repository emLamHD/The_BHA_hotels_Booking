import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getApiBaseUrl, resetApiBaseUrlCacheForTests } from "../env";

const ENV_VAR_NAME = "NEXT_PUBLIC_API_BASE_URL";
const originalValue = process.env[ENV_VAR_NAME];

beforeEach(() => {
  resetApiBaseUrlCacheForTests();
});

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_VAR_NAME];
  } else {
    process.env[ENV_VAR_NAME] = originalValue;
  }
  resetApiBaseUrlCacheForTests();
});

describe("getApiBaseUrl", () => {
  it("returns a valid absolute https URL unchanged", () => {
    process.env[ENV_VAR_NAME] = "https://localhost:7145";
    expect(getApiBaseUrl()).toBe("https://localhost:7145");
  });

  it("accepts a production https origin", () => {
    process.env[ENV_VAR_NAME] = "https://api.thebha.example";
    expect(getApiBaseUrl()).toBe("https://api.thebha.example");
  });

  it("normalizes a single trailing slash", () => {
    process.env[ENV_VAR_NAME] = "https://localhost:7145/";
    expect(getApiBaseUrl()).toBe("https://localhost:7145");
  });

  it("normalizes multiple trailing slashes", () => {
    process.env[ENV_VAR_NAME] = "https://api.example.com///";
    expect(getApiBaseUrl()).toBe("https://api.example.com");
  });

  it("caches the value across calls until reset", () => {
    process.env[ENV_VAR_NAME] = "https://localhost:7145";
    expect(getApiBaseUrl()).toBe("https://localhost:7145");
    process.env[ENV_VAR_NAME] = "https://changed:9999";
    expect(getApiBaseUrl()).toBe("https://localhost:7145");
  });

  it("caches only a validated value, so a later valid https value is still read after a rejection", () => {
    process.env[ENV_VAR_NAME] = "http://localhost:5145";
    expect(() => getApiBaseUrl()).toThrow(/https/i);

    process.env[ENV_VAR_NAME] = "https://localhost:7145";
    expect(getApiBaseUrl()).toBe("https://localhost:7145");
  });

  it("throws when the variable is missing", () => {
    delete process.env[ENV_VAR_NAME];
    expect(() => getApiBaseUrl()).toThrow(/not configured/i);
  });

  it("throws when the variable is an empty string", () => {
    process.env[ENV_VAR_NAME] = "   ";
    expect(() => getApiBaseUrl()).toThrow(/not configured/i);
  });

  // PMS-CAL-001.1 correction C6: the API applies UseHttpsRedirection()
  // globally. An http:// base makes the browser send a credentialed/JSON
  // preflight to the HTTP listener and get a cross-origin redirect, which
  // browsers do not reliably follow — booking and auth would break before the
  // real request was sent. So http is rejected at configuration time.
  it("rejects the previously documented http localhost base", () => {
    process.env[ENV_VAR_NAME] = "http://localhost:5145";
    expect(() => getApiBaseUrl()).toThrow(/must use https/i);
  });

  it("rejects http loopback addresses", () => {
    for (const value of ["http://127.0.0.1:5145", "http://[::1]:5145", "http://localhost"]) {
      resetApiBaseUrlCacheForTests();
      process.env[ENV_VAR_NAME] = value;
      expect(() => getApiBaseUrl()).toThrow(/must use https/i);
    }
  });

  it("rejects an ordinary remote http origin", () => {
    process.env[ENV_VAR_NAME] = "http://api.example.com";
    expect(() => getApiBaseUrl()).toThrow(/must use https/i);
  });

  it("never rewrites http to https", () => {
    process.env[ENV_VAR_NAME] = "http://localhost:7145";
    expect(() => getApiBaseUrl()).toThrow(/must use https/i);
  });

  it("throws for a relative path instead of an absolute URL", () => {
    process.env[ENV_VAR_NAME] = "/api";
    expect(() => getApiBaseUrl()).toThrow(/absolute https URL/i);
  });

  it("throws for a non-http(s) scheme", () => {
    process.env[ENV_VAR_NAME] = "ftp://localhost:5145";
    expect(() => getApiBaseUrl()).toThrow(/must use https/i);
  });

  it("throws for a malformed URL", () => {
    process.env[ENV_VAR_NAME] = "https://";
    expect(() => getApiBaseUrl()).toThrow();
  });

  it("rejects a base URL carrying credentials without echoing them", () => {
    process.env[ENV_VAR_NAME] = "https://user:secret@localhost:7145";
    expect(() => getApiBaseUrl()).toThrow(/must not embed URL credentials/i);
    try {
      getApiBaseUrl();
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("rejects a base URL carrying a query string or fragment", () => {
    process.env[ENV_VAR_NAME] = "https://localhost:7145?token=abc";
    expect(() => getApiBaseUrl()).toThrow(/query string or fragment/i);

    resetApiBaseUrlCacheForTests();
    process.env[ENV_VAR_NAME] = "https://localhost:7145#frag";
    expect(() => getApiBaseUrl()).toThrow(/query string or fragment/i);
  });
});
