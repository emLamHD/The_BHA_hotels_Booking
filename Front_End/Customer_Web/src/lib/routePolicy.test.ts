import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";
import { decideRoute } from "./routePolicy";

const ORIGIN = "https://localhost:3000";
const run = (path: string) => middleware(new NextRequest(new URL(path, ORIGIN)));
const runWithHost = (path: string, origin: string, host: string) =>
  middleware(new NextRequest(new URL(path, origin), { headers: { host } }));
const rewrittenTo = (path: string) => {
  const target = run(path).headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname + new URL(target).search : null;
};

describe("decideRoute", () => {
  it.each(["/", "//"])("serves the live entry at %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "live" });
  });

  it.each(["/home-2", "/home-2/", "/showcase", "/showcase/"])("sends the alias %s home", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "redirect-home" });
  });

  it.each(["/icon.jpg", "/showcase-unavailable"])("passes %s through", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });

  it.each([
    "/checkout", "/checkout/", "/pay-done", "/login", "/signup", "/home-3",
    "/listing-stay", "/listing-stay-map", "/listing-stay-detail", "/listing-car", "/listing-car-map",
    "/listing-car-detail", "/listing-flights", "/listing-experiences", "/listing-experiences-map",
    "/listing-experiences-detail", "/listing-real-estate", "/listing-real-estate-map",
    "/account", "/account-password", "/account-savelists", "/account-billing",
    "/add-listing", "/add-listing/1", "/add-listing/10", "/author", "/blog", "/blog/single", "/blog/a/b",
    "/subscription", "/about", "/contact", "/api/hello", "/home-2/x", "/showcase/x", "/HOME-2",
    "/Checkout", "/vercel.svg", "/next.svg", "/favicon.ico", "/robots.txt", "/unknown",
  ])("denies %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "unavailable" });
  });
});

describe("middleware", () => {
  it.each(["/", "/?ref=demo", "/?_rsc=abc"])("serves %s directly without rewriting or redirecting home", (path) => {
    const response = run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/home-2", "/home-2/", "/home-2/?ref=x", "/showcase", "/showcase/?ref=x"])("redirects %s to / with 307", (path) => {
    const response = run(path);
    expect(response.status).toBe(307);
    const locationHeader = response.headers.get("location")!;
    const location = new URL(locationHeader, ORIGIN);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/");
    expect(location.search).toBe(path.includes("ref=x") ? "?ref=x" : "");
  });

  it("preserves an exact loopback authority without trusting arbitrary Host values", () => {
    const loopback = runWithHost("/showcase?ref=x", "http://127.0.0.1:3000", "127.0.0.1:3000");
    expect(loopback.headers.get("location")).toBe("http://127%2e0%2e0%2e1:3000/?ref=x");
    expect(new URL(loopback.headers.get("location")!).origin).toBe("http://127.0.0.1:3000");

    const untrusted = runWithHost("/showcase", ORIGIN, "attacker.example");
    expect(new URL(untrusted.headers.get("location")!).origin).toBe(ORIGIN);
  });

  it.each(["/checkout?step=2", "/login", "/listing-stay-detail/", "/blog/post-1"])(
    "rewrites %s to the unavailable page without its query",
    (path) => {
      expect(rewrittenTo(path)).toBe("/showcase-unavailable");
    }
  );

  it("lets the logo through untouched", () => {
    const response = run("/icon.jpg");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("never runs for the Next runtime, fonts, chunks or the image optimizer", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/_next/static/chunks/app.js", "/_next/static/media/font.woff2", "/_next/image", "/_next/webpack-hmr"]) {
      expect(matcher.test(path)).toBe(false);
    }
    for (const path of ["/", "/checkout", "/next.svg", "/_nextx"]) {
      expect(matcher.test(path)).toBe(true);
    }
  });
});
