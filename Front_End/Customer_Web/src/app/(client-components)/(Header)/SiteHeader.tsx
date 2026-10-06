"use client";

import React, { useEffect, useRef, useState } from "react";
import { PathName } from "@/routers/types";
import Header from "./Header";
import { usePathname } from "next/navigation";
import { useThemeMode } from "@/utils/useThemeMode";

let OPTIONS = {
  root: null,
  rootMargin: "0px",
  threshold: 1.0,
};
let OBSERVER: IntersectionObserver | null = null;
const PAGES_HIDE_HEADER_BORDER: PathName[] = ["/listing-stay-detail"];

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's sticky header, without its demo "Customize" panel
 * (header-style and home-demo switchers). One header, MainNav2.
 */
const SiteHeader = () => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isTopOfPage, setIsTopOfPage] = useState(true);

  useEffect(() => {
    setIsTopOfPage(window.pageYOffset < 5);
  }, []);
  useThemeMode();
  const pathname = usePathname();

  const intersectionCallback = (entries: IntersectionObserverEntry[]) => {
    entries.forEach((entry) => {
      setIsTopOfPage(entry.isIntersecting);
    });
  };

  useEffect(() => {
    // observer for the line below the header on pages that hide it at the top
    if (!PAGES_HIDE_HEADER_BORDER.includes(pathname as PathName)) {
      OBSERVER && OBSERVER.disconnect();
      OBSERVER = null;
      return;
    }
    if (!OBSERVER) {
      OBSERVER = new IntersectionObserver(intersectionCallback, OPTIONS);
      anchorRef.current && OBSERVER.observe(anchorRef.current);
    }
  }, [pathname]);

  let headerClassName = "shadow-sm dark:border-b dark:border-neutral-700";
  if (PAGES_HIDE_HEADER_BORDER.includes(pathname as PathName)) {
    headerClassName = isTopOfPage ? "" : "shadow-sm dark:border-b dark:border-neutral-700";
  }

  return (
    <>
      <Header className={headerClassName} navType="MainNav2" />
      <div ref={anchorRef} className="h-1 absolute invisible"></div>
    </>
  );
};

export default SiteHeader;
