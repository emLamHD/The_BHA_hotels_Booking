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

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3 (Owner decision): the Chisfis template pages are served again with their
 * own demo content. What is closed is the server side (`/api/*`); two names are redirected (`/showcase`
 * to `/`, `/pay-done` to the live receipt `/paydone`).
 */
describe("decideRoute", () => {
  it.each(["/", "//"])("serves the home page at %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "live" });
  });

  it.each(["/showcase", "/showcase/"])("sends the old internal entry %s home", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "redirect", to: "/" });
  });

  it.each(["/pay-done", "/pay-done/"])("sends the template's receipt %s to the live receipt", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "redirect", to: "/paydone" });
  });

  it.each(["/paydone", "/paydone/"])("serves the live receipt at %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });

  it.each([
    "/listing-stay-detail", "/listing-stay", "/listing-stay-map", "/listing-car", "/listing-car-map",
    "/listing-car-detail", "/listing-flights", "/listing-experiences", "/listing-experiences-map",
    "/listing-experiences-detail", "/listing-real-estate", "/listing-real-estate-map",
    "/account", "/account-password", "/account-savelists", "/account-billing",
    "/add-listing", "/add-listing/1", "/author", "/blog", "/blog/single", "/checkout", "/login", "/signup",
    "/subscription", "/about", "/contact", "/home-2", "/home-3", "/icon.jpg", "/showcase-unavailable",
  ])("serves the template page %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });

  it.each([
    "/media/the-bha-riverside/entrance-logo.webp",
    "/media/the-bha-riverside/rooftop-pool-day.webp",
    "/media/the-bha-riverside/a1.webp",
  ])("passes the controlled photograph %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });

  it.each(["/api", "/api/", "/api/hello", "/api/hello/auth/x", "/API/hello", "/Api/x", "/api//x"])(
    "keeps the server side closed: %s is never served",
    (path) => {
      expect(decideRoute(path)).toEqual({ kind: "unavailable" });
    }
  );

  it.each(["/apix", "/api-docs", "/x/api", "/application"])("does not mistake %s for the API", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });
});

describe("middleware", () => {
  it.each(["/", "/?ref=demo", "/?_rsc=abc"])("serves %s directly without rewriting or redirecting", (path) => {
    const response = run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "/listing-stay-detail",
    "/listing-stay-detail?propertyId=a&roomTypeId=b&modal=PHOTO_TOUR_SCROLLABLE&photoId=2",
    "/paydone",
    "/login",
    "/listing-stay-map",
    "/home-2",
    "/home-3",
    "/checkout?step=2",
  ])("serves the page %s untouched, query kept", (path) => {
    const response = run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    ["/showcase", "/"],
    ["/showcase/?ref=x", "/?ref=x"],
    ["/pay-done", "/paydone"],
    ["/pay-done?x=1", "/paydone?x=1"],
  ])("redirects %s to %s with 307", (path, expected) => {
    const response = run(path);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!, ORIGIN);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname + location.search).toBe(expected);
  });

  // The serialized header is two layers' business: this middleware encodes the dots of a literal loopback
  // IP so Next's adapter does not rewrite it to localhost. Only what the Location resolves to is the contract.
  it.each([
    ["http://127.0.0.1:3000", "127.0.0.1:3000"],
    ["http://localhost:3000", "localhost:3000"],
  ])("keeps the %s authority on both redirects", (origin, host) => {
    for (const [path, expected] of [["/showcase?ref=x", "/?ref=x"], ["/pay-done?ref=x", "/paydone?ref=x"]]) {
      const response = runWithHost(path, origin, host);
      const resolved = new URL(response.headers.get("location")!, origin);
      expect(resolved.origin).toBe(origin);
      expect(resolved.href).toBe(new URL(expected, origin).href);
    }
  });

  it("does not trust an arbitrary Host value for the redirect target", () => {
    const untrusted = runWithHost("/showcase", ORIGIN, "attacker.example");
    expect(new URL(untrusted.headers.get("location")!, ORIGIN).origin).toBe(ORIGIN);
  });

  it.each(["/api/hello", "/api/hello/auth/x", "/API/x"])("rewrites %s to the unavailable page, without its query", (path) => {
    expect(rewrittenTo(`${path}?a=1`)).toBe("/showcase-unavailable");
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
