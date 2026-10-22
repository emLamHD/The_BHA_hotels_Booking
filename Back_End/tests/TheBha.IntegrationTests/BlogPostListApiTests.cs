using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP03-C2 (O1): the Admin post list. A translation with neither a draft nor a published revision (a PERSISTENCE FIXTURE: the schema allows it, no
/// API route commits it) must not turn the list into a 500, must not vanish from it or from its total, and must not be written to; and the page offset is worked
/// out in 64 bits, so a huge page is an empty page, not a database error.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogPostListApiTests(PostgreSqlWebApplicationFactory factory) : BlogTestSupport(factory)
{
    private async Task<(Guid Normal, Guid Other, Guid Broken)> SeedAsync(BlogHost host)
    {
        var media = await UploadAsync(host, host.Cookie(Editor));
        var (normal, _) = await PublishedAsync(host, media, "bai-binh-thuong", "Bài bình thường");
        var other = PostId(await CreatePostAsync(host, Draft(media, "bai-nhap", "Bài nháp")));
        var created = await CreatePostAsync(host, Draft(media, "bai-hong", "Bài không còn revision"));
        var broken = PostId(created);
        await TransitionAsync(host, broken, "vi", "archive", Version(created, "vi"));
        await ExecuteAsync($"""
            UPDATE "BlogPostRevisions" SET "State" = 'Frozen' WHERE "TranslationId" IN (SELECT "Id" FROM "BlogPostTranslations" WHERE "PostId" = '{broken}');
            UPDATE "BlogPostTranslations" SET "DraftRevisionId" = NULL WHERE "PostId" = '{broken}';
            """);
        return (normal, other, broken);
    }

    private static JsonElement Row(JsonElement list, Guid post) => list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetGuid() == post).GetProperty("translations")[0];

    [Fact]
    public async Task A_translation_with_no_revision_stays_in_the_list_with_empty_text_and_the_others_are_unchanged()
    {
        using var host = await StartBlogAsync();
        var (normal, other, broken) = await SeedAsync(host);
        var pointers = await ScalarAsync<string>($"""SELECT concat("Version", '|', "UpdatedAtUtc", '|', "Status", '|', coalesce("DraftRevisionId"::text, '-'), '|', coalesce("PublishedRevisionId"::text, '-')) FROM "BlogPostTranslations" WHERE "PostId" = '{broken}'""");
        var audits = await ScalarAsync<long>("""SELECT count(*) FROM "BlogAudits" """);

        var all = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts", host.Cookie(Editor)))));
        Assert.Equal(3, all.GetProperty("total").GetInt32());
        Assert.Equal(3, all.GetProperty("items").GetArrayLength());
        var brokenRow = Row(all, broken);
        Assert.Equal("Archived", brokenRow.GetProperty("status").GetString());
        Assert.Equal("", brokenRow.GetProperty("title").GetString());
        Assert.Equal("", brokenRow.GetProperty("slug").GetString());
        Assert.False(brokenRow.GetProperty("hasDraft").GetBoolean());
        Assert.Equal(JsonValueKind.Null, brokenRow.GetProperty("coverMediaId").ValueKind);
        Assert.Equal("Bài bình thường", Row(all, normal).GetProperty("title").GetString());
        Assert.Equal("Bài nháp", Row(all, other).GetProperty("title").GetString());
        Assert.True(Row(all, other).GetProperty("hasDraft").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, Row(all, normal).GetProperty("coverMediaId").ValueKind);

        // Filters keep it where it belongs, and the counts add up.
        var archived = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?status=Archived", host.Cookie(Publisher)))));
        Assert.Equal(1, archived.GetProperty("total").GetInt32());
        Assert.Equal(broken, archived.GetProperty("items")[0].GetProperty("id").GetGuid());
        var viList = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?locale=vi", host.Cookie(Both)))));
        Assert.Equal(3, viList.GetProperty("total").GetInt32());
        var published = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?status=Published", host.Cookie(Both)))));
        Assert.Equal(1, published.GetProperty("total").GetInt32());

        // Pages: two per page, the whole set once, nothing repeated.
        var first = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?pageSize=2&page=1", host.Cookie(Editor)))));
        var second = await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts?pageSize=2&page=2", host.Cookie(Editor)))));
        var seen = first.GetProperty("items").EnumerateArray().Concat(second.GetProperty("items").EnumerateArray()).Select(i => i.GetProperty("id").GetGuid()).ToList();
        Assert.Equal(3, seen.Distinct().Count());
        Assert.Equal(3, first.GetProperty("total").GetInt32());

        // Reading wrote nothing.
        Assert.Equal(pointers, await ScalarAsync<string>($"""SELECT concat("Version", '|', "UpdatedAtUtc", '|', "Status", '|', coalesce("DraftRevisionId"::text, '-'), '|', coalesce("PublishedRevisionId"::text, '-')) FROM "BlogPostTranslations" WHERE "PostId" = '{broken}'"""));
        Assert.Equal(audits, await ScalarAsync<long>("""SELECT count(*) FROM "BlogAudits" """));
    }

    [Fact]
    public async Task The_page_offset_is_worked_out_in_64_bits_and_a_page_past_the_end_is_an_empty_page()
    {
        using var host = await StartBlogAsync();
        var media = await UploadAsync(host, host.Cookie(Editor));
        for (var i = 0; i < 3; i++)
        {
            await CreatePostAsync(host, Draft(media, $"trang-{i}", $"Bài {i}"));
        }

        async Task<JsonElement> Page(string query) => await JsonAsync(await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet("/posts" + query, host.Cookie(Editor)))));

        // (page - 1) * pageSize wraps in 32 bits (2 147 483 646 * 20); in 64 bits it is far past the end.
        var huge = await Page($"?page={int.MaxValue}&pageSize=20");
        Assert.Equal(0, huge.GetProperty("items").GetArrayLength());
        Assert.Equal(3, huge.GetProperty("total").GetInt32());
        Assert.Equal(int.MaxValue, huge.GetProperty("page").GetInt32());
        Assert.Equal(20, huge.GetProperty("pageSize").GetInt32());

        // The edges: the last row is on the last page; the page after it is empty; with a filter the total is the filtered one.
        Assert.Equal(1, (await Page("?page=3&pageSize=1")).GetProperty("items").GetArrayLength());
        var past = await Page("?page=4&pageSize=1");
        Assert.Equal(0, past.GetProperty("items").GetArrayLength());
        Assert.Equal(3, past.GetProperty("total").GetInt32());
        var filtered = await Page($"?status=Published&page={int.MaxValue}&pageSize=100");
        Assert.Equal(0, filtered.GetProperty("items").GetArrayLength());
        Assert.Equal(0, filtered.GetProperty("total").GetInt32());

        // An ordinary page keeps its order: the newest-changed first, then by id, and no row repeats across pages.
        var ids = new List<Guid>();
        for (var page = 1; page <= 3; page++)
        {
            ids.AddRange((await Page($"?page={page}&pageSize=1")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()));
        }

        Assert.Equal(3, ids.Distinct().Count());
        Assert.Equal(ids, (await Page("?pageSize=3")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToList());
    }
}
