import React from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import SectionHero from "@/app/(server-components)/SectionHero";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import HomeFeaturedRooms from "../(home)/HomeFeaturedRooms";
import { HomeSectionAnchors } from "../(home)/RiversideHomeSections";
import {
  BookingGuideSection,
  IntroSection,
  LocationFaqSection,
  SpaceGallerySection,
} from "../(home)/RiversideHomeContent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.riverside.title"), description: t("customer.meta.riverside.description") };
}

/**
 * CUST-WEB-001-CP08a: the page of The BHA Riverside, in the Chisfis composition. Hero with the search, the real
 * room types, why and how to book, the place itself, the questions a guest has. Every section says only what
 * the booking system or an Owner-approved fact backs (see `lib/riversideHomeContent`); the template's sample
 * cities, authors, testimonials, newsletter, video and app promotion are not rendered.
 *
 * CUST-WEB-001-CP08a-C2: this composition moved here unchanged from `/`, which is now the booking portal. The
 * sections keep their ids, so `/riverside#rooms`, `#booking-guide`, `#faq` and `#gioi-thieu` work from any page.
 */
function PageRiverside() {
  return (
    <main className="nc-PageRiverside relative overflow-hidden">
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

export default PageRiverside;
