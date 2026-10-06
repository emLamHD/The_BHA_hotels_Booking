import { NextRequest, NextResponse } from "next/server";
import { decideRoute, LIVE_ENTRY_PAGE, UNAVAILABLE_PAGE } from "@/lib/routePolicy";

/**
 * CUST-WEB-SHOWCASE-001-CP01: `/` serves the live booking entry, its old and
 * internal names redirect to `/`, and every other page path is rewritten to
 * the unavailable page (HTTP 404) before any template renders.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  switch (decideRoute(pathname).kind) {
    case "live":
      return NextResponse.rewrite(new URL(LIVE_ENTRY_PAGE + search, request.url));
    case "redirect-home":
      return NextResponse.redirect(new URL("/" + search, request.url), 307);
    case "pass":
      return NextResponse.next();
    default:
      return NextResponse.rewrite(new URL(UNAVAILABLE_PAGE, request.url));
  }
}

export const config = {
  // Everything except the framework runtime: static chunks, fonts, the image
  // optimizer and dev HMR all live under /_next/.
  matcher: ["/((?!_next/).*)"],
};
