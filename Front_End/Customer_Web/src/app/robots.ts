import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

export const dynamic = "force-dynamic";

/**
 * BHA-BLOG-001-CP05: `/robots.txt`. Everything public may be crawled; only what is not a page for the public is kept out (the API, the account, checkout and
 * receipt). The sitemap is named from the configured public origin — and not named at all when there is none, rather than from a guess.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/checkout", "/paydone", "/pay-done"] }],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
