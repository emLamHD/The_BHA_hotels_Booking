"use client";

import React, { useMemo, FC, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useSwipeable } from "react-swipeable";
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, PauseIcon, PlayIcon } from "@heroicons/react/24/solid";
import StaySearchForm from "../(client-components)/(HeroSearchForm)/(stay-search-form)/StaySearchForm";
import { HERO_SEARCH_ID } from "./RiversideHomeSections";
import {
  HERO_HEIGHT,
  HERO_SLIDES,
  HERO_WIDTH,
  MEDIA_CREDITS_PATH,
  creditForFile,
  creditLine,
  travelMediaUrl,
} from "@/data/heroSlides";
import { AUTOPLAY_INTERVAL_MS, nextIndex, prevIndex, shouldAutoplay } from "@/lib/heroCarousel";
import { OPEN_SEARCH_EVENT } from "@/lib/homepageSearch";
import { RIVERSIDE_PATH } from "@/lib/riversideHomeContent";

import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { localizeHeroSlide } from "@/lib/i18n/staticContent";
/** The two hero actions share one height, weight and radius: a solid white primary and a glass secondary, both legible over any picture. */
const ACTION_BASE_CLASS =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold shadow-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 sm:h-14 sm:px-8 sm:text-base";
const PRIMARY_ACTION_CLASS = `${ACTION_BASE_CLASS} bg-white text-neutral-900 hover:bg-neutral-100`;
const SECONDARY_ACTION_CLASS = `${ACTION_BASE_CLASS} border border-white/70 bg-black/25 text-white backdrop-blur-sm hover:bg-black/40`;
const ROUND_BUTTON_CLASS =
  "flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

/** "Tìm phòng": opens the compact search under `lg`, brings the real search form into view above it. It searches nothing by itself. */
function startSearch() {
  if (window.matchMedia("(max-width: 1023px)").matches) {
    window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
    return;
  }
  const form = document.getElementById(HERO_SEARCH_ID);
  if (!form) return;
  form.scrollIntoView({ block: "center", behavior: "smooth" });
  form.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
}

/**
 * CUST-WEB-001-CP08a-C2: the booking portal's first screen. A full-width slideshow of Đà Nẵng photographs
 * directly under the header, one H1, two actions and — on large screens — the real search form straddling the
 * picture's lower edge. Only the picture frame clips (`overflow-hidden`); the search form is a sibling layer
 * with its own stacking, so its popovers are never cut off.
 *
 * The slideshow only changes the picture: it never navigates, submits or touches the search draft. Autoplay
 * (`lib/heroCarousel`) stops for hover, focus inside, a hidden tab, a swipe, reduced motion and the visitor's
 * pause; its timer is cleared on every change and on unmount. Only the first picture is loaded with priority.
 * The pictures show Đà Nẵng, not the property's rooms; the caption names the place and credits the photograph.
 */
