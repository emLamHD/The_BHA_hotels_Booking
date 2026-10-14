import React from "react";
import type { Metadata } from "next";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import HomeHeroCarousel from "./(home)/HomeHeroCarousel";
import HomeOfferSection from "./(home)/HomeOfferSection";
import HomeDestinationSection from "./(home)/HomeDestinationSection";
import HomeRiversideTeaser from "./(home)/HomeRiversideTeaser";
import HomeNewsSection from "./(home)/HomeNewsSection";
import HomeNewsletter from "./(home)/HomeNewsletter";

export const metadata: Metadata = {
  title: "The BHA — Đặt phòng trực tiếp tại Đà Nẵng",
  description:
    "Khám phá Đà Nẵng cùng The BHA: tìm phòng, xem giá từng đêm tại The BHA Riverside, đọc cẩm nang điểm đến và tin du lịch.",
};

/**
 * CUST-WEB-001-CP08a-C2: the booking portal. A full-width Đà Nẵng slideshow with the real search, sample offers
 * (mock data, said as such), destination guides, travel-news summaries and a newsletter preview. It is not
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
      </div>
    </main>
  );
}

export default PageHome;
