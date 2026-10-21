using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP01: the public read side — ordering (pinned first, then newest, with a total tie-break), pagination without repeats, the category
/// the home section follows by id, strict languages, and revalidation. Against real PostgreSQL through the real routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogPublicReadApiTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    private async Task<List<Guid>> PublishSeriesAsync(BlogHost host, Guid media, int count, string prefix = "bai", params Guid[] categories)
    {
        var ids = new List<Guid>();
        for (var i = 1; i <= count; i++)
        {
            Advance(TimeSpan.FromMinutes(1));
            ids.Add((await PublishedAsync(host, media, $"{prefix}-{i}", $"Bài {i}", "vi", null, categories)).Id);
        }

        return ids;
    }

    private async Task PinAsync(BlogHost host, Guid category, params Guid[] postIds)
    {
        var current = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/categories/{category}/pins", host.Cookie(Both)))))).GetProperty("version").GetInt32();
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{category}/pins/save", new { expectedVersion = current, postIds }, host.Cookie(Publisher))));
    }

    [Fact]
    public async Task A_category_lists_pinned_posts_first_in_their_saved_order_then_the_newest_each_once()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var ids = await PublishSeriesAsync(host, media, 7);
        await PinAsync(host, FeaturedCategory, ids[4], ids[1]);

        var all = new List<string>();
        for (var page = 1; page <= 3; page++)
        {
            var list = await PublicOkAsync(host, $"/posts?locale=vi&category=diem-den-noi-bat&page={page}&pageSize=3");
            Assert.Equal(7, list.GetProperty("total").GetInt32());
            all.AddRange(Slugs(list));
        }

        Assert.Equal(["bai-5", "bai-2", "bai-7", "bai-6", "bai-4", "bai-3", "bai-1"], all);
        Assert.Equal(7, all.Distinct().Count());

        // Without a category there are no pins: newest first.
        Assert.Equal(["bai-7", "bai-6", "bai-5", "bai-4", "bai-3", "bai-2", "bai-1"], Slugs(await PublicOkAsync(host, "/posts?locale=vi&pageSize=50")));

        // The pin belongs to the category: another category lists its own posts by date alone.
        var other = (await CreateCategoryAsync(host, "am-thuc")).GetProperty("id").GetGuid();
        var inOther = await PublishedAsync(host, media, "mon-ngon", "Món ngon", "vi", null, other, FeaturedCategory);
        Assert.Equal(["mon-ngon"], Slugs(await PublicOkAsync(host, "/posts?locale=vi&category=am-thuc")));
        // A post in two categories is listed once without a filter, and once in each category.
        Assert.Equal(1, (await PublicOkAsync(host, "/posts?locale=vi&pageSize=50")).GetProperty("items").EnumerateArray().Count(i => i.GetProperty("slug").GetString() == "mon-ngon"));
        Assert.Equal(8, (await PublicOkAsync(host, "/posts?locale=vi&category=diem-den-noi-bat")).GetProperty("total").GetInt32());
        Assert.Equal(inOther.Id, (await PublicOkAsync(host, "/posts/mon-ngon?locale=vi")).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Posts_published_at_the_same_instant_still_page_in_one_stable_order_without_repeats()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        for (var i = 0; i < 9; i++)
        {
            await PublishedAsync(host, media, $"cung-luc-{i}", $"Cùng lúc {i}");
        }

        var seen = new List<string>();
        for (var page = 1; page <= 5; page++)
        {
            seen.AddRange(Slugs(await PublicOkAsync(host, $"/posts?locale=vi&category=diem-den-noi-bat&page={page}&pageSize=2")));
        }

        Assert.Equal(9, seen.Count);
        Assert.Equal(9, seen.Distinct().Count());
        var again = (await PublicOkAsync(host, "/posts?locale=vi&category=diem-den-noi-bat&pageSize=50")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("slug").GetString()).ToList();
        Assert.Equal(seen, again);
        Assert.Empty(Slugs(await PublicOkAsync(host, "/posts?locale=vi&page=99")));
    }

    [Fact]
    public async Task Page_size_is_capped_and_a_page_below_one_is_the_first()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        await PublishSeriesAsync(host, media, 3);
        var capped = await PublicOkAsync(host, "/posts?locale=vi&pageSize=5000&page=-4");
        Assert.Equal(50, capped.GetProperty("pageSize").GetInt32());
        Assert.Equal(1, capped.GetProperty("page").GetInt32());
        Assert.Equal(3, capped.GetProperty("items").GetArrayLength());
        Assert.Equal(1, (await PublicOkAsync(host, "/posts?locale=vi&pageSize=0")).GetProperty("pageSize").GetInt32());
    }

    [Fact]
    public async Task The_home_section_is_the_settings_category_by_id_limited_pinned_first_and_survives_a_rename()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        Assert.Empty((await PublicOkAsync(host, "/home-section?locale=vi")).GetProperty("items").EnumerateArray());
        Assert.Equal("Điểm đến nổi bật", (await PublicOkAsync(host, "/home-section?locale=vi")).GetProperty("category").GetProperty("name").GetString());

        var ids = await PublishSeriesAsync(host, media, 8);
        await PinAsync(host, FeaturedCategory, ids[0]);
        var section = await PublicOkAsync(host, "/home-section?locale=vi");
        Assert.Equal(["bai-1", "bai-8", "bai-7", "bai-6", "bai-5", "bai-4"], Slugs(section));
        Assert.Equal(8, section.GetProperty("category").GetProperty("postCount").GetInt32());
        Assert.Equal(3, (await PublicOkAsync(host, "/home-section?locale=vi&limit=3")).GetProperty("items").GetArrayLength());
        Assert.Equal(8, (await PublicOkAsync(host, "/home-section?locale=vi&limit=99")).GetProperty("items").GetArrayLength());

        // Rename the category (name and address): the section still follows it, because it is linked by id.
        var category = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/categories", host.Cookie(Both)))))).EnumerateArray().Single();
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/save", new
        {
            expectedVersion = category.GetProperty("version").GetInt32(),
            sortOrder = 10,
            translations = new Dictionary<string, object> { ["vi"] = new { name = "Nơi nên đến", slug = "noi-nen-den", description = "Mô tả mới" } }
        }, host.Cookie(Publisher))));
        var renamed = await PublicOkAsync(host, "/home-section?locale=vi");
        Assert.Equal("Nơi nên đến", renamed.GetProperty("category").GetProperty("name").GetString());
        Assert.Equal("noi-nen-den", renamed.GetProperty("category").GetProperty("slug").GetString());
        Assert.Equal(6, renamed.GetProperty("items").GetArrayLength());
        // Posts carry the new category address, and the old one redirects.
        Assert.Equal("noi-nen-den", (await PublicOkAsync(host, "/posts/bai-1?locale=vi")).GetProperty("primaryCategory").GetProperty("slug").GetString());
        await AssertStatusAsync(HttpStatusCode.MovedPermanently, PublicAsync(host, "/categories/diem-den-noi-bat?locale=vi"));
        Assert.Equal(8, (await PublicOkAsync(host, "/posts?locale=vi&category=noi-nen-den")).GetProperty("total").GetInt32());

        // Point the section at another category: it follows the id it is given.
        var other = (await CreateCategoryAsync(host, "tin-tuc")).GetProperty("id").GetGuid();
        await PublishedAsync(host, media, "tin-1", "Tin một", "vi", null, other);
        var settings = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/settings", host.Cookie(Both)))));
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost("/settings/save", new { expectedVersion = settings.GetProperty("version").GetInt32(), homeSectionCategoryId = other }, host.Cookie(Publisher))));
        Assert.Equal(["tin-1"], Slugs(await PublicOkAsync(host, "/home-section?locale=vi")));
    }

    [Fact]
    public async Task Unpublishing_removes_a_post_from_the_section_and_a_pin_returns_with_it_when_published_again()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var ids = await PublishSeriesAsync(host, media, 3);
        await PinAsync(host, FeaturedCategory, ids[0]);
        Assert.Equal(["bai-1", "bai-3", "bai-2"], Slugs(await PublicOkAsync(host, "/home-section?locale=vi")));

        var version = Version(await GetPostAsync(host, ids[0]), "vi");
        var down = await TransitionAsync(host, ids[0], "vi", "unpublish", version);
        Assert.Equal(["bai-3", "bai-2"], Slugs(await PublicOkAsync(host, "/home-section?locale=vi")));
        var pins = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/categories/{FeaturedCategory}/pins", host.Cookie(Both)))));
        Assert.False(pins.GetProperty("pins")[0].GetProperty("effective").GetBoolean());

        await TransitionAsync(host, ids[0], "vi", "publish", Version(down, "vi"));
        Assert.Equal(["bai-1", "bai-3", "bai-2"], Slugs(await PublicOkAsync(host, "/home-section?locale=vi")));
    }

    [Fact]
    public async Task Pins_need_a_published_post_in_that_category_a_current_version_and_no_duplicates()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var other = (await CreateCategoryAsync(host, "khac")).GetProperty("id").GetGuid();
        var live = (await PublishedAsync(host, media, "da-dang")).Id;
        var draftOnly = PostId(await CreatePostAsync(host, Draft(media, "chua-dang")));
        var elsewhere = (await PublishedAsync(host, media, "o-noi-khac", "Nơi khác", "vi", null, other)).Id;
        var version = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/categories/{FeaturedCategory}/pins", host.Cookie(Both)))))).GetProperty("version").GetInt32();

        foreach (var bad in new[] { draftOnly, elsewhere, Guid.NewGuid() })
        {
            var refused = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = version, postIds = new[] { bad } }, host.Cookie(Publisher))));
            Assert.Equal("blog.pin-not-published", (await ProblemOf(refused)).Code);
        }

        var duplicate = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = version, postIds = new[] { live, live } }, host.Cookie(Publisher))));
        Assert.Equal("postIds", (await ProblemOf(duplicate)).Field);
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = version + 5, postIds = new[] { live } }, host.Cookie(Publisher))));
        Assert.Equal("blog.stale-version", (await ProblemOf(stale)).Code);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategoryPins" """));

        var ok = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = version, postIds = new[] { live } }, host.Cookie(Publisher))));
        Assert.Equal(version + 1, (await JsonAsync(ok)).GetProperty("version").GetInt32());
        // Clearing the list removes the pin; the same stale version is now refused.
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = version + 1, postIds = Array.Empty<Guid>() }, host.Cookie(Publisher))));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategoryPins" """));
        await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/pins/save", new { expectedVersion = version, postIds = new[] { live } }, host.Cookie(Publisher))));
    }

    [Fact]
    public async Task Each_language_sees_only_its_own_published_translation_and_the_alternates_are_published_ones()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, viVersion) = await PublishedAsync(host, media, "bai-viet", "Tiếng Việt");
        _ = viVersion;

        // English exists only as a draft: not listed, not found, no alternate.
        var en = await SaveDraftAsync(host, id, "en", 0, Draft(media, "article", "English"));
        Assert.Empty(Slugs(await PublicOkAsync(host, "/posts?locale=en")));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/article?locale=en"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/bai-viet?locale=en"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/article?locale=vi"));
        Assert.Empty((await PublicOkAsync(host, "/posts/bai-viet?locale=vi")).GetProperty("alternates").EnumerateArray());
        Assert.Empty((await PublicOkAsync(host, "/categories?locale=en")).GetProperty("items").EnumerateArray());

        await TransitionAsync(host, id, "en", "publish", Version(en, "en"));
        Assert.Equal(["article"], Slugs(await PublicOkAsync(host, "/posts?locale=en")));
        Assert.Equal(["bai-viet"], Slugs(await PublicOkAsync(host, "/posts?locale=vi")));
        var vi = await PublicOkAsync(host, "/posts/bai-viet?locale=vi");
        Assert.Equal("Tiếng Việt", vi.GetProperty("title").GetString());
        Assert.Equal([("en", "article")], vi.GetProperty("alternates").EnumerateArray().Select(a => (a.GetProperty("locale").GetString()!, a.GetProperty("slug").GetString()!)).ToArray());
        var english = await PublicOkAsync(host, "/posts/article?locale=en");
        Assert.Equal("English", english.GetProperty("title").GetString());
        Assert.Equal("featured-destinations", english.GetProperty("primaryCategory").GetProperty("slug").GetString());
        Assert.Equal("Featured destinations", english.GetProperty("primaryCategory").GetProperty("name").GetString());
        Assert.Equal([("vi", "bai-viet")], english.GetProperty("alternates").EnumerateArray().Select(a => (a.GetProperty("locale").GetString()!, a.GetProperty("slug").GetString()!)).ToArray());

        // No language is guessed: with no locale the default (Vietnamese) answers; a Vietnamese address under English is not found.
        Assert.Equal(["bai-viet"], Slugs(await PublicOkAsync(host, "/posts")));
        Assert.Equal(["article"], Slugs(await PublicOkAsync(host, "/posts?locale=EN")));

        // Unpublishing the English one removes its alternate from the Vietnamese page.
        await TransitionAsync(host, id, "en", "unpublish", Version(await GetPostAsync(host, id), "en"));
        Assert.Empty((await PublicOkAsync(host, "/posts/bai-viet?locale=vi")).GetProperty("alternates").EnumerateArray());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/article?locale=en"));
    }

    [Fact]
    public async Task An_unknown_or_inactive_language_is_a_clear_400_and_never_falls_back()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, _) = await PublishedAsync(host, media, "bai-vi");
        var en = await SaveDraftAsync(host, id, "en", 0, Draft(media, "article-en", "English"));
        await TransitionAsync(host, id, "en", "publish", Version(en, "en"));

        foreach (var locale in new[] { "de", "xx", "vi-VN", "e n", "<script>" })
        {
            foreach (var path in new[] { "/posts", "/posts/bai-vi", "/categories", "/categories/diem-den-noi-bat", "/home-section" })
            {
                var response = await AssertStatusAsync(HttpStatusCode.BadRequest, PublicAsync(host, $"{path}?locale={Uri.EscapeDataString(locale)}"));
                Assert.Equal(("blog.locale-unsupported", "locale"), await ProblemOf(response));
            }
        }

        // English is published but the language is switched off: nothing of it is public.
        await ExecuteAsync("""UPDATE "WebsiteLanguages" SET "IsActive" = false WHERE "NormalizedCode" = 'en' """);
        await AssertStatusAsync(HttpStatusCode.BadRequest, PublicAsync(host, "/posts?locale=en"));
        await AssertStatusAsync(HttpStatusCode.BadRequest, PublicAsync(host, "/posts/article-en?locale=en"));
        // And the Vietnamese page stops advertising it.
        Assert.Empty((await PublicOkAsync(host, "/posts/bai-vi?locale=vi")).GetProperty("alternates").EnumerateArray());
    }

    [Fact]
    public async Task Answers_are_revalidated_and_an_unpublish_is_visible_on_the_very_next_request()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "bo-nho-dem");

        foreach (var path in new[] { "/posts?locale=vi", "/posts/bo-nho-dem?locale=vi", "/categories?locale=vi", "/categories/diem-den-noi-bat?locale=vi", "/home-section?locale=vi" })
        {
            var first = await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, path));
            Assert.Equal("no-cache", first.Headers.CacheControl!.ToString());
            var etag = first.Headers.ETag!.ToString();
            Assert.StartsWith("W/\"", etag);
            Assert.Equal(HttpStatusCode.NotModified, (await PublicAsync(host, path, etag)).StatusCode);
            Assert.Equal(etag, (await PublicAsync(host, path)).Headers.ETag!.ToString());
        }

        var tag = (await PublicAsync(host, "/posts/bo-nho-dem?locale=vi")).Headers.ETag!.ToString();
        var listTag = (await PublicAsync(host, "/posts?locale=vi")).Headers.ETag!.ToString();
        await TransitionAsync(host, id, "vi", "unpublish", version);

        // The validator that was good a moment ago no longer matches: the page is gone, the list changed. Nothing stale is served.
        var gone = await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/bo-nho-dem?locale=vi", tag));
        Assert.Equal("no-store", gone.Headers.CacheControl!.ToString());
        var list = await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts?locale=vi", listTag));
        Assert.NotEqual(listTag, list.Headers.ETag!.ToString());
        Assert.Empty((await JsonAsync(list)).GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task A_picture_is_public_only_while_a_published_article_uses_it_and_is_served_with_safe_headers()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var unused = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "co-anh");

        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{unused}"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{Guid.NewGuid()}"));
        var file = await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, $"/media/{media}"));
        Assert.Equal("image/png", file.Content.Headers.ContentType!.MediaType);
        Assert.Equal("public, max-age=300", file.Headers.CacheControl!.ToString());
        Assert.Equal("nosniff", file.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal((await file.Content.ReadAsByteArrayAsync()).Length, new FileInfo(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", "cover.png")).Length);

        // A picture used only by a draft is not public either, even though its id is in the draft.
        var draftOnly = await UploadAsync(host, host.Cookie(Editor));
        await SaveDraftAsync(host, id, "vi", version, Draft(draftOnly, "co-anh"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{draftOnly}"));
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, $"/media/{media}"));

        // The editor can still see every picture, through the Staff route.
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{draftOnly}", host.Cookie(Editor))));
        await AssertStatusAsync(HttpStatusCode.Unauthorized, SendAsync(host, AdminGet($"/media/{draftOnly}", null)));

        // The body's own pictures follow the same rule, and the detail names them with a size.
        var body = BodyOf(Paragraph("x"), new JsonObject { ["type"] = "image", ["mediaId"] = unused.ToString(), ["alt"] = "Ảnh trong bài", ["caption"] = "Chú thích" });
        var created = await CreatePostAsync(host, Draft(media, "anh-trong-bai", "Ảnh trong bài", d => d["body"] = body));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{unused}"));
        await TransitionAsync(host, PostId(created), "vi", "publish", 1);
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, $"/media/{unused}"));
        var detail = await PublicOkAsync(host, "/posts/anh-trong-bai?locale=vi");
        Assert.Equal(2, detail.GetProperty("media").EnumerateObject().Count());
        Assert.True(detail.GetProperty("media").GetProperty(unused.ToString()).GetProperty("width").GetInt32() > 0);
        Assert.True(detail.GetProperty("cover").GetProperty("height").GetInt32() > 0);

        // Unpublish the only article that used it: the file is gone from public at once.
        await TransitionAsync(host, PostId(created), "vi", "unpublish", Version(await GetPostAsync(host, PostId(created)), "vi"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{unused}"));
    }

    [Fact]
    public async Task The_og_image_is_public_with_the_post_and_text_that_looks_like_markup_comes_back_as_inert_text()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var og = await UploadAsync(host, host.Cookie(Editor));
        await PublishedAsync(host, media, "chia-se", "Tiêu đề & \"dấu\" 'nháy'", "vi", d => d["ogImageMediaId"] = og.ToString());
        var detail = await PublicOkAsync(host, "/posts/chia-se?locale=vi");
        Assert.Equal($"/api/v1/website/blog/media/{og}", detail.GetProperty("seo").GetProperty("ogImageUrl").GetString());
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, $"/media/{og}"));
        Assert.Equal("Tiêu đề & \"dấu\" 'nháy'", detail.GetProperty("title").GetString());
    }
}
