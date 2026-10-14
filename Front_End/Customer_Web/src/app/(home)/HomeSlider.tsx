"use client";

import React, { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import NextBtn from "@/components/NextBtn";
import PrevBtn from "@/components/PrevBtn";

/**
 * CUST-WEB-001-CP08a-C2: a horizontal slider made of native scrolling (scroll-snap) with previous/next buttons.
 * Swiping, trackpads and the keyboard (the track takes focus; arrow keys scroll it) work without any script;
 * the buttons call `scrollBy` and are disabled at the ends. No timer, no auto-advance, no library: it moves only
 * when the visitor moves it, and it never navigates or changes anything outside itself.
 */
const HomeSlider: FC<{ label: string; children: ReactNode; className?: string }> = ({ label, children, className = "" }) => {
  const trackRef = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  const update = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setCanPrev(track.scrollLeft > 4);
    setCanNext(track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => observer.disconnect();
  }, [update]);

  const scroll = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className={`relative ${className}`}>
      <ul
        ref={trackRef}
        tabIndex={0}
        onScroll={update}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:gap-6 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
      <div className="mt-4 hidden justify-end gap-2 sm:flex">
        <PrevBtn type="button" aria-label="Trước" disabled={!canPrev} onClick={() => scroll(-1)} className="h-10 w-10 text-lg disabled:opacity-40" />
        <NextBtn type="button" aria-label="Tiếp" disabled={!canNext} onClick={() => scroll(1)} className="h-10 w-10 text-lg disabled:opacity-40" />
      </div>
    </div>
  );
};

export default HomeSlider;
