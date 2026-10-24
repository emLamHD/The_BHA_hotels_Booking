"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recoverSamePath } from "@/lib/blog/blog";
import { setLocaleTargets } from "@/lib/i18n/localeTargets";

/**
 * Tells the language switch where each language of this Blog page is (see `lib/i18n/localeTargets`). Renders nothing. `recover` is for the Blog's 404 only: a target
 * with the pathname the reader is already on goes through the recovery step, which is what clears the 404 (C7).
 */
export default function BlogLocaleTargets({ targets, recover = false }: { targets: Record<string, string>; recover?: boolean }) {
  const pathname = usePathname();
  const key = JSON.stringify(recover ? recoverSamePath(targets, pathname) : targets);
  useEffect(() => {
    setLocaleTargets(JSON.parse(key) as Record<string, string>);
    return () => setLocaleTargets(null);
  }, [key]);
  return null;
}
