using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Blog;
using TheBha.Domain.Blog;
using TheBha.Domain.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02: the picture library through the real routes on real PostgreSQL — taking pictures in (one, and a batch with a result per file), listing and searching,
/// the descriptive fields and focal point with their version, and who may do what. Pictures are made in the test.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogMediaLibraryApiTests(PostgreSqlWebApplicationFactory factory) : BlogMediaTestSupport(factory)
{
    private Task<int> RowsAsync(string table = "BlogMedia") => ScalarAsync<int>($"""SELECT count(*)::int FROM "{table}" """);

    [Fact]
    public async Task The_cp01_upload_still_answers_as_before_and_now_describes_the_picture()
    {
        using var host = await StartMediaAsync();
        var original = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "promotion", "cover.png"));

        var media = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, UploadRequest("cover.png", host.Cookie(Editor)))));

        foreach (var field in new[] { "id", "contentType", "byteSize", "width", "height", "createdAtUtc" })
        {
            Assert.True(media.TryGetProperty(field, out _), $"CP01 field {field} is gone");
        }

        Assert.Equal("image/png", media.GetProperty("contentType").GetString());
        Assert.Equal(original.Length, media.GetProperty("byteSize").GetInt64());
        Assert.Equal("cover", media.GetProperty("displayName").GetString());
        Assert.Equal("cover.png", media.GetProperty("originalFileName").GetString());
        Assert.Equal(Sha(original), media.GetProperty("originalSha256").GetString());
        Assert.Equal("current", media.GetProperty("pipeline").GetString());
        Assert.Equal(1, media.GetProperty("version").GetInt32());
        Assert.Equal((0.5, 0.5), (media.GetProperty("focalX").GetDouble(), media.GetProperty("focalY").GetDouble()));
        Assert.Equal(6, media.GetProperty("variants").GetArrayLength());

        // The Admin route CP01 had still gives the original bytes — and is never cached.
        var file = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{media.GetProperty("id").GetGuid()}", host.Cookie(Editor))));
        Assert.Equal(original, await file.Content.ReadAsByteArrayAsync());
        Assert.Equal("no-store", file.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task A_client_may_name_the_id_of_a_picture_and_a_repeat_is_refused_not_replayed()
    {
        using var host = await StartMediaAsync();
        var id = Guid.NewGuid();
        var first = await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), id: id);
        Assert.Equal(id, first.GetProperty("id").GetGuid());

        var again = await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), id: id, expected: HttpStatusCode.Conflict);
        Assert.Equal("blog.duplicate-id", again.GetProperty("code").GetString());
        Assert.Equal(1, await RowsAsync());
        Assert.Equal(7, BlogFiles().Length); // the original and six variants of the one picture; the refused repeat left nothing

        var bad = Multipart("/media", host.Cookie(Editor), [("file", "x.jpg", BlogImageFixtures.Jpeg(1200, 800))], [("id", "not-a-guid")]);
        Assert.Equal("blog.validation", await ErrorCodeAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, bad))));
        Assert.Equal(1, await RowsAsync());
    }

    [Fact]
    public async Task A_batch_answers_each_file_by_its_index_and_one_bad_file_undoes_nothing()
    {
        using var host = await StartMediaAsync();
        var ids = Enumerable.Range(0, 6).Select(_ => Guid.NewGuid()).ToArray();
        var good = BlogImageFixtures.Jpeg(1200, 800);
        var alpha = BlogImageFixtures.Png(900, 600, transparentRightHalf: true);
        var batch = new (string, byte[])[]
        {
            ("a.jpg", good),
            ("cut.jpg", good[..3000]),
            ("fake.png", Encoding.UTF8.GetBytes("this is not a picture")),
            ("huge.jpg", BlogImageFixtures.Noise(HeroLimits.MaxUploadBytes + 1)),
            ("broken.webp", BlogImageFixtures.WebpWithBrokenBitstream(800, 600)),
            ("b.png", alpha)
        };

        var result = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), batch, ids)));

        Assert.Equal((2, 4), (result.GetProperty("succeeded").GetInt32(), result.GetProperty("failed").GetInt32()));
        var items = result.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal([0, 1, 2, 3, 4, 5], items.Select(i => i.GetProperty("index").GetInt32()));
        Assert.Equal(batch.Select(f => f.Item1), items.Select(i => i.GetProperty("fileName").GetString()));
        Assert.Equal(ids, items.Select(i => i.GetProperty("id").GetGuid())); // the client's id comes back on every file, failed or not
        Assert.Equal(
            [null, "hero-image-corrupt", "hero-image-unsupported", "hero-image-too-large", "hero-image-corrupt", null],
            items.Select(i => i.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object ? e.GetProperty("code").GetString() : null));
        Assert.All(items.Where(i => i.GetProperty("media").ValueKind == JsonValueKind.Object), i => Assert.Equal(6, i.GetProperty("media").GetProperty("variants").GetArrayLength()));

        // Only the two good pictures exist, complete: a row, six variants, and exactly their files — no temporary file, no file of a refused one.
        Assert.Equal(2, await RowsAsync());
        Assert.Equal(12, await RowsAsync("BlogMediaVariants"));
        Assert.Equal(14, BlogFiles().Length);
        Assert.DoesNotContain(BlogFiles(), path => path.EndsWith(".tmp", StringComparison.Ordinal));
        foreach (var index in new[] { 1, 2, 3, 4 })
        {
            await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, AdminGet($"/media/{ids[index]}/detail", host.Cookie(Both))));
        }

        foreach (var (index, bytes) in new[] { (0, good), (5, alpha) })
        {
            var detail = await MediaDetailAsync(host, ids[index]);
            Assert.Equal(Sha(bytes), detail.GetProperty("originalSha256").GetString());
            Assert.Equal("current", detail.GetProperty("pipeline").GetString());
            var original = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{ids[index]}", host.Cookie(Both))));
            Assert.Equal(bytes, await original.Content.ReadAsByteArrayAsync());
            var preview = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{ids[index]}/preview/thumb", host.Cookie(Both))));
            Assert.Equal("image/webp", preview.Content.Headers.ContentType!.MediaType);
            Assert.Equal("no-store", preview.Headers.CacheControl!.ToString());
        }

        // The batch is not replayed: sending the first file again with its id is refused for that file and nothing else changes.
        var again = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), [("a.jpg", good)], [ids[0]])));
        Assert.Equal("blog.duplicate-id", again.GetProperty("items")[0].GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(2, await RowsAsync());
        Assert.Equal(14, BlogFiles().Length);
    }

    [Fact]
    public async Task A_batch_over_a_limit_is_refused_before_any_picture_is_processed()
    {
        using var host = await StartMediaAsync();
        var good = BlogImageFixtures.Jpeg(1200, 800);

        // Too many files.
        var many = Enumerable.Range(0, 11).Select(i => ($"p{i}.jpg", good));
        var tooMany = await AssertStatusAsync(HttpStatusCode.BadRequest, BatchAsync(host, host.Cookie(Editor), many));
        Assert.Equal(("blog.media-batch-invalid", "files"), await ProblemOf(tooMany));

        // None; ids that do not match the files; ids that repeat; ids that are not Guids.
        await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, Multipart("/media/bulk", host.Cookie(Editor), []))); // a body with no part at all is unreadable to the upload boundary
        var noFile = Multipart("/media/bulk", host.Cookie(Editor), [], [("note", "no picture here")]);
        Assert.Equal("blog.media-batch-invalid", await ErrorCodeAsync(await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, noFile))));
        foreach (var ids in new[] { new[] { Guid.NewGuid() }, [Guid.NewGuid(), Guid.Empty], [Guid.Parse("11111111-1111-1111-1111-111111111111"), Guid.Parse("11111111-1111-1111-1111-111111111111")] })
        {
            var response = await AssertStatusAsync(HttpStatusCode.BadRequest, BatchAsync(host, host.Cookie(Editor), [("a.jpg", good), ("b.jpg", good)], ids));
            Assert.Equal(("blog.media-batch-invalid", "ids"), await ProblemOf(response));
        }

        // Together more than the batch budget (54 MB of pictures that are each within the 10 MB limit): refused whole, nothing taken in.
        var heavy = Enumerable.Range(0, 6).Select(i => ($"big{i}.jpg", BlogImageFixtures.Noise(9 * 1024 * 1024)));
        var status = (await BatchAsync(host, host.Cookie(Editor), heavy)).StatusCode;
        Assert.True(status is HttpStatusCode.RequestEntityTooLarge or HttpStatusCode.BadRequest, status.ToString());

        Assert.Equal(0, await RowsAsync());
        Assert.Empty(BlogFiles());
    }

    [Fact]
    public async Task The_library_pages_and_searches_in_a_stable_order_and_lists_only_complete_pictures()
    {
        using var host = await StartMediaAsync();
        var names = new[] { "sea-1.jpg", "sea-2.jpg", "100%_off.jpg", "city.jpg", "river.jpg", "sea-3.jpg", "sea-4.jpg" };
        var ids = new List<Guid>();
        foreach (var name in names)
        {
            Advance(TimeSpan.FromMinutes(1));
            ids.Add((await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), name)).GetProperty("id").GetGuid());
        }

        await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800)[..2000], "cut.jpg", expected: HttpStatusCode.BadRequest);

        async Task<JsonElement> List(string query) =>
            await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/media" + query, host.Cookie(Editor)))));

        static Guid[] IdsOf(JsonElement list) => list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToArray();

        // Newest first, three at a time: every picture exactly once across the pages, and the same again on a second read.
        var pages = new List<Guid>();
        foreach (var page in new[] { 1, 2, 3 })
        {
            var list = await List($"?pageSize=3&page={page}");
            Assert.Equal(7, list.GetProperty("total").GetInt32());
            pages.AddRange(IdsOf(list));
        }

        Assert.Equal(Enumerable.Reverse(ids), pages);
        Assert.Empty(IdsOf(await List("?pageSize=3&page=4")));
        Assert.Equal(pages.Take(3), IdsOf(await List("?pageSize=3&page=1")));
        Assert.Equal(7, IdsOf(await List("?pageSize=500")).Length); // a page is at most 50

        // Search: by name or file name, any case; "%" and "_" are letters, not wildcards.
        Assert.Equal(4, IdsOf(await List("?q=sea")).Length);
        Assert.Equal(4, IdsOf(await List("?q=SEA-")).Length);
        Assert.Equal([ids[2]], IdsOf(await List("?q=%25")));
        Assert.Equal([ids[2]], IdsOf(await List("?q=_off")));
        Assert.Empty(IdsOf(await List("?q=nothing-like-this")));

        // The credit is searchable too.
        Assert.Equal(HttpStatusCode.OK, (await SaveMediaAsync(host, ids[3], 1, new { expectedVersion = 1, displayName = "Thành phố", credit = "Ảnh: Linh", focalX = 0.5, focalY = 0.5 })).StatusCode);
        Assert.Equal([ids[3]], IdsOf(await List("?q=linh")));

        // Used / unused for the picker and for cleaning up.
        await PublishedAsync(host, ids[4], "co-anh");
        Assert.Equal([ids[4]], IdsOf(await List("?usage=used")));
        Assert.Equal(6, IdsOf(await List("?usage=unused")).Length);
        Assert.Equal(1, (await List("?usage=used")).GetProperty("items")[0].GetProperty("usage").GetProperty("inPublished").GetInt32());
    }

    [Fact]
    public async Task Descriptive_fields_and_the_focal_point_are_saved_against_a_version_and_change_no_article()
    {
        using var host = await StartMediaAsync();
        var id = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), "mykhe.jpg")).GetProperty("id").GetGuid();
        var (postId, _) = await PublishedAsync(host, id, "bai-my-khe");
        var before = await PublicOkAsync(host, "/posts/bai-my-khe?locale=vi");
        var etag = (await PublicAsync(host, "/posts/bai-my-khe?locale=vi")).Headers.ETag!.ToString();
        var postBefore = await GetPostAsync(host, postId);

        var saved = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SaveMediaAsync(host, id, 1, new
        {
            expectedVersion = 1,
            displayName = "Biển Mỹ Khê buổi sáng",
            description = "Bình minh trên biển.",
            credit = "Ảnh: Linh",
            sourceUrl = "https://example.com/anh",
            licence = "CC BY 4.0",
            focalX = 0.123456,
            focalY = 0.75
        })));
        Assert.Equal(2, saved.GetProperty("version").GetInt32());
        Assert.Equal((0.1235, 0.75), (saved.GetProperty("focalX").GetDouble(), saved.GetProperty("focalY").GetDouble()));
        Assert.Equal("Ảnh: Linh", (await MediaDetailAsync(host, id)).GetProperty("credit").GetString());

        // A second writer on the version the first one read is refused; the first one's text is what is stored.
        var stale = await AssertStatusAsync(HttpStatusCode.Conflict, SaveMediaAsync(host, id, 1, new { expectedVersion = 1, displayName = "Của người khác", focalX = 0.1, focalY = 0.1 }));
        Assert.Equal("blog.stale-version", await ErrorCodeAsync(stale));
        Assert.Equal("Biển Mỹ Khê buổi sáng", (await MediaDetailAsync(host, id)).GetProperty("displayName").GetString());

        // Two writers at once on one version: exactly one wins.
        var race = await Task.WhenAll(
            SaveMediaAsync(host, id, 2, new { expectedVersion = 2, displayName = "A", focalX = 0.2, focalY = 0.2 }),
            SaveMediaAsync(host, id, 2, new { expectedVersion = 2, displayName = "B", focalX = 0.3, focalY = 0.3 }));
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], race.Select(r => r.StatusCode).Order());
        Assert.Equal(3, (await MediaDetailAsync(host, id)).GetProperty("version").GetInt32());

        // It changed nothing in the article, which is still published as it was: same alt text, same version, same public answer and address of the answer.
        var postAfter = await GetPostAsync(host, postId);
        Assert.Equal(Translation(postBefore, "vi").GetProperty("published").GetRawText(), Translation(postAfter, "vi").GetProperty("published").GetRawText());
        Assert.Equal(Version(postBefore, "vi"), Version(postAfter, "vi"));
        Assert.Equal(before.GetProperty("contentHash").GetString(), (await PublicOkAsync(host, "/posts/bai-my-khe?locale=vi")).GetProperty("contentHash").GetString());
        await AssertStatusAsync(HttpStatusCode.NotModified, PublicAsync(host, "/posts/bai-my-khe?locale=vi", etag));
        Assert.DoesNotContain("focal", (await PublicAsync(host, "/posts/bai-my-khe?locale=vi")).Content.ReadAsStringAsync().Result, StringComparison.OrdinalIgnoreCase);

        // Each save that took effect (the first, and the winner of the race) is audited with the real Staff id of whoever saved; a refused one is not.
        var editor = await StaffIdAsync(Editor);
        Assert.Equal(2, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogAudits" WHERE "Action" = 'media.update' AND "ActorStaffId" = '{editor}' """));
    }

    [Theory]
    [InlineData("""{"expectedVersion":1,"displayName":"x","focalX":1.5,"focalY":0.5}""", "focalX")]
    [InlineData("""{"expectedVersion":1,"displayName":"x","focalX":0.5,"focalY":-0.1}""", "focalX")]
    [InlineData("""{"expectedVersion":1,"displayName":"   ","focalX":0.5,"focalY":0.5}""", "displayName")]
    [InlineData("""{"expectedVersion":1,"displayName":"<b>x</b>","focalX":0.5,"focalY":0.5}""", "displayName")]
    [InlineData("""{"expectedVersion":1,"displayName":"x","credit":"a<b","focalX":0.5,"focalY":0.5}""", "credit")]
    [InlineData("""{"expectedVersion":1,"displayName":"x","sourceUrl":"http://example.com/a","focalX":0.5,"focalY":0.5}""", "sourceUrl")]
    [InlineData("""{"expectedVersion":1,"displayName":"x","sourceUrl":"javascript:alert(1)","focalX":0.5,"focalY":0.5}""", "sourceUrl")]
    [InlineData("""{"expectedVersion":1,"displayName":"x","sourceUrl":"/internal","focalX":0.5,"focalY":0.5}""", "sourceUrl")]
    public async Task Descriptive_fields_are_plain_text_and_the_source_is_an_https_address(string json, string field)
    {
        using var host = await StartMediaAsync();
        var id = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800))).GetProperty("id").GetGuid();
        var request = new HttpRequestMessage(HttpMethod.Post, Root + $"/media/{id}/save")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        request.Headers.Add("Cookie", host.Cookie(Editor));
        request.Headers.TryAddWithoutValidation("Origin", AdminOrigin);

        var problem = await ProblemOf(await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, request)));

        Assert.Equal(("blog.validation", field), problem);
        Assert.Equal(1, (await MediaDetailAsync(host, id)).GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Each_route_is_closed_to_those_without_the_blog_permission_it_needs()
    {
        using var host = await StartMediaAsync();
        var good = BlogImageFixtures.Jpeg(1200, 800);
        var id = (await UploadPictureAsync(host, good)).GetProperty("id").GetGuid();

        HttpRequestMessage Route(string name, string? cookie) => name switch
        {
            "list" => AdminGet("/media", cookie),
            "detail" => AdminGet($"/media/{id}/detail", cookie),
            "usage" => AdminGet($"/media/{id}/usage", cookie),
            "original" => AdminGet($"/media/{id}", cookie),
            "preview" => AdminGet($"/media/{id}/preview/card", cookie),
            "upload" => Multipart("/media", cookie, [("file", "a.jpg", good)]),
            "batch" => Multipart("/media/bulk", cookie, [("files", "a.jpg", good)]),
            "save" => AdminPost($"/media/{id}/save", new { expectedVersion = 1, displayName = "x", focalX = 0.5, focalY = 0.5 }, cookie),
            _ => AdminPost($"/media/{id}/delete", new { expectedVersion = 1 }, cookie)
        };

        // Who may do what: reading and uploading = edit or publish; description = edit; delete = publish. A Property role (Desk, Manager) or the website flag (Site) gives nothing.
        var allowed = new Dictionary<string, string[]>
        {
            [Editor] = ["list", "detail", "usage", "original", "preview", "upload", "batch", "save"],
            [Publisher] = ["list", "detail", "usage", "original", "preview", "upload", "batch", "delete"],
            [Both] = ["list", "detail", "usage", "original", "preview", "upload", "batch", "save", "delete"],
            [Desk] = [],
            [Site] = [],
            [Manager] = []
        };
        foreach (var route in new[] { "list", "detail", "usage", "original", "preview", "upload", "batch", "save", "delete" })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(host, Route(route, null))).StatusCode);
            foreach (var (user, routes) in allowed.Where(entry => !entry.Value.Contains(route)))
            {
                Assert.True(
                    HttpStatusCode.Forbidden == (await SendAsync(host, Route(route, host.Cookie(user)))).StatusCode,
                    $"{user} must be refused on {route}");
            }
        }

        // And what they may do works, with the answer never cached (delete last: it removes the picture).
        foreach (var route in new[] { "list", "detail", "usage", "original", "preview" })
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, Route(route, host.Cookie(Editor))));
            Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        }

        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, Route("save", host.Cookie(Editor))));
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(host, Route("delete", host.Cookie(Publisher)))).StatusCode); // version 1 is stale now
        await AssertStatusAsync(HttpStatusCode.NoContent, DeleteMediaAsync(host, id, 2, host.Cookie(Publisher)));
    }

    [Fact]
    public async Task A_write_from_another_origin_and_the_local_gate_are_refused()
    {
        using var host = await StartMediaAsync();
        var good = BlogImageFixtures.Jpeg(1200, 800);
        var id = (await UploadPictureAsync(host, good)).GetProperty("id").GetGuid();

        var other = Multipart("/media/bulk", host.Cookie(Editor), [("files", "a.jpg", good)]);
        other.Headers.Remove("Origin");
        other.Headers.TryAddWithoutValidation("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(host, other)).StatusCode);
        Assert.Equal(1, await RowsAsync());

        using var local = await StartBlogAsync(Api.AdminCalendarAccessMode.LocalGate);
        foreach (var request in new[] { AdminGet("/media", null), AdminGet($"/media/{id}/detail", null), Multipart("/media/bulk", null, [("files", "a.jpg", good)]) })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(local, request)).StatusCode);
        }
    }

    // ---- BHA-BLOG-001-CP02-C1 ----

    private static HttpRequestMessage BulkWithIds(string cookie, byte[] picture, params string[] ids) =>
        Multipart("/media/bulk", cookie, ids.Select((_, index) => ("files", $"p{index}.jpg", picture)), ids.Select(id => ("ids", id)));

    /// <summary>A refused request has no effect at all: no row, no variant, no file, no upload audit.</summary>
    private async Task AssertNothingStoredAsync()
    {
        Assert.Equal(0, await RowsAsync());
        Assert.Equal(0, await RowsAsync("BlogMediaVariants"));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "BlogAudits" WHERE "Action" = 'media.upload' """));
        Assert.Empty(BlogFiles());
    }

    public static TheoryData<string[]> SameGuidWrittenTwoWays => new()
    {
        { ["11111111-2222-3333-4444-555555555555", "11111111222233334444555555555555"] }, // D and N
        { ["abcdef01-2345-6789-abcd-ef0123456789", "ABCDEF01-2345-6789-ABCD-EF0123456789"] }, // lower and upper case hex
        { ["{abcdef01-2345-6789-abcd-ef0123456789}", "abcdef01-2345-6789-abcd-ef0123456789"] }, // B and D
        { ["(ABCDEF01-2345-6789-abcd-ef0123456789)", "abcdef0123456789abcdef0123456789".Insert(8, "-").Insert(13, "-").Insert(18, "-").Insert(23, "-")] }, // P and D, mixed case
    };

    [Theory]
    [MemberData(nameof(SameGuidWrittenTwoWays))]
    public async Task Two_ids_that_are_the_same_guid_in_different_text_refuse_the_whole_request_before_anything_is_stored(string[] ids)
    {
        using var host = await StartMediaAsync();
        Assert.Equal(Guid.Parse(ids[0].Trim('{', '}', '(', ')')), Guid.Parse(ids[1].Trim('{', '}', '(', ')'))); // the fixture really is one Guid

        var response = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, BulkWithIds(host.Cookie(Editor), BlogImageFixtures.Jpeg(1200, 800), ids)));

        Assert.Equal(("blog.media-batch-invalid", "ids"), await ProblemOf(response));
        await AssertNothingStoredAsync();
    }

    [Fact]
    public async Task A_repeated_guid_at_the_end_of_the_list_still_refuses_the_whole_request_and_stores_nothing_of_the_valid_ones_before_it()
    {
        using var host = await StartMediaAsync();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        var response = await AssertStatusAsync(HttpStatusCode.BadRequest, SendAsync(host, BulkWithIds(
            host.Cookie(Editor), BlogImageFixtures.Jpeg(1200, 800), first.ToString("D"), second.ToString("D"), first.ToString("N").ToUpperInvariant())));

        Assert.Equal(("blog.media-batch-invalid", "ids"), await ProblemOf(response));
        await AssertNothingStoredAsync(); // before the fix the first two were stored and only the third was refused
    }

    [Fact]
    public async Task Different_guids_in_different_formats_are_all_taken_in_with_the_right_index_and_id_and_no_ids_still_works()
    {
        using var host = await StartMediaAsync();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid();
        var good = BlogImageFixtures.Jpeg(1200, 800);

        var result = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, BulkWithIds(host.Cookie(Editor), good, a.ToString("D"), b.ToString("N").ToUpperInvariant(), "{" + c + "}"))));

        Assert.Equal((3, 0), (result.GetProperty("succeeded").GetInt32(), result.GetProperty("failed").GetInt32()));
        var items = result.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal([0, 1, 2], items.Select(i => i.GetProperty("index").GetInt32()));
        Assert.Equal([a, b, c], items.Select(i => i.GetProperty("id").GetGuid()));
        Assert.Equal(3, await RowsAsync());
        foreach (var id in new[] { a, b, c })
        {
            Assert.Equal("current", (await MediaDetailAsync(host, id)).GetProperty("pipeline").GetString());
        }

        // And with no ids at all the server names them.
        var named = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, BatchAsync(host, host.Cookie(Editor), [("x.jpg", good), ("y.jpg", good)])));
        Assert.Equal(2, named.GetProperty("succeeded").GetInt32());
        Assert.Equal(5, await RowsAsync());
    }

    private async Task<JsonElement> ListAsync(BlogHost host, string query) =>
        await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/media" + query, host.Cookie(Editor)))));

    [Fact]
    public async Task A_page_number_far_past_the_end_is_an_empty_page_with_the_right_total_not_an_overflow()
    {
        using var host = await StartMediaAsync();
        var ids = new List<Guid>();
        foreach (var name in new[] { "a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg" })
        {
            Advance(TimeSpan.FromMinutes(1));
            ids.Add((await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), name)).GetProperty("id").GetGuid());
        }

        await PublishedAsync(host, ids[0], "dung-anh-1");
        await PublishedAsync(host, ids[1], "dung-anh-2"); // two used, three unused

        // (page - 1) * size no longer fits an int: before the fix this wrapped to a negative offset and PostgreSQL refused it (500).
        foreach (var (page, size) in new[] { (int.MaxValue, 24), (int.MaxValue, 50), (int.MaxValue, 2), (42949674, 50), (42949673, 50), (1431655766, 3), (1431655765, 3), (91, 24) })
        {
            var list = await ListAsync(host, $"?page={page}&pageSize={size}");
            Assert.Equal(5, list.GetProperty("total").GetInt32());
            Assert.Empty(list.GetProperty("items").EnumerateArray());
            Assert.Equal((page, size), (list.GetProperty("page").GetInt32(), list.GetProperty("pageSize").GetInt32())); // not clamped to the first or the last page
        }

        // The total is the filtered one, also for a page out of range.
        Assert.Equal(2, (await ListAsync(host, $"?usage=used&page={int.MaxValue}&pageSize=50")).GetProperty("total").GetInt32());
        Assert.Equal(3, (await ListAsync(host, $"?usage=unused&page={int.MaxValue}")).GetProperty("total").GetInt32());
        Assert.Equal(1, (await ListAsync(host, $"?q=c.jpg&page={int.MaxValue}&pageSize=7")).GetProperty("total").GetInt32());
        Assert.Equal(0, (await ListAsync(host, $"?q=no-such-picture&page={int.MaxValue}")).GetProperty("total").GetInt32());

        // The pages that exist are unchanged: newest first, each picture once.
        var seen = new List<Guid>();
        foreach (var page in new[] { 1, 2, 3, 4 })
        {
            seen.AddRange((await ListAsync(host, $"?pageSize=2&page={page}")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()));
        }

        Assert.Equal(Enumerable.Reverse(ids), seen);

        // Page and size are normalized as before.
        var defaults = await ListAsync(host, "?page=0&pageSize=0");
        Assert.Equal((1, BlogMediaLimits.DefaultPageSize, 5), (defaults.GetProperty("page").GetInt32(), defaults.GetProperty("pageSize").GetInt32(), defaults.GetProperty("items").GetArrayLength()));
        var negative = await ListAsync(host, "?page=-7&pageSize=500");
        Assert.Equal((1, BlogLimits.MaxPageSize), (negative.GetProperty("page").GetInt32(), negative.GetProperty("pageSize").GetInt32()));
    }

    [Fact]
    public async Task The_service_itself_does_not_overflow_for_a_caller_that_is_not_the_controller()
    {
        using var host = await StartMediaAsync();
        await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800));
        using var scope = host.Host.Services.CreateScope();
        var blog = scope.ServiceProvider.GetRequiredService<IAdminBlog>();

        foreach (var (page, size) in new[] { (int.MaxValue, int.MaxValue), (int.MaxValue, 50), (int.MaxValue, 1), (int.MaxValue, 0), (int.MaxValue, -1) })
        {
            var list = await blog.ListMediaAsync(new BlogMediaListQuery(null, null, page, size), CancellationToken.None);
            Assert.Equal(1, list.Total);
            Assert.Empty(list.Items);
            Assert.Equal(page, list.Page);
            Assert.InRange(list.PageSize, 1, BlogLimits.MaxPageSize);
        }
    }
}
