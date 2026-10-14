import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import ButtonPrimary from "@/shared/ButtonPrimary";
import {
  HOME_SECTION,
  RESULTS_PATH,
  RIVERSIDE_ADDRESS,
  RIVERSIDE_NAME,
  RIVERSIDE_PATH,
  riversideSectionHref,
} from "@/lib/riversideHomeContent";

/**
 * CUST-WEB-001-CP08a-C2: a short pointer to the property whose rooms the booking system really sells. It
 * carries no price, no availability and no catalog data; the Riverside page, the results and the room page do.
 * It keeps the old `#rooms` anchor, so an older `/#rooms` link still lands on something that leads to the rooms.
 */
const HomeRiversideTeaser: FC = () => (
  <section
    id={HOME_SECTION.rooms}
    aria-labelledby="riverside-teaser-heading"
    className="nc-HomeRiversideTeaser relative grid scroll-mt-24 items-center gap-8 lg:grid-cols-2"
  >
    <div className="space-y-5">
      <span className="text-sm uppercase tracking-widest text-neutral-500 dark:text-neutral-400">Đặt phòng thật</span>
      <h2 id="riverside-teaser-heading" className="text-3xl font-semibold md:text-4xl">
        {RIVERSIDE_NAME}
      </h2>
      <p className="text-neutral-600 dark:text-neutral-300">
        Căn hộ lưu trú tại {RIVERSIDE_ADDRESS}. Chọn ngày để xem loại phòng còn trống và giá từng đêm do hệ thống đặt phòng tính.
      </p>
      <div className="flex flex-wrap gap-3">
        <ButtonPrimary href={RESULTS_PATH as Route}>Xem phòng và giá thực tế</ButtonPrimary>
        <Link
          href={RIVERSIDE_PATH as Route}
          className="nc-Button relative inline-flex h-auto items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 sm:px-6 sm:text-base"
        >
          Khám phá Riverside
        </Link>
        <Link
          href={riversideSectionHref(HOME_SECTION.rooms) as Route}
          className="inline-flex items-center px-2 py-3 text-sm font-medium text-primary-6000 underline underline-offset-2 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          Các loại phòng
        </Link>
      </div>
    </div>
    <div className="overflow-hidden rounded-3xl">
      <Image
        src="/media/the-bha-riverside/rooftop-pool-day.webp"
        alt="Hồ bơi trên sân thượng vào ban ngày"
        width={1600}
        height={1067}
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="w-full object-cover"
      />
    </div>
  </section>
);

export default HomeRiversideTeaser;
