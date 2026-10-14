import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import Badge from "@/shared/Badge";
import Heading from "@/shared/Heading";
import ButtonPrimary from "@/shared/ButtonPrimary";
import { HomeFaq, PropertyAmenities } from "./RiversideHomeSections";
import {
  BENEFITS,
  BOOKING_STEPS,
  HOME_SECTION,
  INTRO_IMAGE,
  RESULTS_PATH,
  RIVERSIDE_ADDRESS,
  RIVERSIDE_NAME,
  SPACE_GALLERY,
  mediaUrl,
} from "@/lib/riversideHomeContent";

const BADGE_COLORS = ["blue", "green", "red"] as const;

/**
 * CUST-WEB-001-CP08a: the Riverside sections of the home page, in the template's own composition (image
 * beside a list of benefits, a pictured grid, three steps, a question list). Everything they say is in
 * `lib/riversideHomeContent` with its source; what the catalog can change (room types, amenities,
 * check-in/out times) is read from the catalog by the client pieces, never written here.
 */

/** Why book here: what the booking page really does, the property's own amenities, one real photograph. */
export const IntroSection: FC = () => (
  <section
    id={HOME_SECTION.intro}
    aria-labelledby="intro-heading"
    className="nc-SectionOurFeatures relative flex scroll-mt-24 flex-col items-center lg:flex-row"
  >
    <div className="w-full flex-grow lg:w-3/5">
      <Image
        src={mediaUrl(INTRO_IMAGE.file)}
        alt={INTRO_IMAGE.alt}
        width={INTRO_IMAGE.width}
        height={INTRO_IMAGE.height}
        sizes="(min-width: 1024px) 55vw, 100vw"
        className="w-full rounded-3xl object-cover"
      />
    </div>
    <div className="mt-10 max-w-2xl flex-shrink-0 lg:mt-0 lg:w-2/5 lg:pl-16">
      <span className="text-sm uppercase tracking-widest text-neutral-500 dark:text-neutral-400">{RIVERSIDE_NAME}</span>
      <h2 id="intro-heading" className="mt-5 text-4xl font-semibold">
        Đặt phòng trực tiếp, rõ ràng từng bước
      </h2>
      <ul className="mt-12 space-y-10">
        {BENEFITS.map((benefit, index) => (
          <li key={benefit.id} className="space-y-4">
            <Badge color={BADGE_COLORS[index % BADGE_COLORS.length]} name={benefit.badge} />
            <h3 className="block text-xl font-semibold">{benefit.title}</h3>
            <span className="block text-neutral-500 dark:text-neutral-400">{benefit.body}</span>
          </li>
        ))}
      </ul>
      <PropertyAmenities />
    </div>
  </section>
);

/** The place itself: property pictures only (pool, rooftop, entrance, lobby), each with its own description. */
export const SpaceGallerySection: FC = () => (
  <section aria-labelledby="space-heading" className="relative scroll-mt-24">
    <Heading id="space-heading" desc="Hồ bơi trên sân thượng, sảnh và lối vào của The BHA Riverside.">
      Khám phá không gian
    </Heading>
    <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3">
      {SPACE_GALLERY.map((image, index) => (
        <div
          key={image.file}
          className={`overflow-hidden rounded-3xl ${index === 0 ? "col-span-2 md:row-span-2" : ""}`}
        >
          <Image
            src={mediaUrl(image.file)}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes={index === 0 ? "(min-width: 768px) 66vw, 100vw" : "(min-width: 768px) 33vw, 50vw"}
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  </section>
);

/** Three steps that are the booking page's real behaviour: search (a snapshot), hold, confirm. */
export const BookingGuideSection: FC = () => (
  <section id={HOME_SECTION.guide} aria-labelledby="guide-heading" className="nc-SectionHowItWork relative scroll-mt-24">
    <Heading id="guide-heading" isCenter desc="Ba bước, ngay trên trang.">
      Cách đặt phòng
    </Heading>
    <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-16">
      {BOOKING_STEPS.map((step) => (
        <li key={step.id} className="mx-auto flex max-w-xs flex-col items-center text-center">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-2xl font-semibold text-primary-700 dark:bg-neutral-800 dark:text-primary-300"
          >
            {step.id}
          </span>
          <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
          <span className="mt-4 block text-neutral-500 dark:text-neutral-400">{step.body}</span>
        </li>
      ))}
    </ol>
    <div className="mt-14 flex justify-center">
      <ButtonPrimary href={RESULTS_PATH as Route}>Bắt đầu tìm phòng</ButtonPrimary>
    </div>
  </section>
);

/** Where it is (the approved address) and what a guest should know before booking. */
export const LocationFaqSection: FC = () => (
  <section id={HOME_SECTION.faq} aria-labelledby="faq-heading" className="relative scroll-mt-24">
    <Heading id="faq-heading" desc="Vị trí và những điều nên biết trước khi đặt phòng.">
      Thông tin cần biết
    </Heading>
    <div className="grid gap-10 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <div className="rounded-3xl border border-neutral-200 p-6 dark:border-neutral-700">
          <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Vị trí</h3>
          <p className="mt-3 text-lg font-semibold">{RIVERSIDE_NAME}</p>
          <p className="mt-1 text-neutral-500 dark:text-neutral-400">{RIVERSIDE_ADDRESS}</p>
          <Link
            href={RESULTS_PATH as Route}
            className="mt-6 inline-block text-sm font-medium text-primary-6000 underline underline-offset-2 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
          >
            Xem phòng còn trống
          </Link>
        </div>
      </div>
      <div className="lg:col-span-2">
        <HomeFaq />
      </div>
    </div>
  </section>
);
