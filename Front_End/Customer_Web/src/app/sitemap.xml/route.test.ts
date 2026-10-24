import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/env", () => ({ getApiBaseUrl: () => "https://api.test" }));
vi.mock("@/lib/blog/server", () => ({ getAllBlogPosts: vi.fn(), getAllBlogCategories: vi.fn() }));
import { GET } from "./route";
import { getAllBlogCategories, getAllBlogPosts } from "@/lib/blog/server";
import { SITEMAP_MAX_BYTES, SITEMAP_MAX_URLS, STATIC_PUBLIC_PATHS } from "@/lib/seo/sitemap";

type Posts = Awaited<ReturnType<typeof getAllBlogPosts>>;
const posts = (count: number, slug = (i: number) => `p${i}`) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, slug: slug(i), modifiedAt: "2026-10-10T03:00:00+00:00" })) as unknown as Posts;
const STATIC_AND_INDEX = STATIC_PUBLIC_PATHS.length + 1;

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://www.thebha.test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ locales: [{ code: "vi" }] }), { status: 200 })));
  vi.mocked(getAllBlogCategories).mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.mocked(getAllBlogPosts).mockReset();
  vi.mocked(getAllBlogCategories).mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const unavailable = async (response: Response) => {
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text();
  expect(body).toBe("The sitemap is not available.");
  expect(body).not.toContain("<urlset");
};

describe("/sitemap.xml and its two limits", () => {
  it("answers 200 with the XML for an ordinary list", async () => {
    vi.mocked(getAllBlogPosts).mockResolvedValue(posts(3));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const xml = await response.text();
    expect(xml).toContain("<urlset");
    expect(xml.match(/<url>/g)).toHaveLength(3 + STATIC_AND_INDEX);
  });

  it("answers 200 at exactly 50,000 URL entries and the controlled error (HTTP 500, no XML) at 50,001", async () => {
    vi.mocked(getAllBlogPosts).mockResolvedValue(posts(SITEMAP_MAX_URLS - STATIC_AND_INDEX));
    const ok = await GET();
    expect(ok.status).toBe(200);
    expect((await ok.text()).match(/<url>/g)).toHaveLength(SITEMAP_MAX_URLS);

    vi.mocked(getAllBlogPosts).mockResolvedValue(posts(SITEMAP_MAX_URLS - STATIC_AND_INDEX + 1));
    await unavailable(await GET());
    expect(vi.mocked(console.error).mock.calls.join(" ")).toMatch(/\[sitemap\] not produced: .*50000 URLs/);
  });

  it("answers the controlled error when the file would pass 52,428,800 bytes, though it has few URLs", async () => {
    // 18 posts of a 3,000,000-character slug: 18 URLs, about 54 MB
    vi.mocked(getAllBlogPosts).mockResolvedValue(posts(18, (i) => String(i).padEnd(3_000_000, "x")));
    await unavailable(await GET());
    expect(vi.mocked(console.error).mock.calls.join(" ")).toMatch(/\[sitemap\] not produced: .*52428800 bytes/);
    expect(SITEMAP_MAX_BYTES).toBe(52_428_800);
  });
});
