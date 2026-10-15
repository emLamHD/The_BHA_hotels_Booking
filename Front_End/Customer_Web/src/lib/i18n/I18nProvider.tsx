"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMessage, type MessageParams } from "./format";
import {
  CURRENCY_COOKIE,
  LOCALE_COOKIE,
  PREFERENCE_MAX_AGE_SECONDS,
  type I18nSnapshot,
  type WebsiteCurrencyInfo,
  type WebsiteLocale,
} from "./types";

/**
 * CUST-WEB-HEADER-001-CP02-C2: the client half. The server layout resolves the visitor's language, currency and
 * dictionary from their cookies and gives the same snapshot to the server render and to this provider, so a server
 * page and a client component of the same request always hold the same texts (no flash of another language, no
 * hydration mismatch). Choosing a language or a currency writes two preference cookies and asks the router to
 * refresh the server components: client state above and below — the booking hold, the customer session, a draft
 * in a form — is not remounted, and nothing is sent to the booking API.
 */

export interface I18nContextValue {
  locale: string;
  formatLocale: string;
  direction: "ltr" | "rtl";
  currency: string;
  baseCurrency: string;
  locales: WebsiteLocale[];
  currencies: WebsiteCurrencyInfo[];
  revision: string;
  degraded: boolean;
  /** Format a message by key; a key without a text is shown as the key (and reported), never as another language. */
  t: (key: string, params?: MessageParams) => string;
  has: (key: string) => boolean;
  /** A field of data the API owns (a room type's name, an amenity): the visitor's translation by stable id, else what the API sent. */
  content: <T extends string | null>(entity: string, id: string, field: string, fallback: T) => string | T;
  /** Choose a language: the language's own default currency comes with it. */
  setLocale: (code: string) => void;
  /** Choose a currency without changing the language. */
  setCurrency: (code: string) => void;
  switching: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function writePreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_MAX_AGE_SECONDS}; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}

/** The App Router, or `null` where there is none (a component test): choosing a language then only writes the cookies. */
function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function I18nProvider({ snapshot, children }: { snapshot: I18nSnapshot; children: React.ReactNode }) {
  const router = useOptionalRouter();
  const [switching, setSwitching] = useState(false);
  const reported = useRef(new Set<string>());
  const { messages, locale, formatLocale, config } = snapshot;

  const t = useCallback(
    (key: string, params?: MessageParams) => {
      const text = messages[key];
      if (text === undefined) {
        if (!reported.current.has(key)) {
          reported.current.add(key);
          console.error(`[i18n] missing text for ${key} (${locale})`);
        }
        return key;
      }
      return formatMessage(text, formatLocale, params);
    },
    [messages, locale, formatLocale]
  );

  // The refresh re-renders the server components with the new cookies; the flag drops when the new snapshot arrives.
  useEffect(() => {
    setSwitching(false);
  }, [snapshot.locale, snapshot.currency, snapshot.revision]);

  const finish = useCallback(() => {
    router?.refresh();
  }, [router]);

  const setLocale = useCallback(
    (code: string) => {
      const target = config.locales.find((item) => item.code === code);
      if (!target || code === locale) return;
      setSwitching(true);
      writePreference(LOCALE_COOKIE, target.code);
      // The language's own default currency comes with it (a mapping the Admin keeps, not a rule in code).
      if (target.defaultCurrency) writePreference(CURRENCY_COOKIE, target.defaultCurrency);
      finish();
    },
    [config.locales, locale, finish]
  );

  const setCurrency = useCallback(
    (code: string) => {
      if (!config.currencies.some((item) => item.code === code) || code === snapshot.currency) return;
      setSwitching(true);
      writePreference(CURRENCY_COOKIE, code);
      finish();
    },
    [config.currencies, snapshot.currency, finish]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      formatLocale,
      direction: snapshot.direction,
      currency: snapshot.currency,
      baseCurrency: config.baseCurrency,
      locales: config.locales,
      currencies: config.currencies,
      revision: snapshot.revision,
      degraded: snapshot.degraded,
      t,
      has: (key: string) => messages[key] !== undefined,
      content: <T extends string | null>(entity: string, id: string, field: string, fallback: T): string | T => {
        const key = `content.${entity}.${id}.${field}`;
        return messages[key] === undefined ? fallback : formatMessage(messages[key], formatLocale, {});
      },
      setLocale,
      setCurrency,
      switching,
    }),
    [locale, formatLocale, snapshot.direction, snapshot.currency, snapshot.revision, snapshot.degraded, config, t, messages, setLocale, setCurrency, switching]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}

/** `const t = useT(); t("customer.header.menu.offers")`. */
export function useT() {
  return useI18n().t;
}
