import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api/env";
import { LOCALE_COOKIE } from "@/lib/i18n/types";
import { parseHero, type HeroSnapshot } from "./hero";

/**
 * The hero for this request, read by the home page with `no-store` (Next caches server fetches by default, which would keep a hero the
 * Admin has since changed). The last good answer per language survives a transient API failure; a first failure gives `null` and the
 * hero draws its frame, texts from the language catalog and the search form, with no picture, until a check succeeds.
 */
const lastGood = new Map<string, HeroSnapshot>();

export async function getHeroSnapshot(locale?: string): Promise<HeroSnapshot | null> {
  const wanted = locale ?? cookies().get(LOCALE_COOKIE)?.value ?? "";
  try {
    const base = getApiBaseUrl();
    const query = wanted ? `?locale=${encodeURIComponent(wanted)}` : "";
    const response = await fetch(`${base}/api/v1/website/hero${query}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const hero = parseHero(await response.json(), base);
    if (!hero) throw new Error("not a hero");
    lastGood.set(wanted, hero);
    return hero;
  } catch (error) {
    console.error(`[hero] could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
    return lastGood.get(wanted) ?? null;
  }
}
