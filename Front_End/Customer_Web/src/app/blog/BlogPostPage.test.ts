import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("@/lib/blog/server", () => ({ getBlogPost: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  useRouter: () => router,
  usePathname: () => "/blog",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderPage } from "@/lib/i18n/testkit";
import BlogPostPage, { generateMetadata as postMetadata } from "./[slug]/page";
import { getBlogPost } from "@/lib/blog/server";
import { detail } from "@/lib/blog/blogTestkit";
import BlogLocaleTargets from "@/components/blog/BlogLocaleTargets";
import { I18nProvider, useI18n, type I18nContextValue } from "@/lib/i18n/I18nProvider";
import { setLocaleTargets } from "@/lib/i18n/localeTargets";
import { testSnapshot } from "@/lib/i18n/testkit";

/** The `targets` the page hands to the real `BlogLocaleTargets` (a client component: its effect does not run in a static render, so the element's props are read). */
function targetsOf(node: unknown): Record<string, string> | null {
  if (!React.isValidElement(node)) return Array.isArray(node) ? node.map(targetsOf).find((t) => t !== null) ?? null : null;
  const element = node as React.ReactElement<{ targets?: Record<string, string>; children?: unknown }>;
  if (element.type === BlogLocaleTargets) return element.props.targets ?? null;
  return targetsOf(element.props.children);
}

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://www.thebha.test");
});
afterEach(() => {
  vi.mocked(getBlogPost).mockReset();
  vi.unstubAllEnvs();
});

describe("/blog/{slug}", () => {
  it("renders the published post: one H1, its body, JSON-LD, and no editor or Staff text", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      status: "ok",
      value: detail({
        body: { schemaVersion: 1, blocks: [{ type: "heading", level: 2, text: "Mở đầu" }, { type: "paragraph", inlines: [{ text: "Xin chào" }] }] },
        alternates: [{ locale: "en", slug: "hello" }],
      }),
    });
    const html = await renderPage(BlogPostPage, { params: { slug: "bai-viet-1" }, searchParams: { locale: "vi" } });

    expect(vi.mocked(getBlogPost).mock.calls[0]).toEqual(["vi", "bai-viet-1"]);
    expect(count(html, "<h1")).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Bài viết 1<\/h1>/);
    expect(html).toContain("Xin chào");
    expect(html).toContain('id="mo-dau"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("BlogPosting");
    expect(html).toContain("BreadcrumbList");
  });

  it("is a real 404 for a draft/unpublished/archived/unknown/other-language slug (the API says 404), and for a slug that is no slug", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "missing" });
    await expect(renderPage(BlogPostPage, { params: { slug: "khong-co" }, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPage(BlogPostPage, { params: { slug: "../etc" }, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(vi.mocked(getBlogPost)).toHaveBeenCalledTimes(1);
  });

  it("redirects an old slug to the current Customer URL (fallback to the middleware's permanent redirect) — never to the API", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "moved", slug: "bai-moi" });
    await expect(renderPage(BlogPostPage, { params: { slug: "bai-cu" }, searchParams: { locale: "en-US" } })).rejects.toThrow("NEXT_REDIRECT:/blog/bai-moi?locale=en-us");
  });

  it("says it could not load, rather than showing a 404 or a stale post, when the read fails; the metadata then says noindex", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "error" });
    const html = await renderPage(BlogPostPage, { params: { slug: "bai-viet-1" }, searchParams: {} });
    expect(html).toContain("blog-unavailable");
    expect(html).not.toContain("<h1");
    expect(await postMetadata({ params: { slug: "bai-viet-1" }, searchParams: {} })).toEqual({ robots: { index: false } });
  });

  it("has metadata, canonical and hreflang from the published translation in the URL's language", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "ok", value: detail({ locale: "en", slug: "hello", title: "Hello", alternates: [{ locale: "vi", slug: "bai-viet-1" }] }) });
    const meta = await postMetadata({ params: { slug: "hello" }, searchParams: { locale: "en" } });
    expect(meta.alternates).toEqual({
      canonical: "https://www.thebha.test/blog/hello?locale=en",
      languages: { en: "https://www.thebha.test/blog/hello?locale=en", vi: "https://www.thebha.test/blog/bai-viet-1?locale=vi" },
    });
    expect(String(meta.title)).toContain("Hello");
  });
});

