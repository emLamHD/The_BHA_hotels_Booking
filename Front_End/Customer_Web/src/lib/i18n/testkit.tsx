import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMessage, type MessageParams } from "./format";
import { I18nProvider } from "./I18nProvider";
import type { I18nSnapshot, WebsiteConfig } from "./types";

/**
 * CUST-WEB-HEADER-001-CP02-C2: test helpers. Rendered tests get the REAL built-in language packs (the files the API
 * serves), never a stub that returns keys: a missing or wrong translation fails the test that renders it.
 */
const PACKS = resolve(__dirname, "../../../../../Back_End/src/TheBha.Application/Website/Localization/packs");

export function loadPack(locale: string): Record<string, string> {
  const pack = JSON.parse(readFileSync(resolve(PACKS, `${locale}.json`), "utf8")) as {
    messages: Record<string, Record<string, string>>;
    content: Record<string, string>;
  };
  return { ...pack.messages.shared, ...pack.messages.customer, ...pack.messages.admin, ...pack.content };
}

const FORMAT: Record<string, { formatLocale: string; currency: string }> = {
  vi: { formatLocale: "vi-VN", currency: "VND" },
  en: { formatLocale: "en-US", currency: "USD" },
  fr: { formatLocale: "fr-FR", currency: "EUR" },
};

export function testConfig(): WebsiteConfig {
  return {
    defaultLocale: "vi",
    locales: Object.entries(FORMAT).map(([code, item]) => ({
      code,
      displayName: code,
      nativeName: code === "vi" ? "Tiếng Việt" : code === "fr" ? "Français" : "English",
      isDefault: code === "vi",
      formatLocale: item.formatLocale,
      direction: "ltr" as const,
      defaultCurrency: item.currency,
    })),
    baseCurrency: "VND",
    defaultCurrency: "VND",
    currencies: [
      { code: "VND", name: "Vietnamese đồng", symbol: "₫", minorUnits: 0, isBase: true, isDefault: true, vndPerUnit: "1", rateUpdatedAtUtc: "" },
      { code: "USD", name: "US dollar", symbol: "$", minorUnits: 2, isBase: false, isDefault: false, vndPerUnit: "26060", rateUpdatedAtUtc: "" },
      { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2, isBase: false, isDefault: false, vndPerUnit: "29748.26", rateUpdatedAtUtc: "" },
    ],
    revision: "test",
  };
}

export function testSnapshot(locale = "vi", currency?: string): I18nSnapshot {
  const format = FORMAT[locale] ?? FORMAT.vi;
  return {
    locale,
    formatLocale: format.formatLocale,
    direction: "ltr",
    currency: currency ?? format.currency,
    config: testConfig(),
    messages: loadPack(locale),
    revision: "test",
    degraded: false,
  };
}

export function withI18n(element: React.ReactElement, locale = "vi", currency?: string): React.ReactElement {
  return React.createElement(I18nProvider, { snapshot: testSnapshot(locale, currency) }, element);
}

/** Renders a (possibly async server) page or component to static markup inside the provider. */
export async function renderPage(page: (props: any) => unknown, props: Record<string, unknown> = {}, locale = "vi", currency?: string): Promise<string> {
  const output = (await page(props)) as React.ReactElement;
  return renderToStaticMarkup(withI18n(output, locale, currency));
}

export function renderWithI18n(element: React.ReactElement, locale = "vi", currency?: string): string {
  return renderToStaticMarkup(withI18n(element, locale, currency));
}

/** The factory for `vi.mock("@/lib/i18n/server", ...)`: the server-side helpers backed by the same real packs. */
export function serverModuleMock(locale = "vi") {
  const snapshot = testSnapshot(locale);
  return {
    getI18n: async () => snapshot,
    getT: async () => (key: string, params?: MessageParams) => {
      const text = snapshot.messages[key];
      if (text === undefined) throw new Error(`missing text for ${key} (${locale})`);
      return formatMessage(text, snapshot.formatLocale, params);
    },
    getContentMessages: async () => ({ messages: snapshot.messages, locale, formatLocale: snapshot.formatLocale }),
  };
}
