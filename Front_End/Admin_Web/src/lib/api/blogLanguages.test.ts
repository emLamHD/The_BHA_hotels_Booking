/**
 * BHA-BLOG-001-CP03-C7 (F2): the public configuration spells a language in its canonical casing (`en-US`, `zh-Hans`); the Blog stores and returns its translations
 * under the case-folded key (`en-us`, `zh-hans`; backend `LanguageTag.TryNormalize`: trim, shape `ll[l][-Ssss][-RR|-999]`, lower-case key). The boundary between the two
 * is `fetchActiveLanguages`: whatever leaves it is the Blog's key. These tests run the real function against a stubbed `fetch` carrying real response shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActiveLanguages, normalizeLanguageCode } from "./blog";

const locale = (code: string, isDefault = false) => ({ code, displayName: `${code} name`, nativeName: `${code} native`, isDefault, formatLocale: code, direction: "ltr", defaultCurrency: "VND" });
const config = (locales: unknown[]) => ({ defaultLocale: "vi", locales, baseCurrency: "VND", defaultCurrency: "VND", currencies: [], revision: "x" });

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function languagesOf(locales: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(config(locales)), { status: 200, headers: { "Content-Type": "application/json" } })));
  const result = await fetchActiveLanguages();
  if (result.kind !== "ok") throw new Error("not ok: " + result.kind);
  return result.data;
}

describe("normalizeLanguageCode (the server's key)", () => {
  it.each([
    ["vi", "vi"], ["EN", "en"], ["en-US", "en-us"], ["en-us", "en-us"], ["EN-us", "en-us"], ["zh-Hans", "zh-hans"], ["ZH-HANT", "zh-hant"], ["zh-Hant-TW", "zh-hant-tw"],
    ["es-419", "es-419"], ["  en-US ", "en-us"], ["fil", "fil"],
  ])("%j -> %j", (input, expected) => expect(normalizeLanguageCode(input)).toBe(expected));

  it.each(["", "e", "english", "en_US", "en-U", "en-USA", "en-US-x", "zh-Hans-CN-x", "en US", "12", "en-"])("%j is not a language tag: left as it is, no alias is invented", (input) => {
    expect(normalizeLanguageCode(input)).toBe(input);
  });
});

describe("fetchActiveLanguages", () => {
  it("returns the Blog's keys, keeps the display texts, the order and the default flag", async () => {
    const data = await languagesOf([locale("vi"), locale("en-US", true), locale("zh-Hans"), locale("pt-BR")]);
    expect(data.map((l) => l.code)).toEqual(["vi", "en-us", "zh-hans", "pt-br"]);
    expect(data.map((l) => l.displayName)).toEqual(["vi name", "en-US name", "zh-Hans name", "pt-BR name"]);
    expect(data.map((l) => l.nativeName)).toEqual(["vi native", "en-US native", "zh-Hans native", "pt-BR native"]);
    expect(data.map((l) => l.isDefault)).toEqual([false, true, false, false]);
  });

  it("keeps regional and script variants apart (en-US, en-GB, zh-Hans, zh-Hant are four languages)", async () => {
    const data = await languagesOf([locale("en-US", true), locale("en-GB"), locale("zh-Hans"), locale("zh-Hant")]);
    expect(data.map((l) => l.code)).toEqual(["en-us", "en-gb", "zh-hans", "zh-hant"]);
  });

  it("asks the public configuration without credentials, as before", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(config([locale("vi", true)])), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchActiveLanguages();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://localhost:7145/api/v1/website/config");
    expect(call[1]).toMatchObject({ method: "GET", credentials: "omit" });
  });
});
