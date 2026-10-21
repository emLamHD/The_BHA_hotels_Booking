using System.Net;
using TheBha.Api.Seeding;
using TheBha.Application.Website;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-BLOG-001-CP02 (legacy pictures and orphan files): a picture uploaded before CP02 keeps its id, key and address and is served as in CP01 until the operator command gives it
/// variants; the command is guarded by the database name, writes nothing on a dry run, can be run again, never touches the original, and finds and removes — only after the
/// grace period — files nothing refers to. Run in-process against real PostgreSQL and a real media directory, as <c>Production</c>.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BlogMediaMaintenanceTests(PostgreSqlWebApplicationFactory factory) : BlogMediaTestSupport(factory)
{
    private string[] Args(params string[] more) => [BlogMediaMaintenanceCommand.Verb, "--expected-database", Factory.DatabaseName, .. more];

    /// <summary>A picture as CP01 stored it: its file and a row with the CP01 columns (the migration gave the new ones their values).</summary>
    private async Task<Guid> LegacyAsync(byte[] bytes)
    {
        var id = Guid.NewGuid();
        var key = $"blog/{Guid.NewGuid():N}.jpg";
        Directory.CreateDirectory(BlogFilesDirectory);
        await File.WriteAllBytesAsync(Path.Combine(Factory.MediaRoot, key), bytes);
        var info = HeroImageInspector.Inspect(bytes).Info!;
        await ExecuteAsync(
            $"""
            INSERT INTO "BlogMedia" ("Id","StorageKey","ContentType","ByteSize","Width","Height","CreatedByStaffId","CreatedAtUtc","DisplayName","UpdatedAtUtc")
            VALUES ('{id}','{key}','{info.ContentType}',{bytes.Length},{info.Width},{info.Height},'{await StaffIdAsync(Editor)}',now(),'Picture ' || left('{id}',8),now())
            """);
        return id;
    }

    [Fact]
    public async Task The_backfill_gives_a_legacy_picture_its_variants_and_changes_what_the_public_gets_without_touching_the_original()
    {
        using var host = await StartMediaAsync();
        var original = BlogImageFixtures.WithExif(BlogImageFixtures.Jpeg(1200, 800), orientation: 6, gps: true);
        var id = await LegacyAsync(original);
        var key = await ScalarAsync<string>($"""SELECT "StorageKey" FROM "BlogMedia" WHERE "Id" = '{id}' """);
        await PublishedAsync(host, id, "anh-cu"); // a legacy picture can be put in an article and published

        // Before: CP01 behaviour, now documented as the limit of an un-backfilled picture — the plain address serves the original; there are no variants.
        var before = await PublicOkAsync(host, "/posts/anh-cu?locale=vi");
        var etag = (await PublicAsync(host, "/posts/anh-cu?locale=vi")).Headers.ETag!.ToString();
        Assert.Equal(0, before.GetProperty("cover").GetProperty("variants").GetArrayLength());
        Assert.Equal((1200, 800), (before.GetProperty("cover").GetProperty("width").GetInt32(), before.GetProperty("cover").GetProperty("height").GetInt32()));
        var legacyServed = await AssertStatusAsync(HttpStatusCode.OK, host.Client.GetAsync($"/api/v1/website/blog/media/{id}"));
        Assert.Equal(original, await legacyServed.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await host.Client.GetAsync($"/api/v1/website/blog/media/{id}/1/article.webp")).StatusCode);
        var legacyDetail = await MediaDetailAsync(host, id);
        Assert.Equal(("legacy", 0), (legacyDetail.GetProperty("pipeline").GetString(), legacyDetail.GetProperty("variants").GetArrayLength()));
        var preview = await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{id}/preview/thumb", host.Cookie(Both))));
        Assert.Equal(original, await preview.Content.ReadAsByteArrayAsync()); // the editor still sees it: the original stands in for the missing preview

        var (dryExit, dryOutput) = await RunMaintenanceAsync(host, Args("--dry-run"));
        Assert.Equal(0, dryExit);
        Assert.Contains("pictures before CP02 (no variants): 1; processed: 0", dryOutput);
        Assert.Contains("DRY RUN", dryOutput);
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT "Generation" FROM "BlogMedia" WHERE "Id" = '{id}' """));
        Assert.Single(BlogFiles());

        var (exit, output) = await RunMaintenanceAsync(host, Args("--apply"));
        Assert.True(exit == 0, output);
        Assert.Contains("processed: 1", output);
        Assert.Contains("APPLIED", output);

        await using (var db = Factory.CreateDbContext())
        {
            var row = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.SingleAsync(
                Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.Include(db.BlogMedia, m => m.Variants), m => m.Id == id);
            Assert.Equal(key, row.StorageKey);
            Assert.Equal((1, 1, 6), (row.Generation, row.Version, row.Variants.Count));
            Assert.Equal(Sha(original), row.OriginalSha256);
            Assert.Equal((800, 1200), (row.Width, row.Height)); // as shown: the EXIF turn is applied
            Assert.Equal("Picture " + id.ToString()[..8], row.DisplayName);
            Assert.Equal(original, await File.ReadAllBytesAsync(Path.Combine(Factory.MediaRoot, key))); // the original is untouched
        }

        Assert.Equal(7, BlogFiles().Length);

        // After: the article lists the variants, its hash and validator moved on, and the plain address no longer hands out the GPS-carrying original.
        var after = await PublicOkAsync(host, "/posts/anh-cu?locale=vi");
        Assert.Equal(6, after.GetProperty("cover").GetProperty("variants").GetArrayLength());
        Assert.NotEqual(before.GetProperty("contentHash").GetString(), after.GetProperty("contentHash").GetString());
        await AssertStatusAsync(HttpStatusCode.OK, PublicAsync(host, "/posts/anh-cu?locale=vi", etag));
        var plain = await AssertStatusAsync(HttpStatusCode.OK, host.Client.GetAsync($"/api/v1/website/blog/media/{id}"));
        var plainBytes = await plain.Content.ReadAsByteArrayAsync();
        Assert.NotEqual(original, plainBytes);
        Assert.False(BlogImageFixtures.Contains(plainBytes, "Exif"));
        foreach (var variant in after.GetProperty("cover").GetProperty("variants").EnumerateArray())
        {
            await AssertStatusAsync(HttpStatusCode.OK, host.Client.GetAsync(variant.GetProperty("url").GetString()));
        }

        // Run again: nothing left to do, nothing changes.
        var (again, againOutput) = await RunMaintenanceAsync(host, Args("--apply"));
        Assert.Equal(0, again);
        Assert.Contains("pictures before CP02 (no variants): 0; processed: 0", againOutput);
        Assert.Equal(7, BlogFiles().Length);
    }

    [Fact]
    public async Task A_wrong_database_name_and_a_dry_run_change_nothing_and_a_missing_flag_is_a_usage_error()
    {
        using var host = await StartMediaAsync();
        var id = await LegacyAsync(BlogImageFixtures.Jpeg(1200, 800));

        var (wrong, wrongOutput) = await RunMaintenanceAsync(host, [BlogMediaMaintenanceCommand.Verb, "--expected-database", "some_other_database", "--apply"]);
        Assert.Equal(3, wrong);
        Assert.Contains("REFUSED", wrongOutput);

        Assert.Equal(2, (await RunMaintenanceAsync(host, [BlogMediaMaintenanceCommand.Verb, "--expected-database", Factory.DatabaseName])).Exit); // neither --dry-run nor --apply
        Assert.Equal(2, (await RunMaintenanceAsync(host, [BlogMediaMaintenanceCommand.Verb, "--apply"])).Exit); // no database named
        Assert.Equal(2, (await RunMaintenanceAsync(host, Args("--apply", "--grace-minutes", "-1"))).Exit);

        Assert.Equal(0, await ScalarAsync<int>($"""SELECT "Generation" FROM "BlogMedia" WHERE "Id" = '{id}' """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*)::int FROM "BlogMediaVariants" """));
        Assert.Single(BlogFiles());
    }

    [Fact]
    public async Task A_picture_whose_original_is_missing_is_reported_and_the_others_are_still_processed()
    {
        using var host = await StartMediaAsync();
        var lost = await LegacyAsync(BlogImageFixtures.Jpeg(1200, 800));
        var found = await LegacyAsync(BlogImageFixtures.Jpeg(1300, 900));
        File.Delete(Path.Combine(Factory.MediaRoot, await ScalarAsync<string>($"""SELECT "StorageKey" FROM "BlogMedia" WHERE "Id" = '{lost}' """)));

        var (exit, output) = await RunMaintenanceAsync(host, Args("--apply"));

        Assert.True(exit == 4, output);
        Assert.Contains($"PROBLEM: {lost}", output);
        Assert.Contains("processed: 1", output);
        Assert.Equal(0, await ScalarAsync<int>($"""SELECT "Generation" FROM "BlogMedia" WHERE "Id" = '{lost}' """));
        Assert.Equal(1, await ScalarAsync<int>($"""SELECT "Generation" FROM "BlogMedia" WHERE "Id" = '{found}' """));
        Assert.Equal(6, await ScalarAsync<int>($"""SELECT count(*)::int FROM "BlogMediaVariants" WHERE "MediaId" = '{found}' """));
    }

    [Fact]
    public async Task Files_nothing_refers_to_are_found_and_only_the_old_ones_are_removed()
    {
        using var host = await StartMediaAsync();
        var known = (await UploadPictureAsync(host, BlogImageFixtures.Jpeg(1200, 800))).GetProperty("id").GetGuid();
        var now = DateTimeOffset.UtcNow.AddHours(3);
        Factory.Clock.UtcNow = now;

        string Stray(string name, TimeSpan age)
        {
            var path = Path.Combine(BlogFilesDirectory, name);
            File.WriteAllBytes(path, [1, 2, 3]);
            File.SetLastWriteTimeUtc(path, (now - age).UtcDateTime);
            return path;
        }

        var oldOrphan = Stray($"{Guid.NewGuid():N}.png", TimeSpan.FromHours(2));
        var youngOrphan = Stray($"{Guid.NewGuid():N}.webp", TimeSpan.FromMinutes(5));
        var staleTemp = Stray($"{Guid.NewGuid():N}.jpg.{Guid.NewGuid():N}.tmp", TimeSpan.FromHours(2));
        var foreign = Stray("readme.txt", TimeSpan.FromHours(2));
        Assert.Equal(11, BlogFiles().Length);

        var (dryExit, dry) = await RunMaintenanceAsync(host, Args("--grace-minutes", "60", "--dry-run"));
        Assert.Equal(0, dryExit);
        Assert.Contains("(older than 60 min): 1; removed: 0; stale half-written files: 1", dry);
        Assert.Equal(11, BlogFiles().Length);

        var (applyExit, applied) = await RunMaintenanceAsync(host, Args("--grace-minutes", "60", "--apply"));
        Assert.Equal(0, applyExit);
        Assert.Contains("1; removed: 1; stale half-written files: 1", applied);
        Assert.False(File.Exists(oldOrphan));
        Assert.False(File.Exists(staleTemp));
        Assert.True(File.Exists(youngOrphan), "a file inside the grace period may belong to an upload in progress");
        Assert.True(File.Exists(foreign), "a file that is not ours is never touched");
        Assert.Equal(9, BlogFiles().Length);

        // With no grace the young one goes too; the picture's own seven files never do.
        Assert.Equal(0, (await RunMaintenanceAsync(host, Args("--grace-minutes", "0", "--apply"))).Exit);
        Assert.False(File.Exists(youngOrphan));
        Assert.True(File.Exists(foreign));
        Assert.Equal(8, BlogFiles().Length);

        Factory.Clock.UtcNow = DateTimeOffset.Parse("2026-10-21T08:00:00Z");
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{known}/preview/article", host.Cookie(Both))));
        await AssertStatusAsync(HttpStatusCode.OK, SendAsync(host, AdminGet($"/media/{known}", host.Cookie(Both))));
    }
}
