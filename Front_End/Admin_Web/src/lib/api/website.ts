/**
 * CUST-WEB-HEADER-001-CP02: the typed client of the website-settings Admin API
 * (`/api/admin/v1/website/…`: languages, UI translations, currencies and exchange rates).
 *
 * Every call carries the browser's `.TheBha.Staff` cookie (`credentials: "include"`); the browser adds `Origin`
 * itself. Nothing is stored, nothing is retried: a write is sent once. What comes back is sorted into outcomes
 * the screens act on without guessing:
 *
 * - `ok` — the server answered with the expected body.
 * - `unauthenticated` (401) / `denied` (403) — the session or the permission is gone: the caller re-checks `me`.
 * - `refused` (400, 404, 409) — the server understood and did NOT apply the request; `code` and `field` say why.
 * - `unverified` — a WRITE got no usable answer (no response, a 5xx, a body that cannot be read): it may or may not
 *   have been applied, so the screen must read the server again before anything is sent a second time.
 * - `network` / `error` / `invalid-response` — the same for a read, where nothing can have changed.
 *
 * A rate is a decimal STRING in both directions (`"25000.5"`), never a JS number, so no digit is ever lost.
 */

import { describeApiBaseUrlError, getApiBaseUrl } from "./env";
import { getAccessMode } from "./accessMode";

export interface WebsiteLanguage {
  code: string;
  displayName: string;
  nativeName: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  version: number;
  translatedKeys: number;
  totalKeys: number;
  updatedAtUtc: string;
}

export interface WebsiteTranslationRow {
  key: string;
  group: string;
  sourceText: string;
  placeholders: string[];
  /** The override of this language, or `null` when it falls back to the default language. */
  value: string | null;
  effectiveValue: string;
  hasOverride: boolean;
  isFallback: boolean;
  version: number | null;
  updatedAtUtc: string | null;
}

export interface WebsiteTranslationList {
  locale: string;
  isDefaultLocale: boolean;
  defaultLocale: string;
  translatedKeys: number;
  totalKeys: number;
  groups: string[];
  rows: WebsiteTranslationRow[];
}

export interface WebsiteCurrency {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  isBase: boolean;
  /** VND per one unit of this currency, as the server's decimal text; `null` until an operator sets one. */
  vndPerUnit: string | null;
  rateUpdatedAtUtc: string | null;
  rateSource: string;
  version: number;
  updatedAtUtc: string;
}

export type WebsiteFailure =
  | { kind: "unauthenticated" }
  | { kind: "denied" }
  | { kind: "refused"; status: number; code: string | null; field: string | null; detail: string }
  | { kind: "unverified"; message: string }
  | { kind: "network"; message: string }
  | { kind: "error"; status: number; message: string }
  | { kind: "invalid-response"; message: string }
  | { kind: "config"; message: string };

export type WebsiteResult<T> = { kind: "ok"; data: T } | WebsiteFailure;

const SETTINGS = "/api/admin/v1/website";

// ---------------------------------------------------------------- input rules (the server decides; these only save a round trip)

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/;
const RATE_TEXT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/;

/** `null` when the text can be a BCP 47 tag of the supported shape (`vi`, `en-US`, `zh-Hans`). */
export function checkLanguageCode(text: string): string | null {
  return LANGUAGE_TAG.test(text.trim())
    ? null
    : "Use a language tag such as vi, en-US or zh-Hans (letters, optional script and region).";
}

/** `null` when the text is three letters; whether it is an ISO 4217 code is the server's call. */
export function checkCurrencyCode(text: string): string | null {
  return /^[A-Za-z]{3}$/.test(text.trim()) ? null : "Use a three-letter ISO 4217 code such as USD.";
}

/**
 * `null` when the text is a plain positive decimal the server will accept: digits and one `.`, up to 12 integer and
 * 8 fraction digits, greater than zero. No sign, exponent, thousands separator or spaces.
 */
