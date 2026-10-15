import React from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import { MEDIA_CHANGES_NOTE, MEDIA_CREDITS_PATH, creditForFile, travelMediaUrl } from "@/data/heroSlides";
import { SAMPLE_POST_LABEL, TRAVEL_POSTS } from "@/data/travelPosts";
import {
  blogCategoryPath,
  findCategory,
  findPostBySegments,
  formatPostDate,
  isSafeSourceUrl,
  relatedPosts,
} from "@/lib/homepageContent";
import { BLOG_PATH } from "@/lib/riversideHomeContent";
import PostCard from "../PostCard";

import { getT } from "@/lib/i18n/server";
interface PostPageProps {
  params: { slug?: string[] };
}

/**
 * Only the registry's slugs exist. `dynamicParams = false` makes every other path a real HTTP 404 (without it
 * Next 13.4 answered an unknown slug with the not-found page but status 200, cached); `notFound()` below stays
 * as the second line.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return TRAVEL_POSTS.map((post) => ({ slug: [post.slug] }));
}

export function generateMetadata({ params }: PostPageProps): Metadata {
  const post = findPostBySegments(params.slug);
  if (!post) return { title: "Không tìm thấy bài viết — The BHA" };
  return { title: `${post.title} — The BHA`, description: post.excerpt };
}

/**
 * CUST-WEB-001-CP08a-C2: one blog post, resolved from the registry by the exact single segment. Unknown
 * slugs, extra segments and other letter cases are a 404. The page shows what the registry holds — sections as
 * plain text (nothing from the web is injected as HTML), its sources as `https` links that open safely,
 * related posts — and no author, comment, counter or template filler.
 */
export default async function PostPage({ params }: PostPageProps) {
  const t = await getT();
  const post = findPostBySegments(params.slug);
  if (!post) notFound();
  const category = findCategory(post.category);
  const credit = creditForFile(post.cover);
  const related = relatedPosts(post);

  return (
    <div className="nc-PostPage relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <article className="mx-auto max-w-3xl">
          <nav aria-label={t("customer.common.breadcrumb")} className="text-sm text-neutral-500 dark:text-neutral-400">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href={"/" as Route} className="hover:underline">{t("customer.common.home")}</Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={BLOG_PATH as Route} className="hover:underline">{t("customer.common.blog2")}</Link>
              </li>
              {category && (
                <>
                  <li aria-hidden="true">/</li>
                  <li>
                    <Link href={blogCategoryPath(category.slug) as Route} className="hover:underline">
                      {category.name}
                    </Link>
                  </li>
                </>
              )}
            </ol>
          </nav>

          <header className="mt-6 space-y-4">
            {category && (
              <Link
                href={blogCategoryPath(category.slug) as Route}
                className="inline-block text-xs font-medium uppercase tracking-wide text-primary-700 hover:underline dark:text-primary-300"
              >
                {category.name}
              </Link>
            )}
            <h1 className="text-3xl font-semibold !leading-tight text-neutral-900 dark:text-neutral-50 md:text-4xl">{post.title}</h1>
            <p className="text-neutral-600 dark:text-neutral-300">{post.excerpt}</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {post.sample
                ? `${SAMPLE_POST_LABEL}: nội dung chưa phải tin thật`
                : post.kind === "news"
                ? `Tóm tắt từ bản tin ngày ${formatPostDate(post.publishedAt)} · cập nhật ${formatPostDate(post.updatedAt)}`
                : `Cẩm nang cập nhật ${formatPostDate(post.updatedAt)}`}
            </p>
          </header>

          <figure className="mt-8">
            <div className="overflow-hidden rounded-3xl">
              <Image
                src={travelMediaUrl(post.cover)}
                alt={post.coverAlt}
                width={1200}
                height={800}
                sizes="(min-width: 768px) 768px, 100vw"
                priority
                className="w-full object-cover"
              />
            </div>
            {credit && (
              <figcaption className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t("customer.blog.slug.page.photo", { author: credit.author })}{" "}
                <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {credit.license}
                </a>{" "}
                ·{" "}
                <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{t("customer.blog.slug.page.wikimediaCommons")}</a>
                . {MEDIA_CHANGES_NOTE}{" "}
                <Link href={MEDIA_CREDITS_PATH as Route} className="underline">{t("customer.common.photoCredits")}</Link>
              </figcaption>
            )}
          </figure>

          <div className="mt-10 space-y-10">
            {post.sections.map((section, sectionIndex) => (
              <section key={section.heading} aria-labelledby={`section-${sectionIndex}`}>
                <h2 id={`section-${sectionIndex}`} className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 md:text-2xl">
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-4 text-neutral-700 dark:text-neutral-300">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets && (
                    <ul className="list-disc space-y-2 pl-6">
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </div>

          {post.sample ? (
            <p role="note" className="mt-12 rounded-3xl border border-neutral-200 p-6 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{t("customer.blog.slug.page.thisIsASampleArticle")}</p>
          ) : (
            <section aria-labelledby="sources-heading" className="mt-12 rounded-3xl border border-neutral-200 p-6 dark:border-neutral-700">
              <h2 id="sources-heading" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("customer.blog.slug.page.references")}</h2>
              <ul className="mt-4 space-y-3 text-sm">
                {post.sources
                  .filter((source) => isSafeSourceUrl(source.url))
                  .map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">
                        {source.label}
                      </a>
                      <span className="block text-neutral-500 dark:text-neutral-400">
                        {source.publisher}
                        {source.publishedAt ? ` · ${formatPostDate(source.publishedAt)}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">{t("customer.blog.slug.page.theContentIsSummarisedIn")}</p>
            </section>
          )}
        </article>

        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="mx-auto mt-16 max-w-6xl">
            <h2 id="related-heading" className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{t("customer.blog.slug.page.relatedArticles")}</h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <li key={item.id}>
                  <PostCard post={item} />
                </li>
              ))}
            </ul>
            <p className="mt-8">
              <Link href={BLOG_PATH as Route} className="font-medium text-primary-700 underline underline-offset-2 dark:text-primary-300">{t("customer.blog.slug.page.backToTheBlog")}</Link>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
