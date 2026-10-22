using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using TheBha.Api;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP03: the Staff-only preview. It shows the saved draft (or, with none, the published revision) in the public article shape, with the pictures
/// addressed through the Staff preview routes; it needs a session, is <c>no-store</c>, writes nothing and makes nothing public.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogPreviewApiTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    private static string Url(Guid post, string locale) => $"/posts/{post}/translations/{locale}/preview";

    [Fact]
    public async Task A_draft_is_previewed_with_staff_pictures_and_stays_invisible_to_the_public()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var created = await CreatePostAsync(host, Draft(media, "ban-nhap-xem-truoc", "Bản nháp xem trước"));
        var id = PostId(created);

        var response = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Editor))));
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        var preview = await JsonAsync(response);
        Assert.Equal("draft", preview.GetProperty("source").GetString());
        Assert.Equal("Draft", preview.GetProperty("status").GetString());
        Assert.Equal(Version(created, "vi"), preview.GetProperty("version").GetInt32());
        Assert.Equal("Bản nháp xem trước", preview.GetProperty("title").GetString());
        Assert.Equal("ban-nhap-xem-truoc", preview.GetProperty("slug").GetString());
        Assert.Equal("Ban biên tập", preview.GetProperty("author").GetString());
        Assert.Equal(2, preview.GetProperty("body").GetProperty("blocks").GetArrayLength());
        Assert.Equal(1, preview.GetProperty("categories").GetArrayLength());

        // Every picture address is a Staff route: the cover, each size, the body media map and the OG image — never a public one.
        var staff = $"/api/admin/v1/website/blog/media/{media}/preview/";
        var cover = preview.GetProperty("cover");
        Assert.Equal(staff + "article", cover.GetProperty("url").GetString());
        Assert.Equal("Bãi biển Mỹ Khê", cover.GetProperty("alt").GetString());
        Assert.All(cover.GetProperty("variants").EnumerateArray(), v => Assert.StartsWith(staff, v.GetProperty("url").GetString()));
        Assert.StartsWith(staff, preview.GetProperty("media").GetProperty(media.ToString()).GetProperty("url").GetString());
        Assert.DoesNotContain("/api/v1/website/blog/media", preview.GetRawText());

        // The addresses really serve the picture to Staff, and to nobody else.
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, Get(cover.GetProperty("url").GetString()!, host.Cookie(Publisher))));
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, Get(cover.GetProperty("url").GetString()!, null))).StatusCode);

        // Nothing about the draft is public: no article, no list row, no picture.
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/ban-nhap-xem-truoc?locale=vi"));
        Assert.Equal(0, (await PublicOkAsync(host, "/posts?locale=vi")).GetProperty("total").GetInt32());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/media/" + media));
        await AssertStatusAsync(HttpStatusCode.NotFound, host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Get, preview.GetProperty("cover").GetProperty("url").GetString()!.Replace("/api/admin/v1/website/blog/", "/api/v1/website/blog/").Replace("/preview/article", string.Empty))));
    }

    [Fact]
    public async Task The_draft_is_shown_over_the_published_revision_and_a_published_post_without_a_draft_shows_itself()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "bai-da-xuat-ban", "Bài đã xuất bản");

        var published = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Publisher)))));
        Assert.Equal("published", published.GetProperty("source").GetString());
        Assert.Equal("Published", published.GetProperty("status").GetString());
        Assert.Equal("Bài đã xuất bản", published.GetProperty("title").GetString());

        await SaveDraftAsync(host, id, "vi", version, Draft(media, "bai-da-xuat-ban", "Bài đang sửa"));
        var draft = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Both)))));
        Assert.Equal("draft", draft.GetProperty("source").GetString());
        Assert.Equal("Bài đang sửa", draft.GetProperty("title").GetString());
        Assert.True(draft.GetProperty("revisionNumber").GetInt32() > published.GetProperty("revisionNumber").GetInt32());

        // The public still shows the published text; the preview changed nothing (no write, no version move).
        Assert.Equal("Bài đã xuất bản", (await PublicOkAsync(host, "/posts/bai-da-xuat-ban?locale=vi")).GetProperty("title").GetString());
        Assert.Equal(version + 1, Version(await GetPostAsync(host, id), "vi"));
    }

    [Fact]
    public async Task A_draft_without_a_cover_previews_with_a_null_cover()
    {
        using var host = await StartBlogAsync();
        var created = await CreatePostAsync(host, new JsonObject { ["title"] = "Chưa có ảnh" });
        var preview = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(PostId(created), "vi"), host.Cookie(Editor)))));
        Assert.Equal(JsonValueKind.Null, preview.GetProperty("cover").ValueKind);
        Assert.Equal(0, preview.GetProperty("categories").GetArrayLength());
    }

    [Fact]
    public async Task Another_language_an_unknown_post_and_an_unknown_language_are_refused()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var created = await CreatePostAsync(host, Draft(media, "chi-co-tieng-viet"));
        var id = PostId(created);

        // The post has no English translation: nothing of the Vietnamese one leaks into it.
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet(Url(id, "en"), host.Cookie(Editor))));
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet(Url(Guid.NewGuid(), "vi"), host.Cookie(Editor))));
        var unknown = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminGet(Url(id, "xx"), host.Cookie(Editor))));
        Assert.Equal("locale", (await ProblemOf(unknown)).Field);
    }

    [Fact]
    public async Task Preview_follows_the_staff_permission_and_is_closed_in_local_gate()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var id = PostId(await CreatePostAsync(host, Draft(media, "quyen-xem-truoc")));
        var url = Url(id, "vi");

        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, AdminGet(url, null))).StatusCode);
        foreach (var account in new[] { Desk, Site, Manager })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(host, AdminGet(url, host.Cookie(account)))).StatusCode);
        }

        // Edit alone and publish alone can both look; neither has to be able to write for that.
        foreach (var account in new[] { Editor, Publisher, Both })
        {
            await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(url, host.Cookie(account))));
        }

        using var local = await StartBlogAsync(AdminCalendarAccessMode.LocalGate);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(local, AdminGet(url, null))).StatusCode);
    }

    [Fact]
    public async Task A_property_intro_is_resolved_and_left_out_once_the_property_is_off_like_the_public_article()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var body = BodyOf(Paragraph("Mở đầu"), new JsonObject { ["type"] = "propertyIntro", ["propertyId"] = host.PropertyId.ToString() });
        var id = PostId(await CreatePostAsync(host, Draft(media, "co-gioi-thieu-co-so", change: draft => draft["body"] = body)));

        var shown = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Editor)))));
        Assert.Equal(1, shown.GetProperty("properties").EnumerateObject().Count());
        Assert.Equal(2, shown.GetProperty("body").GetProperty("blocks").GetArrayLength());

        await ExecuteAsync($"""UPDATE "Properties" SET "IsActive" = false WHERE "Id" = '{host.PropertyId}'""");
        var off = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Editor)))));
        Assert.Equal(0, off.GetProperty("properties").EnumerateObject().Count());
        Assert.Equal(1, off.GetProperty("body").GetProperty("blocks").GetArrayLength());
    }

    [Fact]
    public async Task The_list_row_names_the_cover_of_the_revision_it_shows_for_the_thumbnail()
    {
        using var host = await StartBlogAsync();
        var first = await UploadAsync(host, host.Cookie(Editor));
        var second = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, first, "bai-co-anh-bia", "Bài có ảnh bìa");
        var none = PostId(await CreatePostAsync(host, new JsonObject { ["title"] = "Chưa có ảnh" }));

        string? CoverOf(JsonElement list, Guid post) =>
            list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetGuid() == post)
                .GetProperty("translations")[0].GetProperty("coverMediaId") is { ValueKind: JsonValueKind.String } cover ? cover.GetString() : null;

        var published = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts", host.Cookie(Editor)))));
        Assert.Equal(first.ToString(), CoverOf(published, id));
        Assert.Null(CoverOf(published, none));

        // The row shows the draft once there is one, so a new cover appears there before it is published.
        await SaveDraftAsync(host, id, "vi", version, Draft(second, "bai-co-anh-bia", "Bài có ảnh bìa"));
        var drafted = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts", host.Cookie(Editor)))));
        Assert.Equal(second.ToString(), CoverOf(drafted, id));
    }

    [Fact]
    public async Task The_spaces_between_formatted_runs_survive_a_save_the_preview_and_publication()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var runs = new JsonArray(
            new JsonObject { ["text"] = "Đây là " },
            new JsonObject { ["text"] = "đậm", ["bold"] = true },
            new JsonObject { ["text"] = " chữ" });
        var body = BodyOf(new JsonObject { ["type"] = "paragraph", ["inlines"] = runs });
        var created = await CreatePostAsync(host, Draft(media, "khoang-trang", change: draft => draft["body"] = body));
        var id = PostId(created);

        static string Joined(JsonElement bodyElement) =>
            string.Concat(bodyElement.GetProperty("blocks")[0].GetProperty("inlines").EnumerateArray().Select(run => run.GetProperty("text").GetString()));

        Assert.Equal("Đây là đậm chữ", Joined(Translation(created, "vi").GetProperty("draft").GetProperty("body")));
        var preview = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Editor)))));
        Assert.Equal("Đây là đậm chữ", Joined(preview.GetProperty("body")));

        await TransitionAsync(host, id, "vi", "publish", Version(created, "vi"));
        Assert.Equal("Đây là đậm chữ", Joined((await PublicOkAsync(host, "/posts/khoang-trang?locale=vi")).GetProperty("body")));
    }

    // ---- CP03-C1: what is previewed when the translation is archived, or has nothing to show ----

    private async Task<string> PointersAsync(Guid postId) =>
        await ScalarAsync<string>($"""
            SELECT concat("Version", '|', "UpdatedAtUtc", '|', coalesce("DraftRevisionId"::text, '-'), '|', coalesce("PublishedRevisionId"::text, '-'), '|', "Status", '|', "FirstPublishedAtUtc")
            FROM "BlogPostTranslations" WHERE "PostId" = '{postId}' AND "Locale" = 'vi'
            """);

    [Fact]
    public async Task An_archived_translation_is_still_previewed_from_the_revision_it_has()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));

        // Archived while it only has its first draft (Archive() changes the status and nothing else).
        var draftOnly = await CreatePostAsync(host, Draft(media, "luu-tru-chi-co-nhap", "Chỉ có bản nháp"));
        var draftId = PostId(draftOnly);
        await TransitionAsync(host, draftId, "vi", "archive", Version(draftOnly, "vi"));
        var viaDraft = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(draftId, "vi"), host.Cookie(Editor)))));
        Assert.Equal("draft", viaDraft.GetProperty("source").GetString());
        Assert.Equal("Archived", viaDraft.GetProperty("status").GetString());
        Assert.Equal("Chỉ có bản nháp", viaDraft.GetProperty("title").GetString());

        // Published, then archived: no draft, the published revision is what there is to show.
        var (publishedId, version) = await PublishedAsync(host, media, "luu-tru-da-xuat-ban", "Đã xuất bản rồi lưu trữ");
        await TransitionAsync(host, publishedId, "vi", "archive", version);
        var viaPublished = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(publishedId, "vi"), host.Cookie(Publisher)))));
        Assert.Equal("published", viaPublished.GetProperty("source").GetString());
        Assert.Equal("Archived", viaPublished.GetProperty("status").GetString());
        Assert.Equal("Đã xuất bản rồi lưu trữ", viaPublished.GetProperty("title").GetString());
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/luu-tru-da-xuat-ban?locale=vi"));
    }

    /// <summary>
    /// PERSISTENCE FIXTURE, not a lifecycle: the schema allows an Archived translation whose two revision pointers are both null (the only constraints
    /// require a published pointer for Published / Unpublished), but every write that moves the pointers runs in one transaction and none of the current
    /// API routes commits that state. It is built the way <c>ClearDraft()</c> would leave it - the draft revision frozen and no longer pointed at -
    /// through the real API up to the archive and one SQL change after it.
    /// </summary>
    [Fact]
    public async Task A_translation_with_no_revision_to_show_is_a_controlled_404_and_nothing_changes()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var created = await CreatePostAsync(host, Draft(media, "khong-co-revision", "Không còn bản nào để xem"));
        var id = PostId(created);
        await TransitionAsync(host, id, "vi", "archive", Version(created, "vi"));
        await ExecuteAsync($"""
            UPDATE "BlogPostRevisions" SET "State" = 'Frozen' WHERE "TranslationId" IN (SELECT "Id" FROM "BlogPostTranslations" WHERE "PostId" = '{id}');
            UPDATE "BlogPostTranslations" SET "DraftRevisionId" = NULL WHERE "PostId" = '{id}';
            """);

        var before = await PointersAsync(id);
        var audits = await ScalarAsync<long>("""SELECT count(*) FROM "BlogAudits" """);
        Assert.Contains("|-|-|Archived|", before); // both pointers null, still archived, never published

        foreach (var account in new[] { Editor, Publisher, Both })
        {
            var response = await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(account))));
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
            var problem = await JsonAsync(response);
            Assert.Equal(404, problem.GetProperty("status").GetInt32());
            Assert.Contains("no revision", problem.GetProperty("detail").GetString());
            // C2/O2: a discriminator the Admin can read without comparing words; a missing translation or post stays a plain 404.
            Assert.Equal("blog.not-found", problem.GetProperty("code").GetString());
            Assert.Equal("revision", problem.GetProperty("field").GetString());
        }

        // The service itself answers with a controlled result rather than throwing.
        using (var scope = host.Host.Services.CreateScope())
        {
            var result = await scope.ServiceProvider.GetRequiredService<TheBha.Application.Blog.IAdminBlog>().GetPreviewAsync(id, "vi", CancellationToken.None);
            Assert.Equal(TheBha.Application.Website.WebsiteMutationStatus.NotFound, result.Status);
            Assert.Null(result.Value);
        }

        // Reading, and failing to read, writes nothing: version, dates, pointers, status and the audit trail are as they were.
        Assert.Equal(before, await PointersAsync(id));
        Assert.Equal(audits, await ScalarAsync<long>("""SELECT count(*) FROM "BlogAudits" """));

        // The rest of the contract is as before: no permission, no preview; an unknown post or language answers as it did.
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, AdminGet(Url(id, "vi"), null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Desk)))).StatusCode);
        var customer = await CustomerLoginAsync(host.Host, host.Client);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, AdminGet(Url(id, "vi"), customer))).StatusCode); // a customer session is not a Staff session
        var unknownPost = await JsonAsync(await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet(Url(Guid.NewGuid(), "vi"), host.Cookie(Editor)))));
        Assert.False(unknownPost.TryGetProperty("field", out _)); // not the "no revision" case
        await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminGet(Url(id, "xx"), host.Cookie(Editor))));
    }

    [Fact]
    public async Task A_successful_preview_writes_nothing()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (id, version) = await PublishedAsync(host, media, "xem-khong-ghi", "Xem không ghi");
        await SaveDraftAsync(host, id, "vi", version, Draft(media, "xem-khong-ghi", "Xem không ghi (nháp mới)"));
        var before = await PointersAsync(id);
        var audits = await ScalarAsync<long>("""SELECT count(*) FROM "BlogAudits" """);
        var preview = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet(Url(id, "vi"), host.Cookie(Editor)))));
        Assert.Equal("draft", preview.GetProperty("source").GetString());
        Assert.Equal(before, await PointersAsync(id));
        Assert.Equal(audits, await ScalarAsync<long>("""SELECT count(*) FROM "BlogAudits" """));
        // The draft is preferred, and the public still shows the published one.
        Assert.Equal("Xem không ghi", (await PublicOkAsync(host, "/posts/xem-khong-ghi?locale=vi")).GetProperty("title").GetString());
    }
}
