import React from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
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
 * CUST-WEB-001-CP08a-C2: the booking portal. A full-width Đà Nẵng slideshow with the real search, sample offers
 * (mock data, said as such), destination guides, travel-news summaries, a newsletter preview and the property's map. It is not
 * the Riverside landing page — that is `/riverside` — and it renders no price, availability or catalog data of
 * its own: the booking system answers only when a search or a room page asks.
 */
function PageHome() {
  return (
    <main className="nc-PageHome relative overflow-hidden">
      {/* GLASSMOPHIN */}
      <BgGlassmorphism />

      <HomeHeroCarousel />

      <div className="container relative mb-24 mt-16 space-y-20 lg:mb-28 lg:mt-12 lg:space-y-28">
        <HomeOfferSection />

        <HomeDestinationSection />

        <HomeRiversideTeaser />

        <HomeNewsSection />

        <HomeNewsletter />

        <HomeLocationMap />
      </div>
    </main>
  );
}

export default PageHome;