export function checkRateText(text: string): string | null {
  if (!RATE_TEXT.test(text)) {
    return "Enter VND per one unit as a plain decimal, for example 25000.5 (digits and one '.', up to 12 + 8 digits, no commas or spaces).";
  }
  return /^0(\.0+)?$/.test(text) ? "The rate must be greater than zero." : null;
}

// ---------------------------------------------------------------- response checking

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === "object" && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const strOrNull = (value: unknown): value is string | null => value === null || isStr(value);

export function parseLanguage(data: unknown): WebsiteLanguage | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.code) || data.code === "" || !isStr(data.displayName) || !isStr(data.nativeName) || !isNum(data.sortOrder) ||
    !isBool(data.isActive) || !isBool(data.isDefault) || !isNum(data.version) || !isNum(data.translatedKeys) ||
    !isNum(data.totalKeys) || !isStr(data.updatedAtUtc)
  ) {
    return null;
  }
  return {
    code: data.code, displayName: data.displayName, nativeName: data.nativeName, sortOrder: data.sortOrder,
    isActive: data.isActive, isDefault: data.isDefault, version: data.version, translatedKeys: data.translatedKeys,
    totalKeys: data.totalKeys, updatedAtUtc: data.updatedAtUtc,
  };
}

function parseList<T>(data: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(data)) return null;
  const items: T[] = [];
  for (const entry of data) {
    const item = parse(entry);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

export function parseTranslationRow(data: unknown): WebsiteTranslationRow | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.key) || data.key === "" || !isStr(data.group) || !isStr(data.sourceText) || !Array.isArray(data.placeholders) ||
    !data.placeholders.every(isStr) || !strOrNull(data.value) || !isStr(data.effectiveValue) || !isBool(data.hasOverride) ||
    !isBool(data.isFallback) || !(data.version === null || isNum(data.version)) || !strOrNull(data.updatedAtUtc)
  ) {
    return null;
  }
  return {
    key: data.key, group: data.group, sourceText: data.sourceText, placeholders: data.placeholders as string[], value: data.value,
    effectiveValue: data.effectiveValue, hasOverride: data.hasOverride, isFallback: data.isFallback,
    version: data.version as number | null, updatedAtUtc: data.updatedAtUtc,
  };
}

export function parseTranslationList(data: unknown): WebsiteTranslationList | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.locale) || !isBool(data.isDefaultLocale) || !isStr(data.defaultLocale) || !isNum(data.translatedKeys) ||
    !isNum(data.totalKeys) || !Array.isArray(data.groups) || !data.groups.every(isStr)
  ) {
    return null;
  }
  const rows = parseList(data.rows, parseTranslationRow);
  if (rows === null) return null;
  return {
    locale: data.locale, isDefaultLocale: data.isDefaultLocale, defaultLocale: data.defaultLocale,
    translatedKeys: data.translatedKeys, totalKeys: data.totalKeys, groups: data.groups as string[], rows,
  };
}

export function parseCurrency(data: unknown): WebsiteCurrency | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.code) || data.code === "" || !isStr(data.name) || !isStr(data.symbol) || !isNum(data.minorUnits) ||
    !isNum(data.sortOrder) || !isBool(data.isActive) || !isBool(data.isDefault) || !isBool(data.isBase) ||
    !strOrNull(data.vndPerUnit) || !strOrNull(data.rateUpdatedAtUtc) || !isStr(data.rateSource) || !isNum(data.version) ||
    !isStr(data.updatedAtUtc)
  ) {
    return null;
  }
  return {
    code: data.code, name: data.name, symbol: data.symbol, minorUnits: data.minorUnits, sortOrder: data.sortOrder,
    isActive: data.isActive, isDefault: data.isDefault, isBase: data.isBase, vndPerUnit: data.vndPerUnit,
    rateUpdatedAtUtc: data.rateUpdatedAtUtc, rateSource: data.rateSource, version: data.version, updatedAtUtc: data.updatedAtUtc,
  };
}

