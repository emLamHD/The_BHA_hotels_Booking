import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlogRecover from "@/components/blog/BlogRecover";
import { blogIndexHref, blogTargetOf, normalizeLocale } from "@/lib/blog/blog";

export const dynamic = "force-dynamic";

// A step, not a page: never indexed, no canonical, no alternates, not in the sitemap.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * BHA-BLOG-001-CP04-CP05-C7: where the language switch goes from a Blog 404 whose pathname is the target's (`/blog?page=abc`, `/blog?locale=zz` → `/blog?locale=en`).
 * Next 13.4.3 clears its not-found boundary only when the pathname changes, so a push and a refresh to the same pathname leave the 404 body on a valid index. Only a
 * language is accepted, and the destination is always that language's Blog index — never an address from the URL, so it cannot send a reader anywhere else.
 * C9: `?to=` is the other form — a Blog 404 that turned out to be a stale copy returns to its own address. Exactly one of the two parameters, once; `to` must be a Blog
 * address of this site that `blogTargetOf` accepts (rebuilt from its parts). The pathname change is what lets the not-found boundary go; the return is a `replace`, so Back never lands here.
 */
export default function BlogRecoverPage({ searchParams }: { searchParams?: { locale?: string | string[]; to?: string | string[] } }) {
  const { locale: rawLocale, to: rawTo } = searchParams ?? {};
  if ((rawLocale === undefined) === (rawTo === undefined)) notFound();
  if (rawTo !== undefined) {
    const target = blogTargetOf(rawTo);
    if (!target) notFound();
    return <BlogRecover to={target} />;
  }
  const locale = typeof rawLocale === "string" ? normalizeLocale(rawLocale) : null;
  if (!locale) notFound();
  return <BlogRecover to={blogIndexHref(locale)} />;
}
