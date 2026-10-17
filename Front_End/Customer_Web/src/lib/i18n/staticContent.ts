import type { MockOffer } from "@/data/homepageOffers";
import type { PostCategory, TravelPost } from "@/data/travelPosts";
import type { HomeBenefit, HomeImage, HomeStep, SiteNavItem } from "@/lib/riversideHomeContent";
import { formatMessage } from "./format";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the static content of the site (offers, posts, the hero, the navigation, the booking
 * guide) in the visitor's language. The registries in `data/` keep the Vietnamese text, its structure, the ids and the
 * media; the pack (`content.<entity>.<id>.<field>`) holds each language, so a text can be corrected and a language added
 * from the Admin, with no code. A key without a text falls back to the registry's own text (and is reported as untranslated
 * in the Admin, never counted as a translation). The article body (`postBody`) uses stable ordinals: `s2h` the heading of section 2,
 * `s2p3` its third paragraph, `s2b1` its first bullet.
 */
export type ContentFn = <T extends string | null>(entity: string, id: string, field: string, fallback: T) => string | T;

/** A lookup over a dictionary read on the server (`getContentMessages`). */
export function contentFrom(messages: Record<string, string>, formatLocale: string): ContentFn {
  return <T extends string | null>(entity: string, id: string, field: string, fallback: T): string | T => {
    const text = messages[`content.${entity}.${id}.${field}`];
    return text === undefined ? fallback : formatMessage(text, formatLocale, {});
  };
}

export const localizeOffer = (offer: MockOffer, c: ContentFn): MockOffer => ({
  ...offer,
  title: c("offer", offer.slug, "title", offer.title),
  summary: c("offer", offer.slug, "summary", offer.summary),
  imageAlt: c("offer", offer.slug, "imageAlt", offer.imageAlt),
});

export const localizeCategory = (category: PostCategory, c: ContentFn): PostCategory => ({
  ...category,
  name: c("category", category.slug, "name", category.name),
  description: c("category", category.slug, "description", category.description),
});

export function localizePost(post: TravelPost, c: ContentFn): TravelPost {
  return {
    ...post,
    title: c("post", post.slug, "title", post.title),
    shortTitle: post.shortTitle === undefined ? undefined : c("post", post.slug, "shortTitle", post.shortTitle),
    excerpt: c("post", post.slug, "excerpt", post.excerpt),
    coverAlt: c("post", post.slug, "coverAlt", post.coverAlt),
    // the long body is a separate entity: a page that shows only the card does not carry the article
    sections: post.sections.map((section, i) => ({
      heading: c("postBody", post.slug, `s${i + 1}h`, section.heading),
      paragraphs: section.paragraphs.map((text, j) => c("postBody", post.slug, `s${i + 1}p${j + 1}`, text)),
      bullets: section.bullets?.map((text, k) => c("postBody", post.slug, `s${i + 1}b${k + 1}`, text)),
    })),
  };
}

export const localizeNavItem = (item: SiteNavItem, c: ContentFn): SiteNavItem => ({ ...item, name: c("nav", item.id, "name", item.name) });

export const localizeBenefit = (benefit: HomeBenefit, c: ContentFn): HomeBenefit => ({
  ...benefit,
  badge: c("benefit", benefit.id, "badge", benefit.badge),
  title: c("benefit", benefit.id, "title", benefit.title),
  body: c("benefit", benefit.id, "body", benefit.body),
});

export const localizeStep = (step: HomeStep, c: ContentFn): HomeStep => ({
  ...step,
  title: c("step", String(step.id), "title", step.title),
  body: c("step", String(step.id), "body", step.body),
});

/** A property picture; `id` is the file name without its extension (`rooftop-pool-day`) or `hero` / `intro`. */
export const localizeImage = (image: HomeImage, id: string, c: ContentFn): HomeImage => ({ ...image, alt: c("gallery", id, "alt", image.alt) });
