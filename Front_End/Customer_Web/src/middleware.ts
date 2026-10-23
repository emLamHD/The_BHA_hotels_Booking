import { NextRequest, NextResponse } from "next/server";
import { decideRoute, UNAVAILABLE_PAGE } from "@/lib/routePolicy";
import { getApiBaseUrl } from "@/lib/api/env";
import { normalizeLocale } from "@/lib/blog/blog";
import { resolveBlogRedirect } from "@/lib/blog/redirects";
import { getSiteOrigin } from "@/lib/seo/siteUrl";
import { LOCALE_COOKIE, LOCALE_OVERRIDE_HEADER } from "@/lib/i18n/types";

/**
 * BHA-BLOG-001-CP04: on `/blog` paths (a) an old slug or the old `?category=` address answers a permanent redirect to the current Customer URL, and (b) the
 * URL's explicit `?locale=` is handed to the server render as a request header. The header is dropped everywhere else, so no other page can be given a
 * language by a header a client invented.
 */
function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("host") ?? "";
  const protocol = request.headers.get("x-forwarded-proto") === "https" ? "https:" : request.nextUrl.protocol;
  return /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host) ? `${protocol}//${host}` : request.nextUrl.origin.replace(/^https?:/, protocol);
}

async function blogPass(request: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = request.nextUrl;
  const isBlog = pathname === "/blog" || pathname.startsWith("/blog/");
  if (isBlog) {
    let target: string | null = null;
    try {
      target = await resolveBlogRedirect({ pathname, searchParams, cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value, apiBase: getApiBaseUrl() });
    } catch {
      target = null; // a misconfigured API base is the page's error to show, not a reason to break the request here
    }
    if (target) {
      // Next's middleware adapter needs an ABSOLUTE Location, so its origin matters: the configured public origin (SITE_URL) when there is one — the address the
      // site means to be found at — else the request's own, where a TLS terminator in front (which makes Next see `http:`) is honoured by its `x-forwarded-proto: https`.
      return NextResponse.redirect(new URL(target, getSiteOrigin() ?? requestOrigin(request)), 301);
    }
  }
  const headers = new Headers(request.headers);
  const explicit = isBlog ? normalizeLocale(searchParams.get("locale")) : null;
  if (explicit) headers.set(LOCALE_OVERRIDE_HEADER, explicit);
  else headers.delete(LOCALE_OVERRIDE_HEADER);
  return NextResponse.next({ request: { headers } });
}

/**
 * CUST-WEB-SHOWCASE-001-CP01-C2 / CP02-C3: `/` is rendered by app/page.tsx directly. The template's
 * pages are served; `/showcase` redirects to `/`, `/pay-done` to `/paydone`, and `/api/*` is
 * rewritten to the unavailable page (HTTP 404). See lib/routePolicy.ts.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // BHA-WEB-PROXY-001: inlined by next.config.js `env` at build time, only when the API proxy rewrite
  // was configured. Written as a literal `process.env.X` so Next can replace it in the edge bundle.
  const apiProxyEnabled = process.env.BHA_API_PROXY_ENABLED === "true";
  switch (decideRoute(pathname, { apiProxyEnabled }).kind) {
    case "live":
      // Rewriting home to /showcase can make Next 13.4.3 normalize a loopback
      // request to localhost and re-run middleware. The real page now lives at
      // app/page.tsx, so let this URL pass without rewriting it.
      return NextResponse.next();
    case "redirect": {
      const target = decideRoute(pathname);
      const to = target.kind === "redirect" ? target.to : "/";
      // Next 13.4.3 normalizes request.url from 127.0.0.1 to localhost before
      // middleware runs. Preserve the original authority only for these exact
      // loopback hosts; never build a redirect from an arbitrary Host or
      // forwarded header. Next's middleware adapter requires an absolute URL.
      const host = request.headers.get("host") ?? "";
      const isLoopbackHost = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host);
      if (isLoopbackHost && host.toLowerCase().startsWith("127.")) {
        // NextURL unconditionally rewrites a literal loopback IP to localhost
        // while adapting redirect responses. Encoding the dots keeps that
        // adapter rewrite from changing the browser's origin; URL parsers on
        // the client still resolve the authority to the same loopback IP.
        const encodedAuthority = host.replace(/\./g, "%2e");
        const response = new NextResponse(null, { status: 307 });
        response.headers.set(
          "Location",
          `${request.nextUrl.protocol}//${encodedAuthority}${to}${search}`
        );
        return response;
      }
      const origin = isLoopbackHost
        ? `${request.nextUrl.protocol}//${host}`
        : request.nextUrl.origin;
      return NextResponse.redirect(new URL(to + search, origin), 307);
    }
    case "pass":
      return blogPass(request);
    default:
      return NextResponse.rewrite(new URL(UNAVAILABLE_PAGE, request.url));
  }
}

export const config = {
  // Everything except the framework runtime: static chunks, fonts, the image
  // optimizer and dev HMR all live under /_next/.
  matcher: ["/((?!_next/).*)"],
};
