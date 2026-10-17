/**
 * CUST-WEB-HEADER-001-CP02: the website-settings client — what goes on the wire, and what each answer means. A write is
 * sent once and never retried; a lost write is `unverified`; a rate is a string; nothing is stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkCurrencyCode,
  checkLanguageCode,
  checkRateText,
  clearTranslation,
  createCurrency,
  applyPack,
  createLanguage,
  deleteCurrency,
  deleteLanguage,
  listCurrencies,
  listLanguages,
  exportPack,
  getHero,
  heroImageSrc,
  listTranslations,
  previewPack,
  saveHero,
  saveTranslation,
  setCurrencyActive,
  setCurrencyRate,
  setDefaultCurrency,
  setDefaultLanguage,
  updateCurrency,
  updateLanguage,
  uploadHeroImage,
} from "./website";

const BASE = "https://localhost:7145";
const LANGUAGE = {
  code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", sortOrder: 10, isActive: true, isDefault: true,
  version: 1, defaultCurrencyCode: "VND", direction: "ltr", formatLocale: "vi-VN", packId: "bha.vi", packVersion: "1",
  requiredKeys: 25, translatedKeys: 25, missingKeys: 0, outdatedKeys: 0, manualKeys: 0, isComplete: true,
  updatedAtUtc: "2026-10-15T00:00:00+00:00",
};
const LANGUAGE_INPUT = { displayName: "French", nativeName: "Français", sortOrder: 30, isActive: false, defaultCurrencyCode: "EUR", direction: "ltr" as const, formatLocale: "fr-FR" };
const CURRENCY = {
  code: "USD", name: "US dollar", symbol: "$", minorUnits: 2, sortOrder: 20, isActive: false, isDefault: false, isBase: false,
  vndPerUnit: null, rateUpdatedAtUtc: null, rateSource: "manual", version: 1, updatedAtUtc: "2026-10-15T00:00:00+00:00",
};
const ROW = {
  key: "customer.common.close", scope: "customer", group: "common", context: null, sourceText: "Đóng", placeholders: [], value: null,
  status: "missing", isManual: false, version: null, updatedAtUtc: null,
};
const LIST = {
  locale: "vi", referenceLocale: "vi", defaultLocale: "vi", isDefaultLocale: true, total: 1, page: 1, pageSize: 25,
  facets: { required: 1, translated: 0, missing: 1, outdated: 0, manual: 0, scopes: [{ name: "customer", count: 1 }], groups: [{ name: "common", count: 1 }] },
  rows: [ROW],
};

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE);
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("what goes on the wire", () => {
  it("reads with the Staff cookie, no body, no cache", async () => {
    const spy = respond(200, [LANGUAGE]);
    vi.stubGlobal("fetch", spy);
    expect(await listLanguages()).toEqual({ kind: "ok", data: [LANGUAGE] });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/admin/v1/website/languages`);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("writes JSON with the cookie and never sets an Origin or an actor itself", async () => {
    const spy = respond(201, LANGUAGE);
    vi.stubGlobal("fetch", spy);
    await createLanguage(" fr ", LANGUAGE_INPUT);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/admin/v1/website/languages`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ code: "fr", ...LANGUAGE_INPUT });
    expect(Object.keys(init.headers)).not.toContain("Origin");
    expect(init.body).not.toMatch(/actor|permission|staff/i);
  });

  it("sends a rate as a decimal STRING, so no digit is lost on the way", async () => {
    const spy = respond(200, { ...CURRENCY, vndPerUnit: "123456789012.12345678" });
    vi.stubGlobal("fetch", spy);
    await setCurrencyRate("usd", 3, "123456789012.12345678");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/admin/v1/website/currencies/usd/rate`);
    expect(init.body).toBe('{"expectedVersion":3,"vndPerUnit":"123456789012.12345678"}');
    expect(typeof JSON.parse(init.body).vndPerUnit).toBe("string");
  });

  it("sends expectedVersion null for 'no override yet' and encodes codes in the path", async () => {
    const spy = respond(200, ROW);
    vi.stubGlobal("fetch", spy);
    await saveTranslation("fr", "common.close", "Fermer", null);
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ locale: "fr", key: "common.close", value: "Fermer", expectedVersion: null });
    const languageSpy = respond(200, LANGUAGE);
    vi.stubGlobal("fetch", languageSpy);
    await updateLanguage("zh-Hans", 2, { ...LANGUAGE_INPUT, displayName: "Chinese", nativeName: "中文", sortOrder: 40, isActive: true });
    expect(languageSpy.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/languages/zh-Hans/update`);
    await setDefaultLanguage("a/b", 1);
    expect(languageSpy.mock.calls[1][0]).toBe(`${BASE}/api/admin/v1/website/languages/a%2Fb/set-default`);
  });

  it("builds the translations query from the locale, scope, group, status, trimmed search, reference and page", async () => {
    const spy = respond(200, LIST);
    vi.stubGlobal("fetch", spy);
    await listTranslations("vi", { scope: "customer", group: "common", status: "missing", search: "  Đóng ", reference: "en", page: 2, pageSize: 25 });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/translations?locale=vi&page=2&pageSize=25&scope=customer&group=common&status=missing&q=%C4%90%C3%B3ng&reference=en`);
    await listTranslations("vi", { page: 1, pageSize: 50 });
    expect(spy.mock.calls[1][0]).toBe(`${BASE}/api/admin/v1/website/translations?locale=vi&page=1&pageSize=50`);
  });

  it("previews with no change to the server's data, applies with the preview's token, and exports as text", async () => {
    const counts = { required: 1, inPack: 1, added: 1, updated: 0, unchanged: 0, keptManual: 0, overwrittenManual: 0, ignored: 0, rejected: 0, missingAfter: 0, obsolete: 0 };
    const preview = { locale: "fr", displayName: "French", nativeName: "Français", packId: "bha.fr", packVersion: "7", mode: "keep-manual", isNewLanguage: true, languageVersion: null, defaultCurrency: "EUR", counts, issues: [], issuesTruncated: false, canApply: true, canEnable: true, previewToken: "t" };
    const spy = respond(200, preview);
    vi.stubGlobal("fetch", spy);
    expect((await previewPack({ json: "{}" }, "keep-manual")).kind).toBe("ok");
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/language-packs/preview`);
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ json: "{}", mode: "keep-manual" });
    const applySpy = respond(200, { counts, enabled: true, language: LANGUAGE });
    vi.stubGlobal("fetch", applySpy);
    await applyPack({ builtInPackId: "bha.fr" }, "overwrite", "t", true);
    expect(JSON.parse(applySpy.mock.calls[0][1].body)).toEqual({ builtInPackId: "bha.fr", mode: "overwrite", previewToken: "t", enable: true });
    const exportSpy = vi.fn().mockResolvedValue(new Response('{"schema":"bha.language-pack/1"}', { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", exportSpy);
    expect(await exportPack("fr")).toEqual({ kind: "ok", data: '{"schema":"bha.language-pack/1"}' });
    expect(exportSpy.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/language-packs/export/fr`);
  });

  it("a lost answer to an apply is unverified, while a lost answer to a read is only a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    expect((await applyPack({ builtInPackId: "bha.fr" }, "keep-manual", "t", false)).kind).toBe("unverified");
    expect((await previewPack({ builtInPackId: "bha.fr" }, "keep-manual")).kind).toBe("network");
  });

  it.each([
    ["updateCurrency", () => updateCurrency("USD", 1, { name: "x", symbol: "$", minorUnits: 2, sortOrder: 1 }), "currencies/USD/update"],
    ["setCurrencyActive", () => setCurrencyActive("USD", 1, true), "currencies/USD/active"],
    ["setDefaultCurrency", () => setDefaultCurrency("USD", 1), "currencies/USD/set-default"],
    ["createCurrency", () => createCurrency("usd", { name: "x", symbol: "$", minorUnits: 2, sortOrder: 1 }), "currencies"],
    ["clearTranslation", () => clearTranslation("fr", "common.close", 1), "translations/clear"],
  ])("%s is one POST to the documented route", async (_name, call, route) => {
    const spy = respond(200, route.startsWith("translations") ? ROW : CURRENCY);
    vi.stubGlobal("fetch", spy);
    await call();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/${route}`);
    expect(spy.mock.calls[0][1].method).toBe("POST");
  });

  it("deletes with a POST and accepts only 204", async () => {
    const spy = respond(204);
    vi.stubGlobal("fetch", spy);
    expect(await deleteLanguage("fr", 2)).toEqual({ kind: "ok", data: undefined });
    expect(spy.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/languages/fr/delete`);
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ expectedVersion: 2 });
    vi.stubGlobal("fetch", respond(200, {}));
    expect((await deleteCurrency("USD", 1)).kind).toBe("unverified");
  });
});

describe("what each answer means", () => {
  it("401 is signed out and 403 is denied", async () => {
    vi.stubGlobal("fetch", respond(401, { title: "x" }));
    expect(await listLanguages()).toEqual({ kind: "unauthenticated" });
    vi.stubGlobal("fetch", respond(403));
    expect(await listCurrencies()).toEqual({ kind: "denied" });
    vi.stubGlobal("fetch", respond(403));
    expect(await createLanguage("fr", { ...LANGUAGE_INPUT, displayName: "x", nativeName: "x", sortOrder: 1, isActive: false })).toEqual({ kind: "denied" });
  });

  it.each([400, 404, 409])("%i is a refusal with the server's code, field and reason", async (status) => {
    vi.stubGlobal("fetch", respond(status, { title: "t", detail: "the reason", code: "stale-version", field: "vndPerUnit" }));
    expect(await setCurrencyRate("USD", 1, "1")).toEqual({ kind: "refused", status, code: "stale-version", field: "vndPerUnit", detail: "the reason" });
  });

  it("a refusal without a readable body still has a status", async () => {
    vi.stubGlobal("fetch", respond(409, "<html>"));
    const result = await setDefaultLanguage("en", 1);
    expect(result).toMatchObject({ kind: "refused", status: 409, code: null, field: null });
  });

  it("a write that gets no answer is UNVERIFIED, a read that gets none is a network error, and neither is retried", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", down);
    expect((await createLanguage("fr", { ...LANGUAGE_INPUT, displayName: "x", nativeName: "x", sortOrder: 1, isActive: false })).kind).toBe("unverified");
    expect(down).toHaveBeenCalledTimes(1);
    expect((await listLanguages()).kind).toBe("network");
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("a 5xx on a write is unverified (it may have committed); on a read it is an error", async () => {
    vi.stubGlobal("fetch", respond(503));
    expect((await setCurrencyActive("USD", 1, true)).kind).toBe("unverified");
    expect(await listCurrencies()).toMatchObject({ kind: "error", status: 503 });
  });

  it("a 2xx whose body cannot be read is unverified for a write and invalid for a read", async () => {
    vi.stubGlobal("fetch", respond(200, "not json"));
    expect((await updateLanguage("vi", 1, { ...LANGUAGE_INPUT, displayName: "x", nativeName: "x", sortOrder: 1, isActive: true })).kind).toBe("unverified");
    expect((await listLanguages()).kind).toBe("invalid-response");
    vi.stubGlobal("fetch", respond(200, [{ ...LANGUAGE, version: "1" }]));
    expect((await listLanguages()).kind).toBe("invalid-response");
    vi.stubGlobal("fetch", respond(200, { ...CURRENCY, vndPerUnit: 25000.5 }));
    expect((await setCurrencyRate("USD", 1, "25000.5")).kind).toBe("unverified");
  });

  it("an unexpected status that is not a refusal is an error, not an unverified write", async () => {
    vi.stubGlobal("fetch", respond(415, { title: "Unsupported media type" }));
    expect(await createLanguage("fr", { ...LANGUAGE_INPUT, displayName: "x", nativeName: "x", sortOrder: 1, isActive: false })).toMatchObject({ kind: "error", status: 415 });
  });

  it("an aborted read is not an error and is never retried", async () => {
    const spy = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", spy);
    expect((await listLanguages(new AbortController().signal)).kind).toBe("network");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("configuration", () => {
  it("sends nothing in LocalGate mode or without an API base URL", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    expect((await listLanguages()).kind).toBe("config");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    expect((await createCurrency("USD", { name: "x", symbol: "$", minorUnits: 2, sortOrder: 1 })).kind).toBe("config");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Nope");
    expect((await listCurrencies()).kind).toBe("config");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("input checks (the server still decides)", () => {
  it.each(["vi", "en-US", "zh-Hans", "es-419", " fil "])("accepts language tag %s", (text) => expect(checkLanguageCode(text)).toBeNull());
  it.each(["", "english", "en_US", "e", "en-USA", "x-y"])("refuses language tag %s", (text) => expect(checkLanguageCode(text)).not.toBeNull());
  it.each(["USD", "vnd"])("accepts currency code %s", (text) => expect(checkCurrencyCode(text)).toBeNull());
  it.each(["", "US", "USDX", "12A"])("refuses currency code %s", (text) => expect(checkCurrencyCode(text)).not.toBeNull());
  it.each(["1", "25000.5", "0.00000001", "999999999999.99999999"])("accepts rate %s", (text) => expect(checkRateText(text)).toBeNull());
  it.each(["", "0", "0.0", "-1", "+1", "1e3", "1,5", "1 000", " 1", "1.123456789", "1000000000000", ".5", "5.", "NaN", "abc"])(
    "refuses rate %j",
    (text) => expect(checkRateText(text)).not.toBeNull()
  );
});

// ---------------------------------------------------------------- CUST-WEB-HERO-001-CP01: the home hero

const HERO = {
  revision: "rev-1", version: 1, updatedAtUtc: "2026-10-17T01:00:00+00:00", fontKey: "default", autoplayEnabled: true, intervalSeconds: 6,
  locales: [{ code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true }],
  texts: { title: { vi: "T" }, description: { vi: "D" }, primaryAction: { vi: "P" }, secondaryAction: { vi: "S" } },
  slides: [{ id: "s1", mediaId: "m1", focalPosition: "50% 50%", alt: { vi: "a" }, caption: { vi: "c" } }],
  media: [{ id: "m1", kind: "seed", url: "/api/v1/website/hero/media/m1", seedFile: "hero-a.webp", contentType: "image/webp", byteSize: 10, width: 1920, height: 900, createdAtUtc: "2026-10-17T00:00:00Z" }],
};
const DRAFT = {
  fontKey: "system-serif" as const, autoplayEnabled: false, intervalSeconds: 9,
  texts: { title: { vi: "T2" }, description: { vi: "D" }, primaryAction: { vi: "P" }, secondaryAction: { vi: "S" } },
  slides: HERO.slides,
};

describe("the home hero", () => {
  it("reads with the Staff cookie, and a body that is not a hero (a bad font, a missing list) is invalid, not trusted", async () => {
    const fetchMock = respond(200, HERO);
    vi.stubGlobal("fetch", fetchMock);
    const result = await getHero();
    expect(result).toMatchObject({ kind: "ok", data: { revision: "rev-1", slides: [{ id: "s1" }], media: [{ seedFile: "hero-a.webp" }] } });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/hero`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });
    for (const bad of [{ ...HERO, fontKey: "comic" }, { ...HERO, slides: undefined }, { ...HERO, media: [{}] }, { ...HERO, revision: "" }]) {
      vi.stubGlobal("fetch", respond(200, bad));
      expect((await getHero()).kind).toBe("invalid-response");
    }
  });

  it("saves the whole hero as JSON, once, with the revision it loaded, and sends nothing the server decides", async () => {
    const fetchMock = respond(200, { ...HERO, version: 2, revision: "rev-2" });
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveHero("rev-1", DRAFT);
    expect(result).toMatchObject({ kind: "ok", data: { version: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/hero/save`);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toMatchObject({ method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({
      expectedRevision: "rev-1", fontKey: "system-serif", autoplayEnabled: false, intervalSeconds: 9, texts: DRAFT.texts,
      slides: [{ id: "s1", mediaId: "m1", focalPosition: "50% 50%", alt: { vi: "a" }, caption: { vi: "c" } }],
    });
  });

  it("a stale save is a refusal with the code, and a lost answer is unverified and not retried", async () => {
    vi.stubGlobal("fetch", respond(409, { title: "x", code: "stale-version", detail: "stale" }));
    expect(await saveHero("rev-1", DRAFT)).toMatchObject({ kind: "refused", status: 409, code: "stale-version" });
    const lost = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", lost);
    expect((await saveHero("rev-1", DRAFT)).kind).toBe("unverified");
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("uploads one picture as multipart form data with a part named file, and lets the browser set the content type with its boundary", async () => {
    const media = { ...HERO.media[0], id: "m2", kind: "upload", seedFile: null };
    const fetchMock = respond(200, media);
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "banner.png", { type: "image/png" });
    const result = await uploadHeroImage(file);
    expect(result).toMatchObject({ kind: "ok", data: { id: "m2", kind: "upload" } });
    const init = fetchMock.mock.calls[0][1];
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/v1/website/hero/media`);
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(init.headers).toEqual({ Accept: "application/json" });                 // no Content-Type: a hand-set one would lack the boundary
    expect(init).toMatchObject({ method: "POST", credentials: "include", redirect: "error" });
  });

  it("a refused picture carries the server's code and field; a body over the server's size limit is a refusal too; a lost answer is unverified and never retried", async () => {
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    vi.stubGlobal("fetch", respond(400, { title: "Invalid", code: "hero-image-corrupt", field: "file", detail: "damaged" }));
    expect(await uploadHeroImage(file)).toMatchObject({ kind: "refused", status: 400, code: "hero-image-corrupt", field: "file" });
    vi.stubGlobal("fetch", respond(413));
    expect(await uploadHeroImage(file)).toMatchObject({ kind: "refused", status: 413, code: "hero-image-too-large" });
    vi.stubGlobal("fetch", respond(409, { code: "hero-storage-not-configured", detail: "no root" }));
    expect(await uploadHeroImage(file)).toMatchObject({ kind: "refused", status: 409, code: "hero-storage-not-configured" });
    const lost = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", lost);
    expect((await uploadHeroImage(file)).kind).toBe("unverified");
    expect(lost).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", respond(200, { not: "a picture" }));
    expect((await uploadHeroImage(file)).kind).toBe("unverified");
  });

  it("shows a picture from the API's origin plus its id-addressed path", () => {
    expect(heroImageSrc("/api/v1/website/hero/media/m1")).toBe(`${BASE}/api/v1/website/hero/media/m1`);
  });
});
