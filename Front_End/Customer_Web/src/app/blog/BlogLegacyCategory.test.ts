import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
// React's request cache only exists inside the server runtime; here the metadata and the page each read.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/blog",
  useSearchParams: () => new URLSearchParams(),
}));
import { middleware } from "@/middleware";
import { GET as blogMoved } from "@/app/blog-moved/route";
import { renderPage } from "@/lib/i18n/testkit";
import { apiItem } from "@/lib/blog/blogTestkit";
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import BlogPage, { generateMetadata as indexMetadata } from "./page";

/** The `targets` the page hands to the real `BlogLocaleTargets` (a client component: its effect does not run in a static render, so the element's props are read). */
function targetsOf(node: unknown): Record<string, string> | null {
  if (!React.isValidElement(node)) return Array.isArray(node) ? node.map(targetsOf).find((t) => t !== null) ?? null : null;
  const element = node as React.ReactElement<{ targets?: Record<string, string>; children?: unknown }>;
  return element.type === BlogLocaleTargets ? element.props.targets ?? null : targetsOf(element.props.children);
}

/**
 * BHA-BLOG-001-CP04-CP05-C8 F1: the old `/blog?category=` address from the request to what the reader gets — the REAL middleware and redirect helper, the REAL
 * server reads and the REAL index page and metadata, against one fake API — so a category lookup that fails in the middleware (the helper answers "no
 * redirect") reaches the page exactly as it does in production, instead of a mock that is always null.
 */
const ORIGIN = "https://localhost:3000";
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

function fakeApi(lookup: "ok" | "fails") {
  const calls: string[] = [];
  const handler = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname === "/api/v1/website/config") return json(200, { defaultLocale: "vi", locales: [] });
    const one = /^\/api\/v1\/website\/blog\/categories\/([^/]+)$/.exec(url.pathname);
    if (one) return lookup === "fails" ? json(500) : json(200, { slug: one[1] });
    if (url.pathname === "/api/v1/website/blog/categories") return json(200, { items: [{ slug: "diem-den", name: "Điểm đến", description: null, postCount: 3 }] });
    if (url.pathname === "/api/v1/website/blog/posts") return json(200, { locale: "vi", items: [apiItem(1), apiItem(2)], page: 1, pageSize: 12, total: 2 });
    return json(404);
  };
  return { handler, calls };
}

/** Next's `searchParams` for a URL: a repeated key is an array. */
function nextSearchParams(url: URL) {
  return Object.fromEntries(Array.from(new Set(Array.from(url.searchParams.keys()))).map((key) => [key, url.searchParams.getAll(key).length > 1 ? url.searchParams.getAll(key) : url.searchParams.get(key)!]));
}

async function serve(path: string, lookup: "ok" | "fails", cookie = "bha_locale=vi") {
  const fake = fakeApi(lookup);
  vi.stubGlobal("fetch", vi.fn(fake.handler));
  const url = new URL(path, ORIGIN);
  const answer = await middleware(new NextRequest(url, { headers: { cookie } }));
  const rewrite = answer.headers.get("x-middleware-rewrite");
  if (rewrite) {
    const moved = blogMoved(new Request(`${ORIGIN}/blog-moved`, { headers: { "x-bha-moved-to": answer.headers.get("x-middleware-request-x-bha-moved-to") ?? "" } }));
    return { kind: "redirect" as const, status: moved.status, location: moved.headers.get("location"), cacheControl: moved.headers.get("cache-control"), calls: fake.calls };
  }
  const searchParams = nextSearchParams(url);
  const metadata = await indexMetadata({ searchParams });
  try {
    return { kind: "page" as const, html: await renderPage(BlogPage, { searchParams }), metadata, calls: fake.calls };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_NOT_FOUND") return { kind: "not-found" as const, metadata, calls: fake.calls };
    throw error;
  }
}

const postsReads = (calls: string[]) => calls.filter((c) => c.startsWith("/api/v1/website/blog/posts"));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.test");
  vi.stubEnv("SITE_URL", "https://www.thebha.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a legacy category the middleware could not resolve", () => {
  it.each(["/blog?category=travel&locale=vi", "/blog?category=travel", "/blog?category=travel&locale=vi&page=1"])("%s: 200 'could not load', noindex, no cards, no unfiltered read, no index canonical", async (path) => {
    const r = await serve(path, "fails");
    expect(r.kind).toBe("page");
    if (r.kind !== "page") return;
    expect(r.html).toContain('data-testid="blog-unavailable"');
    expect(r.html).not.toContain("blog-card");
    expect(r.html).not.toContain("blog-empty");
    expect(r.html).not.toContain("blog-pagination");
    expect(r.html).not.toContain("application/ld+json");
    expect(r.metadata).toEqual({ robots: { index: false } });        // no canonical, no hreflang, no title of the index
    expect(postsReads(r.calls)).toEqual([]);                          // the posts are never read without the filter
  });

  it("keeps the language switch: the header gets each language's Blog index (the category slug is not carried into another language)", async () => {
    const r = await serve("/blog?category=travel&locale=vi", "fails");
    expect(r.kind === "page" && r.html).toContain("blog-unavailable");
    expect(targetsOf(await BlogPage({ searchParams: { category: "travel", locale: "vi" } }))).toEqual({ vi: "/blog?locale=vi", en: "/blog?locale=en", fr: "/blog?locale=fr" });
  });

  it("is rejected for a bad language or page before the unavailable branch (404, nothing read)", async () => {
    for (const path of ["/blog?category=travel&locale=zz!", "/blog?category=travel&page=abc", "/blog?category=travel&page=0", "/blog?category=travel&locale=vi&locale=en", "/blog?category=travel&page=2&page=2"]) {
      const r = await serve(path, "fails");
      expect(r.kind, path).toBe("not-found");
      expect(r.metadata, path).toEqual({});
      expect(postsReads(r.calls), path).toEqual([]);
    }
  });
});

describe("a legacy category once the lookup works again, and the requests around it", () => {
  it("answers 301 in one hop with no-store to the category's page", async () => {
    expect(await serve("/blog?category=travel&locale=vi", "ok")).toMatchObject({ kind: "redirect", status: 301, location: "/blog/category/travel?locale=vi", cacheControl: "no-store" });
  });

  it("serves the index normally when no category is given", async () => {
    const r = await serve("/blog?locale=vi", "fails");
    expect(r.kind).toBe("page");
    if (r.kind !== "page") return;
    expect(r.html).toContain("blog-card");
    expect(r.html).not.toContain("blog-unavailable");
    expect(r.metadata).toMatchObject({ alternates: { canonical: "https://www.thebha.test/blog?locale=vi" } });
    expect(postsReads(r.calls).length).toBeGreaterThan(0);
  });

  it.each(["/blog?category=&locale=vi", "/blog?category=Bad_Slug&locale=vi", "/blog?category=a%20b", "/blog?category=a&category=a", "/blog?category=a&category=b&locale=vi", "/blog?category=b&category=a", "/blog?category=&category="])(
    "%s: 404, noindex, never the unfiltered index and never a first-or-last value (lookup working or not)",
    async (path) => {
      for (const lookup of ["ok", "fails"] as const) {
        const r = await serve(path, lookup);
        expect(r.kind, `${path} ${lookup}`).toBe("not-found");
        expect(r.metadata, `${path} ${lookup}`).toEqual({});
        expect(postsReads(r.calls), `${path} ${lookup}`).toEqual([]);
      }
    }
  );
});
