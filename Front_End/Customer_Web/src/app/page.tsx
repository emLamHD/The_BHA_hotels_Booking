import React from "react";
import type { Metadata } from "next";
import { getI18n, getT } from "@/lib/i18n/server";
import { getHeroSnapshot } from "@/lib/hero/server";
import { getPromotions } from "@/lib/promotions/server";
import { getBlogHomeSection, getBlogPosts } from "@/lib/blog/server";
import { normalizeLocale } from "@/lib/blog/blog";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import HomeHeroCarousel from "./(home)/HomeHeroCarousel";
import HomeOfferSection from "./(home)/HomeOfferSection";
import HomeDestinationSection from "./(home)/HomeDestinationSection";
import HomeRiversideTeaser from "./(home)/HomeRiversideTeaser";
import HomeNewsSection from "./(home)/HomeNewsSection";
import HomeNewsletter from "./(home)/HomeNewsletter";
import HomeLocationMap from "./(home)/HomeLocationMap";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.home.title"), description: t("customer.meta.home.description") };
}

/**
 * CUST-WEB-001-CP08a-C2: the booking portal. A full-width Đà Nẵng slideshow with the real search, the Admin's real offers
 * (BHA-BOOKING-PROMOTIONS-001; the block is absent when there are none), destination guides, travel-news summaries, a newsletter preview and the property's map. It is not
 * the Riverside landing page — that is `/riverside` — and it renders no price, availability or catalog data of
 * its own: the booking system answers only when a search or a room page asks.
 */
async function PageHome() {
  // CUST-WEB-HERO-001-CP01: the hero is the Admin's, read per request (no-store) in the visitor's language; a failed read keeps the last good copy.
  const { locale } = await getI18n();
  const hero = await getHeroSnapshot(locale);
  // BHA-BOOKING-PROMOTIONS-001: the promotions that are public today, read per request; none (or a failed read) hides the whole block.
  const promotions = await getPromotions(locale);
  // BHA-BLOG-001-CP04: the Blog's home section (its category and up to 6 posts) and the latest posts, in the visitor's language, per request. Nothing, or a failed read, hides the block: no sample post stands in.
  const blogLocale = normalizeLocale(locale) ?? locale;
  const [destinations, latest] = await Promise.all([getBlogHomeSection(blogLocale, 6), getBlogPosts(blogLocale, { page: 1, pageSize: 5 })]);
  return (
    <main className="nc-PageHome relative overflow-hidden">
      {/* GLASSMOPHIN */}
      <BgGlassmorphism />

      <HomeHeroCarousel initial={hero} />

      <div className="container relative mb-24 mt-16 space-y-20 lg:mb-28 lg:mt-12 lg:space-y-28">
        <HomeOfferSection items={promotions.status === "ok" ? promotions.items : []} />

        <HomeDestinationSection locale={blogLocale} section={destinations.status === "ok" ? destinations.value : null} />

        <HomeRiversideTeaser />

        <HomeNewsSection locale={blogLocale} items={latest.status === "ok" ? latest.value.items : []} />

        <HomeNewsletter />

        <HomeLocationMap />
      </div>
    </main>
  );
}

export default PageHome;
