import { describe, expect, it, vi } from "vitest";
import { resolveBlogRedirect } from "./redirects";

const answer = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }));

async function resolve(url: string, fetcher: ReturnType<typeof vi.fn>, cookieLocale?: string) {
  const u = new URL(url, "https://site.test");
  return { target: await resolveBlogRedirect({ pathname: u.pathname, searchParams: u.searchParams, cookieLocale, apiBase: "https://api.test", fetcher: fetcher as unknown as typeof fetch }), fetcher };
}

describe("an old slug is answered with a permanent redirect to the current Customer URL", () => {
  it("sends an old post slug to the current slug in the language the API resolved, never to an /api address", async () => {
    const { target, fetcher } = await resolve("/blog/bai-cu?locale=en-US", vi.fn().mockReturnValue(answer(301, { slug: "new-post", locale: "en-us" })));
    expect(target).toBe("/blog/new-post?locale=en-us");
    expect(target).not.toContain("/api");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.test/api/v1/website/blog/posts/bai-cu?locale=en-us");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", cache: "no-store" });
  });

  it("does the same for a category, keeping the page", async () => {
    const { target } = await resolve("/blog/category/cu?locale=vi&page=2", vi.fn().mockReturnValue(answer(301, { slug: "moi", locale: "vi" })));
    expect(target).toBe("/blog/category/moi?locale=vi&page=2");
  });

  it("uses the visitor's language cookie when the URL has none, and the language of the API's answer when there is neither", async () => {
    expect((await resolve("/blog/bai-cu", vi.fn().mockReturnValue(answer(301, { slug: "moi", locale: "fr" })), "fr")).target).toBe("/blog/moi?locale=fr");
    const none = await resolve("/blog/bai-cu", vi.fn().mockReturnValue(answer(301, { slug: "moi", locale: "vi" })));
    expect(none.target).toBe("/blog/moi?locale=vi");
    expect(String(none.fetcher.mock.calls[0][0])).not.toContain("locale=");                  // the API's default language decides
  });

  it("is one hop: a current slug (the API answers 200) and an unknown one (404) are not redirected, so there is no loop", async () => {
    expect((await resolve("/blog/bai-viet-1?locale=vi", vi.fn().mockReturnValue(answer(200, {})))).target).toBeNull();
    expect((await resolve("/blog/khong-co?locale=vi", vi.fn().mockReturnValue(answer(404)))).target).toBeNull();
  });

  it("leaves the request alone when it cannot decide: an API error, a bad language, a path that is not a Blog address", async () => {
    expect((await resolve("/blog/bai-cu?locale=vi", vi.fn().mockReturnValue(answer(500)))).target).toBeNull();
    expect((await resolve("/blog/bai-cu?locale=vi", vi.fn().mockRejectedValue(new Error("down")))).target).toBeNull();
    expect((await resolve("/blog/bai-cu?locale=not-a-tag!", vi.fn())).target).toBeNull();
    expect((await resolve("/blog/bai-cu?locale=vi", vi.fn().mockReturnValue(answer(301, { slug: "https://evil.test" })))).target).toBeNull();
    const untouched = vi.fn();
    for (const path of ["/offers", "/blog/a/b", "/blog/category", "/blog/Bad_Slug", "/blogger"]) expect((await resolve(path, untouched)).target).toBeNull();
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("the old /blog?category= address", () => {
  it("goes to the category's own page in one hop, to the CURRENT slug when the old one was renamed", async () => {
    expect((await resolve("/blog?category=diem-den&locale=vi", vi.fn().mockReturnValue(answer(200, { slug: "diem-den" })))).target).toBe("/blog/category/diem-den?locale=vi");
    expect((await resolve("/blog?category=cu&locale=vi&page=2", vi.fn().mockReturnValue(answer(301, { slug: "moi", locale: "vi" })))).target).toBe("/blog/category/moi?locale=vi&page=2");
  });

  it("sends an unknown category to that category's page too, which answers 404; without a language it leaves the choice to the page", async () => {
    expect((await resolve("/blog?category=khong-co&locale=vi", vi.fn().mockReturnValue(answer(404)))).target).toBe("/blog/category/khong-co?locale=vi");
    expect((await resolve("/blog?category=diem-den", vi.fn().mockReturnValue(answer(200, {})))).target).toBe("/blog/category/diem-den");
  });

  it("is not a redirect for a plain /blog, nor for a value that is not a slug", async () => {
    const untouched = vi.fn();
    expect((await resolve("/blog?locale=vi", untouched)).target).toBeNull();
    expect((await resolve("/blog?category=A%20B", untouched)).target).toBeNull();
    expect(untouched).not.toHaveBeenCalled();
  });
});
