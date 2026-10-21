using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP01: draft → public → publish, with the draft/public separation, unpublish/archive/restore, the dates, slugs and redirects,
/// the version guard and races — against real PostgreSQL through the real routes.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogPublicationApiTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    [Fact]
    public async Task A_draft_is_invisible_publishing_makes_the_exact_version_public()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var created = await CreatePostAsync(host, Draft(media, "bai-bien-my-khe"));
        var id = PostId(created);

        Assert.Equal("Draft", Translation(created, "vi").GetProperty("status").GetString());
        Assert.Equal(1, Version(created, "vi"));
        Assert.True(Translation(created, "vi").GetProperty("hasDraft").GetBoolean());
        Assert.Equal(JsonValueKind.Null, Translation(created, "vi").GetProperty("published").ValueKind);

        // Not visible anywhere in public: list, category list, detail, home section, media.
        Assert.Empty((await PublicOkAsync(host, "/posts?locale=vi")).GetProperty("items").EnumerateArray());
        Assert.Empty((await PublicOkAsync(host, "/categories?locale=vi")).GetProperty("items").EnumerateArray());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/bai-bien-my-khe?locale=vi"));
        Assert.Empty((await PublicOkAsync(host, "/home-section?locale=vi")).GetProperty("items").EnumerateArray());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{media}"));

        var published = await TransitionAsync(host, id, "vi", "publish", 1);
        Assert.Equal("Published", Translation(published, "vi").GetProperty("status").GetString());
        Assert.Equal(2, Version(published, "vi"));
        Assert.False(Translation(published, "vi").GetProperty("hasDraft").GetBoolean());

        var detail = await PublicOkAsync(host, "/posts/bai-bien-my-khe?locale=vi");
        Assert.Equal("Bãi biển Mỹ Khê", detail.GetProperty("title").GetString());
        Assert.Equal("Ban biên tập", detail.GetProperty("author").GetString());
        Assert.Equal("Bãi biển Mỹ Khê | The BHA", detail.GetProperty("seo").GetProperty("metaTitle").GetString());
        Assert.Equal("diem-den-noi-bat", detail.GetProperty("primaryCategory").GetProperty("slug").GetString());
        Assert.Equal(2, detail.GetProperty("body").GetProperty("blocks").GetArrayLength());
        Assert.Equal($"/api/v1/website/blog/media/{media}", detail.GetProperty("cover").GetProperty("url").GetString());
        Assert.Single((await PublicOkAsync(host, "/posts?locale=vi")).GetProperty("items").EnumerateArray());
        Assert.Equal("bai-bien-my-khe", Slugs(await PublicOkAsync(host, "/home-section?locale=vi")).Single());
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, $"/media/{media}"));
    }

    [Fact]
    public async Task Editing_the_draft_changes_nothing_public_until_the_next_publish_which_changes_everything_together()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var other = await CreateCategoryAsync(host, "am-thuc");
        var otherId = other.GetProperty("id").GetGuid();
        var (id, version) = await PublishedAsync(host, media, "my-khe", "Tiêu đề cũ");

        var before = await PublicOkAsync(host, "/posts/my-khe?locale=vi");
        var edited = await SaveDraftAsync(host, id, "vi", version, Draft(media, "my-khe-moi", "Tiêu đề mới", d =>
        {
            d["summary"] = "Tóm tắt mới";
            d["metaTitle"] = "SEO mới";
            d["body"] = BodyOf(Paragraph("Nội dung mới"));
        }, otherId));

        // Draft: new content, new slug, new category. Public: byte for byte what it was.
        Assert.Equal("Tiêu đề mới", Translation(edited, "vi").GetProperty("draft").GetProperty("title").GetString());
        Assert.Equal("Tiêu đề cũ", Translation(edited, "vi").GetProperty("published").GetProperty("title").GetString());
        var during = await PublicOkAsync(host, "/posts/my-khe?locale=vi");
        Assert.Equal(before.GetRawText(), during.GetRawText());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/my-khe-moi?locale=vi"));
        Assert.Equal(["diem-den-noi-bat"], (await PublicOkAsync(host, "/categories?locale=vi")).GetProperty("items").EnumerateArray().Select(c => c.GetProperty("slug").GetString()).ToArray());
        Assert.Empty(Slugs(await PublicOkAsync(host, "/posts?locale=vi&category=am-thuc")));
        Assert.Equal(["my-khe"], Slugs(await PublicOkAsync(host, "/posts?locale=vi&category=diem-den-noi-bat")));

        var published = await TransitionAsync(host, id, "vi", "publish", Version(edited, "vi"));
        Assert.Equal(Version(edited, "vi") + 1, Version(published, "vi"));

        var after = await PublicOkAsync(host, "/posts/my-khe-moi?locale=vi");
        Assert.Equal("Tiêu đề mới", after.GetProperty("title").GetString());
        Assert.Equal("Tóm tắt mới", after.GetProperty("summary").GetString());
        Assert.Equal("SEO mới", after.GetProperty("seo").GetProperty("metaTitle").GetString());
        Assert.Equal("am-thuc", after.GetProperty("primaryCategory").GetProperty("slug").GetString());
        Assert.Equal(["my-khe-moi"], Slugs(await PublicOkAsync(host, "/posts?locale=vi&category=am-thuc")));
        Assert.Empty(Slugs(await PublicOkAsync(host, "/posts?locale=vi&category=diem-den-noi-bat")));
        // The old address is now a redirect to the new one, not a copy of the page.
        var moved = await AssertStatusAsync(HttpStatusCode.MovedPermanently, PublicAsync(host, "/posts/my-khe?locale=vi"));
        Assert.Equal("/api/v1/website/blog/posts/my-khe-moi?locale=vi", moved.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task The_published_and_modified_dates_move_only_with_a_publication()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "ngay-thang");
        var first = await PublicOkAsync(host, "/posts/ngay-thang?locale=vi");
        var firstPublished = first.GetProperty("firstPublishedAt").GetDateTimeOffset();
        var modified = first.GetProperty("modifiedAt").GetDateTimeOffset();
        Assert.Equal(firstPublished, modified);

        // Reads, draft saves and a restore do not move either date.
        Advance(TimeSpan.FromMinutes(5));
        await PublicOkAsync(host, "/posts/ngay-thang?locale=vi");
        var saved = await SaveDraftAsync(host, id, "vi", version, Draft(media, "ngay-thang", "Sửa"));
        Assert.Equal(first.GetRawText(), (await PublicOkAsync(host, "/posts/ngay-thang?locale=vi")).GetRawText());

        // Unpublish then publish again as it was: nothing changed, so neither date changed.
        var discard = Translation(await GetPostAsync(host, id), "vi").GetProperty("published").GetProperty("id").GetGuid();
        var restored = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/posts/{id}/translations/vi/revisions/{discard}/restore", new { expectedVersion = Version(saved, "vi") }, host.Cookie(Editor))));
        var afterRestore = await JsonAsync(restored);
        Assert.Equal(first.GetRawText(), (await PublicOkAsync(host, "/posts/ngay-thang?locale=vi")).GetRawText());

        // Publishing the restored draft is a new publication: modified moves, first does not.
        Advance(TimeSpan.FromMinutes(5));
        await TransitionAsync(host, id, "vi", "publish", Version(afterRestore, "vi"));
        var second = await PublicOkAsync(host, "/posts/ngay-thang?locale=vi");
        Assert.Equal(firstPublished, second.GetProperty("firstPublishedAt").GetDateTimeOffset());
        Assert.True(second.GetProperty("modifiedAt").GetDateTimeOffset() > modified);
    }

    [Fact]
    public async Task Unpublish_hides_everywhere_keeps_history_and_republish_restores_it_unchanged()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "an-di");
        var before = await PublicOkAsync(host, "/posts/an-di?locale=vi");

        var unpublished = await TransitionAsync(host, id, "vi", "unpublish", version);
        Assert.Equal("Unpublished", Translation(unpublished, "vi").GetProperty("status").GetString());
        await AssertHiddenAsync(host, "an-di", media);

        // History is intact: the published revision is still there and readable.
        var revisions = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/posts/{id}/translations/vi/revisions", host.Cookie(Both)))));
        var published = revisions.EnumerateArray().Single(r => r.GetProperty("isPublished").GetBoolean());
        Assert.Equal("Frozen", published.GetProperty("state").GetString());

        // Publishing again without changes brings back exactly what was there, with the same dates.
        var again = await TransitionAsync(host, id, "vi", "publish", Version(unpublished, "vi"));
        Assert.Equal("Published", Translation(again, "vi").GetProperty("status").GetString());
        Assert.Equal(before.GetRawText(), (await PublicOkAsync(host, "/posts/an-di?locale=vi")).GetRawText());

        // Nothing to publish now: a stale second publish is refused, not applied twice.
        var nothing = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/posts/{id}/translations/vi/publish", new { expectedVersion = Version(again, "vi") }, host.Cookie(Publisher))));
        Assert.Equal("blog.nothing-to-publish", (await ProblemOf(nothing)).Code);
    }

    [Fact]
    public async Task Archive_hides_blocks_edits_and_unarchive_leaves_it_unpublished()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "luu-tru");

        var archived = await TransitionAsync(host, id, "vi", "archive", version);
        Assert.Equal("Archived", Translation(archived, "vi").GetProperty("status").GetString());
        await AssertHiddenAsync(host, "luu-tru", media);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostRevisions" """));

        var edit = await SaveDraftAsync(host, id, "vi", Version(archived, "vi"), Draft(media, "luu-tru"), expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.archived", edit.GetProperty("code").GetString());
        var publish = await AssertStatusAsync(HttpStatusCode.Conflict, SendAsync(host, AdminPost($"/posts/{id}/translations/vi/publish", new { expectedVersion = Version(archived, "vi") }, host.Cookie(Publisher))));
        Assert.Equal("blog.archived", (await ProblemOf(publish)).Code);

        var back = await TransitionAsync(host, id, "vi", "unarchive", Version(archived, "vi"));
        Assert.Equal("Unpublished", Translation(back, "vi").GetProperty("status").GetString());
        await AssertHiddenAsync(host, "luu-tru", media);
    }

    private async Task AssertHiddenAsync(BlogHost host, string slug, Guid media)
    {
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/posts/{slug}?locale=vi"));
        Assert.Empty((await PublicOkAsync(host, "/posts?locale=vi")).GetProperty("items").EnumerateArray());
        Assert.Empty((await PublicOkAsync(host, "/posts?locale=vi&category=diem-den-noi-bat")).GetProperty("items").EnumerateArray());
        Assert.Empty((await PublicOkAsync(host, "/categories?locale=vi")).GetProperty("items").EnumerateArray());
        Assert.Empty((await PublicOkAsync(host, "/home-section?locale=vi")).GetProperty("items").EnumerateArray());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{media}"));
    }

    [Fact]
    public async Task Restoring_a_revision_makes_a_new_draft_keeps_the_replaced_one_and_leaves_public_alone()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "khoi-phuc", "Bản một");
        var v1 = Translation(await GetPostAsync(host, id), "vi").GetProperty("published").GetProperty("id").GetGuid();

        var second = await SaveDraftAsync(host, id, "vi", version, Draft(media, "khoi-phuc", "Bản hai"));
        var published2 = await TransitionAsync(host, id, "vi", "publish", Version(second, "vi"));
        var inProgress = await SaveDraftAsync(host, id, "vi", Version(published2, "vi"), Draft(media, "khoi-phuc", "Bản đang viết dở"));
        var publicBefore = (await PublicOkAsync(host, "/posts/khoi-phuc?locale=vi")).GetRawText();

        var restored = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/posts/{id}/translations/vi/revisions/{v1}/restore", new { expectedVersion = Version(inProgress, "vi") }, host.Cookie(Editor))));
        var body = await JsonAsync(restored);

        var draft = Translation(body, "vi").GetProperty("draft");
        Assert.Equal("Bản một", draft.GetProperty("title").GetString());
        Assert.Equal("Restore", draft.GetProperty("origin").GetString());
        Assert.Equal(v1, draft.GetProperty("restoredFromRevisionId").GetGuid());
        Assert.Equal("Bản hai", Translation(body, "vi").GetProperty("published").GetProperty("title").GetString());
        Assert.Equal(publicBefore, (await PublicOkAsync(host, "/posts/khoi-phuc?locale=vi")).GetRawText());

        // The draft that was replaced is still in the history, frozen and unpublished.
        var revisions = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/posts/{id}/translations/vi/revisions", host.Cookie(Both)))));
        Assert.Equal(4, revisions.GetArrayLength());
        var superseded = revisions.EnumerateArray().Single(r => r.GetProperty("title").GetString() == "Bản đang viết dở");
        Assert.Equal("Frozen", superseded.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, superseded.GetProperty("publishedAtUtc").ValueKind);
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostRevisions" WHERE "State" = 'Draft' """));
    }

    [Fact]
    public async Task Slugs_are_unique_per_language_never_reassigned_and_old_ones_redirect_without_chains()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "ten-a");

        // Same slug in the same language: refused. In another language: allowed.
        var clash = await CreatePostAsync(host, Draft(media, "ten-a", "Bài khác"), expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.slug-taken", clash.GetProperty("code").GetString());
        var english = await CreatePostAsync(host, Draft(media, "ten-a", "Another"), "en");
        Assert.Equal("ten-a", Translation(english, "en").GetProperty("draft").GetProperty("slug").GetString());

        // Rename twice: both old addresses answer 301 straight to the latest one.
        var v2 = await TransitionAsync(host, id, "vi", "publish", Version(await SaveDraftAsync(host, id, "vi", version, Draft(media, "ten-b")), "vi"));
        var v3 = await TransitionAsync(host, id, "vi", "publish", Version(await SaveDraftAsync(host, id, "vi", Version(v2, "vi"), Draft(media, "ten-c")), "vi"));
        foreach (var old in new[] { "ten-a", "ten-b" })
        {
            var moved = await AssertStatusAsync(HttpStatusCode.MovedPermanently, PublicAsync(host, $"/posts/{old}?locale=vi"));
            Assert.Equal("/api/v1/website/blog/posts/ten-c?locale=vi", moved.Headers.Location!.OriginalString);
            Assert.Equal("ten-c", (await JsonAsync(moved)).GetProperty("slug").GetString());
        }

        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts/ten-c?locale=vi"));

        // A retired address is still owned by the article: nobody else can take it.
        var taken = await CreatePostAsync(host, Draft(media, "ten-b", "Kẻ cướp địa chỉ"), expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.slug-taken", taken.GetProperty("code").GetString());

        // The article itself can go back to an old address: it becomes current, the one it leaves becomes a redirect.
        var back = await TransitionAsync(host, id, "vi", "publish", Version(await SaveDraftAsync(host, id, "vi", Version(v3, "vi"), Draft(media, "ten-a")), "vi"));
        Assert.Equal("Published", Translation(back, "vi").GetProperty("status").GetString());
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts/ten-a?locale=vi"));
        foreach (var old in new[] { "ten-b", "ten-c" })
        {
            Assert.Equal("/api/v1/website/blog/posts/ten-a?locale=vi", (await AssertStatusAsync(HttpStatusCode.MovedPermanently, PublicAsync(host, $"/posts/{old}?locale=vi"))).Headers.Location!.OriginalString);
        }

        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostSlugs" WHERE "Locale" = 'vi' AND "State" = 'Current' """));
    }

    [Fact]
    public async Task A_draft_slug_is_reserved_but_not_public_and_a_bad_slug_is_refused()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var draftOnly = await CreatePostAsync(host, Draft(media, "chua-dang"));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/chua-dang?locale=vi"));

        // Reserved by the draft: another article cannot take it, the same article can change it (the reservation moves).
        var clash = await CreatePostAsync(host, Draft(media, "chua-dang", "Khác"), expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.slug-taken", clash.GetProperty("code").GetString());
        var moved = await SaveDraftAsync(host, PostId(draftOnly), "vi", 1, Draft(media, "doi-ten"));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostSlugs" WHERE "State" = 'Draft' """));
        await CreatePostAsync(host, Draft(media, "chua-dang", "Nay đã được dùng"));

        foreach (var bad in new[] { "Có Dấu", "UPPER", "a b", "-x", "category", "x/y" })
        {
            var refused = await CreatePostAsync(host, Draft(media, bad), expected: HttpStatusCode.BadRequest);
            Assert.StartsWith("blog.slug-", refused.GetProperty("code").GetString());
            Assert.Equal("slug", refused.GetProperty("field").GetString());
        }

        Assert.Equal(2, Version(moved, "vi"));
    }

    [Fact]
    public async Task Two_creates_racing_for_one_slug_leave_one_winner_and_a_clean_conflict()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ =>
            SendAsync(host, AdminPost("/posts", new { id = Guid.NewGuid(), locale = "vi", draft = Draft(media, "dua-slug") }, host.Cookie(Editor)))));

        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.All(results.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostSlugs" WHERE "Slug" = 'dua-slug' """));
    }

    [Fact]
    public async Task Two_writers_on_one_version_one_wins_and_nothing_is_lost()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var created = await CreatePostAsync(host, Draft(media, "dua"));
        var id = PostId(created);

        var a = SendAsync(host, AdminPost($"/posts/{id}/translations/vi/draft", new { expectedVersion = 1, draft = Draft(media, "dua", "Bản của A") }, host.Cookie(Editor)));
        var b = SendAsync(host, AdminPost($"/posts/{id}/translations/vi/draft", new { expectedVersion = 1, draft = Draft(media, "dua", "Bản của B") }, host.Cookie(Both)));
        var responses = await Task.WhenAll(a, b);

        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        var loser = responses.Single(r => r.StatusCode != HttpStatusCode.OK);
        Assert.Equal(HttpStatusCode.Conflict, loser.StatusCode);
        Assert.Equal("blog.stale-version", (await ProblemOf(loser)).Code);

        var winner = responses.Single(r => r.StatusCode == HttpStatusCode.OK);
        var stored = Translation(await GetPostAsync(host, id), "vi").GetProperty("draft").GetProperty("title").GetString();
        Assert.Equal(Translation(await JsonAsync(winner), "vi").GetProperty("draft").GetProperty("title").GetString(), stored);

        // A write with a version that is simply old is refused the same way, and changes nothing.
        var stale = await SaveDraftAsync(host, id, "vi", 1, Draft(media, "dua", "Muộn"), expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.stale-version", stale.GetProperty("code").GetString());
        Assert.Equal(stored, Translation(await GetPostAsync(host, id), "vi").GetProperty("draft").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Publish_unpublish_and_update_racing_on_one_version_never_leave_a_mixed_state()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        for (var round = 0; round < 4; round++)
        {
            var created = await CreatePostAsync(host, Draft(media, $"dua-{round}", $"Bài {round}"));
            var id = PostId(created);
            var published = await TransitionAsync(host, id, "vi", "publish", Version(created, "vi"));
            var version = Version(published, "vi");
            var edit = await SaveDraftAsync(host, id, "vi", version, Draft(media, $"dua-{round}", $"Bài {round} sửa"));
            version = Version(edit, "vi");

            var publish = SendAsync(host, AdminPost($"/posts/{id}/translations/vi/publish", new { expectedVersion = version }, host.Cookie(Publisher)));
            var unpublish = SendAsync(host, AdminPost($"/posts/{id}/translations/vi/unpublish", new { expectedVersion = version }, host.Cookie(Publisher)));
            var update = SendAsync(host, AdminPost($"/posts/{id}/translations/vi/draft", new { expectedVersion = version, draft = Draft(media, $"dua-{round}", $"Bài {round} lại sửa") }, host.Cookie(Editor)));
            var results = await Task.WhenAll(publish, unpublish, update);

            Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
            Assert.All(results.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));

            // Whatever won, the translation is coherent: the public view equals the status, and exactly one version moved.
            var after = Translation(await GetPostAsync(host, id), "vi");
            Assert.Equal(version + 1, after.GetProperty("version").GetInt32());
            var status = after.GetProperty("status").GetString();
            var publicStatus = (await PublicAsync(host, $"/posts/dua-{round}?locale=vi")).StatusCode;
            Assert.Equal(status == "Published" ? HttpStatusCode.OK : HttpStatusCode.NotFound, publicStatus);
            if (status == "Published")
            {
                Assert.Equal($"Bài {round} sửa", (await PublicOkAsync(host, $"/posts/dua-{round}?locale=vi")).GetProperty("title").GetString());
            }
        }

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostTranslations" t WHERE t."Status" = 'Published' AND t."PublishedRevisionId" IS NULL """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM (SELECT 1 FROM "BlogPostRevisions" GROUP BY "TranslationId" HAVING count(*) FILTER (WHERE "State" = 'Draft') > 1) x"""));
    }

    [Fact]
    public async Task Publishing_is_atomic_a_refusal_changes_nothing()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var created = await CreatePostAsync(host, Draft(media, "dang-do", "Dở", d => d["coverAlt"] = ""));
        var id = PostId(created);

        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminPost($"/posts/{id}/translations/vi/publish", new { expectedVersion = 1 }, host.Cookie(Publisher))));
        Assert.Equal(("blog.cover-alt-required", "coverAlt"), await ProblemOf(refused));
        var after = Translation(await GetPostAsync(host, id), "vi");
        Assert.Equal("Draft", after.GetProperty("status").GetString());
        Assert.Equal(1, after.GetProperty("version").GetInt32());
        Assert.Equal(JsonValueKind.Null, after.GetProperty("published").ValueKind);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostSlugs" WHERE "State" = 'Current' """));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/dang-do?locale=vi"));
    }

    [Theory]
    [InlineData("title", "", "blog.title-required", "title")]
    [InlineData("slug", "", "blog.slug-required", "slug")]
    [InlineData("summary", "", "blog.summary-required", "summary")]
    [InlineData("body", "empty", "blog.body-empty", "body")]
    [InlineData("body", "noalt", "blog.image-alt-required", "body")]
    [InlineData("categoryIds", "none", "blog.category-required", "categoryIds")]
    [InlineData("primaryCategoryId", "none", "blog.category-primary-required", "primaryCategoryId")]
    [InlineData("coverMediaId", "none", "blog.cover-required", "coverMediaId")]
    [InlineData("coverAlt", "", "blog.cover-alt-required", "coverAlt")]
    public async Task Publishing_requires_a_complete_article_while_a_draft_may_be_unfinished(string field, string value, string code, string problemField)
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var other = (await CreateCategoryAsync(host, "khac")).GetProperty("id").GetGuid();
        var draft = Draft(media, "day-du", "Đầy đủ", d =>
        {
            switch (field, value)
            {
                case ("body", "empty"): d["body"] = BodyOf(); break;
                case ("body", "noalt"): d["body"] = BodyOf(Paragraph("x"), new JsonObject { ["type"] = "image", ["mediaId"] = media.ToString(), ["alt"] = "" }); break;
                case ("categoryIds", "none"): d["categoryIds"] = new JsonArray(); d["primaryCategoryId"] = null; break;
                case ("primaryCategoryId", "none"): d["categoryIds"] = new JsonArray(FeaturedCategory.ToString(), other.ToString()); d["primaryCategoryId"] = null; break;
                case ("coverMediaId", "none"): d["coverMediaId"] = null; break;
                default: d[field] = value; break;
            }
        });

        // A draft with the same gap is accepted (a title is only needed to start a translation, so that case clears it afterwards) ...
        var created = field == "title"
            ? await SaveDraftAsync(host, PostId(await CreatePostAsync(host, Draft(media, "day-du"))), "vi", 1, draft)
            : await CreatePostAsync(host, draft, "vi", null, null, HttpStatusCode.OK);
        var createdId = PostId(created);
        var current = Version(created, "vi");
        // ... and publishing it is refused with the exact reason.
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminPost($"/posts/{createdId}/translations/vi/publish", new { expectedVersion = current }, host.Cookie(Publisher))));
        Assert.Equal((code, problemField), await ProblemOf(refused));
    }

    [Fact]
    public async Task A_category_without_a_text_in_the_language_blocks_publishing_that_language_only()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        // The seeded category has vi and en texts, not fr.
        var created = await CreatePostAsync(host, Draft(media, "bonjour", "Bonjour"), "fr");
        var refused = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminPost($"/posts/{PostId(created)}/translations/fr/publish", new { expectedVersion = 1 }, host.Cookie(Publisher))));
        Assert.Equal("blog.category-locale-missing", (await ProblemOf(refused)).Code);

        var category = (await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/categories", host.Cookie(Both)))))).EnumerateArray().Single();
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost($"/categories/{FeaturedCategory}/save", new
        {
            expectedVersion = category.GetProperty("version").GetInt32(),
            sortOrder = 10,
            translations = new Dictionary<string, object> { ["fr"] = new { name = "Destinations phares", slug = "destinations-phares", description = "Les lieux." } }
        }, host.Cookie(Publisher))));
        await TransitionAsync(host, PostId(created), "fr", "publish", 1);
        Assert.Equal(["bonjour"], Slugs(await PublicOkAsync(host, "/posts?locale=fr")));
    }

    [Fact]
    public async Task Hostile_or_dangling_content_is_refused_by_the_server_and_nothing_is_stored()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var hostile = new (string Name, Action<JsonObject> Change, string Code)[]
        {
            ("script in text", d => d["body"] = BodyOf(Paragraph("<script>alert(1)</script>")), "blog.body-invalid"),
            ("script in title", d => d["title"] = "<img src=x onerror=alert(1)>", "blog.validation"),
            ("javascript link", d => d["body"] = BodyOf(new JsonObject { ["type"] = "paragraph", ["inlines"] = new JsonArray(new JsonObject { ["text"] = "x", ["href"] = "javascript:alert(1)" }) }), "blog.body-invalid"),
            ("protocol-relative link", d => d["body"] = BodyOf(new JsonObject { ["type"] = "paragraph", ["inlines"] = new JsonArray(new JsonObject { ["text"] = "x", ["href"] = "/\\evil.example" }) }), "blog.body-invalid"),
            ("raw html block", d => d["body"] = BodyOf(new JsonObject { ["type"] = "html", ["html"] = "<iframe src=//evil></iframe>" }), "blog.body-invalid"),
            ("external image url", d => d["body"] = BodyOf(new JsonObject { ["type"] = "image", ["mediaId"] = media.ToString(), ["alt"] = "a", ["url"] = "https://evil.example/x.png" }), "blog.body-invalid"),
            ("unknown media", d => d["coverMediaId"] = Guid.NewGuid().ToString(), "blog.media-missing"),
            ("unknown media in body", d => d["body"] = BodyOf(new JsonObject { ["type"] = "image", ["mediaId"] = Guid.NewGuid().ToString(), ["alt"] = "a" }), "blog.media-missing"),
            ("unknown category", d => { var id = Guid.NewGuid().ToString(); d["categoryIds"] = new JsonArray(id); d["primaryCategoryId"] = id; }, "blog.category-missing"),
            ("primary outside categories", d => d["primaryCategoryId"] = Guid.NewGuid().ToString(), "blog.validation"),
            ("unknown property", d => d["body"] = BodyOf(new JsonObject { ["type"] = "propertyIntro", ["propertyId"] = Guid.NewGuid().ToString() }), "blog.property-missing"),
            ("title too long", d => d["title"] = new string('x', 151), "blog.validation"),
            ("h1 heading", d => d["body"] = BodyOf(new JsonObject { ["type"] = "heading", ["level"] = 1, ["text"] = "H1" }), "blog.body-invalid")
        };
        foreach (var (name, change, code) in hostile)
        {
            var response = await AssertStatusAsync(code == "blog.media-missing" || code == "blog.category-missing" ? HttpStatusCode.BadRequest : HttpStatusCode.BadRequest,
                SendAsync(host, AdminPost("/posts", new { id = Guid.NewGuid(), locale = "vi", draft = Draft(media, "doc-hai", "Độc hại", change) }, host.Cookie(Editor))));
            Assert.True(code == (await ProblemOf(response)).Code, $"{name}: {await response.Content.ReadAsStringAsync()}");
        }

        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPosts" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "BlogPostSlugs" """));

        // A property that exists is accepted and the public payload names it; one that is not active is dropped from the body.
        var property = host.PropertyId;
        var created = await CreatePostAsync(host, Draft(media, "co-property", "Có cơ sở", d => d["body"] = BodyOf(Paragraph("x"), new JsonObject { ["type"] = "propertyIntro", ["propertyId"] = property.ToString() })));
        await TransitionAsync(host, PostId(created), "vi", "publish", 1);
        var detail = await PublicOkAsync(host, "/posts/co-property?locale=vi");
        Assert.Equal("website-cp02", detail.GetProperty("properties").GetProperty(property.ToString()).GetProperty("slug").GetString());
        await ExecuteAsync($"""UPDATE "Properties" SET "IsActive" = false WHERE "Id" = '{property}' """);
        var hidden = await PublicOkAsync(host, "/posts/co-property?locale=vi");
        Assert.Equal(JsonValueKind.Object, hidden.GetProperty("properties").ValueKind);
        Assert.Empty(hidden.GetProperty("properties").EnumerateObject());
        Assert.Equal(1, hidden.GetProperty("body").GetProperty("blocks").GetArrayLength());
    }

    [Fact]
    public async Task A_duplicate_post_id_is_a_conflict_and_a_missing_post_or_translation_is_not_found()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var id = Guid.NewGuid();
        await CreatePostAsync(host, Draft(media, "mot"), "vi", id);
        var duplicate = await CreatePostAsync(host, Draft(media, "hai"), "vi", id, null, HttpStatusCode.Conflict);
        Assert.Equal("blog.duplicate-id", duplicate.GetProperty("code").GetString());

        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet($"/posts/{Guid.NewGuid()}", host.Cookie(Both))));
        await SaveDraftAsync(host, Guid.NewGuid(), "vi", 1, Draft(media, "ba"), expected: HttpStatusCode.NotFound);
        await TransitionAsync(host, id, "en", "publish", 1, expected: HttpStatusCode.NotFound);
        await CreatePostAsync(host, Draft(media, "bon"), "de", null, null, HttpStatusCode.BadRequest);

        // A new language is added to an existing post with expectedVersion 0 only.
        await SaveDraftAsync(host, id, "en", 3, Draft(media, "mot"), expected: HttpStatusCode.NotFound);
        var en = await SaveDraftAsync(host, id, "en", 0, Draft(media, "one", "One"));
        Assert.Equal(["en", "vi"], en.GetProperty("translations").EnumerateArray().Select(t => t.GetProperty("locale").GetString()).Order().ToArray());
        await SaveDraftAsync(host, id, "en", 0, Draft(media, "one"), expected: HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task The_audit_names_the_session_actor_never_a_value_from_the_request()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var editor = await StaffIdAsync(Editor);
        var publisher = await StaffIdAsync(Publisher);
        var impostor = await StaffIdAsync(Both);

        // A body that names someone else as the actor changes nothing: the field is not part of the contract.
        var created = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminPost("/posts", new
        {
            id = Guid.NewGuid(), locale = "vi", actorStaffId = impostor, createdBy = impostor, draft = Draft(media, "kiem-toan")
        }, host.Cookie(Editor))));
        var id = PostId(await JsonAsync(created));
        await TransitionAsync(host, id, "vi", "publish", 1);
        await TransitionAsync(host, id, "vi", "unpublish", 2);

        var rows = new List<(string Action, Guid Actor)>();
        await using (var context = Factory.CreateDbContext())
        {
            rows = (await context.BlogAudits.AsNoTracking().OrderBy(a => a.AtUtc).ToListAsync()).Select(a => (a.Action, a.ActorStaffId)).ToList();
        }

        Assert.Contains(("media.upload", editor), rows);
        Assert.Contains(("post.create", editor), rows);
        Assert.Contains(("post.publish", publisher), rows);
        Assert.Contains(("post.unpublish", publisher), rows);
        Assert.DoesNotContain(rows, r => r.Actor == impostor);

        var post = await GetPostAsync(host, id);
        Assert.Equal(Publisher, Translation(post, "vi").GetProperty("updatedBy").GetProperty("email").GetString());
        Assert.Equal(Editor, Translation(post, "vi").GetProperty("published").GetProperty("createdBy").GetProperty("email").GetString());
        Assert.Equal(Publisher, Translation(post, "vi").GetProperty("published").GetProperty("publishedBy").GetProperty("email").GetString());
    }
}
