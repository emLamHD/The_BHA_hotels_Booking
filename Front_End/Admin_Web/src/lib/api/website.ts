/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the typed client of the website-settings Admin API
 * (`/api/admin/v1/website/…`: languages, language packs, translations, currencies and exchange rates).
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
 * A rate is a decimal STRING in both directions (`"25000.5"`), never a JS number, so no digit is ever lost. The
 * words shown to the operator are Vietnamese; a server `detail` (English) is kept for the cases no code explains.
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
  /** The currency a visitor gets with this language; `null` = the site default. */
  defaultCurrencyCode: string | null;
  direction: "ltr" | "rtl";
  formatLocale: string;
  packId: string | null;
  packVersion: string | null;
  requiredKeys: number;
  translatedKeys: number;
  missingKeys: number;
  outdatedKeys: number;
  manualKeys: number;
  /** Every required text exists and is valid: the only state a language may be switched on in. */
  isComplete: boolean;
  updatedAtUtc: string;
}

export type TranslationStatus = "translated" | "missing" | "outdated";

export interface WebsiteTranslationRow {
  key: string;
  scope: string;
  group: string;
  context: string | null;
  placeholders: string[];
  /** The reference language's text. */
  sourceText: string;
  /** The text of this language, or `null` when there is none (a fallback is never shown as a translation). */
  value: string | null;
  status: TranslationStatus;
  isManual: boolean;
  version: number | null;
  updatedAtUtc: string | null;
}

export interface FacetCount {
  name: string;
  count: number;
}

