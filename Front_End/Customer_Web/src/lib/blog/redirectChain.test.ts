import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { GET as blogMoved } from "@/app/blog-moved/route";

/**
 * The whole chain a reader's request goes through — the redirect helper, the middleware's rewrite and the /blog-moved route handler — against a fake API, so a target the
 * helper builds but the handler refuses (the first version of the legacy-category case) is a failure here, not a green unit test on each half.
 */
const ORIGIN = "https://localhost:3000";
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

interface Api {
  /** The API's default language (also what `/website/config` reports). */
  defaultLocale?: string;
  /** slug → what `categories/{slug}` answers: "current", or the current slug it moved to, or "unknown". */
  categories?: Record<string, "current" | "unknown" | { movedTo: string }>;
  posts?: Record<string, { movedTo: string; byLocale?: Record<string, string> } | "current">;
  configFails?: boolean;
}

function fakeApi(api: Api) {
  const calls: string[] = [];
  const handler = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const locale = url.searchParams.get("locale") ?? api.defaultLocale ?? "vi";
    if (url.pathname === "/api/v1/website/config") return api.configFails ? json(500) : json(200, { defaultLocale: api.defaultLocale ?? "vi", locales: [] });
    const match = /^\/api\/v1\/website\/blog\/(categories|posts)\/([^/]+)$/.exec(url.pathname);
    if (!match) return json(404);
    const table = match[1] === "categories" ? api.categories : api.posts;
    const entry = table?.[match[2]] ?? "unknown";
    if (entry === "unknown") return json(404);
    if (entry === "current") return json(200, { slug: match[2] });
    const moved = entry as { movedTo: string; byLocale?: Record<string, string> };
    return json(301, { slug: moved.byLocale?.[locale] ?? moved.movedTo, locale });
  };
  return { handler, calls };
}

/** What the browser receives for this path: the middleware's answer, and when it rewrites to /blog-moved, that handler's answer. */
async function through(path: string, api: Api, cookie?: string) {
  const fake = fakeApi(api);
  vi.stubGlobal("fetch", vi.fn(fake.handler));
  const request = new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : {} });
  const answer = await middleware(request);
  const rewrite = answer.headers.get("x-middleware-rewrite");
  if (!rewrite) return { status: 200 as number, location: null as string | null, cacheControl: null as string | null, redirected: false, calls: fake.calls };
  expect(new URL(rewrite).pathname).toBe("/blog-moved");
  const to = answer.headers.get("x-middleware-request-x-bha-moved-to");
  const final = blogMoved(new Request(`${ORIGIN}/blog-moved`, { headers: to ? { "x-bha-moved-to": to } : {} }));
  return { status: final.status, location: final.headers.get("location"), cacheControl: final.headers.get("cache-control"), redirected: true, calls: fake.calls };
}

describe("a legacy /blog?category= address, from request to HTTP answer", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answers a first-time visitor (no ?locale, no cookie) with a 301 to the category page in the API's default language", async () => {
    const r = await through("/blog?category=diem-den", { categories: { "diem-den": "current" } });
    expect(r).toMatchObject({ status: 301, location: "/blog/category/diem-den?locale=vi" });
  });

  it("uses the default language the API reports, not a hard-coded one (a regional default is kept normalized)", async () => {
    const en = await through("/blog?category=places", { defaultLocale: "en-US", categories: { places: "current" } });
    expect(en).toMatchObject({ status: 301, location: "/blog/category/places?locale=en-us" });
    const fr = await through("/blog?category=lieux&page=2", { defaultLocale: "fr", categories: { lieux: "current" } });
    expect(fr).toMatchObject({ status: 301, location: "/blog/category/lieux?locale=fr&page=2" });
  });

  it("lets the explicit ?locale win over the cookie, and the cookie win over the default", async () => {
    const api = { defaultLocale: "en-US", categories: { diem: "current" as const } };
    expect((await through("/blog?category=diem&locale=fr", api, "bha_locale=vi")).location).toBe("/blog/category/diem?locale=fr");
    const withCookie = await through("/blog?category=diem", api, "bha_locale=vi");
    expect(withCookie.location).toBe("/blog/category/diem?locale=vi");
    expect(withCookie.calls.some((c) => c.startsWith("/api/v1/website/config"))).toBe(false);          // a known language needs no config read
  });

  it("goes to the CURRENT category slug when it was renamed, with the language the API resolved and a valid page kept", async () => {
    const r = await through("/blog?category=cu&page=2", { defaultLocale: "en", categories: { cu: { movedTo: "moi" } } });
    expect(r).toMatchObject({ status: 301, location: "/blog/category/moi?locale=en&page=2" });
    const direct = await through("/blog/category/cu?locale=vi&page=3", { categories: { cu: { movedTo: "moi" } } });
    expect(direct).toMatchObject({ status: 301, location: "/blog/category/moi?locale=vi&page=3" });
  });

  it("sends an unknown category to that category's page (which answers its own 404), still with a language", async () => {
    const r = await through("/blog?category=khong-co", { defaultLocale: "en", categories: {} });
    expect(r).toMatchObject({ status: 301, location: "/blog/category/khong-co?locale=en" });
  });

  it("does not guess a language when the default cannot be read: no redirect, the page answers (its own error handling)", async () => {
    const r = await through("/blog?category=diem-den", { configFails: true, categories: { "diem-den": "current" } });
    expect(r).toMatchObject({ redirected: false, status: 200 });
  });

  it("leaves old POST slugs and current URLs as they were", async () => {
    expect(await through("/blog/bai-cu?locale=vi", { posts: { "bai-cu": { movedTo: "bai-moi" } } })).toMatchObject({ status: 301, location: "/blog/bai-moi?locale=vi" });
    expect((await through("/blog/bai-moi?locale=vi", { posts: { "bai-moi": "current" } })).redirected).toBe(false);
  });
});

