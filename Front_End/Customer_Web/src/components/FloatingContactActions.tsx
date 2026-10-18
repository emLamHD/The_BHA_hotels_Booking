"use client";

import { ArrowUpIcon, PhoneIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/api/env";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { createMenuPoller, MENU_POLL_MS } from "@/lib/menus/poller";
import { backToTopBehavior, contactLabels, parseContactSettings, shouldAcceptContact, type ContactSettings } from "@/lib/social/settings";

export default function FloatingContactActions() {
  const { locale } = useI18n();
  const pathname = usePathname();
  const [settings, setSettings] = useState<ContactSettings | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const phoneWrap = useRef<HTMLDivElement>(null);
  const callLink = useRef<HTMLAnchorElement>(null);
  const labels = contactLabels(locale);

  const accept = useCallback((next: ContactSettings) => {
    setSettings(current => shouldAcceptContact(current, next) ? next : current);
  }, []);

  useEffect(() => {
    const poller = createMenuPoller<ContactSettings>({
      intervalMs: MENU_POLL_MS,
      isVisible: () => document.visibilityState === "visible",
      fetchMenu: async signal => {
        const response = await fetch(`${getApiBaseUrl()}/api/v1/website/social-media`, { signal, cache: "no-store", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseContactSettings(await response.json());
      },
      onMenu: accept,
      onStale: () => undefined,
    });
    const wake = () => poller.checkNow();
    poller.start();
    poller.checkNow();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { poller.stop(); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [accept]);

  useEffect(() => {
    let scheduled = false;
    const read = () => { scheduled = false; setShowTop(window.scrollY > 400); };
    const scroll = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(read); } };
    read(); window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);

  useEffect(() => {
    if (!phoneOpen) return;
    const dismiss = (event: PointerEvent) => { if (!phoneWrap.current?.contains(event.target as Node)) setPhoneOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPhoneOpen(false); phoneWrap.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    requestAnimationFrame(() => callLink.current?.focus());
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [phoneOpen]);

  useEffect(() => { if (!settings?.phoneEnabled) setPhoneOpen(false); }, [settings?.phoneEnabled]);
  if (!settings) return null;
  const room = pathname?.startsWith("/listing-stay-detail");
  const button = "flex h-11 w-11 items-center justify-center rounded-full shadow-lg ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950";
  const neutralButton = `${button} bg-white text-neutral-800 ring-black/10 hover:bg-neutral-50 dark:bg-neutral-800 dark:text-white dark:ring-white/20 dark:hover:bg-neutral-700`;
  const phoneButton = `${button} bg-[#0a84ff] text-white ring-blue-900/10 hover:bg-[#0077e6] dark:bg-[#0a84ff] dark:text-white dark:ring-blue-200/30 dark:hover:bg-[#2997ff]`;
  return <aside aria-label="Contact" className={`fixed right-[max(1rem,env(safe-area-inset-right))] z-[35] flex flex-col items-end gap-2 md:bottom-6 ${room ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]"}`}>
    {settings.phoneEnabled && settings.phoneNumber && settings.phoneHref && <div ref={phoneWrap} className="relative">
      {phoneOpen && <div role="dialog" aria-label={labels.phone} className="absolute bottom-0 right-14 whitespace-nowrap rounded-xl bg-white p-3 text-sm shadow-xl ring-1 ring-black/10 dark:bg-neutral-800 dark:ring-white/20">
        <p className="mb-1 select-text font-medium">{settings.phoneNumber}</p>
        <a ref={callLink} href={settings.phoneHref} className="text-primary-600 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{labels.call} {settings.phoneNumber}</a>
      </div>}
      <button type="button" className={phoneButton} aria-label={labels.phone} title={labels.phone} aria-expanded={phoneOpen} onClick={() => setPhoneOpen(open => !open)}><PhoneIcon className="h-6 w-6" /></button>
    </div>}
    {settings.messengerEnabled && settings.messengerUrl && <a className={`${button} bg-[#0084ff] text-white hover:bg-[#0878df] dark:bg-[#0084ff]`} href={settings.messengerUrl} target="_blank" rel="noopener noreferrer" aria-label={labels.messenger} title={labels.messenger}><i aria-hidden="true" className="lab la-facebook-messenger text-2xl" /></a>}
    {settings.zaloEnabled && settings.zaloUrl && <a className={`${button} overflow-hidden bg-white p-0.5 ring-black/10 hover:bg-neutral-100 dark:bg-white dark:ring-white/30 dark:hover:bg-neutral-100`} href={settings.zaloUrl} target="_blank" rel="noopener noreferrer" aria-label={labels.zalo} title={labels.zalo}><Image aria-hidden="true" src="/brand/zalo-share-logo.png" alt="" width={360} height={360} className="h-10 w-10 object-contain" /></a>}
    {settings.backToTopEnabled && showTop && <button type="button" className={neutralButton} aria-label={labels.top} title={labels.top} onClick={() => window.scrollTo({ top: 0, behavior: backToTopBehavior(window.matchMedia("(prefers-reduced-motion: reduce)").matches) })}><ArrowUpIcon className="h-6 w-6" /></button>}
  </aside>;
}
