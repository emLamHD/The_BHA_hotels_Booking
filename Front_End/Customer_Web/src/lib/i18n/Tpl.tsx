"use client";

import React from "react";
import { useI18n } from "./I18nProvider";
import { tplKey } from "./tpl";

/** Renders a template text in the visitor's language (see `tpl.ts`). */
const reported = new Set<string>();

/** A template text with no key in the pack is shown as written and reported once (the Admin counts it as missing, never as translated). */
function reportMissing(text: string, locale: string) {
  if (typeof window === "undefined" || reported.has(text) || !/\p{L}{2}/u.test(text)) return;
  reported.add(text);
  console.warn(`[i18n] missing template text (${locale}): ${text}`);
}

export function Tpl({ text }: { text: string }) {
  const { t, has, locale } = useI18n();
  const key = tplKey(text);
  if (!has(key)) {
    reportMissing(text, locale);
    return <>{text}</>;
  }
  return <>{t(key)}</>;
}

/** For an attribute that needs a string (`placeholder`, `aria-label`). */
export function useTpl() {
  const { t, has } = useI18n();
  return (text: string) => (has(tplKey(text)) ? t(tplKey(text)) : text);
}
