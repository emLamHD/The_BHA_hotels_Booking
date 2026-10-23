import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/env", () => ({ getApiBaseUrl: () => "https://api.test" }));
// React's request cache only exists inside the server runtime; a test calls the function each time.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { getAllBlogPosts, getBlogCategory, getBlogPost, getBlogPosts } from "./server";
import { apiDetail, apiItem } from "./blogTestkit";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const list = (items: unknown[], total: number, page = 1) => ({ locale: "vi", items, page, pageSize: 50, total });

describe("the server's read of the public Blog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks the public route only: no cookie, no credentials, never cached, a 301 not followed", async () => {
    fetchMock.mockReturnValue(json(apiDetail()));
    await getBlogPost("en-us", "bai-viet-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/api/v1/website/blog/posts/bai-viet-1?locale=en-us");
    expect(init).toMatchObject({ cache: "no-store", redirect: "manual", headers: { Accept: "application/json" } });
    expect(JSON.stringify(init)).not.toMatch(/cookie|credentials|authorization/i);
  });

  it("reads a post, and tells a 404 (missing) from a failure (error): an outage is never shown as 'no such post'", async () => {
    fetchMock.mockReturnValueOnce(json(apiDetail()));
    expect(await getBlogPost("vi", "bai-viet-1")).toMatchObject({ status: "ok", value: { slug: "bai-viet-1" } });

    fetchMock.mockReturnValueOnce(json({}, 404));
    expect(await getBlogPost("vi", "khong-co")).toEqual({ status: "missing" });

    for (const failure of [json({}, 500), json({}, 503), Promise.reject(new Error("connect ECONNREFUSED")), json({ not: "a post" }), Promise.resolve(new Response("<html>proxy error</html>", { status: 200 })), json({ title: "Problem" }, 400)]) {
      fetchMock.mockReturnValueOnce(failure);
      expect(await getBlogPost("vi", "bai-viet-1")).toEqual({ status: "error" });
    }
  });

  it("treats an unsupported language as missing (a real 404), and any other 400 as an error", async () => {
    fetchMock.mockReturnValueOnce(json({ code: "blog.locale-unsupported" }, 400));
    expect(await getBlogPosts("zz")).toEqual({ status: "missing" });
    fetchMock.mockReturnValueOnce(json({ code: "something-else" }, 400));
    expect(await getBlogPosts("vi")).toEqual({ status: "error" });
  });

  it("reads the API's 301 as data: the current slug, never a Location or an /api address", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response(JSON.stringify({ slug: "bai-moi", locale: "vi" }), { status: 301, headers: { Location: "/api/v1/website/blog/posts/bai-moi?locale=vi" } })));
    expect(await getBlogPost("vi", "bai-cu")).toEqual({ status: "moved", slug: "bai-moi" });
    fetchMock.mockReturnValueOnce(json({ slug: "https://evil.test/x" }, 301));
    expect(await getBlogCategory("vi", "cu")).toEqual({ status: "error" });
  });

  it("sends the category and page it was asked for", async () => {
    fetchMock.mockReturnValue(json(list([apiItem(1)], 1)));
    await getBlogPosts("vi", { category: "diem-den", page: 3, pageSize: 12 });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.test/api/v1/website/blog/posts?locale=vi&category=diem-den&page=3&pageSize=12");
  });
});

describe("every post of a language, for the sitemap", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("walks every page of the API, not only the first", async () => {
    const page = (n: number) => Array.from({ length: n === 3 ? 20 : 50 }, (_, i) => apiItem(1, { id: `${n}-${i}`, slug: `p${n}-${i}` }));
    fetchMock.mockImplementation((url: string) => json(list(page(Number(new URL(url).searchParams.get("page"))), 120, Number(new URL(url).searchParams.get("page")))));

    const all = await getAllBlogPosts("vi");

    expect(all).toHaveLength(120);
    expect(new Set(all.map((p) => p.slug)).size).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when any page cannot be read, rather than returning a partial list", async () => {
    fetchMock.mockReturnValueOnce(json(list(Array.from({ length: 50 }, (_, i) => apiItem(1, { id: `x-${i}`, slug: `p-${i}` })), 120)));
    fetchMock.mockReturnValueOnce(json({}, 500));
    await expect(getAllBlogPosts("vi")).rejects.toThrow(/could not be read/);
  });

  it("throws when the API says there is more but sends nothing", async () => {
    fetchMock.mockReturnValueOnce(json(list([apiItem(1)], 120)));
    fetchMock.mockReturnValueOnce(json(list([], 120, 2)));
    await expect(getAllBlogPosts("vi")).rejects.toThrow(/ended early/);
  });
});