export interface WebsiteTranslationList {
  locale: string;
  referenceLocale: string;
  defaultLocale: string;
  isDefaultLocale: boolean;
  total: number;
  page: number;
  pageSize: number;
  facets: { required: number; translated: number; missing: number; outdated: number; manual: number; scopes: FacetCount[]; groups: FacetCount[] };
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

export interface LibraryPack {
  id: string;
  locale: string;
  displayName: string;
  nativeName: string;
  version: string;
  texts: number;
  missingFromCatalog: number;
  /** `available`, `installed` or `update-available`. */
  state: string;
  installedVersion: string | null;
}

export interface PackCounts {
  required: number;
  inPack: number;
  added: number;
  updated: number;
  unchanged: number;
  keptManual: number;
  overwrittenManual: number;
  ignored: number;
  rejected: number;
  missingAfter: number;
  obsolete: number;
}

export interface PackIssue {
  key: string | null;
  severity: string;
  code: string;
  message: string;
}

export interface PackPreview {
  locale: string;
  displayName: string;
  nativeName: string;
  packId: string;
  packVersion: string;
  mode: PackMode;
  isNewLanguage: boolean;
  languageVersion: number | null;
  defaultCurrency: string | null;
  counts: PackCounts;
  issues: PackIssue[];
  issuesTruncated: boolean;
  canApply: boolean;
  canEnable: boolean;
  previewToken: string;
}

export interface PackApplyResult {
  counts: PackCounts;
  enabled: boolean;
  language: WebsiteLanguage;
}

export type PackMode = "keep-manual" | "overwrite";

/** A pack to check or install: one of the library, or the text of an uploaded file — never a URL. */
export type PackSource = { builtInPackId: string } | { json: string };

/** One language as the menu editor lists it; the content source language (Vietnamese) keeps its label in the menu row itself. */
export interface MenuLocale {
  code: string;
  displayName: string;
  nativeName: string;
  isDefault: boolean;
  isActive: boolean;
  isContentSource: boolean;
}

export type MenuPlacement = "primary" | "secondary";

/** One entry of the header navigation. `labels` has one text per language (`null` = none yet: the visitor then sees the default language's). */
export interface MenuItem {
  id: string;
  parentId: string | null;
  /** `primary` (the main row) or `secondary` (the group on the right) for a top-level entry; `null` for a sub-entry. */
  placement: MenuPlacement | null;
  isEnabled: boolean;
  href: string;
  openInNewTab: boolean;
  labels: Record<string, string | null>;
}

export interface WebsiteMenu {
  /** The tree's version and every label's: what a Save must quote. */
  revision: string;
  version: number;
  updatedAtUtc: string;
  locales: MenuLocale[];
  /** In tree order: the main row first, each entry followed by its sub-entries. */
  items: MenuItem[];
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
  return LANGUAGE_TAG.test(text.trim()) ? null : "Dùng mã ngôn ngữ như vi, en-US hoặc zh-Hans (chữ cái, có thể thêm chữ viết và vùng).";
}

/** `null` when the text is three letters; whether it is an ISO 4217 code is the server's call. */
export function checkCurrencyCode(text: string): string | null {
  return /^[A-Za-z]{3}$/.test(text.trim()) ? null : "Dùng mã tiền tệ ISO 4217 gồm ba chữ cái, ví dụ USD.";
}

/**
 * `null` when the text is a plain positive decimal the server will accept: digits and one `.`, up to 12 integer and
 * 8 fraction digits, greater than zero. No sign, exponent, thousands separator or spaces.
 */
export function checkRateText(text: string): string | null {
  if (!RATE_TEXT.test(text)) {
    return "Nhập số VND cho một đơn vị tiền tệ dạng số thập phân thường, ví dụ 25000.5 (chỉ chữ số và một dấu '.', không dấu phẩy hay khoảng trắng).";
  }
  return /^0(\.0+)?$/.test(text) ? "Tỷ giá phải lớn hơn 0." : null;
}

// ---------------------------------------------------------------- response checking

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === "object" && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const strOrNull = (value: unknown): value is string | null => value === null || isStr(value);

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

export function parseLanguage(data: unknown): WebsiteLanguage | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.code) || data.code === "" || !isStr(data.displayName) || !isStr(data.nativeName) || !isNum(data.sortOrder) ||
    !isBool(data.isActive) || !isBool(data.isDefault) || !isNum(data.version) || !strOrNull(data.defaultCurrencyCode) ||
    !(data.direction === "ltr" || data.direction === "rtl") || !isStr(data.formatLocale) || !strOrNull(data.packId) ||
    !strOrNull(data.packVersion) || !isNum(data.requiredKeys) || !isNum(data.translatedKeys) || !isNum(data.missingKeys) ||
    !isNum(data.outdatedKeys) || !isNum(data.manualKeys) || !isBool(data.isComplete) || !isStr(data.updatedAtUtc)
  ) {
    return null;
  }
  return {
    code: data.code, displayName: data.displayName, nativeName: data.nativeName, sortOrder: data.sortOrder, isActive: data.isActive,
    isDefault: data.isDefault, version: data.version, defaultCurrencyCode: data.defaultCurrencyCode, direction: data.direction,
    formatLocale: data.formatLocale, packId: data.packId, packVersion: data.packVersion, requiredKeys: data.requiredKeys,
    translatedKeys: data.translatedKeys, missingKeys: data.missingKeys, outdatedKeys: data.outdatedKeys, manualKeys: data.manualKeys,
    isComplete: data.isComplete, updatedAtUtc: data.updatedAtUtc,
  };
}

export function parseTranslationRow(data: unknown): WebsiteTranslationRow | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.key) || data.key === "" || !isStr(data.scope) || !isStr(data.group) || !strOrNull(data.context) ||
    !Array.isArray(data.placeholders) || !data.placeholders.every(isStr) || !isStr(data.sourceText) || !strOrNull(data.value) ||
    !(data.status === "translated" || data.status === "missing" || data.status === "outdated") || !isBool(data.isManual) ||
    !(data.version === null || isNum(data.version)) || !strOrNull(data.updatedAtUtc)
  ) {
    return null;
  }
  return {
    key: data.key, scope: data.scope, group: data.group, context: data.context, placeholders: data.placeholders as string[],
    sourceText: data.sourceText, value: data.value, status: data.status, isManual: data.isManual,
    version: data.version as number | null, updatedAtUtc: data.updatedAtUtc,
  };
}

const parseFacet = (data: unknown): FacetCount | null => (isRec(data) && isStr(data.name) && isNum(data.count) ? { name: data.name, count: data.count } : null);

