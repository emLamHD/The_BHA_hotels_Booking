import type { MetadataRoute } from "next";
import { getApiBaseUrl } from "@/lib/api/env";
import { normalizeLocale } from "@/lib/blog/blog";
import { getAllBlogCategories, getAllBlogPosts } from "@/lib/blog/server";
import { sitemapEntries } from "@/lib/seo/sitemap";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

// Built for each request from what is public now (a post published a minute ago is in it; one unpublished is not): never at build time.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * BHA-BLOG-001-CP05: `/sitemap.xml`. The languages are the site's active ones (the website settings), the posts are every page of the API's list, not the first.
 * If the origin is not configured, or ANY read fails, this throws: the answer is an error, never a partial sitemap that looks complete.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
  return sitemapEntries(origin, codes, { posts, categories });
}
