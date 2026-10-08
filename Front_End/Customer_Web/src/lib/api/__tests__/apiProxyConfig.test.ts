import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BHA-WEB-PROXY-001: the opt-in same-origin API proxy in next.config.js. These cover the validation
 * rules and the rewrite the config produces; whether a real request survives the hop (method, body,
 * cookies, CSRF/Idempotency headers, several Set-Cookie, no-store) is a transport property proven by
 * the recorded local rehearsal in docs/reports/BHA-WEB-PROXY-001-completion.md, not by this file.
 */
const projectRoot = resolve(__dirname, "../../../..");
const nodeRequire = createRequire(join(projectRoot, "package.json"));
const { resolveApiProxyOrigin } = nodeRequire("./scripts/api-proxy-origin.cjs") as {
  resolveApiProxyOrigin: (env: Record<string, string | undefined>) => string | undefined;
};

const API = "https://the-bha-api.52-65-145-145.sslip.io";
const CUSTOMER = "https://the-bha-hotels-booking-p5rj.vercel.app";

describe("resolveApiProxyOrigin", () => {
  it.each([undefined, "", "   "])("keeps the direct mode when API_PROXY_ORIGIN is %j", (value) => {
    expect(resolveApiProxyOrigin({ API_PROXY_ORIGIN: value })).toBeUndefined();
  });

  it.each([
    [API, API],
    [`${API}/`, API],
    [`  ${API}  `, API],
    ["HTTPS://API.Example.COM:443/", "https://api.example.com"],
    ["https://api.example.com:8443", "https://api.example.com:8443"],
  ])("accepts %j as %s", (value, expected) => {
    expect(resolveApiProxyOrigin({ API_PROXY_ORIGIN: value, NEXT_PUBLIC_API_BASE_URL: CUSTOMER })).toBe(expected);
  });

  it.each([
    ["not a url"],
    ["leaky-host.test"],
    ["http://leaky-host.test"],
    ["ftp://leaky-host.test"],
    ["https://user:s3cret@leaky-host.test"],
    ["https://leaky-host.test?token=s3cret"],
    ["https://leaky-host.test/?"],
    ["https://leaky-host.test#access_token=s3cret"],
    ["https://leaky-host.test/#"],
    ["https://leaky-host.test/api"],
    ["https://leaky-host.test//"],
  ])("rejects %j without repeating the value", (value) => {
    let message = "";
    try {
      resolveApiProxyOrigin({ API_PROXY_ORIGIN: value });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("API_PROXY_ORIGIN");
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("leaky-host.test");
    expect(message).not.toContain(value.trim());
  });

  it.each([CUSTOMER, `${CUSTOMER}/`, CUSTOMER.toUpperCase().replace("HTTPS", "https")])(
    "rejects an upstream equal to the frontend origin (%s)",
    (value) => {
      expect(() =>
        resolveApiProxyOrigin({ API_PROXY_ORIGIN: value, NEXT_PUBLIC_API_BASE_URL: `${CUSTOMER}/` })
      ).toThrow(/own origin/);
    }
  );

  it("rejects the Vercel deployment hosts as an upstream", () => {
    const env = { API_PROXY_ORIGIN: "https://app-git-x.vercel.app", VERCEL_BRANCH_URL: "app-git-x.vercel.app" };
    expect(() => resolveApiProxyOrigin(env)).toThrow(/own origin/);
  });
});

describe("next.config.js", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function loadConfig(env: Record<string, string>) {
    for (const name of ["API_PROXY_ORIGIN", "NEXT_PUBLIC_API_BASE_URL"]) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    delete nodeRequire.cache[nodeRequire.resolve("./next.config.js")];
    return nodeRequire("./next.config.js") as {
      env?: Record<string, string>;
      images?: unknown;
      experimental?: unknown;
      rewrites: () => Promise<unknown>;
    };
  }

  it("adds no proxy and no flag when API_PROXY_ORIGIN is unset", async () => {
    const config = await loadConfig({ NEXT_PUBLIC_API_BASE_URL: "https://localhost:7145" });
    expect(await config.rewrites()).toEqual([]);
    expect(config.env).toBeUndefined();
  });

  it("rewrites /api/:path* to the upstream, keeping the /api prefix, and bakes the flag", async () => {
    const config = await loadConfig({ API_PROXY_ORIGIN: `${API}/`, NEXT_PUBLIC_API_BASE_URL: CUSTOMER });
    expect(await config.rewrites()).toEqual({
      beforeFiles: [{ source: "/api/:path*", destination: `${API}/api/:path*` }],
    });
    expect(config.env).toEqual({ BHA_API_PROXY_ENABLED: "true" });
  });

  it("preserves the unrelated configuration", async () => {
    const config = await loadConfig({ API_PROXY_ORIGIN: API });
    expect(config.experimental).toEqual({ appDir: true, typedRoutes: true });
    expect(JSON.stringify(config.images)).toContain("images.pexels.com");
  });

  it("fails config load on a bad value and on a self-referencing upstream", async () => {
    await expect(loadConfig({ API_PROXY_ORIGIN: "http://api.example.com" })).rejects.toThrow(/https/);
    await expect(
      loadConfig({ API_PROXY_ORIGIN: CUSTOMER, NEXT_PUBLIC_API_BASE_URL: CUSTOMER })
    ).rejects.toThrow(/own origin/);
  });
});
