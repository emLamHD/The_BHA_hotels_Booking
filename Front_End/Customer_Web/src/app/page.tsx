import React from "react";
import type { Metadata } from "next";
import SectionHero from "@/app/(server-components)/SectionHero";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import HomeFeaturedRooms from "./(home)/HomeFeaturedRooms";
import { HomeSectionAnchors } from "./(home)/RiversideHomeSections";
import {
  BookingGuideSection,
  IntroSection,
  LocationFaqSection,
  SpaceGallerySection,
} from "./(home)/RiversideHomeContent";

export const metadata: Metadata = {
  title: "The BHA Riverside — Đặt phòng trực tiếp tại Đà Nẵng",
  description:
    "Căn hộ lưu trú The BHA Riverside tại Đà Nẵng: chọn ngày, xem giá từng đêm theo loại phòng và đặt phòng trực tiếp.",
};

/**
 * CUST-WEB-001-CP08a: the home page of The BHA Riverside, in the Chisfis composition. Hero with the search,
 * the real room types, why and how to book, the place itself, the questions a guest has. Every section says
 * only what the booking system or an Owner-approved fact backs (see `lib/riversideHomeContent`); the
 * template's sample cities, authors, testimonials, newsletter, video and app promotion are not rendered.
 */
function PageHome() {
  return (
    <main className="nc-PageHome relative overflow-hidden">
      {/* GLASSMOPHIN */}
      <BgGlassmorphism />

      <HomeSectionAnchors>
        <div className="container relative space-y-24 mb-24 lg:space-y-28 lg:mb-28">
          <SectionHero className="pt-10 lg:pt-16 lg:pb-16" />

          <HomeFeaturedRooms />

          <IntroSection />

          <SpaceGallerySection />

          <BookingGuideSection />

          <LocationFaqSection />
        </div>
      </HomeSectionAnchors>
    </main>
  );
}

export default PageHome;
