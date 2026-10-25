import React from "react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import BlogCategoryNav from "@/components/blog/BlogCategoryNav";
import BlogFreshness from "@/components/blog/BlogFreshness";
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import BlogPagination from "@/components/blog/BlogPagination";
import BlogPostCard from "@/components/blog/BlogPostCard";
import { BLOG_SLUG, blogCategoryHref, blogIndexHref, formatPostDate, lastPageOf } from "@/lib/blog/blog";
import { blogRequest, indexTargets, type BlogSearchParams } from "@/lib/blog/context";
import { listMetadata } from "@/lib/blog/seo";
import { getBlogCategories, getBlogCategory, getBlogPosts } from "@/lib/blog/server";
import { getT } from "@/lib/i18n/server";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const PAGE_SIZE = 12;

interface Props {
  params: { slug: string };
  searchParams?: BlogSearchParams;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, page } = await blogRequest(searchParams);
  if (!locale || !page || !BLOG_SLUG.test(params.slug)) return {};
  const category = await getBlogCategory(locale, params.slug);
  if (category.status !== "ok") return { robots: { index: false } };
  // The page's own posts read (same arguments, so one request per render): a list that could not be read is the "could not load" page, which is not indexed.
  const posts = await getBlogPosts(locale, { category: params.slug, page, pageSize: PAGE_SIZE });
  if (posts.status !== "ok") return { robots: { index: false } };
  const t = await getT();
  return listMetadata(getSiteOrigin(), locale, t("customer.blog.metaTitle", { name: category.value.name }), category.value.description ?? t("customer.blog.index.description"), blogCategoryHref(locale, params.slug, page));
}

/**
 * BHA-BLOG-001-CP04: one category — its name and description and its published posts, pinned first and then newest (the API's order, kept as it is). An unknown
 * category, or one without a text in this language, is a 404; an old slug was already redirected for good by the middleware (this page redirects it too, as a
 * fallback, if the slug moved between the two reads).
 */
export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const { snapshot, locale, page } = await blogRequest(searchParams);
  if (!locale || !page || !BLOG_SLUG.test(params.slug)) notFound();
  const t = await getT();
  const category = await getBlogCategory(locale, params.slug);
  if (category.status === "missing") notFound();
  if (category.status === "moved") redirect(blogCategoryHref(locale, category.slug, page));

  const [posts, categories] = category.status === "ok" ? await Promise.all([getBlogPosts(locale, { category: params.slug, page, pageSize: PAGE_SIZE }), getBlogCategories(locale)]) : [null, null];
  if (posts?.status === "missing") notFound();
  if (posts?.status === "ok" && page > lastPageOf(posts.value.total, PAGE_SIZE)) redirect(blogCategoryHref(locale, params.slug, lastPageOf(posts.value.total, PAGE_SIZE)));
  const heading = category.status === "ok" ? category.value.name : t("customer.blog.index.title");

  return (
    <div className="nc-BlogCategoryPage relative overflow-hidden">
      <BgGlassmorphism />
      <BlogLocaleTargets targets={indexTargets(snapshot.config.locales)} />
      <BlogFreshness />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <nav aria-label={t("customer.common.breadcrumb")} className="text-sm text-neutral-500 dark:text-neutral-400">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href={"/" as Route} className="hover:underline">{t("customer.common.home")}</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href={blogIndexHref(locale) as Route} prefetch={false} className="hover:underline">{t("customer.common.blog2")}</Link></li>
            {category.status === "ok" && (
              <>
                <li aria-hidden="true">/</li>
                <li aria-current="page">{heading}</li>
              </>
            )}
          </ol>
        </nav>

        <header className="mt-6 max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{heading}</h1>
          {category.status === "ok" && <p className="text-neutral-600 dark:text-neutral-300">{category.value.description ?? t("customer.blog.index.description")}</p>}
        </header>

        {categories?.status === "ok" && categories.value.length > 0 && (
          <BlogCategoryNav
            label={t("customer.blog.page.categories")}
            allLabel={t("customer.blog.page.all")}
            allHref={blogIndexHref(locale)}
            active={params.slug}
            items={categories.value.map((c) => ({ slug: c.slug, name: c.name, href: blogCategoryHref(locale, c.slug) }))}
          />
        )}

        {(category.status === "error" || posts?.status === "error") && (
          <p role="alert" data-testid="blog-unavailable" className="mt-10 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-neutral-800 dark:text-amber-200">
            {t("customer.blog.unavailable")}
          </p>
        )}
        {posts?.status === "ok" && posts.value.items.length === 0 && (
          <p role="status" data-testid="blog-empty" className="mt-10 text-neutral-600 dark:text-neutral-300">{t("customer.blog.empty")}</p>
        )}
        {posts?.status === "ok" && posts.value.items.length > 0 && (
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
              hrefFor={(p) => blogCategoryHref(locale, params.slug, p)}
              labels={{ navigation: t("customer.blog.pagination.label"), previous: t("customer.blog.pagination.previous"), next: t("customer.blog.pagination.next"), goTo: (p) => t("customer.blog.pagination.goTo", { page: p }) }}
            />
          </>
        )}
      </div>
    </div>
  );
}
