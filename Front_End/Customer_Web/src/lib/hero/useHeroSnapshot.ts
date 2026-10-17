"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/api/env";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { shouldAcceptMenu } from "@/lib/menus/menu";
import { createMenuPoller, MENU_POLL_MS } from "@/lib/menus/poller";
import { isSameHero, parseHero, type HeroSnapshot } from "./hero";

/**
 * CUST-WEB-HERO-001-CP01: keeps the home hero current while it is on screen. The page's server render gives the first copy; after that
 * this hook re-checks every `MENU_POLL_MS` (10 s, so a Save shows within the promised 15 s, request time included; the API answers an
 * unchanged hero with a 304), and again on focus and when the tab becomes visible — the menu's loop (`lib/menus/poller`): one request at
 * a time, none while the tab is hidden, the one in flight aborted on a language change or unmount. The loop exists only while the hero is
 * mounted (the home page), so no other page polls. An answer replaces the hero only if it is for the language on screen and newer by the
 * API's own clock; an answer with the same revision replaces nothing, so a quiet poll re-renders nothing and re-arms no timer. A failed
 * check keeps the last good hero. It never calls `router.refresh()`, so the search form, holds and sessions are untouched.
 */
export function useHeroSnapshot(initial: HeroSnapshot | null): { hero: HeroSnapshot | null; stale: boolean } {
  const { locale } = useI18n();
  const [hero, setHero] = useState<HeroSnapshot | null>(initial);
  const [stale, setStale] = useState(false);
  const heroRef = useRef(hero);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const accept = useCallback((next: HeroSnapshot) => {
    if (!shouldAcceptMenu(heroRef.current, next, localeRef.current)) return;
    if (isSameHero(heroRef.current, next)) {
      if (heroRef.current) heroRef.current = { ...heroRef.current, generatedAt: next.generatedAt };
      return;
    }
    heroRef.current = next;
    setHero(next);
  }, []);

  // The server renders again after a language switch (router.refresh in I18nProvider) and hands over its own copy.
  useEffect(() => {
    if (initial) accept(initial);
  }, [initial, accept]);

  useEffect(() => {
    const poller = createMenuPoller<HeroSnapshot>({
      intervalMs: MENU_POLL_MS,
      isVisible: () => document.visibilityState === "visible",
      fetchMenu: async (signal) => {
        const base = getApiBaseUrl();
        const response = await fetch(`${base}/api/v1/website/hero?locale=${encodeURIComponent(locale)}`, {
          cache: "no-cache",
          signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseHero(await response.json(), base);
      },
      onMenu: accept,
      onStale: setStale,
    });
    const wake = () => poller.checkNow();
    poller.start();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [locale, accept]);

  return { hero, stale };
}
