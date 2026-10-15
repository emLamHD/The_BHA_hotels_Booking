"use client";

import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { travelMediaUrl } from "@/data/heroSlides";
import type { TravelPost } from "@/data/travelPosts";
import { findCategory, postPath } from "@/lib/homepageContent";
import { formatStayDate } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { localizeCategory, localizePost } from "@/lib/i18n/staticContent";
import type { Translate } from "@/lib/i18n/types";

/** "Updated 14 Oct 2026" for a destination guide; "News of 12 Jul 2026" for a summary of a report. */
export function postDateLine(post: TravelPost, t: Translate, formatLocale: string): string {
  if (post.sample) return t("customer.blog.sampleLabel");
  return post.kind === "news"
    ? t("customer.blog.reportDate", { date: formatStayDate(post.publishedAt, formatLocale) })
    : t("customer.blog.updated", { date: formatStayDate(post.updatedAt, formatLocale) });
}

/** One post in a list: cover, category, title, excerpt, date. The whole title is the link. */
const PostCard: FC<{ post: TravelPost; sizes?: string }> = ({ post: registryPost, sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" }) => {
  const { t, content, formatLocale } = useI18n();
  const post = localizePost(registryPost, content);
  const registryCategory = findCategory(post.category);
  return (
  <article className="nc-PostCard group flex h-full flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
    <Link href={postPath(post.slug) as Route} tabIndex={-1} aria-hidden="true" className="relative block aspect-[3/2] overflow-hidden">
      <Image src={travelMediaUrl(post.cover)} alt="" width={1200} height={800} sizes={sizes} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
    </Link>
    <div className="flex flex-1 flex-col space-y-3 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{registryCategory ? localizeCategory(registryCategory, content).name : ""}</p>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <Link href={postPath(post.slug) as Route} className="hover:underline focus:outline-none focus-visible:underline">
          {post.title}
        </Link>
      </h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{post.excerpt}</p>
      <p className="mt-auto pt-2 text-xs text-neutral-500 dark:text-neutral-400">{postDateLine(post, t, formatLocale)}</p>
    </div>
  </article>
  );
};

export default PostCard;
