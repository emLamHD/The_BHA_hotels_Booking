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

  // PMS-CAL-001.1 correction C8: a rejected configuration value is treated as
  // potentially secret in full. The previous implementation redacted only
  // values containing "@", so a forbidden query or fragment — the two places a
  // token is most often pasted — was echoed verbatim into `Error.message`,
  // which reaches the browser console and deployment logs. There is no
  // heuristic here to get wrong: no rejected value, parsed or raw, is ever
  // interpolated, so what a value happens to contain no longer matters.
  //
  // Every sentinel below is synthetic. Each case asserts both that the message
  // still names the right constraint (it must stay actionable) and that
  // neither the sentinel nor the whole rejected value survives into it.
  describe("never discloses a rejected value (correction C8)", () => {
    const rejectedValues: ReadonlyArray<{
      readonly what: string;
      readonly value: string;
      readonly sentinel: string;
      readonly constraint: RegExp;
    }> = [
      {
        what: "a query-string secret",
        value: "https://api.example.test?token=C8_QUERY_SENTINEL",
        sentinel: "C8_QUERY_SENTINEL",
        constraint: /query string or fragment/i,
      },
      {
        what: "a fragment secret",
        value: "https://api.example.test#access_token=C8_FRAGMENT_SENTINEL",
        sentinel: "C8_FRAGMENT_SENTINEL",
        constraint: /query string or fragment/i,
      },
      {
        what: "a URL password",
        value: "https://user:C8_PASSWORD_SENTINEL@api.example.test",
        sentinel: "C8_PASSWORD_SENTINEL",
        constraint: /must not embed URL credentials/i,
      },
      {
        what: "an http URL carrying a query secret",
        value: "http://api.example.test?api_key=C8_HTTP_SENTINEL",
        sentinel: "C8_HTTP_SENTINEL",
        constraint: /must use https/i,
      },
      {
        what: "a relative path with sensitive content",
        value: "/api/C8_PATH_SENTINEL",
        sentinel: "C8_PATH_SENTINEL",
        constraint: /absolute https URL/i,
      },
      {
        what: "a malformed value with sensitive content",
        value: "https://:C8_MALFORMED_SENTINEL@@ ??",
        sentinel: "C8_MALFORMED_SENTINEL",
        constraint: /absolute https URL/i,
      },
    ];

    for (const { what, value, sentinel, constraint } of rejectedValues) {
      it(`rejects ${what} without echoing it`, () => {
        process.env[ENV_VAR_NAME] = value;

        let message = "";
        try {
          getApiBaseUrl();
          throw new Error(`expected ${what} to be rejected, but it was accepted`);
        } catch (error) {
          message = (error as Error).message;
        }

        // Still actionable: the operator learns which variable and which rule.
        expect(message).toMatch(constraint);
        expect(message).toContain(ENV_VAR_NAME);

        // …but learns nothing about the value itself.
        expect(message).not.toContain(sentinel);
        expect(message).not.toContain(value);

        // The rejected value must not be cached: fixing the configuration and
        // calling again has to succeed rather than replay the failure.
        process.env[ENV_VAR_NAME] = "https://localhost:7145";
        resetApiBaseUrlCacheForTests();
        expect(getApiBaseUrl()).toBe("https://localhost:7145");
      });
    }

    it("keeps the rejected value out of the message even without resetting the cache", () => {
      // A rejection must not populate the cache, so the second call re-reads
      // the (still invalid) environment and fails the same way — it must not
      // return a value, and must not start leaking one either.
      process.env[ENV_VAR_NAME] = "https://api.example.test?token=C8_REPEAT_SENTINEL";

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          getApiBaseUrl();
          throw new Error("expected the query-string value to be rejected");
        } catch (error) {
          expect((error as Error).message).not.toContain("C8_REPEAT_SENTINEL");
        }
      }
    });

    it("does not interpolate a rejected value in any validation branch", async () => {
      // A guard against reintroduction: no message template in env.ts may
      // splice in the raw or parsed value under any name. This catches a new
      // branch added later that reaches for the value again.
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const source = readFileSync(resolve(__dirname, "../env.ts"), "utf8");

      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
        .join("\n");

      for (const forbidden of [
        "${rawValue}",
        "${trimmed}",
        "${parsed}",
        "${parsed.href}",
        "${value}",
        "describeValue",
      ]) {
        expect(code).not.toContain(forbidden);
      }

      // Nothing about a rejected value may be written to the console either.
      expect(code).not.toMatch(/console\./);
    });
  });
});
