import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
  headers: () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));
// React's request cache only exists inside the server runtime; a test calls the function each time.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const config = {
  defaultLocale: "vi",
  locales: [
    { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, formatLocale: "vi-VN", direction: "ltr", defaultCurrency: "VND" },
    { code: "en", displayName: "English", nativeName: "English", isDefault: false, formatLocale: "en-US", direction: "ltr", defaultCurrency: "USD" },
  ],
  baseCurrency: "VND",
  defaultCurrency: "VND",
  currencies: [
    { code: "VND", minorUnits: 0 },
    { code: "USD", minorUnits: 2 },
  ],
  revision: "r1",
};

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("server i18n snapshot", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    jar.clear();
    requestHeaders.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function route(dictionary: unknown | null) {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/config") ? answer(config) : dictionary === null ? answer({}, 503) : answer(dictionary));
  }

  it("never lets Next cache the dictionary or the settings, and asks for the post cards but not the post bodies", async () => {
    route({ resolvedLocale: "en", revision: "d1", entries: { "shared.x": "x" } });
    jar.set("bha_locale", "en");
    const { getI18n } = await import("./server");
    const snapshot = await getI18n();
    expect(snapshot.locale).toBe("en");
    for (const call of fetchMock.mock.calls) expect(call[1]).toMatchObject({ cache: "no-store" });
    const dictionaryUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes("/dictionary"))?.[0]);
    expect(dictionaryUrl).toContain("locale=en");
    expect(decodeURIComponent(dictionaryUrl)).toContain("prefix=content.post.");
    expect(decodeURIComponent(dictionaryUrl)).not.toContain("content.postBody");
  });

  it("falls back to the locale's own currency when the cookie names one the site does not offer, and keeps an offered one", async () => {
    route({ resolvedLocale: "en", revision: "d1", entries: {} });
    jar.set("bha_locale", "en");
    jar.set("bha_currency", "JPY");
    let { getI18n } = await import("./server");
    expect((await getI18n()).currency).toBe("USD");
    vi.resetModules();
    jar.set("bha_currency", "VND");
    ({ getI18n } = await import("./server"));
    expect((await getI18n()).currency).toBe("VND");
  });

  it("uses the language the server resolved (a disabled or unknown cookie value falls back there)", async () => {
    route({ resolvedLocale: "vi", revision: "d1", entries: {} });
    jar.set("bha_locale", "de");
    const { getI18n } = await import("./server");
    const snapshot = await getI18n();
    expect(snapshot.locale).toBe("vi");
    expect(snapshot.currency).toBe("VND");
  });

  it("lets a Blog URL's explicit language (the middleware's header) win over the visitor's cookie, without touching the cookie", async () => {
    route({ resolvedLocale: "en", revision: "d1", entries: {} });
    jar.set("bha_locale", "vi");
    requestHeaders.set("x-bha-locale", "en");
    const { getI18n } = await import("./server");
    const snapshot = await getI18n();
    const dictionaryUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes("/dictionary"))?.[0]);
    expect(dictionaryUrl).toContain("locale=en");
    expect(dictionaryUrl).not.toContain("locale=vi");
    expect(snapshot.locale).toBe("en");
    expect(jar.get("bha_locale")).toBe("vi");
  });

  it("marks the answer degraded, instead of throwing, when the API is down", async () => {
    route(null);
    const { getI18n } = await import("./server");
    const snapshot = await getI18n();
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.messages).toEqual({});
  });
});
