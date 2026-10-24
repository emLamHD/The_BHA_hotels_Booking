import { describe, expect, it } from "vitest";
import { API, apiCover, apiDetail, apiItem } from "./blogTestkit";
import {
  BLOG_RECOVER_PATH, blogCategoryHref, blogIndexHref, blogRecoverHref, recoverSamePath, blogLocaleOf, blogPostHref, languageTag, lastPageOf, normalizeLocale, parseCategoryList, parseHomeSection, parsePage, parsePostDetail, parsePostItem, parsePostList,
} from "./blog";

const MEDIA = "/api/v1/website/blog/media/aaaaaaaa-0000-0000-0000-000000000001";

describe("what the API serves is read strictly", () => {
  it("makes a picture's address absolute, and only for the API's own Blog media paths", () => {
    expect(parsePostItem(apiItem(1), API)?.cover.url).toBe(`${API}${MEDIA}`);
    expect(parsePostItem(apiItem(1), API)?.cover.variants[0].url).toBe(`${API}${MEDIA}/1/thumb.webp`);
    for (const url of ["https://evil.test/x.png", "/api/v1/website/hero/media/aaaaaaaa-0000-0000-0000-000000000001", "//evil.test/a", "javascript:alert(1)", `${MEDIA}/x`, `${MEDIA}/1/huge.webp`, `${MEDIA}/1/card.gif`, ""]) {
      expect(parsePostItem(apiItem(1, { cover: { ...apiCover(1), url } }), API)).toBeNull();          // a post with no usable cover is not a post
    }
    const noVariantUrl = parsePostItem(apiItem(1, { cover: { ...apiCover(1), variants: [{ ...apiCover(1).variants[0], url: "https://evil.test/a.webp" }, apiCover(1).variants[1]] } }), API)!;
    expect(noVariantUrl.cover.variants).toHaveLength(1);                                              // a foreign variant is dropped, the rest kept
  });

  it("leaves out a card that is not one and keeps the rest; a list that is not a list is null", () => {
    const list = parsePostList({ locale: "vi", items: [apiItem(1), { id: "x" }, apiItem(2, { slug: "Not A Slug" }), apiItem(3)], page: 1, pageSize: 12, total: 4 }, API)!;
    expect(list.items.map((i) => i.slug)).toEqual(["bai-viet-1", "bai-viet-3"]);
    expect(list.total).toBe(4);                                                                       // the total is the API's, not the count that survived
    expect(parsePostList({ hello: "a proxy's page" }, API)).toBeNull();
    expect(parsePostList({ locale: "vi", items: [], page: 0, pageSize: 12, total: 0 }, API)).toBeNull();
    expect(parseCategoryList({ nope: true })).toBeNull();
  });

  it("reads a detail with its media, properties, SEO and alternates (locales normalized), and refuses a half-detail", () => {
    const detail = parsePostDetail(
      apiDetail({
        media: { "AAAAAAAA-0000-0000-0000-000000000009": { url: `${MEDIA.slice(0, -1)}9`, width: 800, height: 600, variants: [] }, "bad": { url: "https://evil.test/x", width: 1, height: 1, variants: [] } },
        properties: { "BBBBBBBB-0000-0000-0000-000000000001": { slug: "the-bha-riverside", name: "The BHA Riverside" } },
        seo: { metaTitle: "Tiêu đề SEO", metaDescription: "", ogImageUrl: MEDIA },
        alternates: [{ locale: "en-US", slug: "article-1" }, { locale: "not a locale", slug: "x" }, { locale: "fr", slug: "Bad Slug" }],
      }),
      API
    )!;
    expect(Object.keys(detail.media)).toEqual(["aaaaaaaa-0000-0000-0000-000000000009"]);
    expect(detail.properties["bbbbbbbb-0000-0000-0000-000000000001"].slug).toBe("the-bha-riverside");
    expect(detail.seo).toEqual({ metaTitle: "Tiêu đề SEO", metaDescription: null, ogImageUrl: `${API}${MEDIA}` });
    expect(detail.alternates).toEqual([{ locale: "en-us", slug: "article-1" }]);
    expect(parsePostDetail(apiDetail({ body: null }), API)).toBeNull();
    expect(parsePostDetail(apiDetail({ seo: null }), API)).toBeNull();
  });

  it("parses the home section's category and cards, and tolerates a section with no category", () => {
    const section = parseHomeSection({ locale: "vi", category: { slug: "diem-den-noi-bat", name: "Điểm đến nổi bật", description: "x", postCount: 2 }, items: [apiItem(1)] }, API)!;
    expect(section.category?.slug).toBe("diem-den-noi-bat");
    expect(parseHomeSection({ locale: "vi", category: null, items: [] }, API)).toEqual({ locale: "vi", category: null, items: [] });
  });
});

