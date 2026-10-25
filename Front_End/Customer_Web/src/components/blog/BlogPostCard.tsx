import React from "react";
import Link from "next/link";
import type { Route } from "next";
import BlogPicture from "./BlogPicture";
import { blogPostHref, type BlogPostItem } from "@/lib/blog/blog";

/**
 * One published post in a list: its cover (as the API sized it), category, title, summary and date. It takes only plain values (no hook), so the server's Blog
 * pages and the client's home slider use the same card. The link keeps the language the card was read in.
 */
export default function BlogPostCard({ post, locale, dateLabel, sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" }: { post: BlogPostItem; locale: string; dateLabel: string; sizes?: string }) {
  const href = blogPostHref(locale, post.slug) as Route;
  return (
    <article data-testid="blog-card" className="nc-PostCard group flex h-full flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <Link href={href} prefetch={false} tabIndex={-1} aria-hidden="true" className="relative block aspect-[3/2] overflow-hidden">
        <BlogPicture src={post.cover.url} alt="" width={post.cover.width} height={post.cover.height} variants={post.cover.variants} sizes={sizes} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
      </Link>
      <div className="flex flex-1 flex-col space-y-3 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{post.primaryCategory?.name ?? ""}</p>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          <Link href={href} prefetch={false} className="hover:underline focus:outline-none focus-visible:underline">
            {post.title}
          </Link>
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{post.summary}</p>
        <p className="mt-auto pt-2 text-xs text-neutral-500 dark:text-neutral-400">{dateLabel}</p>
      </div>
    </article>
  );
}
