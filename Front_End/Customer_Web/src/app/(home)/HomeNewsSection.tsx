"use client";

import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { travelMediaUrl } from "@/data/heroSlides";
import { SAMPLE_POST_LABEL, TravelPost } from "@/data/travelPosts";
import { findCategory, formatPostDate, homeNews, postPath } from "@/lib/homepageContent";
import { BLOG_PATH } from "@/lib/riversideHomeContent";

import { useT } from "@/lib/i18n/I18nProvider";
/** "Tin ngày 12/07/2026": the date of the report the summary is made from, not of anything the property did. */
const reportDate = (post: TravelPost) => (post.sample ? SAMPLE_POST_LABEL : `Tin ngày ${formatPostDate(post.publishedAt)}`);

export const NewsCardLarge: FC<{ post: TravelPost }> = ({ post }) => (
  <article className="nc-NewsCardLarge group flex flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
    <Link href={postPath(post.slug) as Route} className="relative block aspect-[3/2] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" aria-label={post.title}>
      <Image src={travelMediaUrl(post.cover)} alt={post.coverAlt} width={1200} height={800} sizes="(min-width: 1024px) 50vw, 100vw" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
    </Link>
    <div className="space-y-3 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{findCategory(post.category)?.name}</p>
      <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 sm:text-2xl">
        <Link href={postPath(post.slug) as Route} className="hover:underline focus:outline-none focus-visible:underline">
          {post.title}
        </Link>
      </h3>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{post.excerpt}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{reportDate(post)}</p>
    </div>
  </article>
);

export const NewsCardSmall: FC<{ post: TravelPost }> = ({ post }) => (
  <article className="nc-NewsCardSmall group flex gap-4 overflow-hidden rounded-3xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
    <Link href={postPath(post.slug) as Route} className="relative block h-28 w-28 flex-shrink-0 overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:h-32 sm:w-40" aria-label={post.title}>
      <Image src={travelMediaUrl(post.cover)} alt={post.coverAlt} width={1200} height={800} sizes="160px" className="h-full w-full object-cover" />
    </Link>
    <div className="min-w-0 space-y-2 py-1">
      <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{findCategory(post.category)?.name}</p>
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        <Link href={postPath(post.slug) as Route} className="hover:underline focus:outline-none focus-visible:underline">
          {post.title}
        </Link>
      </h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{reportDate(post)}</p>
    </div>
  </article>
);

/**
 * CUST-WEB-001-CP08a-C2: "Tin tức nổi bật": one large and the other news summaries (the template's
 * Magazine layout over the blog registry). They are summaries of public travel reports with their sources on
 * the article page, not news of The BHA; "Xem thêm tin tức" leads to the unfiltered `/blog`.
 */
const HomeNewsSection: FC = () => {
  const t = useT();
  const [lead, ...rest] = homeNews();
  if (!lead) return null;
  return (
    <section aria-labelledby="news-heading" className="nc-HomeNewsSection relative">
      <Heading id="news-heading" desc={t("customer.home.homeNewsSection.summariesOfPublicTravelNews")}>{t("customer.home.homeNewsSection.topNews")}</Heading>
      <div className="grid gap-6 lg:grid-cols-2">
        <NewsCardLarge post={lead} />
        <div className="grid content-start gap-6">
          {rest.slice(0, 4).map((post) => (
            <NewsCardSmall key={post.id} post={post} />
          ))}
        </div>
      </div>
      <div className="mt-8 flex justify-center">
        <ButtonSecondary href={BLOG_PATH as Route} className="!leading-none">
          <div className="flex items-center justify-center">
            <span>{t("customer.home.homeNewsSection.seeMoreNews")}</span>
            <ArrowRightIcon aria-hidden="true" className="ml-3 h-5 w-5" />
          </div>
        </ButtonSecondary>
      </div>
    </section>
  );
};

export default HomeNewsSection;
