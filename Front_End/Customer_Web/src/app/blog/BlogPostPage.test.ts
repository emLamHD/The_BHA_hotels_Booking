import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("@/lib/blog/server", () => ({ getBlogPost: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
}));
import { renderPage } from "@/lib/i18n/testkit";
import BlogPostPage, { generateMetadata as postMetadata } from "./[slug]/page";
import { getBlogPost } from "@/lib/blog/server";
import { detail } from "@/lib/blog/blogTestkit";

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

beforeEach(() => vi.stubEnv("SITE_URL", "https://www.thebha.test"));
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
