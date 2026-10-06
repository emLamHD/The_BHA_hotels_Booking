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

  // CP02-C2: exactly one template listing route is real now — a room's page.
  it.each(["/listing-stay-detail", "/listing-stay-detail/"])("passes the room details route %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });

  it.each([
    "/listing-stay-detail/x", "/listing-stay-detail-x", "/listing-stay-details", "/Listing-Stay-Detail",
    "/listing-stay-detail/../checkout", "/listing-stay-detail%2f", "/x/listing-stay-detail",
    "/listing-car-detail", "/listing-experiences-detail", "/listing-stay", "/listing-stay-map",
  ])("does not open the rest of the listing group through %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "unavailable" });
  });

  it.each([
    "/media/the-bha-riverside/entrance-logo.webp",
    "/media/the-bha-riverside/rooftop-pool-day.webp",
    "/media/the-bha-riverside/a1.webp",
  ])("passes the controlled photograph %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "pass" });
  });

  it.each([
    "/media/the-bha-riverside/entrance-logo.webp/", // trailing slash
    "/media/the-bha-riverside/Entrance-Logo.webp", // uppercase
    "/media/the-bha-riverside/entrance_logo.webp", // underscore
    "/media/the-bha-riverside/-lead.webp",
    "/media/the-bha-riverside/trail-.webp",
    "/media/the-bha-riverside/a..b.webp",
    "/media/the-bha-riverside/entrance.logo.webp",
    "/media/the-bha-riverside/entrance-logo.jpg",
    "/media/the-bha-riverside/entrance-logo.png",
    "/media/the-bha-riverside/manifest.json",
    "/media/the-bha-riverside/.webp",
    "/media/the-bha-riverside/",
    "/media/the-bha-riverside",
    "/media/the-bha-riverside/sub/entrance-logo.webp", // nested
    "/media/the-bha-riverside/../entrance-logo.webp",
    "/media/the-bha-riverside/%2e%2e/entrance-logo.webp",
    "/media/the-bha-riverside/entrance%2flogo.webp",
    "/media/the-bha-riverside/entrance%2dlogo.webp",
    "/media/the-bha-riverside/entrance-logo.webp%00",
    "/media/the-bha-riverside//entrance-logo.webp",
    "//media/the-bha-riverside/entrance-logo.webp",
    "/media/other/entrance-logo.webp", // another namespace
    "/media/the-bha-riverside-extra/entrance-logo.webp",
    "/Media/the-bha-riverside/entrance-logo.webp",
    "/public/media/the-bha-riverside/entrance-logo.webp",
    "/images/entrance-logo.webp",
    "/vercel.svg",
  ])("still denies the lookalike %s", (path) => {
    expect(decideRoute(path)).toEqual({ kind: "unavailable" });
  });

  it.each([
    "/checkout", "/checkout/", "/pay-done", "/login", "/signup", "/home-3",
    "/listing-stay", "/listing-stay-map", "/listing-car", "/listing-car-map",
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

  // The serialized header is two layers' business: this middleware encodes the
  // dots of a literal loopback IP so Next's adapter does not rewrite it to
  // localhost, and the running server then emits `Location` relative (observed
  // on `next start -H 127.0.0.1`: `/?ref=x`). Only what the Location resolves to
  // is the contract, so that is what is asserted — not the exact string.
  it.each([
    ["http://127.0.0.1:3000", "127.0.0.1:3000"],
    ["http://localhost:3000", "localhost:3000"],
  ])("keeps the %s authority: the redirect resolves to the same origin, path and query", (origin, host) => {
    const response = runWithHost("/showcase?ref=x", origin, host);
    const resolved = new URL(response.headers.get("location")!, origin);
    expect(resolved.origin).toBe(origin);
    expect(resolved.pathname).toBe("/");
    expect(resolved.search).toBe("?ref=x");
    expect(resolved.href).toBe(new URL("/?ref=x", origin).href); // same target as a relative Location
  });

  it("does not trust an arbitrary Host value for the redirect target", () => {
    const untrusted = runWithHost("/showcase", ORIGIN, "attacker.example");
    expect(new URL(untrusted.headers.get("location")!, ORIGIN).origin).toBe(ORIGIN);
  });

  it.each(["/checkout?step=2", "/login", "/listing-stay-detail/x", "/blog/post-1"])(
    "rewrites %s to the unavailable page without its query",
    (path) => {
      expect(rewrittenTo(path)).toBe("/showcase-unavailable");
    }
  );

  it.each([
    "/listing-stay-detail",
    "/listing-stay-detail/",
    "/listing-stay-detail?propertyId=a1000000-0000-0000-0000-000000000001&roomTypeId=a3000000-0000-0000-0000-000000000001",
    "/listing-stay-detail?propertyId=a&roomTypeId=b&modal=PHOTO_TOUR_SCROLLABLE&photoId=2",
  ])("serves the room details route %s directly, query untouched", (path) => {
    const response = run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets a controlled photograph through untouched and refuses the manifest", () => {
    const photo = run("/media/the-bha-riverside/entrance-logo.webp");
    expect(photo.headers.get("x-middleware-next")).toBe("1");
    expect(photo.headers.get("x-middleware-rewrite")).toBeNull();
    expect(rewrittenTo("/media/the-bha-riverside/manifest.json")).toBe("/showcase-unavailable");
    expect(rewrittenTo("/media/the-bha-riverside/%2e%2e/secret.webp")).toBe("/showcase-unavailable");
  });

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