describe("the language of a Blog URL", () => {
  it("normalizes a tag the way the backend does (regional and script keys included) and refuses what is no tag", () => {
    expect(normalizeLocale("en-US")).toBe("en-us");
    expect(normalizeLocale("zh-Hant")).toBe("zh-hant");
    expect(normalizeLocale(" vi ")).toBe("vi");
    for (const bad of ["", "e", "english", "en_US", "en-US-x-private", "../x", "vi;drop"]) expect(normalizeLocale(bad)).toBeNull();
    expect(languageTag("zh-hant")).toBe("zh-Hant");
    expect(languageTag("en-us")).toBe("en-US");
  });

  it("is the explicit ?locale= when there is one, the site's language otherwise, and null for a repeated or malformed one", () => {
    expect(blogLocaleOf("en-US", "vi")).toBe("en-us");
    expect(blogLocaleOf(undefined, "en-US")).toBe("en-us");
    expect(blogLocaleOf(["en", "vi"], "vi")).toBeNull();
    expect(blogLocaleOf("zz zz", "vi")).toBeNull();
  });

  it("keeps the language in every Blog link (page 1 has no ?page=)", () => {
    expect(blogIndexHref("en-us")).toBe("/blog?locale=en-us");
    expect(blogIndexHref("vi", 3)).toBe("/blog?locale=vi&page=3");
    expect(blogCategoryHref("zh-hant", "du-lich", 2)).toBe("/blog/category/du-lich?locale=zh-hant&page=2");
    expect(blogPostHref("fr", "mon-article")).toBe("/blog/mon-article?locale=fr");
  });
});

describe("pages", () => {
  it("accepts a positive integer or nothing, and nothing else", () => {
    expect([parsePage(undefined), parsePage("1"), parsePage("12")]).toEqual([1, 1, 12]);
    for (const bad of ["0", "-1", "1.5", "abc", "01", "", "1e3", ["1", "2"]]) expect(parsePage(bad as string)).toBeNull();
    expect([lastPageOf(0, 12), lastPageOf(12, 12), lastPageOf(13, 12), lastPageOf(25, 12)]).toEqual([1, 1, 2, 3]);
  });
});

describe("the Blog 404 recovery step (C7)", () => {
  const indexes = { vi: "/blog?locale=vi", en: "/blog?locale=en", "en-US": "/blog?locale=en-us" };
  it("is a path of its own that names a language and nothing else", () => {
    expect(BLOG_RECOVER_PATH).toBe("/blog-recover");
    expect(blogRecoverHref("en")).toBe("/blog-recover?locale=en");
    expect(blogRecoverHref("zh-hant")).toBe("/blog-recover?locale=zh-hant");
  });

  it("replaces the Blog index targets only for a reader who is on the index's own pathname", () => {
    expect(recoverSamePath(indexes, "/blog")).toEqual({ vi: "/blog-recover?locale=vi", en: "/blog-recover?locale=en", "en-US": "/blog-recover?locale=en-us" });
    for (const pathname of ["/blog/khong-co", "/blog/category/khong-co", "/", "/faq"]) expect(recoverSamePath(indexes, pathname), pathname).toEqual(indexes);
  });

  it("leaves a target that is not the Blog index, or names no language, as it is", () => {
    const targets = { vi: "/blog/bai-mot?locale=vi", en: "/blog", fr: "/blog/category/diem-den?locale=fr" };
    expect(recoverSamePath(targets, "/blog")).toEqual(targets);
  });
});
