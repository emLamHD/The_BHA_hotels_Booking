"use client";

import React, { FC, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

/**
 * CUST-WEB-SHOWCASE-001-CP01-C1 (F1): a header link to one section of the
 * live entry that never loads a new document (that would remount
 * BookingHoldProvider and lose the guest's in-memory hold and token).
 *
 * Next 13.4.3 scrolls a Link's hash target with
 * `window.scrollTo(0, element.offsetTop)`, which is wrong inside a positioned
 * ancestor and ignores the sticky header's scroll margin. So on the live page
 * itself — with or without a query string — the jump is a native fragment
 * change instead; from any other page the Link navigates client-side and
 * SectionGridFeatureProperty aligns the section once the catalog is ready.
 */
const ShowcaseNavLink: FC<{ section: string; className?: string; children: ReactNode }> = ({
  section,
  className,
  children,
}) => {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = window.location.pathname === "/" ? document.getElementById(section) : null;
    if (!target) return;
    event.preventDefault();
    if (window.location.hash === `#${section}`) target.scrollIntoView({ block: "start" });
    else window.location.hash = section;
  };

  return (
    <Link href={`/#${section}` as Route} className={className} onClick={onClick}>
      {children}
    </Link>
  );
};

export default ShowcaseNavLink;
