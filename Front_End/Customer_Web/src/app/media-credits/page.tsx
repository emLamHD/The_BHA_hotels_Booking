import React from "react";
import type { Metadata } from "next";
import Image from "next/image";
import BgGlassmorphism from "@/components/BgGlassmorphism";
import { MEDIA_CHANGES_NOTE, MEDIA_CREDITS, travelMediaUrl } from "@/data/heroSlides";

import { getT } from "@/lib/i18n/server";
export const metadata: Metadata = {
  title: "Nguồn ảnh — The BHA",
  description: "Tác giả, giấy phép và nguồn của các ảnh Đà Nẵng trên trang The BHA.",
};

/**
 * CUST-WEB-001-CP08a-C2: the credit page for the Đà Nẵng photographs (the hero slideshow and the destination and
 * news cards). Each entry gives the author as the Wikimedia Commons page does, the licence with its text, the
 * Commons page, what was changed, and where the picture is used. CC BY-SA pictures stay under that licence in
 * the form shown here. The Riverside property photographs are a separate matter and are said so below.
 */
export default async function MediaCreditsPage() {
  const t = await getT();
  return (
    <div className="nc-MediaCreditsPage relative overflow-hidden">
      <BgGlassmorphism />
      <div className="container relative pb-20 pt-10 lg:pb-28 lg:pt-14">
        <header className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 md:text-4xl">{t("customer.common.photoCredits")}</h1>
          <p className="text-neutral-600 dark:text-neutral-300">{t("customer.mediaCredits.page.photosOfDaNangAnd", { MEDIACHANGESNOTE: MEDIA_CHANGES_NOTE })}</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("customer.mediaCredits.page.photosOfTheBhaRiverside")}</p>
        </header>
        <ul className="mt-10 grid gap-6 lg:grid-cols-2">
          {MEDIA_CREDITS.map((credit) => (
            <li key={credit.id} className="flex gap-4 rounded-3xl border border-neutral-200 p-4 dark:border-neutral-700">
              <Image
                src={travelMediaUrl(credit.files[credit.files.length - 1])}
                alt=""
                width={1200}
                height={800}
                sizes="128px"
                className="h-24 w-32 flex-shrink-0 rounded-2xl object-cover"
              />
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{credit.commonsTitle.replace(/^File:/, "")}</p>
                <p className="text-neutral-600 dark:text-neutral-300">{t("customer.mediaCredits.page.author", { author: credit.author })}</p>
                <p className="text-neutral-600 dark:text-neutral-300">{t("customer.mediaCredits.page.licence")}{" "}
                  <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    {credit.license}
                  </a>
                </p>
                <p>
                  <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline dark:text-primary-300">{t("customer.mediaCredits.page.originalPageOnWikimediaCommons")}</a>
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.mediaCredits.page.fileUsedOnThisSite")}{" "}{credit.files.join(", ")}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
