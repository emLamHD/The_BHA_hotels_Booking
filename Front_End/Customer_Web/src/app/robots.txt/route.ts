import { robotsTxt } from "@/lib/seo/sitemap";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

// A route handler for the same reason as the sitemap: the `robots.ts` convention is rendered at build time, so the sitemap line would be whatever SITE_URL was then.
export const dynamic = "force-dynamic";

/** BHA-BLOG-001-CP05: `/robots.txt`, with the sitemap named from the configured public origin (and not named when there is none). */
export function GET(): Response {
  return new Response(robotsTxt(getSiteOrigin()), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
