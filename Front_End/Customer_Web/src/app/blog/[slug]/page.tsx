import React from "react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import BlogBody from "@/components/blog/BlogBody";
import BlogFreshness from "@/components/blog/BlogFreshness";
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import BlogPicture from "@/components/blog/BlogPicture";
import JsonLd from "@/components/JsonLd";
import { BLOG_SLUG, blogCategoryHref, blogIndexHref, blogPostHref, formatPostDate } from "@/lib/blog/blog";
import { parseBody } from "@/lib/blog/body";
import { blogRequest, indexTargets, postTargets, type BlogSearchParams } from "@/lib/blog/context";
import { postJsonLd, postMetadata } from "@/lib/blog/seo";
import { getBlogPost } from "@/lib/blog/server";
import { getT } from "@/lib/i18n/server";
import { getSiteOrigin } from "@/lib/seo/siteUrl";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface Props {
  params: { slug: string };
  searchParams?: BlogSearchParams;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await blogRequest(searchParams);
  if (!locale || !BLOG_SLUG.test(params.slug)) return {};
  const result = await getBlogPost(locale, params.slug);
  // A post that cannot be read must not be indexed as the "could not load" page, and nothing is invented for one that is not there.
  return result.status === "ok" ? postMetadata(getSiteOrigin(), result.value) : { robots: { index: false } };
}

/**
 * BHA-BLOG-001-CP04/05: one published post in the language of its URL. Draft, unpublished, archived, another language's slug and an unknown slug are all
 * the same answer: a real 404. An old slug is a PERMANENT redirect to the current address, made by the middleware before this runs (this page redirects too, as
 * a fallback, if the slug moved between the two reads). A read that fails is not a 404: the page says it could not load. The text of the post is only ever
 * rendered as React text — never as HTML.
 */
export default async function BlogPostPage({ params, searchParams }: Props) {
  const { snapshot, locale } = await blogRequest(searchParams);
  if (!locale || !BLOG_SLUG.test(params.slug)) notFound();
  const t = await getT();
  const result = await getBlogPost(locale, params.slug);
  if (result.status === "missing") notFound();
  if (result.status === "moved") redirect(blogPostHref(locale, result.slug));

  if (result.status === "error") {
    return (
      <div className="nc-PostPage relative overflow-hidden">
        <BgGlassmorphism />
        {/* The post is unknown here, so no translation is guessed: each language goes to its own index (and the URL's `locale` stops overriding the choice). */}
        <BlogLocaleTargets targets={indexTargets(snapshot.config.locales)} />
        <BlogFreshness />
        <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
          <p className="mb-6"><Link href={blogIndexHref(locale) as Route} prefetch={false} className="text-sm font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">{t("customer.blog.slug.page.backToTheBlog")}</Link></p>
          <p role="alert" data-testid="blog-unavailable" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-neutral-800 dark:text-amber-200">{t("customer.blog.unavailable")}</p>
        </div>
      </div>
    );
  }

  const post = result.value;
  const origin = getSiteOrigin();
  const blocks = parseBody(post.body);
  const ld = postJsonLd(origin, post, { home: t("customer.common.home"), blog: t("customer.common.blog2") });
  const published = formatPostDate(post.firstPublishedAt, snapshot.formatLocale);
  const modified = formatPostDate(post.modifiedAt, snapshot.formatLocale);

  return (
    <div className="nc-PostPage relative overflow-hidden">
      <BgGlassmorphism />
      <BlogLocaleTargets targets={postTargets(snapshot.config.locales, post)} />
      <BlogFreshness />
      {ld && <JsonLd data={ld} testId="blog-jsonld" />}
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <article className="mx-auto max-w-3xl">
          <nav aria-label={t("customer.common.breadcrumb")} className="text-sm text-neutral-500 dark:text-neutral-400">
            <ol className="flex flex-wrap items-center gap-2">
              <li><Link href={"/" as Route} className="hover:underline">{t("customer.common.home")}</Link></li>
              <li aria-hidden="true">/</li>
              <li><Link href={blogIndexHref(post.locale) as Route} prefetch={false} className="hover:underline">{t("customer.common.blog2")}</Link></li>
              {post.primaryCategory && (
                <>
                  <li aria-hidden="true">/</li>
                  <li><Link href={blogCategoryHref(post.locale, post.primaryCategory.slug) as Route} prefetch={false} className="hover:underline">{post.primaryCategory.name}</Link></li>
                </>
              )}
            </ol>
          </nav>

          <header className="mt-6 space-y-4">
            {post.primaryCategory && (
              <Link href={blogCategoryHref(post.locale, post.primaryCategory.slug) as Route} prefetch={false} className="inline-block text-xs font-medium uppercase tracking-wide text-primary-700 hover:underline dark:text-primary-300">
                {post.primaryCategory.name}
              </Link>
            )}
            <h1 className="text-3xl font-semibold !leading-tight text-neutral-900 dark:text-neutral-50 md:text-4xl">{post.title}</h1>
            <p className="text-neutral-600 dark:text-neutral-300">{post.summary}</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {post.author.trim() !== "" && <span>{t("customer.blog.post.by", { author: post.author })} · </span>}
              <time dateTime={post.firstPublishedAt}>{t("customer.blog.post.published", { date: published })}</time>
              {modified !== published && <> · <time dateTime={post.modifiedAt}>{t("customer.blog.updated", { date: modified })}</time></>}
            </p>
          </header>

          <figure className="mt-8">
            <div className="overflow-hidden rounded-3xl bg-neutral-100 dark:bg-neutral-800">
              <BlogPicture src={post.cover.url} alt={post.cover.alt} width={post.cover.width} height={post.cover.height} variants={post.cover.variants} sizes="(min-width: 768px) 768px, 100vw" eager className="h-auto w-full object-cover" />
            </div>
          </figure>

          <div className="mt-10">
            <BlogBody
              blocks={blocks}
              media={post.media}
              properties={post.properties}
              labels={{ tocTitle: t("customer.blog.toc.title"), galleryLabel: t("customer.blog.gallery.label"), propertyCta: (name) => t("customer.blog.property.cta", { name }) }}
            />
          </div>

          <p className="mt-12">
            <Link href={blogIndexHref(post.locale) as Route} prefetch={false} className="text-sm font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">{t("customer.blog.slug.page.backToTheBlog")}</Link>
          </p>
        </article>
      </div>
    </div>
  );
}