describe("a page that is not a page is never turned into page 1", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const api: Api = { defaultLocale: "vi", categories: { cu: { movedTo: "moi" }, hien: "current" } };

  it.each(["abc", "0", "-1", "1.5", "", "01", "1e3", "1000000", "%20"])("an old category URL with page=%j gets NO redirect (the Blog page answers its 404)", async (page) => {
    for (const path of [`/blog/category/cu?locale=vi&page=${page}`, `/blog?category=cu&locale=vi&page=${page}`, `/blog?category=hien&locale=vi&page=${page}`, `/blog?category=hien&page=${page}`]) {
      const r = await through(path, api);
      expect(r, path).toMatchObject({ redirected: false, status: 200 });
    }
  });

  it("keeps an absent page as page 1 (no ?page=) and a valid one as it is", async () => {
    expect((await through("/blog/category/cu?locale=vi", api)).location).toBe("/blog/category/moi?locale=vi");
    expect((await through("/blog/category/cu?locale=vi&page=1", api)).location).toBe("/blog/category/moi?locale=vi");
    expect((await through("/blog/category/cu?locale=vi&page=2", api)).location).toBe("/blog/category/moi?locale=vi&page=2");
    expect((await through("/blog/category/cu?locale=vi&page=999999", api)).location).toBe("/blog/category/moi?locale=vi&page=999999");
  });
});

describe("a permanent Blog redirect is never reused from a cache (BHA-BLOG-001-CP04-CP05-C6)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends Cache-Control: no-store with the 301 of an old post slug, an old category slug and the legacy ?category= address", async () => {
    for (const path of ["/blog/bai-cu?locale=vi", "/blog/category/cu?locale=vi", "/blog?category=cu&locale=vi"]) {
      const r = await through(path, { posts: { "bai-cu": { movedTo: "bai-moi" } }, categories: { cu: { movedTo: "moi" } } });
      expect(r, path).toMatchObject({ status: 301, cacheControl: "no-store" });
    }
  });

  it("answers the SAME old address (no ?locale) with the target of each visitor's own language, so a copy kept for one cookie would be wrong for the other", async () => {
    const api: Api = { posts: { hello: { movedTo: "hello-vi", byLocale: { vi: "xin-chao-2", en: "hello-welcome" } } } };
    const vi = await through("/blog/hello", api, "bha_locale=vi");
    const en = await through("/blog/hello", api, "bha_locale=en");
    expect(vi).toMatchObject({ status: 301, location: "/blog/xin-chao-2?locale=vi", cacheControl: "no-store" });
    expect(en).toMatchObject({ status: 301, location: "/blog/hello-welcome?locale=en", cacheControl: "no-store" });
  });

  it("follows the next rename: the same old address goes to the newest slug in one hop, and is again no-store", async () => {
    const api: Api = { posts: { hello: { movedTo: "hello-2" } } };
    expect(await through("/blog/hello", api, "bha_locale=vi")).toMatchObject({ location: "/blog/hello-2?locale=vi", cacheControl: "no-store" });
    api.posts = { hello: { movedTo: "hello-3" }, "hello-2": { movedTo: "hello-3" } };
    const next = await through("/blog/hello", api, "bha_locale=vi");
    expect(next).toMatchObject({ status: 301, location: "/blog/hello-3?locale=vi", cacheControl: "no-store" });
    expect(next.location).not.toContain("hello-2");
  });
});
