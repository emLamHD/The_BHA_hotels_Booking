import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import { POST_CATEGORIES } from "@/data/travelPosts";
import { localizeCategory } from "@/lib/i18n/staticContent";
import { blogCategoryPath, postsForFilter, resolveBlogFilter } from "@/lib/homepageContent";
import { BLOG_PATH } from "@/lib/riversideHomeContent";
import PostCard from "./PostCard";

import { getContent, getT } from "@/lib/i18n/server";
interface BlogPageProps {
  searchParams?: { category?: string | string[] };
}

export async function generateMetadata({ searchParams }: BlogPageProps): Promise<Metadata> {
  const [t, { c }] = await Promise.all([getT(), getContent()]);
  const filter = resolveBlogFilter(searchParams?.category);
  if (filter.kind === "category") {
    const category = localizeCategory(filter.category, c);
    return { title: t("customer.blog.metaTitle", { name: category.name }), description: category.description };
  }
  return { title: t("customer.blog.metaTitleIndex"), description: t("customer.blog.index.description") };
}

const CHIP_CLASS =
  "inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * CUST-WEB-001-CP08a-C2: the travel blog. `?category=` is read by `resolveBlogFilter`: none shows everything,
 * one registered category shows its posts, anything else (unknown, repeated, another letter case) is a 404
 * rather than a guess. The posts are guides and summaries of public reports with their sources, not news of
 * The BHA; there is no author, comment or counter.
 */
export default async function BlogPage({ searchParams }: BlogPageProps) {
  const [t, { c }] = await Promise.all([getT(), getContent()]);
  const filter = resolveBlogFilter(searchParams?.category);
  if (filter.kind === "invalid") notFound();
  const posts = postsForFilter(filter);
  const activeSlug = filter.kind === "category" ? filter.category.slug : null;
  const activeCategory = filter.kind === "category" ? localizeCategory(filter.category, c) : null;
  const heading = activeCategory ? activeCategory.name : t("customer.blog.index.title");
  const description = activeCategory ? activeCategory.description : t("customer.blog.index.description");

  return (
    <div className="nc-BlogPage relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <nav aria-label={t("customer.common.breadcrumb")} className="text-sm text-neutral-500 dark:text-neutral-400">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href={"/" as Route} className="hover:underline">{t("customer.common.home")}</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              {activeSlug ? (
                <Link href={BLOG_PATH as Route} className="hover:underline">{t("customer.common.blog2")}</Link>
              ) : (
                <span aria-current="page">{t("customer.common.blog2")}</span>
              )}
            </li>
            {activeSlug && (
              <>
                <li aria-hidden="true">/</li>
                <li aria-current="page">{heading}</li>
              </>
            )}
          </ol>
        </nav>

        <header className="mt-6 max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{heading}</h1>
          <p className="text-neutral-600 dark:text-neutral-300">{description}</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("customer.blog.page.eachArticleListsItsSources")}</p>
        </header>

        <nav aria-label={t("customer.blog.page.categories")} className="mt-8 flex flex-wrap gap-3">
          <Link
            href={BLOG_PATH as Route}
            aria-current={activeSlug === null ? "page" : undefined}
            className={`${CHIP_CLASS} ${activeSlug === null ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
          >{t("customer.blog.page.all")}</Link>
          {POST_CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={blogCategoryPath(category.slug) as Route}
              aria-current={activeSlug === category.slug ? "page" : undefined}
              className={`${CHIP_CLASS} ${activeSlug === category.slug ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
            >
              {localizeCategory(category, c).name}
            </Link>
          ))}
        </nav>

        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
