import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BHA-BLOG-001-CP04-CP05-C5. These tests use the REAL `@/lib/blog/server` (its fetch, its parsers, its `readOnce`) with only `fetch` replaced, so a metadata
// function that does not ask for what the page asks for is seen as a second request. React's request cache exists only in the server runtime: here it is a
// memo per "request" that `request.reset()` ends — the same key rule (the arguments), the same lifetime (one request).
const request = vi.hoisted(() => {
  const maps: Map<string, unknown>[] = [];
  return { maps, reset: () => maps.forEach((m) => m.clear()) };
});
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<string, unknown>();
    request.maps.push(memo);
    return (...args: A): R => {
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key) as R;
    };
  },
}));
vi.mock("@/lib/api/env", () => ({ getApiBaseUrl: () => "https://api.test" }));
vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/blog/category/diem-den",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderPage } from "@/lib/i18n/testkit";
import BlogCategoryPage, { generateMetadata as categoryMetadata } from "./category/[slug]/page";
import { apiItem } from "@/lib/blog/blogTestkit";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const CATEGORY = { slug: "diem-den", name: "Điểm đến", description: null, postCount: 3 };
const postsOf = (n: number, total = n) => ({ locale: "vi", items: Array.from({ length: n }, (_, i) => apiItem(i + 1)), page: 1, pageSize: 12, total });

describe("/blog/category/{slug}: the metadata and the page read the posts once, and the metadata follows that read", () => {
  const fetchMock = vi.fn();
  let posts: () => Promise<Response>;
  const calls = (needle: string) => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(needle));

  beforeEach(() => {
    request.reset();
    fetchMock.mockReset();
    posts = () => json(postsOf(2));
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/posts?")) return posts();
      if (url.includes("/categories/diem-den")) return json(CATEGORY);
      if (url.includes("/categories?")) return json({ items: [CATEGORY] });
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SITE_URL", "https://www.thebha.test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const props = { params: { slug: "diem-den" }, searchParams: { locale: "en", page: "1" } };

  it("is noindex when the category is read but its posts are not; the page still says it could not load (200, not a 404) and the posts are asked once", async () => {
    posts = () => json({}, 503);
    expect(await categoryMetadata(props)).toEqual({ robots: { index: false } });
    const html = await renderPage(BlogCategoryPage, props);

    expect(html).toContain('data-testid="blog-unavailable"');
    expect(html).toMatch(/<h1[^>]*>Điểm đến<\/h1>/);
    expect(calls("/posts?")).toEqual(["https://api.test/api/v1/website/blog/posts?locale=en&category=diem-den&page=1&pageSize=12"]);
    expect(calls("/categories/diem-den")).toHaveLength(1);
  });

  it("is indexed again when the API is back (the next request), and a working list is indexed from the same single read", async () => {
    posts = () => json({}, 503);
    expect(await categoryMetadata(props)).toEqual({ robots: { index: false } });

    request.reset();
    posts = () => json(postsOf(2));
    fetchMock.mockClear();
    const meta = await categoryMetadata(props);
    const html = await renderPage(BlogCategoryPage, props);
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates).toMatchObject({ canonical: "https://www.thebha.test/blog/category/diem-den?locale=en" });
    expect(html).toContain('data-testid="blog-card"');
    expect(calls("/posts?")).toHaveLength(1);
  });

  it("indexes a category whose list is valid and empty — an empty list is an answer, not a failure", async () => {
    posts = () => json(postsOf(0));
    const meta = await categoryMetadata(props);
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates).toBeDefined();
    expect(await renderPage(BlogCategoryPage, props)).toContain('data-testid="blog-empty"');
    expect(calls("/posts?")).toHaveLength(1);
  });

  it("keeps the page asked for: page 2 is read as page 2 by both, and a missing category stays noindex", async () => {
    const second = { ...props, searchParams: { locale: "en", page: "2" } };
    posts = () => json({ ...postsOf(2, 30), page: 2 });
    const meta = await categoryMetadata(second);
    await renderPage(BlogCategoryPage, second);
    expect(meta.alternates).toMatchObject({ canonical: "https://www.thebha.test/blog/category/diem-den?locale=en&page=2" });
    expect(calls("/posts?")).toEqual(["https://api.test/api/v1/website/blog/posts?locale=en&category=diem-den&page=2&pageSize=12"]);

    request.reset();
    fetchMock.mockImplementation(() => json({}, 404));
    expect(await categoryMetadata(props)).toEqual({ robots: { index: false } });
  });
});