const parseLanguages = (data: unknown) => parseList(data, parseLanguage);
const parseCurrencies = (data: unknown) => parseList(data, parseCurrency);

// ---------------------------------------------------------------- one request

interface CallOptions<T> {
  write: boolean;
  parse?: (data: unknown) => T | null;
  /** The success status carries no body (delete). */
  noContent?: boolean;
  signal?: AbortSignal;
}

function target(path: string): { ok: true; url: string } | { ok: false; message: string } {
  const mode = getAccessMode();
  if (!mode.ok) return { ok: false, message: mode.message };
  if (mode.mode !== "Staff") {
    return { ok: false, message: "The website settings need Staff sign-in. They are not available in LocalGate mode." };
  }
  const base = getApiBaseUrl();
  if (!base.ok) return { ok: false, message: describeApiBaseUrlError(base.reason) };
  return { ok: true, url: `${base.baseUrl}${path}` };
}

async function readProblem(response: Response): Promise<{ code: string | null; field: string | null; detail: string }> {
  try {
    const body: unknown = await response.json();
    if (isRec(body)) {
      return {
        code: isStr(body.code) ? body.code : null,
        field: isStr(body.field) ? body.field : null,
        detail: isStr(body.detail) ? body.detail : isStr(body.title) ? body.title : `HTTP ${response.status}`,
      };
    }
  } catch {
    // An unreadable problem body still has a status.
  }
  return { code: null, field: null, detail: `The Admin API answered HTTP ${response.status}.` };
}

async function call<T>(method: "GET" | "POST", path: string, body: unknown, options: CallOptions<T>): Promise<WebsiteResult<T>> {
  const destination = target(path);
  if (!destination.ok) return { kind: "config", message: destination.message };
  const { write } = options;
  const noAnswer = write
    ? ({ kind: "unverified", message: "The Admin API did not answer, so the change may or may not have been saved." } as const)
    : ({ kind: "network", message: "Could not reach the Admin API. Check your connection and try again." } as const);

  let response: Response;
  try {
    response = await fetch(destination.url, {
      method,
      headers: method === "POST" ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "network", message: "The request was cancelled." };
    return noAnswer;
  }

  if (response.status === 401) return { kind: "unauthenticated" };
  if (response.status === 403) return { kind: "denied" };
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return { kind: "refused", status: response.status, ...(await readProblem(response)) };
  }
  if (response.status >= 500) {
    return write
      ? { kind: "unverified", message: `The Admin API answered HTTP ${response.status}, so the change may or may not have been saved.` }
      : { kind: "error", status: response.status, message: `The Admin API answered HTTP ${response.status}. Try again in a moment.` };
  }
  if (!response.ok) {
    // Any other status (a redirect, 405, 415, 429…): the request was not applied.
    return { kind: "error", status: response.status, message: `The Admin API refused the request (HTTP ${response.status}).` };
  }
  if (options.noContent) {
    return response.status === 204 ? { kind: "ok", data: undefined as T } : write
      ? { kind: "unverified", message: "The Admin API gave an unexpected answer, so the change may or may not have been saved." }
      : { kind: "invalid-response", message: "The Admin API gave an unexpected answer." };
  }
  try {
    const parsed = options.parse ? options.parse(await response.json()) : null;
    if (parsed !== null) return { kind: "ok", data: parsed };
  } catch {
    // Falls through: a 2xx whose body cannot be read.
  }
  return write
    ? { kind: "unverified", message: "The Admin API saved nothing it could confirm: its answer could not be read." }
    : { kind: "invalid-response", message: "The Admin API answer could not be read." };
}

const encode = (value: string) => encodeURIComponent(value);

// ---------------------------------------------------------------- languages

export interface LanguageInput {
  displayName: string;
  nativeName: string;
  sortOrder: number;
  isActive: boolean;
}

