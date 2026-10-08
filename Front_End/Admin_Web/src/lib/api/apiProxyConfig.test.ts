import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApiProxyOrigin } from "../../../scripts/api-proxy-origin";

/**
 * BHA-ADMIN-PROXY-001: the opt-in same-origin Staff API proxy in next.config.ts. These cover the
 * validation rules and the rewrite the config produces; whether a real request survives the hop (method,
 * body, Origin/Cookie, several Set-Cookie, no-store) is a transport property proven by the recorded
 * local rehearsal in docs/reports/BHA-ADMIN-PROXY-001-completion.md, not by this file.
 */
const API = "https://the-bha-api.52-65-145-145.sslip.io";
const ADMIN = "https://the-bha-hotels-booking.vercel.app";

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
    expect(resolveApiProxyOrigin({ API_PROXY_ORIGIN: value, NEXT_PUBLIC_API_BASE_URL: ADMIN })).toBe(expected);
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
    ["https://leaky-host.test/api/admin/v1"],
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

  it.each([ADMIN, `${ADMIN}/`, ADMIN.replace("https://", "HTTPS://").toUpperCase()])(
    "rejects an upstream equal to the Admin origin (%s)",
    (value) => {
      expect(() =>
        resolveApiProxyOrigin({ API_PROXY_ORIGIN: value, NEXT_PUBLIC_API_BASE_URL: `${ADMIN}/` })
      ).toThrow(/own origin/);
    }
  );

  it("rejects the Vercel deployment hosts as an upstream", () => {
    const env = { API_PROXY_ORIGIN: "https://app-git-x.vercel.app", VERCEL_BRANCH_URL: "app-git-x.vercel.app" };
    expect(() => resolveApiProxyOrigin(env)).toThrow(/own origin/);
  });

  it("does not let an unparseable NEXT_PUBLIC_API_BASE_URL block a valid upstream", () => {
    expect(resolveApiProxyOrigin({ API_PROXY_ORIGIN: API, NEXT_PUBLIC_API_BASE_URL: "nonsense" })).toBe(API);
  });
});

describe("next.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadConfig(env: Record<string, string>) {
    vi.resetModules();
    for (const name of ["API_PROXY_ORIGIN", "NEXT_PUBLIC_API_BASE_URL"]) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    return (await import("../../../next.config")).default;
  }

  it("adds no proxy when API_PROXY_ORIGIN is unset", async () => {
    const config = await loadConfig({ NEXT_PUBLIC_API_BASE_URL: "https://localhost:7145" });
    expect(await config.rewrites!()).toEqual([]);
  });

  it("rewrites only /api/admin/v1/:path* to the upstream, keeping the prefix", async () => {
    const config = await loadConfig({ API_PROXY_ORIGIN: `${API}/`, NEXT_PUBLIC_API_BASE_URL: ADMIN });
    expect(await config.rewrites!()).toEqual({
      beforeFiles: [{ source: "/api/admin/v1/:path*", destination: `${API}/api/admin/v1/:path*` }],
    });
  });

  it("preserves the webpack and turbopack SVG rules", async () => {
    const config = await loadConfig({ API_PROXY_ORIGIN: API });
    const webpackConfig = { module: { rules: [] as unknown[] } };
    config.webpack!(webpackConfig as never, {} as never);
    expect(webpackConfig.module.rules).toEqual([{ test: /\.svg$/, use: ["@svgr/webpack"] }]);
    expect(config.turbopack).toEqual({
      rules: { "*.svg": { loaders: ["@svgr/webpack"], as: "*.js" } },
    });
  });

  it("fails config load on a bad value and on a self-referencing upstream", async () => {
    await expect(loadConfig({ API_PROXY_ORIGIN: "http://leaky-host.test" })).rejects.toThrow(/https/);
    await expect(
      loadConfig({ API_PROXY_ORIGIN: ADMIN, NEXT_PUBLIC_API_BASE_URL: ADMIN })
    ).rejects.toThrow(/own origin/);
  });
});
