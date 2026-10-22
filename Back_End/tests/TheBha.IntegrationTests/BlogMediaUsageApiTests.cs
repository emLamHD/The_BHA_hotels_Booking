using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02 acceptance 6 and 7: where a picture is used (cover, og, body picture, gallery; draft, live, history; also of an unpublished or archived article),
/// that a used picture cannot be deleted whatever state the article is in, that an old revision can still be restored with its pictures, and that deleting a
/// picture races cleanly with the writes that would start using it — proven in both orders with real PostgreSQL locks, and under concurrency.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogMediaUsageApiTests(PostgreSqlWebApplicationFactory factory) : BlogMediaTestSupport(factory)
{
    private static async Task<Guid> NewPictureAsync(BlogMediaUsageApiTests test, BlogHost host, string name) =>
        (await test.UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), name)).GetProperty("id").GetGuid();

    private async Task<JsonElement> UsageAsync(BlogHost host, Guid media) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{media}/usage", host.Cookie(Both)))));

    private static string[] Kinds(JsonElement use) => use.GetProperty("kinds").EnumerateArray().Select(k => k.GetString()!).ToArray();

    private static JsonObject ImageBlock(Guid media) => new() { ["type"] = "image", ["mediaId"] = media.ToString(), ["alt"] = "Ảnh trong bài", ["caption"] = "Chú thích" };

    private static JsonObject GalleryBlock(params Guid[] media) => new()
    {
        ["type"] = "gallery",
        ["items"] = new JsonArray(media.Select(id => (JsonNode)new JsonObject { ["mediaId"] = id.ToString(), ["alt"] = "Ảnh thư viện" }).ToArray())
    };

    private async Task AssertInUseAsync(BlogHost host, Guid media)
    {
        var version = (await MediaDetailAsync(host, media)).GetProperty("version").GetInt32();
        var refused = await AssertStatusAsync(HttpStatusCode.Conflict, DeleteMediaAsync(host, media, version));
        Assert.Equal("blog.media-in-use", await ErrorCodeAsync(refused));
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{media}/preview/card", host.Cookie(Both))));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMedia" WHERE "Id" = '{media}' """));
        Assert.Equal(6, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMediaVariants" WHERE "MediaId" = '{media}' """));
    }

    [Fact]
    public async Task Usage_names_every_revision_that_uses_a_picture_and_what_it_uses_it_for()
    {
        using var host = await StartMediaAsync();
        var cover = await NewPictureAsync(this, host, "cover.jpg");
        var og = await NewPictureAsync(this, host, "og.jpg");
        var inBody = await NewPictureAsync(this, host, "body.jpg");
        var g1 = await NewPictureAsync(this, host, "g1.jpg");
        var g2 = await NewPictureAsync(this, host, "g2.jpg");
        var unused = await NewPictureAsync(this, host, "unused.jpg");

        // A draft: the cover is also in the body, so it is used twice in the one revision.
        var created = await CreatePostAsync(host, Draft(cover, "bai-dung-anh", "Bài dùng ảnh", d =>
        {
            d["ogImageMediaId"] = og.ToString();
            d["body"] = BodyOf(Paragraph("Mở đầu"), ImageBlock(inBody), ImageBlock(cover), GalleryBlock(g1, g2));
        }));
        var postId = PostId(created);

        var usageOfCover = await UsageAsync(host, cover);
        Assert.Equal(1, usageOfCover.GetProperty("total").GetInt32());
        var draftUse = usageOfCover.GetProperty("items")[0];
        Assert.Equal(["cover", "body"], Kinds(draftUse));
        Assert.Equal(("Draft", false, "vi", "Draft"), (draftUse.GetProperty("revisionState").GetString(), draftUse.GetProperty("isPublished").GetBoolean(), draftUse.GetProperty("locale").GetString(), draftUse.GetProperty("postStatus").GetString()));
        Assert.Equal(["og"], Kinds((await UsageAsync(host, og)).GetProperty("items")[0]));
        foreach (var id in new[] { inBody, g1, g2 })
        {
            Assert.Equal(["body"], Kinds((await UsageAsync(host, id)).GetProperty("items")[0]));
        }

        Assert.Equal(0, (await UsageAsync(host, unused)).GetProperty("total").GetInt32());

        // Published: the same revision is now the live one.
        var published = await TransitionAsync(host, postId, "vi", "publish", Version(created, "vi"));
        var live = (await UsageAsync(host, g1)).GetProperty("items")[0];
        Assert.Equal((true, "Published", "Frozen"), (live.GetProperty("isPublished").GetBoolean(), live.GetProperty("postStatus").GetString(), live.GetProperty("revisionState").GetString()));

        // Editing starts a new draft: the live revision still uses g1; the new draft no longer does, and does use the new picture.
        var replacement = await NewPictureAsync(this, host, "replacement.jpg");
        var edited = await SaveDraftAsync(host, postId, "vi", Version(published, "vi"), Draft(replacement, "bai-dung-anh", "Bài dùng ảnh", d => d["body"] = BodyOf(Paragraph("Mới"), ImageBlock(replacement))));
        var afterEdit = (await UsageAsync(host, g1)).GetProperty("items");
        Assert.Equal(1, afterEdit.GetArrayLength());
        Assert.True(afterEdit[0].GetProperty("isPublished").GetBoolean());
        Assert.Equal(["cover", "body"], Kinds((await UsageAsync(host, replacement)).GetProperty("items")[0]));

        // Unpublished and archived articles keep their pictures in use (they can come back).
        var unpublished = await TransitionAsync(host, postId, "vi", "unpublish", Version(edited, "vi"));
        var unpublishedUse = (await UsageAsync(host, g1)).GetProperty("items")[0];
        Assert.Equal((false, "Unpublished"), (unpublishedUse.GetProperty("isPublished").GetBoolean(), unpublishedUse.GetProperty("postStatus").GetString()));
        await TransitionAsync(host, postId, "vi", "archive", Version(unpublished, "vi"));
        Assert.Equal("Archived", (await UsageAsync(host, g1)).GetProperty("items")[0].GetProperty("postStatus").GetString());
    }

    [Fact]
    public async Task A_used_picture_cannot_be_deleted_in_any_state_and_an_old_revision_still_restores_with_its_picture()
    {
        using var host = await StartMediaAsync();
        var first = await NewPictureAsync(this, host, "first.jpg");
        var second = await NewPictureAsync(this, host, "second.jpg");
        var inBody = await NewPictureAsync(this, host, "body.jpg");
        var gallery = await NewPictureAsync(this, host, "gallery.jpg");
        var og = await NewPictureAsync(this, host, "og.jpg");
        var spare = await NewPictureAsync(this, host, "spare.jpg");

        // Draft only.
        var created = await CreatePostAsync(host, Draft(first, "xoa-anh", "Xóa ảnh", d =>
        {
            d["ogImageMediaId"] = og.ToString();
            d["body"] = BodyOf(Paragraph("x"), ImageBlock(inBody), GalleryBlock(gallery, spare));
        }));
        var postId = PostId(created);
        foreach (var id in new[] { first, inBody, gallery, og })
        {
            await AssertInUseAsync(host, id);
        }

        // Published, then republished with another cover: the first cover is now only in a past revision.
        var v1 = await TransitionAsync(host, postId, "vi", "publish", Version(created, "vi"));
        await AssertInUseAsync(host, first);
        var edited = await SaveDraftAsync(host, postId, "vi", Version(v1, "vi"), Draft(second, "xoa-anh", "Xóa ảnh"));
        var v2 = await TransitionAsync(host, postId, "vi", "publish", Version(edited, "vi"));
        await AssertInUseAsync(host, first);
        await AssertInUseAsync(host, inBody);
        await AssertInUseAsync(host, gallery);
        await AssertInUseAsync(host, og);
        Assert.Equal(0, (await UsageAsync(host, first)).GetProperty("items").EnumerateArray().Count(use => use.GetProperty("isPublished").GetBoolean()));

        // Unpublished, archived: still used.
        var unpublished = await TransitionAsync(host, postId, "vi", "unpublish", Version(v2, "vi"));
        await AssertInUseAsync(host, second);
        await TransitionAsync(host, postId, "vi", "archive", Version(unpublished, "vi"));
        await AssertInUseAsync(host, second);
        await AssertInUseAsync(host, first);

        // The old revision is restored with its pictures, whole.
        var revisions = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/posts/{postId}/translations/vi/revisions", host.Cookie(Both)))));
        var oldest = revisions.EnumerateArray().Single(r => r.GetProperty("number").GetInt32() == 1);
        var current = await GetPostAsync(host, postId);
        await TransitionAsync(host, postId, "vi", "unarchive", Version(current, "vi"));
        var unarchived = await GetPostAsync(host, postId);
        var restored = await AssertStatusAsync(
            HttpStatusCode.OK, SendAsync(host, AdminPost($"/posts/{postId}/translations/vi/revisions/{oldest.GetProperty("id").GetGuid()}/restore", new { expectedVersion = Version(unarchived, "vi") }, host.Cookie(Editor))));
        var draft = Translation(await JsonAsync(restored), "vi").GetProperty("draft");
        Assert.Equal(first, draft.GetProperty("coverMediaId").GetGuid());
        Assert.Equal(og, draft.GetProperty("ogImageMediaId").GetGuid());
        foreach (var id in new[] { first, og, inBody, gallery })
        {
            await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{id}/preview/article", host.Cookie(Editor))));
        }
    }

    [Fact]
    public async Task An_unused_picture_is_deleted_with_its_variants_and_its_files_and_is_gone_for_everyone()
    {
        using var host = await StartMediaAsync();
        var id = await NewPictureAsync(this, host, "unused.jpg");
        var keep = await NewPictureAsync(this, host, "keep.jpg");
        Assert.Equal(14, BlogFiles().Length);

        // Wrong version, unknown picture, and not by an editor.
        Assert.Equal("blog.stale-version", await ErrorCodeAsync(await AssertStatusAsync(HttpStatusCode.Conflict, DeleteMediaAsync(host, id, 9))));
        await AssertStatusAsync(HttpStatusCode.NotFound, DeleteMediaAsync(host, Guid.NewGuid(), 1));
        await AssertStatusAsync(HttpStatusCode.Forbidden, DeleteMediaAsync(host, id, 1, host.Cookie(Editor)));
        Assert.Equal(14, BlogFiles().Length);

        await AssertStatusAsync(HttpStatusCode.NoContent, DeleteMediaAsync(host, id, 1));

        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMedia" WHERE "Id" = '{id}' """));
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMediaVariants" WHERE "MediaId" = '{id}' """));
        Assert.Equal(7, BlogFiles().Length); // the other picture's original and variants are untouched
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet($"/media/{id}/detail", host.Cookie(Both))));
        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet($"/media/{id}", host.Cookie(Both))));
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, $"/media/{id}"));
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{keep}", host.Cookie(Both))));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogAudits" WHERE "Action" = 'media.delete' AND "ActorStaffId" = '{await StaffIdAsync(Publisher)}' """));

        // A deleted picture can no longer be put in an article.
        var missing = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, AdminPost("/posts", new { id = Guid.NewGuid(), locale = "vi", draft = Draft(id, "ma") }, host.Cookie(Editor))));
        Assert.Equal("blog.media-missing", await ErrorCodeAsync(missing));
    }

    /// <summary>Order 1: the delete holds the picture's row; a draft that wants to use the picture waits at its foreign key and, once the row is gone, is refused cleanly.</summary>
    [Fact]
    public async Task A_save_that_meets_a_delete_already_under_way_is_refused_as_media_missing_not_as_an_error()
    {
        using var host = await StartMediaAsync();
        var picture = await NewPictureAsync(this, host, "race.jpg");
        var created = await CreatePostAsync(host, new JsonObject { ["title"] = "Bài chạy đua" });

        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteOn(connection, transaction, $"""SELECT 1 FROM "BlogMedia" WHERE "Id" = '{picture}' FOR UPDATE""");

        var save = SendAsync(host, AdminPost(
            $"/posts/{PostId(created)}/translations/vi/draft", new { expectedVersion = Version(created, "vi"), draft = new JsonObject { ["title"] = "Bài chạy đua", ["coverMediaId"] = picture.ToString() } }, host.Cookie(Editor)));
        await Task.Delay(700);
        Assert.False(save.IsCompleted, "the save must wait for the delete that holds the picture");

        await ExecuteOn(connection, transaction, $"""DELETE FROM "BlogMedia" WHERE "Id" = '{picture}'""");
        await transaction.CommitAsync();

        var response = await save;
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("blog.media-missing", await ErrorCodeAsync(response));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "BlogRevisionMedia" """));
        var unchanged = Translation(await GetPostAsync(host, PostId(created)), "vi").GetProperty("draft");
        Assert.Equal(JsonValueKind.Null, unchanged.GetProperty("coverMediaId").ValueKind);
    }

    /// <summary>Order 2: a writer has started using the picture and not yet committed; the delete waits for it, then sees the use and is refused.</summary>
    [Fact]
    public async Task A_delete_that_meets_a_use_under_way_waits_for_it_and_is_refused_as_in_use()
    {
        using var host = await StartMediaAsync();
        var picture = await NewPictureAsync(this, host, "race.jpg");
        var created = await CreatePostAsync(host, new JsonObject { ["title"] = "Bài chạy đua" });
        var draftRevision = await ScalarAsync<Guid>($"""SELECT "DraftRevisionId" FROM "BlogPostTranslations" WHERE "PostId" = '{PostId(created)}' """);

        await using var connection = new NpgsqlConnection(Factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteOn(connection, transaction, $"""INSERT INTO "BlogRevisionMedia" ("RevisionId","MediaId") VALUES ('{draftRevision}','{picture}')""");

        var delete = DeleteMediaAsync(host, picture, 1);
        await Task.Delay(700);
        Assert.False(delete.IsCompleted, "the delete must wait for the use that is being written");

        await transaction.CommitAsync();
        var response = await delete;
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("blog.media-in-use", await ErrorCodeAsync(response));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMedia" WHERE "Id" = '{picture}' """));
        Assert.Equal(7, BlogFiles().Length);
    }

    private static async Task ExecuteOn(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Whatever the interleaving, a delete racing a save either wins (the save is refused) or loses (the delete is refused); never a 500, never a draft pointing at a deleted picture.</summary>
    [Fact]
    public async Task Deletes_racing_saves_never_leave_a_dangling_use_or_an_unexpected_error()
    {
        using var host = await StartMediaAsync();
        var outcomes = new List<string>();
        for (var round = 0; round < 12; round++)
        {
            var picture = await NewPictureAsync(this, host, $"race-{round}.jpg");
            var created = await CreatePostAsync(host, new JsonObject { ["title"] = $"Bài {round}" });
            var save = Task.Run(() => SendAsync(host, AdminPost(
                $"/posts/{PostId(created)}/translations/vi/draft", new { expectedVersion = Version(created, "vi"), draft = new JsonObject { ["title"] = $"Bài {round}", ["coverMediaId"] = picture.ToString() } }, host.Cookie(Editor))));
            var delete = Task.Run(() => DeleteMediaAsync(host, picture, 1));
            var (saved, deleted) = (await save, await delete);

            var outcome = (saved.StatusCode, deleted.StatusCode) switch
            {
                (HttpStatusCode.OK, HttpStatusCode.Conflict) => "save-won",
                (HttpStatusCode.BadRequest, HttpStatusCode.NoContent) => "delete-won",
                var other => throw new Xunit.Sdk.XunitException($"round {round}: save {other.Item1}, delete {other.Item2}"),
            };
            outcomes.Add(outcome);

            var rowExists = await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMedia" WHERE "Id" = '{picture}' """) == 1;
            var uses = await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogRevisionMedia" WHERE "MediaId" = '{picture}' """);
            Assert.Equal(outcome == "save-won", rowExists);
            Assert.Equal(outcome == "save-won" ? 1 : 0, uses);
        }

        // Every file left belongs to a picture that still exists: 7 files per picture.
        Assert.Equal(7 * await ScalarAsync<int>("""SELECT count(*)::int FROM "BlogMedia" """), BlogFiles().Length);
        Assert.Equal(outcomes.Count, outcomes.Count(o => o is "save-won" or "delete-won"));
    }
}
