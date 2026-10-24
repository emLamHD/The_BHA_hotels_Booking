import { getApiBaseUrl } from "@/lib/api/env";
import { normalizeLocale } from "@/lib/blog/blog";
import { getAllBlogCategories, getAllBlogPosts } from "@/lib/blog/server";
import { sitemapEntries, sitemapXml } from "@/lib/seo/sitemap";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

// A route handler, not the `sitemap.ts` convention: Next 13.4.3 renders that one at BUILD time whatever `dynamic` says, which would freeze the list and fail a build
// without SITE_URL. Built for each request from what is public now (a post published a minute ago is in it; one unpublished is not).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * BHA-BLOG-001-CP05: `/sitemap.xml`. The languages are the site's active ones (the website settings); the posts are every page of the API's list, not the first.
 * If the origin is not configured, or ANY read fails, the answer is an error (HTTP 500) — never a partial sitemap that looks complete.
 */
export async function GET(): Promise<Response> {
  try {
    const origin = getSiteOrigin();
    if (!origin) throw new Error("SITE_URL is not configured: there is no public origin to build a sitemap from.");

    const response = await fetch(`${getApiBaseUrl()}/api/v1/website/config`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`the website languages could not be read (HTTP ${response.status})`);
    const config = (await response.json()) as { locales?: { code?: unknown }[] };
    const codes = (config.locales ?? []).map((l) => (typeof l.code === "string" ? normalizeLocale(l.code) : null)).filter((c): c is string => c !== null);
    if (codes.length === 0) throw new Error("the website has no active language");

    const posts: Record<string, Awaited<ReturnType<typeof getAllBlogPosts>>> = {};
    const categories: Record<string, Awaited<ReturnType<typeof getAllBlogCategories>>> = {};
    for (const code of codes) {
      posts[code] = await getAllBlogPosts(code);
      categories[code] = await getAllBlogCategories(code);
    }
    return new Response(sitemapXml(sitemapEntries(origin, codes, { posts, categories })), { headers: { "Content-Type": "application/xml; charset=utf-8", ...NO_STORE } });
  } catch (error) {
    console.error(`[sitemap] not produced: ${error instanceof Error ? error.message : "unknown error"}`);
    return new Response("The sitemap is not available.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
  }
}
