"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getApiBaseUrl } from "@/lib/api/env";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { parseMenu, shouldAcceptMenu, type MenuSnapshot } from "./menu";
import { createMenuPoller, MENU_POLL_MS } from "./poller";

/**
 * CUST-WEB-HEADER-001-CP04: the one place the header navigation lives on the client. The server layout reads the menu for
 * the first render; after that this provider keeps it current without a reload: while the tab is visible it re-checks every
 * `POLL_MS` (the API revalidates with an ETag, so an unchanged menu is a 304), and again on focus, when the tab becomes
 * visible and on every navigation. There is exactly one provider, so the number of headers, menus or components never
 * multiplies the requests; a check never overlaps another; a language change aborts the one in flight. It never
 * calls `router.refresh()`, so a booking form, hold or session above or below it is untouched.
 */
interface MenuContextValue {
  menu: MenuSnapshot | null;
  /** True while the last check failed: the last good menu stays on screen. */
  stale: boolean;
}

export const MenuContext = createContext<MenuContextValue>({ menu: null, stale: false });

export function MenuProvider({ initial, children }: { initial: MenuSnapshot | null; children?: React.ReactNode }) {
  const { locale } = useI18n();
  const pathname = usePathname();
  const [menu, setMenu] = useState<MenuSnapshot | null>(initial);
  const [stale, setStale] = useState(false);
  const menuRef = useRef(menu);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const accept = useCallback((next: MenuSnapshot) => {
    if (!shouldAcceptMenu(menuRef.current, next, localeRef.current)) return;
    menuRef.current = next;
    setMenu(next);
  }, []);

  // The server renders again after a language switch (router.refresh in I18nProvider) and hands over its own copy.
  useEffect(() => {
    if (initial) accept(initial);
  }, [initial, accept]);

  const checkRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const poller = createMenuPoller({
      intervalMs: MENU_POLL_MS,
      isVisible: () => document.visibilityState === "visible",
      fetchMenu: async (signal) => {
        const response = await fetch(`${getApiBaseUrl()}/api/v1/website/menus?locale=${encodeURIComponent(locale)}`, {
          cache: "no-cache",
          signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseMenu(await response.json());
      },
      onMenu: accept,
      onStale: setStale,
    });
    checkRef.current = poller.checkNow;
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

  // A navigation is a moment the visitor is looking: check straight away.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    checkRef.current();
  }, [pathname]);

  const value = useMemo(() => ({ menu, stale }), [menu, stale]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

/** The navigation to render; `null` until the first answer (render nothing then — there is no built-in menu). */
export function useMenu(): MenuContextValue {
  return useContext(MenuContext);
}
