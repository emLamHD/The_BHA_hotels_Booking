"use client";

import { useEffect } from "react";

/** Brings the offer `?offer=<slug>` named into view once, when `/offers` opens. It changes nothing else. */
export default function OfferHighlightScroller({ slug }: { slug: string }) {
  useEffect(() => {
    document.getElementById(`offer-${slug}`)?.scrollIntoView({ block: "center" });
  }, [slug]);
  return null;
}
