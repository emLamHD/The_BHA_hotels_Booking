/**
 * CUST-WEB-HEADER-001-CP02-C2: the shapes of the public website settings (`GET /api/v1/website/config` and
 * `/dictionary`). Nothing here names a language: a language is data the Admin installs.
 */
export interface WebsiteLocale {
  code: string;
  displayName: string;
  nativeName: string;
  isDefault: boolean;
  formatLocale: string;
  direction: "ltr" | "rtl";
  /** The currency a visitor gets with this language (always one of `currencies`). */
  defaultCurrency: string | null;
}

export interface WebsiteCurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
  isBase: boolean;
  isDefault: boolean;
  /** VND per one unit, as the exact decimal text the Admin typed. */
  vndPerUnit: string;
  rateUpdatedAtUtc: string;
}

export interface WebsiteConfig {
  defaultLocale: string;
  locales: WebsiteLocale[];
  baseCurrency: string;
  defaultCurrency: string;
  currencies: WebsiteCurrencyInfo[];
  revision: string;
}

export interface WebsiteDictionary {
  requestedLocale: string | null;
  resolvedLocale: string;
  defaultLocale: string;
  isFallbackLocale: boolean;
  revision: string;
  entries: Record<string, string>;
}

/** What the server layout resolved for this request and hands to the client provider. */
export interface I18nSnapshot {
  locale: string;
  formatLocale: string;
  direction: "ltr" | "rtl";
  currency: string;
  config: WebsiteConfig;
  messages: Record<string, string>;
  revision: string;
  /** True when the settings could not be read and the last good copy (or nothing) is shown. */
  degraded: boolean;
}

export const LOCALE_COOKIE = "bha_locale";
export const CURRENCY_COOKIE = "bha_currency";
export const PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The dictionary the layout sends to the client: UI texts and the small stored-content entries. Long static content is read per page. */
export const PROVIDER_SCOPES = ["shared", "customer"] as const;
export const PROVIDER_CONTENT_PREFIXES = [
  "content.property.",
  "content.roomType.",
  "content.ratePlan.",
  "content.amenity.",
  "content.media.",
  // the small static registries (offers, hero slides, navigation, booking guide); posts are read per page
  "content.offer.",
  "content.hero.",
  "content.nav.",
  "content.gallery.",
  "content.benefit.",
  "content.step.",
  "content.category.",
  // post cards (title, excerpt, cover alt); the long post bodies stay per page
  "content.post.",
] as const;

/** What `useT()` returns: the text for a key in the visitor's language, with the message's parameters filled in. */
export type Translate = (key: string, params?: import("./format").MessageParams) => string;
