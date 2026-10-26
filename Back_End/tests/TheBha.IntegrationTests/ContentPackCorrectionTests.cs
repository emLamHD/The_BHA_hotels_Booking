using System.Net;
using System.Text.Json.Nodes;
using TheBha.Api.Seeding;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C1: one regression test for each failure the review of the first delivery found, each written against the commit
/// that had it (the red run is in the report) and kept green after the fix. Real PostgreSQL, a real media directory, the operator command in-process.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackCorrectionTests(PostgreSqlWebApplicationFactory factory)
{
    private async Task<Guid> ActorIdAsync(Target target) => Guid.Parse((await target.TextAsync($"""SELECT "Id" FROM "StaffAccounts" WHERE "NormalizedEmail" = upper('{Actor}')"""))!);

    [Fact]
    public async Task F1_a_rate_plan_the_target_has_under_another_id_is_used_by_dry_run_apply_and_verify()
    {
        await using var target = await NewTargetAsync(factory);
        var pack = PackDir();
        // The target has the property (same id) and a rate plan with the same code under another id.
        await target.InsertRowAsync("Properties", PackRow("Properties", l => l.Contains(RiversideId)));
        var own = Guid.NewGuid().ToString();
        var plan = PackRow("RatePlans", l => l.Contains(RiversideId));
        var packPlanId = plan["Id"]!.GetValue<string>();
        plan["Id"] = own;
        await target.InsertRowAsync("RatePlans", plan);

        var dry = await target.RunAsync(target.Import(pack, "--dry-run"));
        Assert.True(dry.Exit == 0, dry.Output);
        var apply = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(apply.Exit == 0, apply.Output);
        Assert.Contains("mapped to the target's own row: RatePlans", apply.Output);
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "RatePlans" """));
        Assert.Equal(180, await target.CountAsync($"""SELECT count(*) FROM "DailyRoomRates" WHERE "RatePlanId" = '{own}' """));
        Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "DailyRoomRates" WHERE "RatePlanId" = '{packPlanId}' """));
        var verify = await target.RunAsync(target.Verify(pack));
        Assert.True(verify.Exit == 0, verify.Output);
    }

    [Fact]
    public async Task F2_verify_finds_a_variant_file_that_is_missing_or_changed_and_the_public_address_agrees()
    {
        await using var target = await NewTargetAsync(factory);
        var pack = PackDir();
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);
        Assert.Equal(0, (await target.RunAsync(target.Verify(pack))).Exit);

        async Task<(string Key, string Url)> VariantAsync(int skip)
        {
            var row = (await target.TextAsync($"""SELECT v."StorageKey" || '|' || m."Id" || '/' || m."Generation" || '/' || v."Preset" || '.' || v."Format" FROM "BlogMediaVariants" v JOIN "BlogMedia" m ON m."Id" = v."MediaId" ORDER BY v."Id" OFFSET {skip} LIMIT 1"""))!.Split('|');
            return (row[0], $"/api/v1/website/blog/media/{row[1]}");
        }
        var client = target.Host.CreateClient();
        var missing = await VariantAsync(0);
        var changed = await VariantAsync(40);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(missing.Url)).StatusCode);

        File.Delete(Path.Combine(target.Media, missing.Key));
        var afterDelete = await target.RunAsync(target.Verify(pack));
        Assert.Equal(1, afterDelete.Exit);
        Assert.Contains(missing.Key, afterDelete.Output);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(missing.Url)).StatusCode);

        var path = Path.Combine(target.Media, changed.Key);
        var bytes = await File.ReadAllBytesAsync(path);
        bytes[^1] ^= 0xFF;
        await File.WriteAllBytesAsync(path, bytes);
        var afterChange = await target.RunAsync(target.Verify(pack));
        Assert.Equal(1, afterChange.Exit);
        Assert.Contains(changed.Key, afterChange.Output);
        Assert.Contains("does not match", afterChange.Output);
        // The public address serves whatever file is there (the site does not hash it): only verify can tell.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(changed.Url)).StatusCode);
    }

    [Fact]
    public async Task F3_scoped_imports_resolve_the_targets_own_catalog_without_writing_it_and_a_missing_dependency_stops_before_any_write()
    {
        await using var target = await NewTargetAsync(factory);
        var pack = PackDir();
        var own = Guid.NewGuid().ToString();
        var property = PackRow("Properties", l => l.Contains(RiversideId));
        property["Id"] = own;
        await target.InsertRowAsync("Properties", property);

        var catalog = await target.RunAsync(target.Import(pack, "--apply", "--groups", "catalog"));
        Assert.True(catalog.Exit == 0, catalog.Output);
        // The catalog group wrote the pack's other property (and its room types) and nothing else: the target's own property was used for the Riverside.
        Assert.Equal(5, await target.CountAsync("""SELECT count(*) FROM "RoomTypes" """));
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "Properties" """));

        var promotions = await target.RunAsync(target.Import(pack, "--apply", "--groups", "promotions"));
        Assert.True(promotions.Exit == 0, promotions.Output);
        Assert.Equal(4, await target.CountAsync($"""SELECT count(*) FROM "Promotions" WHERE "PropertyId" = '{own}' """));
        Assert.Equal(3, await target.CountAsync("""SELECT count(*) FROM "PromotionRoomTypes" """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));

        var blog = await target.RunAsync(target.Import(pack, "--apply", "--groups", "blog"));
        Assert.True(blog.Exit == 0, blog.Output);
        Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "BlogPostRevisions" WHERE "BodyJson"::text LIKE '%{RiversideId}%' """));
        Assert.True(await target.CountAsync($"""SELECT count(*) FROM "BlogPostRevisions" WHERE "BodyJson"::text LIKE '%{own}%' """) > 0);
        // Nothing outside the selected groups was written along the way.
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        Assert.Equal(5, await target.CountAsync("""SELECT count(*) FROM "RoomTypes" """));
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "RatePlans" """));

        // A target without the catalog: promotions and the Blog are refused before anything is written.
        await using var empty = await NewTargetAsync(factory);
        var refused = await empty.RunAsync(empty.Import(pack, "--apply", "--groups", "promotions"));
        Assert.Equal(1, refused.Exit);
        Assert.Contains("needs", refused.Output);
        Assert.Contains("the-bha-riverside", refused.Output);
        Assert.Equal(0, await empty.CountAsync("""SELECT count(*) FROM "Promotions" """));
        Assert.Equal(0, await empty.CountAsync("""SELECT count(*) FROM "PromotionMedia" """));
        Assert.Equal(0, empty.MediaFiles());
        var refusedBlog = await empty.RunAsync(empty.Import(pack, "--apply", "--groups", "blog"));
        Assert.Equal(1, refusedBlog.Exit);
        Assert.Equal(0, await empty.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task F4_a_picture_of_the_target_that_is_not_in_the_pack_is_never_touched_and_never_fails_the_import()
    {
        await using var target = await NewTargetAsync(factory);
        var pack = PackDir();
        var actor = await ActorIdAsync(target);
        // A picture of the target's own, from before the pipeline (generation 0) and with no original file at all.
        var unrelated = PackRow("BlogMedia", _ => true);
        var unrelatedId = Guid.NewGuid().ToString();
        unrelated["Id"] = unrelatedId; unrelated["StorageKey"] = $"blog/{Guid.NewGuid():N}.jpg"; unrelated["CreatedByStaffId"] = actor.ToString(); unrelated["UpdatedByStaffId"] = null;
        unrelated["Generation"] = 0;
        await target.InsertRowAsync("BlogMedia", unrelated);

        var scoped = await target.RunAsync(target.Import(pack, "--apply", "--groups", "catalog,promotions"));
        Assert.True(scoped.Exit == 0, scoped.Output);
        Assert.Equal(0, await target.CountAsync($"""SELECT "Generation" FROM "BlogMedia" WHERE "Id" = '{unrelatedId}' """));

        var blog = await target.RunAsync(target.Import(pack, "--apply", "--groups", "blog"));
        Assert.True(blog.Exit == 0, blog.Output);
        Assert.Equal(0, await target.CountAsync($"""SELECT "Generation" FROM "BlogMedia" WHERE "Id" = '{unrelatedId}' """));
        Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "BlogMediaVariants" WHERE "MediaId" = '{unrelatedId}' """));
        Assert.Equal(40, await target.CountAsync("""SELECT count(*) FROM "BlogMedia" WHERE "Generation" >= 1 """));
    }

    [Theory]
    [InlineData("")]
    [InlineData("/")]
    public async Task F5_a_media_root_behaves_the_same_with_or_without_a_trailing_separator(string suffix)
    {
        await using var target = await NewTargetAsync(factory, mediaRootSuffix: suffix);
        var pack = PackDir();
        var apply = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(apply.Exit == 0, apply.Output);
        Assert.Contains("VERIFIED", apply.Output);
        Assert.Equal(43 + 240, target.MediaFiles());
        Assert.Equal(0, (await target.RunAsync(target.Verify(pack))).Exit);

        var output = Path.Combine(Path.GetTempPath(), "bha-export-" + Guid.NewGuid().ToString("N"));
        try
        {
            var export = await target.RunAsync(ContentPackCommand.Export, "--expected-database", target.Database, "--out", output, "--source-media-origin", BaseUrl);
            Assert.True(export.Exit == 0, export.Output);
            Assert.Equal(43, Directory.EnumerateFiles(Path.Combine(output, "files"), "*", SearchOption.AllDirectories).Count());
        }
        finally { if (Directory.Exists(output)) Directory.Delete(output, recursive: true); }
    }

    private Task<Target> NewTargetAsync(PostgreSqlWebApplicationFactory f, bool withActor = true, string mediaRootSuffix = "") => ContentPackTestSupport.NewTargetAsync(f, withActor, mediaRootSuffix);
}
