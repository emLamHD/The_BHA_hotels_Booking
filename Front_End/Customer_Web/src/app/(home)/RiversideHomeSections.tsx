"use client";

import React, { FC, ReactNode, useEffect, useRef } from "react";
import { Disclosure } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { useStaySearch } from "@/components/StaySearchProvider";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import ButtonPrimary from "@/shared/ButtonPrimary";
import { createAnchorAlignment } from "@/lib/anchorAlignment";
import { OPEN_SEARCH_EVENT } from "@/lib/homepageSearch";
import { HOME_SECTION, HOME_SECTION_IDS, amenityNames, buildFaq, checkTimes } from "@/lib/riversideHomeContent";
import { SHOWCASE_SECTION_NAVIGATION_EVENT } from "@/lib/routePolicy";

import { useT } from "@/lib/i18n/I18nProvider";
/** The id of the hero's search form: the "Tìm phòng" button scrolls to it on large screens. */
export const HERO_SEARCH_ID = "tim-phong";

const ALIGNED_SECTIONS: ReadonlySet<string> = new Set(HOME_SECTION_IDS);
const USER_TAKEOVER_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;
const ALIGNMENT_WINDOW_MS = 5000;

/**
 * Keeps the section a visitor jumped to (`/#rooms`, `/#faq`, …) in view while content above it settles —
 * the catalog arriving, pictures loading — for browsers without native scroll anchoring. One alignment for
 * the whole page (see `lib/anchorAlignment`): it starts only from an explicit navigation intent and ends on
 * the first user input, so data arriving later never pulls the visitor back.
 */
export const HomeSectionAnchors: FC<{ children: ReactNode }> = ({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const alignment = createAnchorAlignment<HTMLElement>({
      container,
      sections: ALIGNED_SECTIONS,
      navigationEvent: SHOWCASE_SECTION_NAVIGATION_EVENT,
      takeoverEvents: USER_TAKEOVER_EVENTS,
      windowMs: ALIGNMENT_WINDOW_MS,
      environment: {
        window,
        getElementById: (id) => document.getElementById(id),
        createObserver: (onResize) => new ResizeObserver(onResize),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
    });
    return () => alignment.dispose();
  }, []);
  return <div ref={containerRef}>{children}</div>;
};

const SECONDARY_LINK_CLASS =
  "nc-Button relative h-auto inline-flex items-center justify-center rounded-full transition-colors text-sm sm:text-base font-medium px-5 py-4 sm:px-7 border bg-white border-neutral-200 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * The hero's two actions. "Tìm phòng" opens the compact search on a small screen and brings the hero's
 * own search form into view (focused) on a large one; neither searches by itself. "Khám phá loại phòng" is
 * a link to the room types on this page.
 */
export const HeroActions: FC = () => {
  const t = useT();
  const onSearch = () => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
      return;
    }
    const form = document.getElementById(HERO_SEARCH_ID);
    if (!form) return;
    form.scrollIntoView({ block: "center", behavior: "smooth" });
    form.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  };
  return (
    <div className="flex flex-wrap gap-3">
      <ButtonPrimary type="button" onClick={onSearch} sizeClass="px-5 py-4 sm:px-7">{t("customer.common.findARoom2")}</ButtonPrimary>
      <ShowcaseNavLink section={HOME_SECTION.rooms} className={SECONDARY_LINK_CLASS}>{t("customer.home.riversideHomeSections.exploreRoomTypes")}</ShowcaseNavLink>
    </div>
  );
};

/** The property's amenities exactly as the booking system names them; nothing is shown while it has none. */
export const PropertyAmenities: FC = () => {
  const t = useT();
  const names = amenityNames(useStaySearch()?.riverside);
  if (names.length === 0) return null;
  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{t("customer.home.riversideHomeSections.propertyAmenities")}</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {names.map((name) => (
          <li
            key={name}
            className="rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** The questions of `buildFaq`; the check-in/out answer carries the times the booking system holds, when it has them. */
export const HomeFaq: FC = () => {
  const t = useT();
  const items = buildFaq(checkTimes(useStaySearch()?.riverside), t);
  return (
    <div className="divide-y divide-neutral-200 rounded-3xl border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
      {items.map((item) => (
        <Disclosure key={item.id} as="div" className="px-5 sm:px-6">
          {({ open }) => (
            <>
              <Disclosure.Button className="flex w-full items-center justify-between py-5 text-left font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <span>{item.question}</span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`ml-4 h-5 w-5 flex-shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </Disclosure.Button>
              <Disclosure.Panel className="pb-5 text-neutral-500 dark:text-neutral-400">{item.answer}</Disclosure.Panel>
            </>
          )}
        </Disclosure>
      ))}
    </div>
  );
};
