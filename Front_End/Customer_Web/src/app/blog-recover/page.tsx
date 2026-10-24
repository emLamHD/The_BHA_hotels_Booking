import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlogRecover from "@/components/blog/BlogRecover";
import { blogIndexHref, normalizeLocale } from "@/lib/blog/blog";

export const dynamic = "force-dynamic";

// A step, not a page: never indexed, no canonical, no alternates, not in the sitemap.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * BHA-BLOG-001-CP04-CP05-C7: where the language switch goes from a Blog 404 whose pathname is the target's (`/blog?page=abc`, `/blog?locale=zz` → `/blog?locale=en`).
 * Next 13.4.3 clears its not-found boundary only when the pathname changes, so a push and a refresh to the same pathname leave the 404 body on a valid index. Only a
 * language is accepted, and the destination is always that language's Blog index — never an address from the URL, so it cannot send a reader anywhere else.
 */
export default function BlogRecoverPage({ searchParams }: { searchParams?: { locale?: string | string[] } }) {
  const raw = searchParams?.locale;
  const locale = typeof raw === "string" ? normalizeLocale(raw) : null;
  if (!locale) notFound();
  return <BlogRecover to={blogIndexHref(locale)} />;
}