describe("/blog/{slug} with a page that is no page (BHA-BLOG-001-CP04-CP05-C8 F2)", () => {
  // The parsed page is the request's: a malformed one is a 404 before the post is read, for a current slug and for an old one, and an old slug is never redirected.
  const BAD_PAGES: Array<string | string[]> = [["2", "abc"], ["abc", "2"], ["2", "2"], ["1", "2", "3"], "", "abc", "0", "-1", "1.5", "01", "1000000"];

  it.each(BAD_PAGES.map((page) => [page]))("page=%j: metadata is empty and the render is a 404, with the post never read (current and old slug alike)", async (page) => {
    for (const read of [{ status: "ok" as const, value: detail() }, { status: "moved" as const, slug: "bai-moi" }]) {
      vi.mocked(getBlogPost).mockResolvedValue(read);
      const searchParams = { locale: "vi", page };
      expect(await postMetadata({ params: { slug: "bai-viet-1" }, searchParams })).toEqual({});
      await expect(renderPage(BlogPostPage, { params: { slug: "bai-viet-1" }, searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(vi.mocked(getBlogPost)).not.toHaveBeenCalled();
  });

  it("keeps an absent page and a single valid page as they were: the post renders, an old slug redirects (guards)", async () => {
    for (const searchParams of [{ locale: "vi" }, { locale: "vi", page: "1" }, { locale: "vi", page: "2" }]) {
      vi.mocked(getBlogPost).mockResolvedValue({ status: "ok", value: detail() });
      expect(await renderPage(BlogPostPage, { params: { slug: "bai-viet-1" }, searchParams })).toContain("<h1");
      expect(await postMetadata({ params: { slug: "bai-viet-1" }, searchParams })).toMatchObject({ alternates: { canonical: "https://www.thebha.test/blog/bai-viet-1?locale=vi" } });
      vi.mocked(getBlogPost).mockResolvedValue({ status: "moved", slug: "bai-moi" });
      await expect(renderPage(BlogPostPage, { params: { slug: "bai-cu" }, searchParams })).rejects.toThrow("NEXT_REDIRECT:/blog/bai-moi?locale=vi");
    }
  });
});

describe("the language switch on a post that cannot be read", () => {
  const INDEXES = { vi: "/blog?locale=vi", en: "/blog?locale=en", fr: "/blog?locale=fr" };
  const cookies: string[] = [];

  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
    cookies.length = 0;
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    vi.stubGlobal("document", { set cookie(value: string) { cookies.push(value); } });
  });
  afterEach(() => {
    setLocaleTargets(null);
    vi.unstubAllGlobals();
  });

  /** The provider the layout mounts, with the header's `setLocale` taken from the real context. */
  function mountedSwitch(currency?: string): I18nContextValue {
    let context: I18nContextValue | null = null;
    const Probe = () => { context = useI18n(); return null; };
    renderToStaticMarkup(React.createElement(I18nProvider, { snapshot: testSnapshot("vi", currency) }, React.createElement(Probe)));
    return context!;
  }

  it("registers every active language's own Blog index, from the site config, and no post slug", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "error" });
    const tree = await BlogPostPage({ params: { slug: "bai-viet-1" }, searchParams: { locale: "vi" } });
    expect(targetsOf(tree)).toEqual(INDEXES);
    expect(JSON.stringify(targetsOf(tree))).not.toContain("bai-viet-1");
  });

  it("switches from a URL that names its language: the header goes to the new language's index and refreshes, so the URL stops overriding the cookie", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "error" });
    const tree = await BlogPostPage({ params: { slug: "bai-viet-1" }, searchParams: { locale: "vi" } });
    setLocaleTargets(targetsOf(tree));                                   // what BlogLocaleTargets's effect does on the page

    mountedSwitch().setLocale("en");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/blog?locale=en");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(cookies.some((c) => c.startsWith("bha_locale=en;"))).toBe(true);
  });

  it("goes to the index even when the language's default currency is the one already chosen (nothing else in the snapshot changes)", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "error" });
    setLocaleTargets(targetsOf(await BlogPostPage({ params: { slug: "bai-viet-1" }, searchParams: { locale: "vi" } })));

    mountedSwitch("USD").setLocale("en");                                // English's own default currency is USD: the currency stays USD
    expect(router.push).toHaveBeenCalledWith("/blog?locale=en");
    expect(cookies.some((c) => c.startsWith("bha_currency=USD;"))).toBe(true);
  });

  it("without targets the header only writes the cookie and refreshes the same URL — which is why the branch must register them", () => {
    mountedSwitch().setLocale("en");
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the happy path: the published translation when there is one, else that language's index", async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ status: "ok", value: detail({ alternates: [{ locale: "en", slug: "hello" }] }) });
    const tree = await BlogPostPage({ params: { slug: "bai-viet-1" }, searchParams: { locale: "vi" } });
    expect(targetsOf(tree)).toEqual({ vi: "/blog/bai-viet-1?locale=vi", en: "/blog/hello?locale=en", fr: "/blog?locale=fr" });
  });
});
