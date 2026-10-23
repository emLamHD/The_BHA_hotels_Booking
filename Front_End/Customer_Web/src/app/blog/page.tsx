import React from "react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import BlogFreshness from "@/components/blog/BlogFreshness";
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import BlogPagination from "@/components/blog/BlogPagination";
import BlogPostCard from "@/components/blog/BlogPostCard";
import BlogCategoryNav from "@/components/blog/BlogCategoryNav";
import { blogCategoryHref, blogIndexHref, formatPostDate, lastPageOf } from "@/lib/blog/blog";
import { blogRequest, indexTargets, type BlogSearchParams } from "@/lib/blog/context";
import { listMetadata } from "@/lib/blog/seo";
import { getBlogCategories, getBlogPosts } from "@/lib/blog/server";
import { getT } from "@/lib/i18n/server";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

// A published post must appear (and an unpublished one disappear) on the next request: nothing here is built ahead of time.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const PAGE_SIZE = 12;

export async function generateMetadata({ searchParams }: { searchParams?: BlogSearchParams }): Promise<Metadata> {
  const { locale, page } = await blogRequest(searchParams);
  const t = await getT();
  if (!locale || !page) return {};
  return listMetadata(getSiteOrigin(), locale, t("customer.blog.metaTitleIndex"), t("customer.blog.index.description"), blogIndexHref(locale, page));
}

/**
 * BHA-BLOG-001-CP04: the Blog index — the posts the Admin has published, in the language of its URL, newest first, a page at a time (the API paginates). A read
 * that fails says so; it is never an empty list, a 404 or a sample. A page beyond the last one goes to the last page (temporary: the data moved, the URL did not).
 */
export default async function BlogPage({ searchParams }: { searchParams?: BlogSearchParams }) {
  const { snapshot, locale, page } = await blogRequest(searchParams);
  if (!locale || !page) notFound();
  const t = await getT();
  const [posts, categories] = await Promise.all([getBlogPosts(locale, { page, pageSize: PAGE_SIZE }), getBlogCategories(locale)]);
  if (posts.status === "missing") notFound();
  if (posts.status === "ok") {
    const last = lastPageOf(posts.value.total, PAGE_SIZE);
    if (page > last) redirect(blogIndexHref(locale, last));
  }

  return (
    <div className="nc-BlogPage relative overflow-hidden">
      <BgGlassmorphism />
      <BlogLocaleTargets targets={indexTargets(snapshot.config.locales)} />
      <BlogFreshness />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <nav aria-label={t("customer.common.breadcrumb")} className="text-sm text-neutral-500 dark:text-neutral-400">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href={"/" as Route} className="hover:underline">{t("customer.common.home")}</Link></li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{t("customer.common.blog2")}</li>
          </ol>
        </nav>

        <header className="mt-6 max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{t("customer.blog.index.title")}</h1>
          <p className="text-neutral-600 dark:text-neutral-300">{t("customer.blog.index.description")}</p>
        </header>

        {categories.status === "ok" && categories.value.length > 0 && (
          <BlogCategoryNav
            label={t("customer.blog.page.categories")}
            allLabel={t("customer.blog.page.all")}
            allHref={blogIndexHref(locale)}
            active={null}
            items={categories.value.map((c) => ({ slug: c.slug, name: c.name, href: blogCategoryHref(locale, c.slug) }))}
          />
        )}

        {posts.status === "error" && (
          <p role="alert" data-testid="blog-unavailable" className="mt-10 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-neutral-800 dark:text-amber-200">
            {t("customer.blog.unavailable")}
          </p>
        )}
        {posts.status === "ok" && posts.value.items.length === 0 && (
          <p role="status" data-testid="blog-empty" className="mt-10 text-neutral-600 dark:text-neutral-300">{t("customer.blog.empty")}</p>
        )}
        {posts.status === "ok" && posts.value.items.length > 0 && (
          <>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
              {posts.value.items.map((post) => (
                <li key={post.id}>
                  <BlogPostCard post={post} locale={locale} dateLabel={t("customer.blog.post.published", { date: formatPostDate(post.firstPublishedAt, snapshot.formatLocale) })} />
                </li>
              ))}
            </ul>
            <BlogPagination
              current={page}
              last={lastPageOf(posts.value.total, PAGE_SIZE)}
              hrefFor={(p) => blogIndexHref(locale, p)}
              labels={{ navigation: t("customer.blog.pagination.label"), previous: t("customer.blog.pagination.previous"), next: t("customer.blog.pagination.next"), goTo: (p) => t("customer.blog.pagination.goTo", { page: p }) }}
            />
          </>
        )}
      </div>
    </div>
  );
}
