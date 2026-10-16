import { contentFrom, type ContentFn } from "./staticContent";
import { cache } from "react";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api/env";
import { formatMessage, type MessageParams } from "./format";
import {
  CURRENCY_COOKIE,
  LOCALE_COOKIE,
  PROVIDER_CONTENT_PREFIXES,
  PROVIDER_SCOPES,
  type I18nSnapshot,
  type WebsiteConfig,
  type WebsiteDictionary,
} from "./types";

/**
 * CUST-WEB-HEADER-001-CP02-C2: what the server resolves for one request — the visitor's language and currency
 * (their cookies, checked against the live settings), the dictionary for that language, and the settings themselves.
 * Every fetch is `no-store`: Next 13 caches server fetches by default, which would hold an old dictionary after the
 * Admin installs or edits a pack. The last good answer is kept only to survive a transient API failure.
 */

const lastGood = new Map<string, unknown>();

async function getJson<T>(path: string, key: string): Promise<{ value: T | null; ok: boolean }> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = (await response.json()) as T;
    lastGood.set(key, value);
    return { value, ok: true };
  } catch (error) {
    console.error(`[i18n] ${path.split("?")[0]} could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
    return { value: (lastGood.get(key) as T | undefined) ?? null, ok: false };
  }
}

function dictionaryPath(locale: string | undefined, prefixes: readonly string[], scopes: readonly string[]): string {
  const query = new URLSearchParams();
  if (locale) query.set("locale", locale);
  query.set("scopes", scopes.join(","));
  prefixes.forEach((prefix) => query.append("prefix", prefix));
  return `/api/v1/website/dictionary?${query.toString()}`;
}

const EMPTY_CONFIG: WebsiteConfig = {
  defaultLocale: "vi",
  locales: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, formatLocale: "vi-VN", direction: "ltr", defaultCurrency: "VND" }],
  baseCurrency: "VND",
  defaultCurrency: "VND",
  currencies: [],
  revision: "",
};

/** The visitor's settings for this request. Cached for the request, so the layout and every server component share one read. */
export const getI18n = cache(async (): Promise<I18nSnapshot> => {
  const jar = cookies();
  const wantedLocale = jar.get(LOCALE_COOKIE)?.value;
  const wantedCurrency = jar.get(CURRENCY_COOKIE)?.value;

  const configResult = await getJson<WebsiteConfig>("/api/v1/website/config", "config");
  const config = configResult.value ?? EMPTY_CONFIG;
  // The content scope is asked for by prefix, so the long static texts (posts, FAQ) stay out of every page.
  const uiScopes = [...PROVIDER_SCOPES, "content"];
  const path = dictionaryPath(wantedLocale, PROVIDER_CONTENT_PREFIXES, uiScopes);
  const dictionaryResult = await getJson<WebsiteDictionary>(path, `dictionary:${wantedLocale ?? ""}`);
  const dictionary = dictionaryResult.value;

  const localeCode = dictionary?.resolvedLocale ?? config.defaultLocale;
  const locale = config.locales.find((item) => item.code === localeCode) ?? config.locales.find((item) => item.isDefault) ?? config.locales[0];
  const offered = new Set(config.currencies.map((item) => item.code));
  const currency =
    wantedCurrency && offered.has(wantedCurrency) ? wantedCurrency : locale.defaultCurrency && offered.has(locale.defaultCurrency) ? locale.defaultCurrency : config.defaultCurrency;

  return {
    locale: locale.code,
    formatLocale: locale.formatLocale,
    direction: locale.direction,
    currency,
    config,
    messages: dictionary?.entries ?? {},
    revision: `${config.revision}:${dictionary?.revision ?? ""}`,
    degraded: !configResult.ok || !dictionaryResult.ok,
  };
});

/** Server-component translator: `const t = await getT(); t("customer.header.menu.offers")`. */
export async function getT(): Promise<(key: string, params?: MessageParams) => string> {
  const snapshot = await getI18n();
  return (key, params) => {
    const text = snapshot.messages[key];
    if (text === undefined) {
      console.error(`[i18n] missing text for ${key} (${snapshot.locale})`);
      return key;
    }
    return formatMessage(text, snapshot.formatLocale, params);
  };
}

/** The text lookup for static content (posts, offers, navigation): the small registries already in the layout's dictionary plus the long ones named by `prefixes`. */
export async function getContent(...prefixes: string[]): Promise<{ c: ContentFn; formatLocale: string }> {
  const snapshot = await getI18n();
  const extra = prefixes.length > 0 ? await getContentMessages(...prefixes) : null;
  return { c: contentFrom({ ...snapshot.messages, ...(extra?.messages ?? {}) }, snapshot.formatLocale), formatLocale: snapshot.formatLocale };
}

/** Long static content (a post, the FAQ) for the visitor's language, by key prefix — read per page, never shipped to every page. */
export async function getContentMessages(...prefixes: string[]): Promise<{ messages: Record<string, string>; locale: string; formatLocale: string }> {
  const snapshot = await getI18n();
  const result = await getJson<WebsiteDictionary>(dictionaryPath(snapshot.locale, prefixes, ["content"]), `content:${snapshot.locale}:${prefixes.join(",")}`);
  return { messages: result.value?.entries ?? {}, locale: snapshot.locale, formatLocale: snapshot.formatLocale };
}
