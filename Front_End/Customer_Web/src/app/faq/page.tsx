import React from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import Heading from "@/shared/Heading";
import { HomeFaq } from "../(home)/RiversideHomeSections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("customer.home.riversideHomeContent.goodToKnow")} — The BHA Riverside`, description: t("customer.home.riversideHomeContent.locationAndThingsToKnow") };
}

/**
 * CUST-WEB-HEADER-001-CP04: the questions a guest has before booking, on a page of their own (the header's FAQ entry, which the
 * Admin can move, rename or turn off like any other). It is the Riverside page's `HomeFaq` — the same six questions
 * and answers (`buildFaq`, keys `customer.faq.*`), the check-in/out times from the booking system when it has them — so there is one
 * policy text, not two. It reads nothing about availability and creates no hold. The Riverside page keeps its own `#faq` section.
 */
export default async function PageFaq() {
  const t = await getT();
  return (
    <main className="nc-PageFaq relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative py-16 lg:py-24">
        <Heading id="faq-heading" desc={t("customer.home.riversideHomeContent.locationAndThingsToKnow")}>
          {t("customer.home.riversideHomeContent.goodToKnow")}
        </Heading>
        <div className="mx-auto max-w-3xl">
          <HomeFaq />
        </div>
      </div>
    </main>
  );
}