export const listLanguages = (signal?: AbortSignal) =>
  call<WebsiteLanguage[]>("GET", `${SETTINGS}/languages`, undefined, { write: false, parse: parseLanguages, signal });

export const createLanguage = (code: string, input: LanguageInput) =>
  call<WebsiteLanguage>("POST", `${SETTINGS}/languages`, { code: code.trim(), ...input }, { write: true, parse: parseLanguage });

export const updateLanguage = (code: string, expectedVersion: number, input: LanguageInput) =>
  call<WebsiteLanguage>("POST", `${SETTINGS}/languages/${encode(code)}/update`, { expectedVersion, ...input }, { write: true, parse: parseLanguage });

export const setDefaultLanguage = (code: string, expectedVersion: number) =>
  call<WebsiteLanguage>("POST", `${SETTINGS}/languages/${encode(code)}/set-default`, { expectedVersion }, { write: true, parse: parseLanguage });

export const deleteLanguage = (code: string, expectedVersion: number) =>
  call<void>("POST", `${SETTINGS}/languages/${encode(code)}/delete`, { expectedVersion }, { write: true, noContent: true });

// ---------------------------------------------------------------- translations

export const listTranslations = (locale: string, filter: { group?: string; search?: string }, signal?: AbortSignal) => {
  const query = new URLSearchParams({ locale });
  if (filter.group) query.set("group", filter.group);
  if (filter.search?.trim()) query.set("q", filter.search.trim());
  return call<WebsiteTranslationList>("GET", `${SETTINGS}/translations?${query}`, undefined, { write: false, parse: parseTranslationList, signal });
};

export const saveTranslation = (locale: string, key: string, value: string, expectedVersion: number | null) =>
  call<WebsiteTranslationRow>("POST", `${SETTINGS}/translations/save`, { locale, key, value, expectedVersion }, { write: true, parse: parseTranslationRow });

export const clearTranslation = (locale: string, key: string, expectedVersion: number) =>
  call<WebsiteTranslationRow>("POST", `${SETTINGS}/translations/clear`, { locale, key, expectedVersion }, { write: true, parse: parseTranslationRow });

// ---------------------------------------------------------------- currencies

export interface CurrencyInput {
  name: string;
  symbol: string;
  minorUnits: number;
  sortOrder: number;
}

export const listCurrencies = (signal?: AbortSignal) =>
  call<WebsiteCurrency[]>("GET", `${SETTINGS}/currencies`, undefined, { write: false, parse: parseCurrencies, signal });

export const createCurrency = (code: string, input: CurrencyInput) =>
  call<WebsiteCurrency>("POST", `${SETTINGS}/currencies`, { code: code.trim(), ...input }, { write: true, parse: parseCurrency });

export const updateCurrency = (code: string, expectedVersion: number, input: CurrencyInput) =>
  call<WebsiteCurrency>("POST", `${SETTINGS}/currencies/${encode(code)}/update`, { expectedVersion, ...input }, { write: true, parse: parseCurrency });

export const setCurrencyRate = (code: string, expectedVersion: number, vndPerUnit: string) =>
  call<WebsiteCurrency>("POST", `${SETTINGS}/currencies/${encode(code)}/rate`, { expectedVersion, vndPerUnit }, { write: true, parse: parseCurrency });

export const setCurrencyActive = (code: string, expectedVersion: number, isActive: boolean) =>
  call<WebsiteCurrency>("POST", `${SETTINGS}/currencies/${encode(code)}/active`, { expectedVersion, isActive }, { write: true, parse: parseCurrency });

export const setDefaultCurrency = (code: string, expectedVersion: number) =>
  call<WebsiteCurrency>("POST", `${SETTINGS}/currencies/${encode(code)}/set-default`, { expectedVersion }, { write: true, parse: parseCurrency });

export const deleteCurrency = (code: string, expectedVersion: number) =>
  call<void>("POST", `${SETTINGS}/currencies/${encode(code)}/delete`, { expectedVersion }, { write: true, noContent: true });
