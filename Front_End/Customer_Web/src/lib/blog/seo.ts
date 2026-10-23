import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo/siteUrl";
import { blogCategoryHref, blogIndexHref, blogPostHref, languageTag, type BlogPostDetail } from "./blog";

/**
 * BHA-BLOG-001-CP05: what a crawler reads from a Blog page, built only from what the API published for that translation: title and description of the
 * published revision, canonical and `hreflang` from the configured public origin (never the API's, never a request's `Host`), Open Graph / Twitter, and
 * `BlogPosting` + `BreadcrumbList` JSON-LD. An author or a date that is not in the answer is not invented; a link that needs an absolute address is
 * left out when the site origin is not configured.
 */
const SITE_NAME = "The BHA";

const ogLocale = (normalized: string) => languageTag(normalized).replace("-", "_");

export interface BlogCrumbNames {
  home: string;
  blog: string;
}

/** The published translations of a post (itself included) as `hreflang` → absolute URL; the post's own language is always there, the others only when published. */
export function postLanguages(origin: string | null, post: BlogPostDetail): Record<string, string> {
  const languages: Record<string, string> = {};
  const entries = [{ locale: post.locale, slug: post.slug }, ...post.alternates.filter((a) => a.locale !== post.locale)];
  for (const entry of entries) {
    const url = absoluteUrl(origin, blogPostHref(entry.locale, entry.slug));
    if (url) languages[languageTag(entry.locale)] = url;
  }
  return languages;
}

export function postMetadata(origin: string | null, post: BlogPostDetail): Metadata {
  const title = post.seo.metaTitle ?? post.title;
  const description = post.seo.metaDescription ?? post.summary;
  const canonical = absoluteUrl(origin, blogPostHref(post.locale, post.slug));
  const image = post.seo.ogImageUrl ?? post.cover.url;
  const languages = postLanguages(origin, post);
  return {
    title: `${title} — ${SITE_NAME}`,
    description,
    alternates: canonical ? { canonical, languages } : undefined,
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      title,
      description,
      url: canonical ?? undefined,
      locale: ogLocale(post.locale),
      publishedTime: post.firstPublishedAt,
      modifiedTime: post.modifiedAt,
      images: [{ url: image, alt: post.cover.alt }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export function listMetadata(origin: string | null, locale: string, title: string, description: string, path: string): Metadata {
  const canonical = absoluteUrl(origin, path);
  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: canonical ?? undefined, locale: ogLocale(locale) },
    twitter: { card: "summary", title, description },
  };
}

/** `BlogPosting` and `BreadcrumbList`, or `null` when the site origin is not configured (every URL in them is absolute). */
export function postJsonLd(origin: string | null, post: BlogPostDetail, names: BlogCrumbNames): unknown[] | null {
  const url = absoluteUrl(origin, blogPostHref(post.locale, post.slug));
  const home = absoluteUrl(origin, "/");
  const blog = absoluteUrl(origin, blogIndexHref(post.locale));
  if (!url || !home || !blog) return null;
  const crumbs = [
    { name: names.home, item: home },
    { name: names.blog, item: blog },
  ];
  if (post.primaryCategory) crumbs.push({ name: post.primaryCategory.name, item: absoluteUrl(origin, blogCategoryHref(post.locale, post.primaryCategory.slug))! });
  crumbs.push({ name: post.title, item: url });
  return [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      headline: post.title,
      description: post.seo.metaDescription ?? post.summary,
      image: [post.seo.ogImageUrl ?? post.cover.url],
      datePublished: post.firstPublishedAt,
      dateModified: post.modifiedAt,
      inLanguage: languageTag(post.locale),
      url,
      // The author is the text the editor wrote; an empty one is not replaced by anything.
      ...(post.author.trim() ? { author: { "@type": "Person", name: post.author } } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: crumb.item })),
    },
  ];
}