const HomeHeroCarousel: FC = () => {
  const t = useT();
  const { content } = useI18n();
  const slides = useMemo(() => HERO_SLIDES.map((slide) => localizeHeroSlide(slide, content)), [content]);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pausedByVisitor, setPausedByVisitor] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const autoplay = shouldAutoplay({
    slideCount: slides.length,
    reducedMotion,
    hovered,
    focusWithin,
    documentHidden,
    dragging,
    pausedByVisitor,
  });

  // One timer for the picture on screen; any change (slide, hover, focus, pause…) clears and re-arms it.
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => setIndex((current) => nextIndex(current, slides.length)), AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [autoplay, index, slides.length]);

  const go = useCallback((target: number) => setIndex(target), []);
  const next = useCallback(() => setIndex((current) => nextIndex(current, slides.length)), [slides.length]);
  const prev = useCallback(() => setIndex((current) => prevIndex(current, slides.length)), [slides.length]);

  const swipe = useSwipeable({
    onSwipeStart: () => setDragging(true),
    onSwiped: () => setDragging(false),
    onSwipedLeft: next,
    onSwipedRight: prev,
    delta: 40,
    preventScrollOnSwipe: false,
    trackMouse: false,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    }
  };

  const active = slides[index];
  const credit = creditForFile(active.file);

  return (
    <section aria-label={t("customer.home.homeHeroCarousel.daNang")} className="nc-HomeHeroCarousel relative lg:mb-16">
      <div
        ref={regionRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={t("customer.home.homeHeroCarousel.photosOfDaNang")}
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(event) => {
          if (!regionRef.current?.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
        }}
        onKeyDown={onKeyDown}
      >
        {/* The picture frame is the only element that clips. */}
        {/* touch-pan-y: only vertical panning is left to the browser, so a horizontal swipe changes the picture and is not
            taken by the browser's own overscroll gesture (which went back in history). */}
        <div {...swipe} className="relative h-[380px] touch-pan-y overflow-hidden bg-neutral-900 sm:h-[460px] lg:h-[682px]">
          {slides.map((slide, slideIndex) => {
            const isActive = slideIndex === index;
            return (
              <div
                key={slide.id}
                aria-hidden={!isActive}
                className={`absolute inset-0 ${reducedMotion ? "" : "transition-opacity duration-700"} ${isActive ? "opacity-100" : "opacity-0"}`}
              >
                <Image
                  src={travelMediaUrl(slide.file)}
                  alt={isActive ? slide.alt : ""}
                  width={HERO_WIDTH}
                  height={HERO_HEIGHT}
                  sizes="100vw"
                  priority={slideIndex === 0}
                  className="h-full w-full object-cover sm:!object-center"
                  style={{ objectPosition: slide.mobilePosition }}
                />
              </div>
            );
          })}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />

          <div className="container absolute inset-0 flex flex-col justify-center pb-10 sm:pb-6">
            <div className="max-w-2xl space-y-4 sm:space-y-6">
              <h1 className="text-3xl font-medium !leading-[114%] text-white sm:text-5xl lg:text-6xl">{t("customer.home.homeHeroCarousel.theBhaDaNang")}</h1>
              <p className="max-w-md text-base text-white/90 sm:text-lg">{t("customer.home.homeHeroCarousel.bookDirectAndSeeThe")}</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={startSearch} className={PRIMARY_ACTION_CLASS}>
                  <MagnifyingGlassIcon className="h-5 w-5" aria-hidden="true" />{t("customer.common.findARoom2")}</button>
                <Link href={RIVERSIDE_PATH as Route} className={SECONDARY_ACTION_CLASS}>{t("customer.home.homeHeroCarousel.xemRiverside")}<ArrowRightIcon className="h-5 w-5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>

          <div className="container absolute inset-x-0 bottom-3 flex items-end justify-between gap-3 sm:bottom-4 lg:bottom-[76px]">
            <p className="min-w-0 text-xs text-white/90 sm:text-sm">
              <span>{active.caption}</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              {credit && <span>{creditLine(credit, t("customer.media.photoBy"))}</span>}
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <Link href={MEDIA_CREDITS_PATH as Route} className="underline underline-offset-2 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">{t("customer.common.photoCredits")}</Link>
            </p>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button type="button" aria-label={t("customer.home.homeHeroCarousel.previousPhoto")} onClick={prev} className={ROUND_BUTTON_CLASS}>
                <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("customer.home.homeHeroCarousel.nextPhoto")} onClick={next} className={ROUND_BUTTON_CLASS}>
                <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-14 flex items-center justify-center gap-2 sm:bottom-16 lg:bottom-[76px] lg:left-1/2 lg:right-auto lg:-translate-x-1/2">
            <ul className="flex items-center gap-2">
              {slides.map((slide, slideIndex) => (
                <li key={slide.id}>
                  <button
                    type="button"
                    aria-label={t("customer.hero.slideLabel", { n: slideIndex + 1, caption: slide.caption })}
                    aria-current={slideIndex === index ? "true" : undefined}
                    onClick={() => go(slideIndex)}
                    className="group flex h-6 w-6 items-center justify-center focus:outline-none"
                  >
                    <span
                      className={`block h-2.5 rounded-full transition-all group-focus-visible:ring-2 group-focus-visible:ring-white ${
                        slideIndex === index ? "w-6 bg-white" : "w-2.5 bg-white/60 group-hover:bg-white/90"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              aria-label={pausedByVisitor ? t("customer.hero.resume") : t("customer.hero.pause")}
              onClick={() => setPausedByVisitor((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {pausedByVisitor ? <PlayIcon className="h-4 w-4" aria-hidden="true" /> : <PauseIcon className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {/* The search form is its own layer above the picture: nothing here is inside the clipping frame. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden translate-y-1/2 lg:block">
        <div className="container">
          <div id={HERO_SEARCH_ID} className="pointer-events-auto max-w-6xl scroll-mt-28 [&_form]:mt-0">
            <StaySearchForm />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HomeHeroCarousel;
