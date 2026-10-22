using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SkiaSharp;
using TheBha.Domain.Blog;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02 acceptance 8, 9 and 11: who can fetch which bytes, when, and with what cache; that no address, variant, conditional request or other route gets around the
/// publication gate; that the private original is never public; and that what is recorded survives a restart of the API on the same database and media directory.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogMediaServingApiTests(PostgreSqlWebApplicationFactory factory) : BlogMediaTestSupport(factory)
{
    private const string Api = "/api/v1/website/blog/media/";

    private static Task<HttpResponseMessage> RawAsync(BlogHost host, string url, params (string Name, string Value)[] headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (name, value) in headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        return host.Client.SendAsync(request);
    }

    /// <summary>Every address a visitor could try for a picture of generation 1: the plain one and the six variants.</summary>
    private static string[] AddressesOf(Guid id) =>
        [Api + id, .. new[] { "thumb", "card", "article" }.SelectMany(preset => new[] { "webp", "jpg" }.Select(format => $"{Api}{id}/1/{preset}.{format}"))];

    private static async Task AssertAllAsync(BlogHost host, HttpStatusCode expected, IEnumerable<string> urls, params (string Name, string Value)[] headers)
    {
        foreach (var url in urls)
        {
            var response = await RawAsync(host, url, headers);
            Assert.True(response.StatusCode == expected, $"{url} [{string.Join(", ", headers.Select(h => h.Name))}] answered {(int)response.StatusCode}, expected {(int)expected}");
        }
    }

    [Fact]
    public async Task A_picture_is_public_only_while_a_published_article_uses_it_at_every_address_and_for_every_kind_of_request()
    {
        using var host = await StartMediaAsync();
        var original = BlogImageFixtures.WithExif(BlogImageFixtures.Jpeg(1600, 1000), orientation: 1, gps: true);
        var id = (await UploadPictureAsync(host, original, "gps.jpg")).GetProperty("id").GetGuid();
        var created = await CreatePostAsync(host, Draft(id, "co-anh"));
        var postId = PostId(created);

        // A draft uses it: nothing is public, whatever the address (the files exist on disk).
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(id));
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(id), ("If-None-Match", "*"), ("If-Modified-Since", "Wed, 21 Oct 2099 07:28:00 GMT"));

        var published = await TransitionAsync(host, postId, "vi", "publish", Version(created, "vi"));
        var detail = await PublicOkAsync(host, "/posts/co-anh?locale=vi");
        var served = new List<byte[]>();

        // Published: the plain address and each variant the article lists are served, as what they say, with the short cache and nothing else.
        var listed = detail.GetProperty("cover").GetProperty("variants").EnumerateArray().ToArray();
        Assert.Equal(6, listed.Length);
        Assert.Equal(AddressesOf(id)[1..].OrderBy(u => u), listed.Select(v => v.GetProperty("url").GetString()!).OrderBy(u => u));
        foreach (var variant in listed)
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, RawAsync(host, variant.GetProperty("url").GetString()!));
            var bytes = await response.Content.ReadAsByteArrayAsync();
            served.Add(bytes);
            Assert.Equal(variant.GetProperty("type").GetString(), response.Content.Headers.ContentType!.MediaType);
            Assert.Equal("public, max-age=300", response.Headers.CacheControl!.ToString());
            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Contains("sandbox", response.Headers.GetValues("Content-Security-Policy").Single());
            Assert.Null(response.Headers.ETag);
            Assert.Null(response.Content.Headers.LastModified);
            using var decoded = SKBitmap.Decode(bytes);
            Assert.Equal((variant.GetProperty("width").GetInt32(), variant.GetProperty("height").GetInt32()), (decoded.Width, decoded.Height));
            Assert.False(BlogImageFixtures.Contains(bytes, "Exif"));
        }

        var plain = await AssertStatusAsync(HttpStatusCode.OK, RawAsync(host, Api + id));
        var plainBytes = await plain.Content.ReadAsByteArrayAsync();
        served.Add(plainBytes);
        Assert.Equal("image/jpeg", plain.Content.Headers.ContentType!.MediaType);
        Assert.Equal("public, max-age=300", plain.Headers.CacheControl!.ToString());
        Assert.False(BlogImageFixtures.Contains(plainBytes, "Exif"), "the plain address must not serve the GPS-carrying original");
        Assert.DoesNotContain(served, bytes => bytes.SequenceEqual(original)); // the private original is never what a visitor gets

        // The cache is the 300 seconds CP01 accepted — no stale extension, nothing longer.
        foreach (var url in AddressesOf(id))
        {
            var cache = (await RawAsync(host, url)).Headers.CacheControl!.ToString();
            Assert.Equal("public, max-age=300", cache);
            Assert.DoesNotContain("stale", cache);
            Assert.DoesNotContain("immutable", cache);
        }

        // A conditional request is answered by the same gate, not by a cache validator: while published it is a 200.
        await AssertAllAsync(host, HttpStatusCode.OK, AddressesOf(id), ("If-None-Match", "*"), ("If-Modified-Since", "Wed, 21 Oct 2099 07:28:00 GMT"));

        // Addresses that are not a variant of this picture are not served: another generation, a preset or format that does not exist, a traversal, another case.
        foreach (var url in new[]
                 {
                     $"{Api}{id}/0/article.webp", $"{Api}{id}/2/article.webp", $"{Api}{id}/-1/article.webp", $"{Api}{id}/1/huge.webp", $"{Api}{id}/1/card.gif",
                     $"{Api}{id}/1/card.webp.exe", $"{Api}{id}/1/..%2Fcard.webp", $"{Api}{id}/1/CARD.webp", $"{Api}{id}/1/card", $"{Api}{id}/x/card.webp", $"{Api}{Guid.NewGuid()}/1/card.webp"
                 })
        {
            var status = (await RawAsync(host, url)).StatusCode;
            Assert.True(status == HttpStatusCode.NotFound, $"{url} answered {(int)status}");
        }

        // Unpublishing closes every address at the very next request, conditional or not.
        var unpublished = await TransitionAsync(host, postId, "vi", "unpublish", Version(published, "vi"));
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(id));
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(id), ("If-None-Match", "*"), ("If-Modified-Since", "Wed, 21 Oct 2099 07:28:00 GMT"));
        Assert.Equal("no-store", (await RawAsync(host, Api + id)).Headers.CacheControl!.ToString());

        // Republished it is back; archived it is closed again.
        var again = await TransitionAsync(host, postId, "vi", "publish", Version(unpublished, "vi"));
        await AssertAllAsync(host, HttpStatusCode.OK, AddressesOf(id));
        await TransitionAsync(host, postId, "vi", "archive", Version(again, "vi"));
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(id));
    }

    [Fact]
    public async Task The_json_is_always_revalidated_and_an_unpublish_beats_a_validator_the_client_holds()
    {
        using var host = await StartMediaAsync();
        var id = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800))).GetProperty("id").GetGuid();
        var (postId, version) = await PublishedAsync(host, id, "ban-tin");

        var response = await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts/ban-tin?locale=vi"));
        var etag = response.Headers.ETag!.ToString();
        Assert.Equal("no-cache", response.Headers.CacheControl!.ToString());
        await AssertStatusAsync(HttpStatusCode.NotModified, PublicAsync(host, "/posts/ban-tin?locale=vi", etag));
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts/ban-tin?locale=vi", "W/\"other\""));

        await TransitionAsync(host, postId, "vi", "unpublish", version);
        await AssertStatusAsync(HttpStatusCode.NotFound, PublicAsync(host, "/posts/ban-tin?locale=vi", etag));
    }

    [Fact]
    public async Task A_picture_used_only_by_a_draft_or_only_by_history_is_not_public_even_when_its_address_is_guessed()
    {
        using var host = await StartMediaAsync();
        var live = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), "live.jpg")).GetProperty("id").GetGuid();
        var past = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), "past.jpg")).GetProperty("id").GetGuid();
        var middle = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), "middle.jpg")).GetProperty("id").GetGuid();
        var draftOnly = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800), "draft.jpg")).GetProperty("id").GetGuid();
        static System.Text.Json.Nodes.JsonObject Image(Guid media) => new() { ["type"] = "image", ["mediaId"] = media.ToString(), ["alt"] = "Ảnh" };

        // Revision 1 is published with `past` as its cover.
        var (postId, v1) = await PublishedAsync(host, past, "bai-cu");
        await AssertAllAsync(host, HttpStatusCode.OK, AddressesOf(past));

        // Revision 2 goes live with `live` as cover and `middle` in the body: `past` is now only in history.
        var rev2 = await SaveDraftAsync(host, postId, "vi", v1, Draft(live, "bai-cu", "Bài cũ", d => d["body"] = BodyOf(Paragraph("x"), Image(middle))));
        var v2 = await TransitionAsync(host, postId, "vi", "publish", Version(rev2, "vi"));
        await AssertAllAsync(host, HttpStatusCode.OK, [.. AddressesOf(live), .. AddressesOf(middle)]);
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(past));

        // Revision 3 goes live without `middle`: it too is only in history.
        var rev3 = await SaveDraftAsync(host, postId, "vi", Version(v2, "vi"), Draft(live, "bai-cu", "Bài cũ"));
        var v3 = await TransitionAsync(host, postId, "vi", "publish", Version(rev3, "vi"));
        await AssertAllAsync(host, HttpStatusCode.NotFound, [.. AddressesOf(past), .. AddressesOf(middle)]);

        // An open draft uses `draftOnly`: not public until that draft is published.
        await SaveDraftAsync(host, postId, "vi", Version(v3, "vi"), Draft(live, "bai-cu", "Bài cũ", d => d["body"] = BodyOf(Paragraph("x"), Image(draftOnly))));
        await AssertAllAsync(host, HttpStatusCode.NotFound, AddressesOf(draftOnly));
        await AssertAllAsync(host, HttpStatusCode.OK, AddressesOf(live));
    }

    [Fact]
    public async Task No_other_route_serves_a_blog_picture_and_the_public_answers_name_no_path_key_or_staff()
    {
        using var host = await StartMediaAsync();
        var id = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800))).GetProperty("id").GetGuid();
        var (_, _) = await PublishedAsync(host, id, "xuat-ban");
        var key = await ScalarAsync<string>($"""SELECT "StorageKey" FROM "BlogMedia" WHERE "Id" = '{id}' """);
        var variantKey = await ScalarAsync<string>($"""SELECT "StorageKey" FROM "BlogMediaVariants" WHERE "MediaId" = '{id}' LIMIT 1""");

        // The id and the stored names, asked of every other media route and as plain paths: nothing answers with bytes.
        var urls = new[]
        {
            $"/api/v1/website/hero/media/{id}", $"/api/v1/website/promotions/media/{id}", $"/{key}", $"/{variantKey}", $"/media/{Path.GetFileName(key)}", $"/blog/{Path.GetFileName(key)}",
            $"{Api}{Path.GetFileNameWithoutExtension(key)}", $"{Api}{key}", $"/api/v1/website/blog/files/{Path.GetFileName(key)}"
        };
        foreach (var url in urls)
        {
            var response = await RawAsync(host, url);
            Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed, $"{url} answered {(int)response.StatusCode}");
            Assert.False(response.Content.Headers.ContentType?.MediaType?.StartsWith("image/", StringComparison.Ordinal) ?? false);
        }

        await AssertStatusAsync(HttpStatusCode.NotFound, SendAsync(host, Get($"/api/admin/v1/website/hero/media/{id}", host.Cookie(Site))));
        Assert.NotEqual(HttpStatusCode.OK, (await SendAsync(host, Get($"/api/admin/v1/catalog/properties/{host.PropertyId}/media/{id}", host.Cookie(Site)))).StatusCode);

        // The public JSON names no disk path, storage key, hash or Staff member.
        var staff = (await StaffIdAsync(Editor)).ToString();
        foreach (var path in new[] { "/posts/xuat-ban?locale=vi", "/posts?locale=vi", "/home-section?locale=vi" })
        {
            var text = await (await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, path))).Content.ReadAsStringAsync();
            foreach (var secret in new[] { Factory.MediaRoot, key, variantKey, "storageKey", "StorageKey", "sha256", "Sha256", "createdBy", staff, "focal", "credit", "licence", "sourceUrl" })
            {
                Assert.DoesNotContain(secret, text, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public async Task What_is_recorded_survives_a_restart_on_the_same_database_and_media_directory_and_matches_its_hashes()
    {
        string[] urls;
        Guid id;
        string originalSha;
        var variantHashes = new Dictionary<string, string>();
        using (var first = await StartMediaAsync())
        {
            var original = BlogImageFixtures.WithExif(BlogImageFixtures.Jpeg(1800, 1200), orientation: 1, gps: true);
            id = (await UploadPictureAsync(first, original, "restart.jpg")).GetProperty("id").GetGuid();
            await PublishedAsync(first, id, "sau-khi-khoi-dong-lai");
            originalSha = Sha(original);
            urls = AddressesOf(id);
            foreach (var url in urls[1..])
            {
                variantHashes[url] = Sha(await (await AssertStatusAsync(HttpStatusCode.OK, RawAsync(first, url))).Content.ReadAsByteArrayAsync());
            }
        }

        // A new host: a new process's worth of state (new services, new data-protection keys), the same PostgreSQL database and the same media directory.
        using var second = CreateHost();
        using var client = CreateHttpsClient(second);
        var cookie = await LoginAsync(client, Both);
        var restarted = new BlogHost(second, client, Guid.Empty, new Dictionary<string, string> { [Both] = cookie });

        var original2 = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(restarted, AdminGet($"/media/{id}", cookie)));
        Assert.Equal(originalSha, Sha(await original2.Content.ReadAsByteArrayAsync()));
        foreach (var url in urls[1..])
        {
            var response = await AssertStatusAsync(HttpStatusCode.OK, RawAsync(restarted, url));
            Assert.Equal(variantHashes[url], Sha(await response.Content.ReadAsByteArrayAsync()));
        }

        // Every recorded file is on disk with exactly the recorded hash: the database and the media directory can be restored together and checked.
        await using var db = Factory.CreateDbContext();
        var row = await db.BlogMedia.Include(m => m.Variants).SingleAsync(m => m.Id == id);
        Assert.Equal(originalSha, Sha(await File.ReadAllBytesAsync(Path.Combine(Factory.MediaRoot, row.StorageKey))));
        Assert.Equal(originalSha, row.OriginalSha256);
        Assert.Equal(6, row.Variants.Count);
        foreach (var variant in row.Variants)
        {
            var bytes = await File.ReadAllBytesAsync(Path.Combine(Factory.MediaRoot, variant.StorageKey));
            Assert.Equal(variant.Sha256, Sha(bytes));
            Assert.Equal(variant.ByteSize, bytes.Length);
        }

        Assert.Equal(7, BlogFiles().Length);
    }
}
