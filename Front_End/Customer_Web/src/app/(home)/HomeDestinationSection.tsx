"use client";

import React, { FC } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import HomeSlider from "./HomeSlider";
import BlogPicture from "@/components/blog/BlogPicture";
import { BLOG_ROOT, blogCategoryHref, blogPostHref, type BlogHomeSection, type BlogPostItem } from "@/lib/blog/blog";

import { useT } from "@/lib/i18n/I18nProvider";
/** One destination: its photograph and title, linking to its own article. No count, rating or price is shown. */
export const DestinationCard: FC<{ post: BlogPostItem; locale: string }> = ({ post, locale }) => {
  const t = useT();
  return (
    <Link
      href={blogPostHref(locale, post.slug) as Route}
      prefetch={false}
      className="nc-DestinationCard group block overflow-hidden rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl">
        <BlogPicture
          src={post.cover.url}
          alt={post.cover.alt}
          width={post.cover.width}
          height={post.cover.height}
          variants={post.cover.variants}
          sizes="(min-width: 1024px) 24vw, (min-width: 640px) 40vw, 70vw"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <h3 className="text-lg font-semibold text-white">{post.title}</h3>
          <span className="mt-1 block text-sm text-white/85">{t("customer.home.homeDestinationSection.readTheGuide")}</span>
        </div>
      </div>
    </Link>
  );
};

/**
 * "Điểm đến nổi bật": the posts the Admin put in the home section's category (BHA-BLOG-001-CP04) — up to 6, pinned first — as the template's slider of cards.
 * "Xem thêm" leads to that category's own page. No posts (or a failed read) hides the whole section: no sample post, count or picture stands in.
 */
const HomeDestinationSection: FC<{ locale: string; section: BlogHomeSection | null }> = ({ locale, section }) => {
  const t = useT();
  if (!section || section.items.length === 0) return null;
  const seeMore = section.category ? blogCategoryHref(locale, section.category.slug) : `${BLOG_ROOT}?locale=${locale}`;
  const title = section.category?.name ?? t("customer.home.homeDestinationSection.featuredDestinations");
  return (
    <section aria-labelledby="destinations-heading" data-testid="home-destinations" className="nc-HomeDestinationSection relative">
      <Heading id="destinations-heading" desc={section.category?.description ?? undefined}>{title}</Heading>
      <HomeSlider label={title}>
        {section.items.map((post) => (
          <li key={post.id} className="w-[70%] flex-shrink-0 snap-start sm:w-[40%] lg:w-[24%]">
            <DestinationCard post={post} locale={locale} />
          </li>
        ))}
      </HomeSlider>
      <div className="mt-6 flex justify-center">
        <ButtonSecondary href={seeMore as Route} className="!leading-none">
          <div className="flex items-center justify-center">
            <span>{t("customer.home.homeDestinationSection.seeMoreDestinations")}</span>
            <ArrowRightIcon aria-hidden="true" className="ml-3 h-5 w-5" />
          </div>
        </ButtonSecondary>
      </div>
    </section>
  );
};

export default HomeDestinationSection;
