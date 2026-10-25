"use client";

import React, { FC } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import BlogPicture from "@/components/blog/BlogPicture";
import { blogIndexHref, blogPostHref, formatPostDate, type BlogPostItem } from "@/lib/blog/blog";

import { useI18n } from "@/lib/i18n/I18nProvider";

export const NewsCardLarge: FC<{ post: BlogPostItem; locale: string }> = ({ post, locale }) => {
  const { t, formatLocale } = useI18n();
  const href = blogPostHref(locale, post.slug) as Route;
  return (
    <article className="nc-NewsCardLarge group flex flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <Link href={href} prefetch={false} className="relative block aspect-[3/2] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" aria-label={post.title}>
        <BlogPicture src={post.cover.url} alt={post.cover.alt} width={post.cover.width} height={post.cover.height} variants={post.cover.variants} sizes="(min-width: 1024px) 50vw, 100vw" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
      </Link>
      <div className="space-y-3 p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{post.primaryCategory?.name ?? ""}</p>
        <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 sm:text-2xl">
          <Link href={href} prefetch={false} className="hover:underline focus:outline-none focus-visible:underline">{post.title}</Link>
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{post.summary}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.blog.post.published", { date: formatPostDate(post.firstPublishedAt, formatLocale) })}</p>
      </div>
    </article>
  );
};

export const NewsCardSmall: FC<{ post: BlogPostItem; locale: string }> = ({ post, locale }) => {
  const { t, formatLocale } = useI18n();
  const href = blogPostHref(locale, post.slug) as Route;
  return (
    <article className="nc-NewsCardSmall group flex gap-4 overflow-hidden rounded-3xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <Link href={href} prefetch={false} className="relative block h-28 w-28 flex-shrink-0 overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:h-32 sm:w-40" aria-label={post.title}>
        <BlogPicture src={post.cover.url} alt={post.cover.alt} width={post.cover.width} height={post.cover.height} variants={post.cover.variants} sizes="160px" className="h-full w-full object-cover" />
      </Link>
      <div className="min-w-0 space-y-2 py-1">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">{post.primaryCategory?.name ?? ""}</p>
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          <Link href={href} prefetch={false} className="hover:underline focus:outline-none focus-visible:underline">{post.title}</Link>
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.blog.post.published", { date: formatPostDate(post.firstPublishedAt, formatLocale) })}</p>
      </div>
    </article>
  );
};

/**
 * "Tin tức nổi bật": the latest published posts (one large, up to four small — the template's Magazine layout), read per request (BHA-BLOG-001-CP04).
 * "Xem thêm tin tức" leads to the Blog index in the same language. No posts (or a failed read) hides the section: no sample or registry summary stands in.
 */
const HomeNewsSection: FC<{ locale: string; items: BlogPostItem[] }> = ({ locale, items }) => {
  const t = useI18n().t;
  const [lead, ...rest] = items;
  if (!lead) return null;
  return (
    <section aria-labelledby="news-heading" data-testid="home-news" className="nc-HomeNewsSection relative">
      <Heading id="news-heading">{t("customer.home.homeNewsSection.topNews")}</Heading>
      <div className="grid gap-6 lg:grid-cols-2">
        <NewsCardLarge post={lead} locale={locale} />
        <div className="grid content-start gap-6">
          {rest.slice(0, 4).map((post) => (
            <NewsCardSmall key={post.id} post={post} locale={locale} />
          ))}
        </div>
      </div>
      <div className="mt-8 flex justify-center">
        <ButtonSecondary href={blogIndexHref(locale) as Route} className="!leading-none">
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
