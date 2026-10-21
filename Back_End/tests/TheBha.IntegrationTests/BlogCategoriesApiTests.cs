using System.Net;

namespace TheBha.IntegrationTests;

/// <summary>BHA-BLOG-001-CP01: categories and the Blog settings — create, edit with slug history, delete only when nothing refers to them.</summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogCategoriesApiTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    [Fact]
    public async Task The_featured_destinations_category_and_the_settings_row_exist_from_the_migration_seed()
    {
        using var host = await StartBlogAsync();
        var categories = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/categories", host.Cookie(Both)))));
        var featured = categories.EnumerateArray().Single();
        Assert.Equal(FeaturedCategory, featured.GetProperty("id").GetGuid());
        Assert.Equal("featured-destinations", featured.GetProperty("systemKey").GetString());
        Assert.True(featured.GetProperty("isHomeSection").GetBoolean());
        Assert.Equal("Điểm đến nổi bật", featured.GetProperty("translations").GetProperty("vi").GetProperty("name").GetString());
        Assert.Equal("diem-den-noi-bat", featured.GetProperty("translations").GetProperty("vi").GetProperty("slug").GetString());
        Assert.Equal("Featured destinations", featured.GetProperty("translations").GetProperty("en").GetProperty("name").GetString());
        var settings = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/settings", host.Cookie(Both)))));
        Assert.Equal(FeaturedCategory, settings.GetProperty("homeSectionCategoryId").GetGuid());

        // No post, picture or figure is seeded.
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPosts" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogMedia" """));

        // The seed is idempotent. It also covers a language installed after it first ran (French exists now, with no text yet), and
        // nothing else: running it a second time changes nothing.
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategoryTranslations" """));
        await ExecuteAsync(TheBha.Infrastructure.Persistence.BlogSeed.Sql);
        await ExecuteAsync(TheBha.Infrastructure.Persistence.BlogSeed.Sql);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategories" """));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategoryTranslations" """));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategorySlugs" WHERE "IsCurrent" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogSettings" """));
        Assert.Equal("destinations-phares", await ScalarAsync<string>("""SELECT "Slug" FROM "BlogCategoryTranslations" WHERE "Locale" = 'fr' """));
    }

    [Fact]
    public async Task A_category_is_created_edited_with_slug_history_and_slugs_never_collide_per_language()
    {
        using var host = await StartBlogAsync();
        var created = await CreateCategoryAsync(host, "am-thuc", "Ẩm thực");
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal(1, created.GetProperty("version").GetInt32());
        Assert.Equal("Ẩm thực", created.GetProperty("translations").GetProperty("vi").GetProperty("name").GetString());

        var clash = await CreateCategoryAsync(host, "am-thuc", "Trùng", expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.slug-taken", clash.GetProperty("code").GetString());
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategories" WHERE "SystemKey" IS NULL """));

        // Rename: the old address becomes a redirect owned by this category; another category cannot take it.
        var edited = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{id}/save", new
        {
            expectedVersion = 1,
            sortOrder = 5,
            translations = new Dictionary<string, object> { ["vi"] = new { name = "Món ngon", slug = "mon-ngon", description = (string?)null } }
        }, host.Cookie(Publisher)))));
        Assert.Equal(2, edited.GetProperty("version").GetInt32());
        Assert.Equal(5, edited.GetProperty("sortOrder").GetInt32());
        Assert.Equal("mon-ngon", edited.GetProperty("translations").GetProperty("vi").GetProperty("slug").GetString());
        Assert.Equal("am-thuc-en", edited.GetProperty("translations").GetProperty("en").GetProperty("slug").GetString());

        var media = await UploadAsync(host, host.Cookie(Editor));
        await PublishedAsync(host, media, "pho", "Phở", "vi", null, id);
        var moved = await AssertStatusAsync(HttpStatusCode.MovedPermanently, PublicAsync(host, "/categories/am-thuc?locale=vi"));
        Assert.Equal("/api/v1/website/blog/categories/mon-ngon?locale=vi", moved.Headers.Location!.OriginalString);
        Assert.Equal("Món ngon", (await PublicOkAsync(host, "/categories/mon-ngon?locale=vi")).GetProperty("name").GetString());
        var retaken = await CreateCategoryAsync(host, "am-thuc", "Cướp", new Dictionary<string, object> { ["vi"] = new { name = "Cướp", slug = "am-thuc" } }, expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.slug-taken", retaken.GetProperty("code").GetString());

        // The category can go back to its old address (it is its own).
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{id}/save", new
        {
            expectedVersion = 2,
            sortOrder = 5,
            translations = new Dictionary<string, object> { ["vi"] = new { name = "Ẩm thực", slug = "am-thuc" } }
        }, host.Cookie(Publisher))));
        Assert.Equal(HttpStatusCode.OK, (await PublicAsync(host, "/categories/am-thuc?locale=vi")).StatusCode);
        Assert.Equal(HttpStatusCode.MovedPermanently, (await PublicAsync(host, "/categories/mon-ngon?locale=vi")).StatusCode);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategorySlugs" WHERE "Locale" = 'vi' AND "IsCurrent" AND "CategoryId" = (SELECT "Id" FROM "BlogCategories" WHERE "SystemKey" IS NULL) """));
    }

    [Fact]
    public async Task Category_input_is_validated_and_a_stale_or_unknown_category_is_refused()
    {
        using var host = await StartBlogAsync();
        var bad = new (string Name, Dictionary<string, object> Translations, string Code)[]
        {
            ("no language", new Dictionary<string, object>(), "blog.validation"),
            ("unknown language", new Dictionary<string, object> { ["de"] = new { name = "x", slug = "xx" } }, "blog.locale-unsupported"),
            ("empty name", new Dictionary<string, object> { ["vi"] = new { name = " ", slug = "xx" } }, "blog.validation"),
            ("markup in name", new Dictionary<string, object> { ["vi"] = new { name = "<b>x</b>", slug = "xx" } }, "blog.validation"),
            ("bad slug", new Dictionary<string, object> { ["vi"] = new { name = "x", slug = "Bad Slug" } }, "blog.slug-invalid"),
            ("reserved slug", new Dictionary<string, object> { ["vi"] = new { name = "x", slug = "category" } }, "blog.slug-invalid"),
            ("long description", new Dictionary<string, object> { ["vi"] = new { name = "x", slug = "xx", description = new string('d', 301) } }, "blog.validation")
        };
        foreach (var (name, translations, code) in bad)
        {
            var response = await CreateCategoryAsync(host, "unused", translations: translations, expected: HttpStatusCode.BadRequest);
            Assert.True(code == response.GetProperty("code").GetString(), $"{name}: {response}");
        }

        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogCategories" """));
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/save", new { expectedVersion = 9, sortOrder = 1, translations = new Dictionary<string, object>() }, host.Cookie(Publisher))));
        Assert.Equal("blog.stale-version", (await ProblemOf(stale)).Code);
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminPost($"/categories/{Guid.NewGuid()}/save", new { expectedVersion = 1, sortOrder = 1, translations = new Dictionary<string, object>() }, host.Cookie(Publisher))));
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet($"/categories/{Guid.NewGuid()}/pins", host.Cookie(Both))));
    }

    [Fact]
    public async Task A_category_that_something_refers_to_cannot_be_deleted_and_an_unused_one_can()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var used = (await CreateCategoryAsync(host, "dang-dung")).GetProperty("id").GetGuid();
        var spare = (await CreateCategoryAsync(host, "du")).GetProperty("id").GetGuid();
        var (id, version) = await PublishedAsync(host, media, "bai-1", "Bài", "vi", null, used);

        // Used by a published revision.
        var inUse = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{used}/delete", new { expectedVersion = 1 }, host.Cookie(Publisher))));
        Assert.Equal("blog.category-in-use", (await ProblemOf(inUse)).Code);

        // Still used after the post moves to another category, because the old revision keeps it (history can be restored).
        var moved = await SaveDraftAsync(host, id, "vi", version, Draft(media, "bai-1", "Bài", null, spare));
        await TransitionAsync(host, id, "vi", "publish", Version(moved, "vi"));
        await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{used}/delete", new { expectedVersion = 1 }, host.Cookie(Publisher))));

        // The home section's category cannot go while it feeds the section.
        var section = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/delete", new { expectedVersion = 1 }, host.Cookie(Publisher))));
        Assert.Equal("blog.category-in-use", (await ProblemOf(section)).Code);

        // A category nothing refers to goes, with its texts and addresses; a stale version first is refused.
        var unused = (await CreateCategoryAsync(host, "bo-di")).GetProperty("id").GetGuid();
        await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/categories/{unused}/delete", new { expectedVersion = 7 }, host.Cookie(Publisher))));
        await AssertStatusAsync(HttpStatusCode.NoContent, SendAsync(host, AdminPost($"/categories/{unused}/delete", new { expectedVersion = 1 }, host.Cookie(Publisher))));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{unused}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*) FROM "BlogCategorySlugs" WHERE "CategoryId" = '{unused}' """));
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminPost($"/categories/{unused}/delete", new { expectedVersion = 1 }, host.Cookie(Publisher))));

        // The category list reports how much refers to each.
        var list = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/categories", host.Cookie(Both)))));
        Assert.Equal(2, list.EnumerateArray().Single(c => c.GetProperty("id").GetGuid() == used).GetProperty("revisionCount").GetInt32() + 1);
    }

    [Fact]
    public async Task The_blog_settings_are_versioned_and_name_an_existing_category()
    {
        using var host = await StartBlogAsync();
        var other = (await CreateCategoryAsync(host, "khac")).GetProperty("id").GetGuid();
        var settings = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/settings", host.Cookie(Both)))));
        var version = settings.GetProperty("version").GetInt32();

        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost("/settings/save", new { expectedVersion = version + 3, homeSectionCategoryId = other }, host.Cookie(Publisher))));
        Assert.Equal("blog.stale-version", (await ProblemOf(stale)).Code);
        var missing = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminPost("/settings/save", new { expectedVersion = version, homeSectionCategoryId = Guid.NewGuid() }, host.Cookie(Publisher))));
        Assert.Equal("blog.category-missing", (await ProblemOf(missing)).Code);

        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost("/settings/save", new { expectedVersion = version, homeSectionCategoryId = other }, host.Cookie(Publisher)))));
        Assert.Equal(other, saved.GetProperty("homeSectionCategoryId").GetGuid());
        Assert.Equal(version + 1, saved.GetProperty("version").GetInt32());
        // The old section category is free to be deleted now only if nothing else refers to it; it has no content, so it can.
        await AssertStatusAsync(HttpStatusCode.NoContent, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/delete", new { expectedVersion = 1 }, host.Cookie(Publisher))));
        // With the section pointing at nothing, the public section is empty and has no category.
        var cleared = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost("/settings/save", new { expectedVersion = version + 1, homeSectionCategoryId = (Guid?)null }, host.Cookie(Publisher)))));
        Assert.Equal(System.Text.Json.JsonValueKind.Null, cleared.GetProperty("homeSectionCategoryId").ValueKind);
        var section = await PublicOkAsync(host, "/home-section?locale=vi");
        Assert.Equal(System.Text.Json.JsonValueKind.Null, section.GetProperty("category").ValueKind);
        Assert.Empty(section.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task The_post_list_filters_by_search_category_status_and_language_and_pages()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var other = (await CreateCategoryAsync(host, "khac")).GetProperty("id").GetGuid();
        var a = (await PublishedAsync(host, media, "ngu-hanh-son", "Ngũ Hành Sơn")).Id;
        var b = PostId(await CreatePostAsync(host, Draft(media, "ban-dao-son-tra", "Bán đảo Sơn Trà", null, other)));
        var c = PostId(await CreatePostAsync(host, Draft(media, "co-do-hue", "Cố đô Huế")));
        await SaveDraftAsync(host, a, "en", 0, Draft(media, "marble-mountains", "Marble Mountains"));

        async Task<string[]> Ids(string query) =>
            (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts" + query, host.Cookie(Both))))))
            .GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).OrderBy(x => x).ToArray();

        string[] Sorted(params Guid[] ids) => ids.Select(i => i.ToString()).OrderBy(x => x).ToArray();
        Assert.Equal(Sorted(a, b, c), await Ids(""));
        Assert.Equal(Sorted(a), await Ids("?status=Published"));
        // A post matches a status when any of its translations has it: the English draft of the first post counts.
        Assert.Equal(Sorted(a, b, c), await Ids("?status=Draft"));
        Assert.Equal(Sorted(a), await Ids("?status=Draft&locale=en"));
        Assert.Equal(Sorted(b, c), await Ids("?status=Draft&locale=vi"));
        Assert.Equal(Sorted(b), await Ids($"?categoryId={other}"));
        Assert.Equal(Sorted(a, c), await Ids($"?categoryId={FeaturedCategory}"));
        Assert.Equal(Sorted(a), await Ids("?q=ng%C5%A9"));
        Assert.Equal(Sorted(b), await Ids("?q=s%C6%A1n-tr%C3%A0".Replace("%C6%A1n-tr%C3%A0", "on-tra")));
        Assert.Equal(Sorted(a), await Ids("?locale=en"));
        Assert.Equal(Sorted(a), await Ids("?q=marble"));
        Assert.Equal([], await Ids("?q=khong-co-bai-nao"));

        var page1 = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?pageSize=2&page=1", host.Cookie(Both)))));
        var page2 = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?pageSize=2&page=2", host.Cookie(Both)))));
        Assert.Equal(3, page1.GetProperty("total").GetInt32());
        Assert.Equal(2, page1.GetProperty("items").GetArrayLength());
        Assert.Equal(1, page2.GetProperty("items").GetArrayLength());
        var row = page1.GetProperty("items").EnumerateArray().Concat(page2.GetProperty("items").EnumerateArray()).Single(i => i.GetProperty("id").GetGuid() == a);
        Assert.Equal(["en", "vi"], row.GetProperty("translations").EnumerateArray().Select(t => t.GetProperty("locale").GetString()).Order().ToArray());

        await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminGet("/posts?status=Nope", host.Cookie(Both))));
        await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminGet("/posts?locale=de", host.Cookie(Both))));
    }
}
