"use client";

import React, { FC, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { RIVERSIDE_PATH, riversideSectionHref } from "@/lib/riversideHomeContent";
import { SHOWCASE_SECTION_NAVIGATION_EVENT } from "@/lib/routePolicy";

/**
 * CUST-WEB-SHOWCASE-001-CP01-C1 (F1): a link to one section of the Riverside page that never loads a new
 * document (that would remount BookingHoldProvider and lose the guest's in-memory hold and token).
 *
 * CUST-WEB-001-CP08a-C2: the Riverside page is `/riverside` now (`/` is the booking portal), so every link
 * is `/riverside#section`.
 *
 * Next 13.4.3 scrolls a Link's hash target with
 * `window.scrollTo(0, element.offsetTop)`, which is wrong inside a positioned
 * ancestor and ignores the sticky header's scroll margin. So on the Riverside page
 * itself — with or without a query string — the jump is a native fragment
 * change instead; from any other page the Link navigates client-side and
 * the page's `HomeSectionAnchors` aligns the section the hash names once it mounts.
 * A same-fragment click has no native hashchange event, so it explicitly
 * starts a fresh bounded alignment window.
 */
const ShowcaseNavLink: FC<{
  section: string;
  className?: string;
  children: ReactNode;
  /** Called on a plain click, e.g. to close a menu that contains the link. */
  onNavigate?: () => void;
}> = ({ section, className, children, onNavigate }) => {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    onNavigate?.();
    const target = window.location.pathname === RIVERSIDE_PATH ? document.getElementById(section) : null;
    if (!target) return;
    event.preventDefault();
    if (window.location.hash === `#${section}`) {
      target.scrollIntoView({ block: "start" });
      window.dispatchEvent(new Event(SHOWCASE_SECTION_NAVIGATION_EVENT));
    } else {
      window.location.hash = section;
    }
  };

  return (
    <Link href={riversideSectionHref(section) as Route} className={className} onClick={onClick}>
      {children}
    </Link>
  );
};

export default ShowcaseNavLink;
