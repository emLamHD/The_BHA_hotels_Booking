import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("@/lib/blog/server", () => ({ getBlogPosts: vi.fn(), getBlogPost: vi.fn(), getBlogCategories: vi.fn(), getBlogCategory: vi.fn(), getBlogHomeSection: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/blog",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderPage } from "@/lib/i18n/testkit";
import BlogPage, { generateMetadata as indexMetadata } from "./page";
import BlogCategoryPage from "./category/[slug]/page";
import { getBlogCategories, getBlogCategory, getBlogPosts } from "@/lib/blog/server";
import { category, items } from "@/lib/blog/blogTestkit";

const list = (count: number, total = count, page = 1) => ({ status: "ok" as const, value: { locale: "vi", items: items(count), page, pageSize: 12, total } });
const categories = { status: "ok" as const, value: [category("diem-den", "Điểm đến"), category("am-thuc", "Ẩm thực")] };
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

beforeEach(() => {
  vi.mocked(getBlogCategories).mockResolvedValue(categories);
  vi.stubEnv("SITE_URL", "https://www.thebha.test");
});
afterEach(() => {
  vi.mocked(getBlogPosts).mockReset();
  vi.mocked(getBlogCategory).mockReset();
  vi.unstubAllEnvs();
});

describe("/blog", () => {
  it("shows the published posts and the categories, every link keeping the language of the URL, and asks the API for that language", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue(list(12, 30));
    const html = await renderPage(BlogPage, { searchParams: { locale: "en-US" } });

    expect(vi.mocked(getBlogPosts).mock.calls[0]).toEqual(["en-us", { page: 1, pageSize: 12 }]);
    expect(count(html, 'data-testid="blog-card"')).toBe(12);
    expect(html).toContain('href="/blog/bai-viet-1?locale=en-us"');
    expect(html).toContain('href="/blog/category/diem-den?locale=en-us"');
    expect(html).toContain('href="/blog?locale=en-us&amp;page=2"');                       // pagination keeps it too
    expect(count(html, "<h1")).toBe(1);
  });

  it("uses the site's language when the URL names none", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue(list(1));
    await renderPage(BlogPage, { searchParams: {} });
    expect(vi.mocked(getBlogPosts).mock.calls[0][0]).toBe("vi");
  });

  it("says it could not load when the read fails — not an empty list, not a 404, no sample post", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue({ status: "error" });
    const html = await renderPage(BlogPage, { searchParams: {} });
    expect(html).toContain('data-testid="blog-unavailable"');
    expect(html).not.toContain("blog-empty");
    expect(html).not.toContain("blog-card");
  });

  it("says there is nothing yet for an empty answer, and shows no pagination", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue(list(0));
    const html = await renderPage(BlogPage, { searchParams: {} });
    expect(html).toContain('data-testid="blog-empty"');
    expect(html).not.toContain("blog-pagination");
  });

  it("sends a page beyond the last to the last page (or to page 1 when nothing is left), so there is no blank page", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue(list(0, 30, 9));
    await expect(renderPage(BlogPage, { searchParams: { locale: "vi", page: "9" } })).rejects.toThrow("NEXT_REDIRECT:/blog?locale=vi&page=3");
    vi.mocked(getBlogPosts).mockResolvedValue(list(0, 0, 4));
    await expect(renderPage(BlogPage, { searchParams: { page: "4" } })).rejects.toThrow("NEXT_REDIRECT:/blog?locale=vi");
  });

  it("answers 404 for a page or a language that is no such thing, and when the API has no such language", async () => {
    for (const searchParams of [{ page: "0" }, { page: "abc" }, { locale: "not a tag" }, { locale: ["vi", "en"] }]) {
      await expect(renderPage(BlogPage, { searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    vi.mocked(getBlogPosts).mockResolvedValue({ status: "missing" });
    await expect(renderPage(BlogPage, { searchParams: { locale: "zz" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("has a canonical that names the language and the page, on the configured origin", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue(list(3));
    expect(await indexMetadata({ searchParams: { locale: "en", page: "2" } })).toMatchObject({ alternates: { canonical: "https://www.thebha.test/blog?locale=en&page=2" } });
    vi.stubEnv("SITE_URL", "");
    expect((await indexMetadata({ searchParams: {} })).alternates).toBeUndefined();
  });

  it("is noindex when the posts cannot be read, from the very read the page makes; a working list and an empty one are indexed normally", async () => {
    vi.mocked(getBlogPosts).mockResolvedValue({ status: "error" });
    const searchParams = { locale: "en", page: "2" };
    expect(await indexMetadata({ searchParams })).toEqual({ robots: { index: false } });
    expect(await renderPage(BlogPage, { searchParams })).toContain("blog-unavailable");
    expect(vi.mocked(getBlogPosts).mock.calls.map((c) => JSON.stringify(c))).toEqual(Array(2).fill('["en",{"page":2,"pageSize":12}]'));

    vi.mocked(getBlogPosts).mockResolvedValue({ status: "missing" });   // the page answers 404 for it: no canonical for a URL that is not there
    expect(await indexMetadata({ searchParams: { locale: "zz" } })).toEqual({ robots: { index: false } });

    vi.mocked(getBlogPosts).mockResolvedValue(list(3, 30, 2));
    expect(await indexMetadata({ searchParams })).toMatchObject({ alternates: { canonical: "https://www.thebha.test/blog?locale=en&page=2" } });
    expect((await indexMetadata({ searchParams })).robots).toBeUndefined();

    vi.mocked(getBlogPosts).mockResolvedValue(list(0));
    const empty = await indexMetadata({ searchParams: {} });
    expect(empty.robots).toBeUndefined();
    expect(empty.alternates).toBeDefined();
  });
});

describe("/blog/category/{slug}", () => {
  it("shows the category's own texts and its posts in the API's order, paginated within the category", async () => {
    vi.mocked(getBlogCategory).mockResolvedValue({ status: "ok", value: category("diem-den", "Điểm đến") });
    vi.mocked(getBlogPosts).mockResolvedValue(list(12, 25));
    const html = await renderPage(BlogCategoryPage, { params: { slug: "diem-den" }, searchParams: { locale: "vi" } });

    expect(vi.mocked(getBlogPosts).mock.calls[0]).toEqual(["vi", { category: "diem-den", page: 1, pageSize: 12 }]);
    expect(html).toMatch(/<h1[^>]*>Điểm đến<\/h1>/);
    expect(html).toContain('href="/blog/category/diem-den?locale=vi&amp;page=2"');
    expect(html).toContain('aria-current="page"');                                          // the category chip
  });

  it("is a 404 for an unknown category, a redirect to the current slug for a moved one, an error message for a failed read", async () => {
    vi.mocked(getBlogCategory).mockResolvedValue({ status: "missing" });
    await expect(renderPage(BlogCategoryPage, { params: { slug: "khong-co" }, searchParams: { locale: "vi" } })).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(getBlogCategory).mockResolvedValue({ status: "moved", slug: "moi" });
    await expect(renderPage(BlogCategoryPage, { params: { slug: "cu" }, searchParams: { locale: "vi", page: "2" } })).rejects.toThrow("NEXT_REDIRECT:/blog/category/moi?locale=vi&page=2");
    vi.mocked(getBlogCategory).mockResolvedValue({ status: "error" });
    expect(await renderPage(BlogCategoryPage, { params: { slug: "diem-den" }, searchParams: {} })).toContain("blog-unavailable");
    await expect(renderPage(BlogCategoryPage, { params: { slug: "Bad Slug" }, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