export function parseTranslationList(data: unknown): WebsiteTranslationList | null {
  if (!isRec(data) || !isRec(data.facets)) return null;
  const facets = data.facets;
  if (
    !isStr(data.locale) || !isStr(data.referenceLocale) || !isStr(data.defaultLocale) || !isBool(data.isDefaultLocale) ||
    !isNum(data.total) || !isNum(data.page) || !isNum(data.pageSize) || !isNum(facets.required) || !isNum(facets.translated) ||
    !isNum(facets.missing) || !isNum(facets.outdated) || !isNum(facets.manual)
  ) {
    return null;
  }
  const scopes = parseList(facets.scopes, parseFacet);
  const groups = parseList(facets.groups, parseFacet);
  const rows = parseList(data.rows, parseTranslationRow);
  if (scopes === null || groups === null || rows === null) return null;
  return {
    locale: data.locale, referenceLocale: data.referenceLocale, defaultLocale: data.defaultLocale, isDefaultLocale: data.isDefaultLocale,
    total: data.total, page: data.page, pageSize: data.pageSize,
    facets: { required: facets.required, translated: facets.translated, missing: facets.missing, outdated: facets.outdated, manual: facets.manual, scopes, groups },
    rows,
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

export function parseLibraryPack(data: unknown): LibraryPack | null {
  if (!isRec(data)) return null;
  if (
    !isStr(data.id) || !isStr(data.locale) || !isStr(data.displayName) || !isStr(data.nativeName) || !isStr(data.version) ||
    !isNum(data.texts) || !isNum(data.missingFromCatalog) || !isStr(data.state) || !strOrNull(data.installedVersion)
  ) {
    return null;
  }
  return {
    id: data.id, locale: data.locale, displayName: data.displayName, nativeName: data.nativeName, version: data.version,
    texts: data.texts, missingFromCatalog: data.missingFromCatalog, state: data.state, installedVersion: data.installedVersion,
  };
}

function parseCounts(data: unknown): PackCounts | null {
  if (!isRec(data)) return null;
  const keys = ["required", "inPack", "added", "updated", "unchanged", "keptManual", "overwrittenManual", "ignored", "rejected", "missingAfter", "obsolete"] as const;
  if (!keys.every((key) => isNum(data[key]))) return null;
  return Object.fromEntries(keys.map((key) => [key, data[key] as number])) as unknown as PackCounts;
}

const parseIssue = (data: unknown): PackIssue | null =>
  isRec(data) && strOrNull(data.key) && isStr(data.severity) && isStr(data.code) && isStr(data.message)
    ? { key: data.key as string | null, severity: data.severity, code: data.code, message: data.message }
    : null;

export function parsePackPreview(data: unknown): PackPreview | null {
  if (!isRec(data)) return null;
  const counts = parseCounts(data.counts);
  const issues = parseList(data.issues, parseIssue);
  if (
    counts === null || issues === null || !isStr(data.locale) || !isStr(data.displayName) || !isStr(data.nativeName) ||
    !isStr(data.packId) || !isStr(data.packVersion) || !(data.mode === "keep-manual" || data.mode === "overwrite") ||
    !isBool(data.isNewLanguage) || !(data.languageVersion === null || isNum(data.languageVersion)) || !strOrNull(data.defaultCurrency) ||
    !isBool(data.issuesTruncated) || !isBool(data.canApply) || !isBool(data.canEnable) || !isStr(data.previewToken)
  ) {
    return null;
  }
  return {
    locale: data.locale, displayName: data.displayName, nativeName: data.nativeName, packId: data.packId, packVersion: data.packVersion,
    mode: data.mode, isNewLanguage: data.isNewLanguage, languageVersion: data.languageVersion as number | null,
    defaultCurrency: data.defaultCurrency, counts, issues, issuesTruncated: data.issuesTruncated, canApply: data.canApply,
    canEnable: data.canEnable, previewToken: data.previewToken,
  };
}

export function parsePackApplyResult(data: unknown): PackApplyResult | null {
  if (!isRec(data)) return null;
  const counts = parseCounts(data.counts);
  const language = parseLanguage(data.language);
  if (counts === null || language === null || !isBool(data.enabled)) return null;
  return { counts, enabled: data.enabled, language };
}

const parseMenuLocale = (data: unknown): MenuLocale | null =>
  isRec(data) && isStr(data.code) && data.code !== "" && isStr(data.displayName) && isStr(data.nativeName) && isBool(data.isDefault) && isBool(data.isActive) && isBool(data.isContentSource)
    ? { code: data.code, displayName: data.displayName, nativeName: data.nativeName, isDefault: data.isDefault, isActive: data.isActive, isContentSource: data.isContentSource }
    : null;

export function parseMenuItem(data: unknown): MenuItem | null {
  if (!isRec(data) || !isRec(data.labels)) return null;
  if (
    !isStr(data.id) || data.id === "" || !strOrNull(data.parentId) || !strOrNull(data.placement) || !(data.placement === null || data.placement === "primary" || data.placement === "secondary") ||
    !isBool(data.isEnabled) || !isStr(data.href) || !isBool(data.openInNewTab) || !Object.values(data.labels).every(strOrNull)
  ) {
    return null;
  }
  return {
    id: data.id, parentId: data.parentId, placement: data.placement as MenuPlacement | null, isEnabled: data.isEnabled, href: data.href,
    openInNewTab: data.openInNewTab, labels: { ...(data.labels as Record<string, string | null>) },
  };
}

export function parseMenu(data: unknown): WebsiteMenu | null {
  if (!isRec(data)) return null;
  const locales = parseList(data.locales, parseMenuLocale);
  const items = parseList(data.items, parseMenuItem);
  if (locales === null || items === null || !isStr(data.revision) || data.revision === "" || !isNum(data.version) || !isStr(data.updatedAtUtc)) return null;
  return { revision: data.revision, version: data.version, updatedAtUtc: data.updatedAtUtc, locales, items };
}

const parseLanguages = (data: unknown) => parseList(data, parseLanguage);
const parseCurrencies = (data: unknown) => parseList(data, parseCurrency);
const parseLibrary = (data: unknown) => parseList(data, parseLibraryPack);

// ---------------------------------------------------------------- one request

interface CallOptions<T> {
  write: boolean;
  parse?: (data: unknown) => T | null;
  /** The success status carries no body (delete). */
  noContent?: boolean;
  /** The success body is plain text (an exported pack). */
  text?: boolean;
  signal?: AbortSignal;
}

function target(path: string): { ok: true; url: string } | { ok: false; message: string } {
  const mode = getAccessMode();
  if (!mode.ok) return { ok: false, message: mode.message };
  if (mode.mode !== "Staff") {
    return { ok: false, message: "Cài đặt website cần đăng nhập Staff. Chúng không dùng được ở chế độ LocalGate." };
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
  return { code: null, field: null, detail: `Máy chủ Admin trả lời HTTP ${response.status}.` };
}

async function call<T>(method: "GET" | "POST", path: string, body: unknown, options: CallOptions<T>): Promise<WebsiteResult<T>> {
  const destination = target(path);
  if (!destination.ok) return { kind: "config", message: destination.message };
  const { write } = options;
  const noAnswer = write
    ? ({ kind: "unverified", message: "Máy chủ Admin không trả lời, nên thay đổi có thể đã hoặc chưa được lưu." } as const)
    : ({ kind: "network", message: "Không kết nối được tới máy chủ Admin. Hãy kiểm tra kết nối rồi thử lại." } as const);

  let response: Response;
  try {
    response = await fetch(destination.url, {
      method,
      headers: method === "POST" ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: options.text ? "application/json, text/plain" : "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "network", message: "Yêu cầu đã bị huỷ." };
    return noAnswer;
  }

  if (response.status === 401) return { kind: "unauthenticated" };
  if (response.status === 403) return { kind: "denied" };
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return { kind: "refused", status: response.status, ...(await readProblem(response)) };
  }
  if (response.status >= 500) {
    return write
      ? { kind: "unverified", message: `Máy chủ Admin trả lời HTTP ${response.status}, nên thay đổi có thể đã hoặc chưa được lưu.` }
      : { kind: "error", status: response.status, message: `Máy chủ Admin trả lời HTTP ${response.status}. Hãy thử lại sau ít phút.` };
  }
  if (!response.ok) {
    // Any other status (a redirect, 405, 415, 429…): the request was not applied.
    return { kind: "error", status: response.status, message: `Máy chủ Admin từ chối yêu cầu (HTTP ${response.status}).` };
  }
  if (options.noContent) {
    return response.status === 204 ? { kind: "ok", data: undefined as T } : write
      ? { kind: "unverified", message: "Máy chủ Admin trả lời không như mong đợi, nên thay đổi có thể đã hoặc chưa được lưu." }
      : { kind: "invalid-response", message: "Máy chủ Admin trả lời không như mong đợi." };
  }
  try {
    if (options.text) return { kind: "ok", data: (await response.text()) as T };
    const parsed = options.parse ? options.parse(await response.json()) : null;
    if (parsed !== null) return { kind: "ok", data: parsed };
  } catch {
    // Falls through: a 2xx whose body cannot be read.
  }
  return write
    ? { kind: "unverified", message: "Không có gì được xác nhận: không đọc được câu trả lời của máy chủ Admin." }
    : { kind: "invalid-response", message: "Không đọc được câu trả lời của máy chủ Admin." };
}

const encode = (value: string) => encodeURIComponent(value);

// ---------------------------------------------------------------- languages

export interface LanguageInput {
  displayName: string;
  nativeName: string;
  sortOrder: number;
  isActive: boolean;
  defaultCurrencyCode: string | null;
  direction: "ltr" | "rtl";
  formatLocale: string;
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

// ---------------------------------------------------------------- language packs

const PACKS = `${SETTINGS}/language-packs`;

export const listLibraryPacks = (signal?: AbortSignal) =>
  call<LibraryPack[]>("GET", `${PACKS}/library`, undefined, { write: false, parse: parseLibrary, signal });

/** Checks a pack on the server and says what installing it would do. Nothing is changed (so it is read-safe to repeat). */
export const previewPack = (source: PackSource, mode: PackMode) =>
  call<PackPreview>("POST", `${PACKS}/preview`, { ...source, mode }, { write: false, parse: parsePackPreview });

/** Installs the pack the preview described; the token binds the two. A lost answer is `unverified`: read the server before retrying. */
export const applyPack = (source: PackSource, mode: PackMode, previewToken: string, enable: boolean) =>
  call<PackApplyResult>("POST", `${PACKS}/apply`, { ...source, mode, previewToken, enable }, { write: true, parse: parsePackApplyResult });

export const exportPack = (code: string) => call<string>("GET", `${PACKS}/export/${encode(code)}`, undefined, { write: false, text: true });

export const downloadPackTemplate = (referenceLocale?: string) =>
  call<string>("GET", `${PACKS}/template${referenceLocale ? `?reference=${encode(referenceLocale)}` : ""}`, undefined, { write: false, text: true });

// ---------------------------------------------------------------- translations

export type TranslationScope = "customer" | "admin" | "shared" | "content";

export interface TranslationFilter {
  scope?: string;
  group?: string;
  status?: string;
  search?: string;
  reference?: string;
  page: number;
  pageSize: number;
}

export const listTranslations = (locale: string, filter: TranslationFilter, signal?: AbortSignal) => {
  const query = new URLSearchParams({ locale, page: String(filter.page), pageSize: String(filter.pageSize) });
  if (filter.scope) query.set("scope", filter.scope);
  if (filter.group) query.set("group", filter.group);
  if (filter.status) query.set("status", filter.status);
  if (filter.search?.trim()) query.set("q", filter.search.trim());
  if (filter.reference) query.set("reference", filter.reference);
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

// ---------------------------------------------------------------- header navigation (menu)

export const getMenu = (signal?: AbortSignal) => call<WebsiteMenu>("GET", `${SETTINGS}/menus`, undefined, { write: false, parse: parseMenu, signal });

/**
 * Applies the whole tree, links and labels in one transaction, or nothing. `expectedRevision` is the revision the editor
 * loaded; a stale one is a refusal (`stale-version`) and the draft is kept. A lost answer is `unverified`: read the server before sending again.
 */
export const saveMenu = (expectedRevision: string, items: MenuItem[]) =>
  call<WebsiteMenu>(
    "POST",
    `${SETTINGS}/menus/save`,
    {
      expectedRevision,
      items: items.map((item) => ({
        id: item.id, parentId: item.parentId, placement: item.placement, isEnabled: item.isEnabled, href: item.href,
        openInNewTab: item.openInNewTab, labels: item.labels,
      })),
    },
    { write: true, parse: parseMenu }
  );
