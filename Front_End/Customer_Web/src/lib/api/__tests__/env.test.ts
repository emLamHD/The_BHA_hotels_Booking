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
  it("returns a valid absolute URL unchanged", () => {
    process.env[ENV_VAR_NAME] = "http://localhost:5145";
    expect(getApiBaseUrl()).toBe("http://localhost:5145");
  });

  it("normalizes a single trailing slash", () => {
    process.env[ENV_VAR_NAME] = "http://localhost:5145/";
    expect(getApiBaseUrl()).toBe("http://localhost:5145");
  });

  it("normalizes multiple trailing slashes", () => {
    process.env[ENV_VAR_NAME] = "https://api.example.com///";
    expect(getApiBaseUrl()).toBe("https://api.example.com");
  });

  it("caches the value across calls until reset", () => {
    process.env[ENV_VAR_NAME] = "http://localhost:5145";
    expect(getApiBaseUrl()).toBe("http://localhost:5145");
    process.env[ENV_VAR_NAME] = "http://changed:9999";
    expect(getApiBaseUrl()).toBe("http://localhost:5145");
  });

  it("throws when the variable is missing", () => {
    delete process.env[ENV_VAR_NAME];
    expect(() => getApiBaseUrl()).toThrow(/not configured/i);
  });

  it("throws when the variable is an empty string", () => {
    process.env[ENV_VAR_NAME] = "   ";
    expect(() => getApiBaseUrl()).toThrow(/not configured/i);
  });

  it("throws for a relative path instead of an absolute URL", () => {
    process.env[ENV_VAR_NAME] = "/api";
    expect(() => getApiBaseUrl()).toThrow(/absolute http or https URL/i);
  });

  it("throws for a non-http(s) scheme", () => {
    process.env[ENV_VAR_NAME] = "ftp://localhost:5145";
    expect(() => getApiBaseUrl()).toThrow(/absolute http or https URL/i);
  });

  it("throws for a malformed URL", () => {
    process.env[ENV_VAR_NAME] = "http://";
    expect(() => getApiBaseUrl()).toThrow();
  });
});
