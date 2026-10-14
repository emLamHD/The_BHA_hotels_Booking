import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { travelMediaUrl } from "@/data/heroSlides";
import { TravelPost } from "@/data/travelPosts";
import { findCategory, formatPostDate, postPath } from "@/lib/homepageContent";

/** "Cẩm nang, cập nhật 14/10/2026" for a destination; "Tin ngày 12/07/2026" for a summary of a report. */
export function postDateLine(post: TravelPost): string {
  return post.kind === "news" ? `Tin ngày ${formatPostDate(post.publishedAt)}` : `Cập nhật ${formatPostDate(post.updatedAt)}`;
}

/** One post in a list: cover, category, title, excerpt, date. The whole title is the link. */
const PostCard: FC<{ post: TravelPost; sizes?: string }> = ({ post, sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" }) => (
  <article className="nc-PostCard group flex h-full flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
    <Link href={postPath(post.slug) as Route} tabIndex={-1} aria-hidden="true" className="relative block aspect-[3/2] overflow-hidden">
      <Image src={travelMediaUrl(post.cover)} alt="" width={1200} height={800} sizes={sizes} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
    </Link>
    <div className="flex flex-1 flex-col space-y-3 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{findCategory(post.category)?.name}</p>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <Link href={postPath(post.slug) as Route} className="hover:underline focus:outline-none focus-visible:underline">
          {post.title}
        </Link>
      </h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{post.excerpt}</p>
      <p className="mt-auto pt-2 text-xs text-neutral-500 dark:text-neutral-400">{postDateLine(post)}</p>
    </div>
  </article>
);

export default PostCard;
