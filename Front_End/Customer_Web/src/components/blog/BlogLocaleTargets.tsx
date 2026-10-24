"use client";

import { useEffect } from "react";
import { setLocaleTargets } from "@/lib/i18n/localeTargets";

/** Tells the language switch where each language of this Blog page is (see `lib/i18n/localeTargets`). Renders nothing. */
export default function BlogLocaleTargets({ targets }: { targets: Record<string, string> }) {
  const key = JSON.stringify(targets);
  useEffect(() => {
    setLocaleTargets(JSON.parse(key) as Record<string, string>);
    return () => setLocaleTargets(null);
  }, [key]);
  return null;
}
