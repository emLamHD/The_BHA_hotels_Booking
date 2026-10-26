using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Api.Seeding;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001: the committed content pack (<c>deploy/content/bha-site-content</c>) imported into throw-away PostgreSQL
/// databases through the real operator command, in-process, with a real media directory. Each test has its own database and picture
/// directory, so the shared test database is never touched.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed partial class ContentPackTests(PostgreSqlWebApplicationFactory factory)
{
    private const string BaseUrl = ContentPackTestSupport.BaseUrl;
    private const string RiversideId = ContentPackTestSupport.RiversideId;
    private const string Actor = ContentPackTestSupport.Actor;
    [GeneratedRegex(@"inserted\s+[1-9]")]
    private static partial Regex AnyInsert();

    private static string PackDir() => ContentPackTestSupport.PackDir();
    private static string CopyPack() => ContentPackTestSupport.CopyPack();
    private Task<ContentPackTestSupport.Target> NewTargetAsync(bool withActor = true) => ContentPackTestSupport.NewTargetAsync(factory, withActor);

    [Fact]
    public async Task A_fresh_database_gets_the_whole_pack_a_dry_run_writes_nothing_and_a_rerun_adds_nothing()
    {
        await using var target = await NewTargetAsync();
        var pack = PackDir();

        var dry = await target.RunAsync(target.Import(pack, "--dry-run"));
        Assert.Equal(0, dry.Exit);
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
        Assert.Equal(0, target.MediaFiles());
        Assert.Contains("DRYRUN", dry.Output);

        var applied = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(applied.Exit == 0, applied.Output);
        Assert.Contains("VERIFIED", applied.Output);
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "Properties" WHERE "Id" = '{RiversideId}' """));
        Assert.Equal(5, await target.CountAsync("""SELECT count(*) FROM "RoomTypes" """));
        Assert.Equal(14, await target.CountAsync("""SELECT count(*) FROM "PhysicalRooms" """));
        Assert.Equal(208, await target.CountAsync("""SELECT count(*) FROM "DailyRoomRates" """));
        Assert.Equal(35, await target.CountAsync("""SELECT count(*) FROM "Media" """));
        Assert.Equal(4, await target.CountAsync("""SELECT count(*) FROM "Promotions" """));
        Assert.Equal(3, await target.CountAsync("""SELECT count(*) FROM "PromotionMedia" """));
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
        Assert.Equal(30, await target.CountAsync("""SELECT count(*) FROM "BlogPostTranslations" """));
        Assert.Equal(40, await target.CountAsync("""SELECT count(*) FROM "BlogMedia" WHERE "Generation" >= 1 """));
        Assert.Equal(40, await target.CountAsync("""SELECT count(*) FROM "BlogMedia" m WHERE EXISTS (SELECT 1 FROM "BlogMediaVariants" v WHERE v."MediaId" = m."Id") """));
        // Every translation points at a revision of its own, and the published ones at a published revision.
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogPostTranslations" WHERE "Status" = 'Published' AND "PublishedRevisionId" IS NULL """));
        // The Customer origin is the target's; nothing local travelled.
        Assert.Equal(31, await target.CountAsync($"""SELECT count(*) FROM "Media" WHERE "Url" LIKE '{BaseUrl}/media/the-bha-riverside/%' """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Media" WHERE "Url" ILIKE '%localhost%' """));
        Assert.Equal("True", await target.TextAsync("""SELECT "IsActive" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));
        Assert.Equal(43 + 240, target.MediaFiles()); // 40 originals + 240 variants the pipeline made + 3 promotion covers

        var variants = await target.CountAsync("""SELECT count(*) FROM "BlogMediaVariants" """);
        var again = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(again.Exit == 0, again.Output);
        Assert.False(AnyInsert().IsMatch(again.Output), again.Output);
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
        Assert.Equal(40, await target.CountAsync("""SELECT count(*) FROM "BlogMedia" """));
        Assert.Equal(variants, await target.CountAsync("""SELECT count(*) FROM "BlogMediaVariants" """));
        Assert.Equal(43 + 240, target.MediaFiles());

        var verify = await target.RunAsync(ContentPackCommand.Verify, "--expected-database", target.Database, "--pack", pack, "--media-base-url", BaseUrl);
        Assert.Equal(0, verify.Exit);
    }

    [Fact]
    public async Task C_what_the_staff_changed_after_the_first_import_survives_every_rerun()
    {
        await using var target = await NewTargetAsync();
        var pack = PackDir();
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);

        await target.ExecuteAsync("""UPDATE "Promotions" SET "Title" = 'Edited by staff', "Version" = "Version" + 1 WHERE "Slug" = 'dat-som-giam-15' """);
        await target.ExecuteAsync("""UPDATE "RoomTypes" SET "Name" = 'Staff renamed' WHERE "Code" = 'RIV-2BR' """);
        await target.ExecuteAsync("""UPDATE "WebsiteLanguages" SET "IsActive" = false, "Version" = 2 WHERE "NormalizedCode" = 'en' """);

        var rerun = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(rerun.Exit == 0, rerun.Output);
        Assert.Equal("Edited by staff", await target.TextAsync("""SELECT "Title" FROM "Promotions" WHERE "Slug" = 'dat-som-giam-15' """));
        Assert.Equal("Staff renamed", await target.TextAsync("""SELECT "Name" FROM "RoomTypes" WHERE "Code" = 'RIV-2BR' """));
        Assert.Contains("kept (the target differs from the pack): Promotions", rerun.Output);
        Assert.Contains("kept (the target differs from the pack): RoomTypes", rerun.Output);
        // A language a staff member switched off stays off, and the output says so.
        Assert.Equal("False", await target.TextAsync("""SELECT "IsActive" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));
        Assert.Contains("kept (the target differs from the pack): WebsiteLanguages", rerun.Output);
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task B_a_slug_that_belongs_to_something_else_is_a_conflict_listed_and_nothing_is_written()
    {
        await using var target = await NewTargetAsync();
        var pack = PackDir();
        // The target already has a Blog category slug of the pack, owned by the migration's own category.
        await target.ExecuteAsync("""INSERT INTO "BlogCategorySlugs" ("Locale","Slug","CategoryId","IsCurrent") VALUES ('vi','am-thuc-da-nang','b10c0001-0000-4000-8000-000000000001', false)""");

        var result = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.Equal(4, result.Exit);
        Assert.Contains("CONFLICT", result.Output);
        Assert.Contains("am-thuc-da-nang", result.Output);
        // The catalog and promotions went in earlier in the same run: all of it was rolled back, and no picture was copied.
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Promotions" """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
        Assert.Equal(0, target.MediaFiles());

        // The conflict is resolved by the operator, and the same command finishes the job.
        await target.ExecuteAsync("""DELETE FROM "BlogCategorySlugs" WHERE "Slug" = 'am-thuc-da-nang' """);
        var rerun = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(rerun.Exit == 0, rerun.Output);
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task B_a_database_loaded_by_the_earlier_route_keeps_its_own_rates_and_offers_and_receives_the_rest()
    {
        await using var target = await NewTargetAsync();
        var pack = PackDir();
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply", "--groups", "catalog,promotions"))).Exit);

        // This database was loaded by the earlier route, not by this command: it has no ledger of what was imported.
        await target.ExecuteAsync("""DELETE FROM "ContentPackLedger" """);
        // The earlier route (a dump of a demo database) gave the same property, room types and photographs the same ids, but its rates and offers
        // other ids, another window (it ends on 2026-12-20, ours on 2026-12-25) and prices the staff may have changed.
        await target.ExecuteAsync("""UPDATE "DailyRoomRates" SET "Id" = gen_random_uuid() """);
        await target.ExecuteAsync("""UPDATE "DailyRoomRates" SET "Amount" = "Amount" + 1000 WHERE "StayDate" < '2026-11-10' """);
        await target.ExecuteAsync($"""DELETE FROM "DailyRoomRates" WHERE "StayDate" > '2026-12-20' AND "PropertyId" = '{RiversideId}' """);
        await target.ExecuteAsync("""DELETE FROM "PromotionRoomTypes" """);
        await target.ExecuteAsync("""DELETE FROM "Promotions" """);
        await target.ExecuteAsync("""DELETE FROM "PromotionMedia" """);
        var own = JsonNode.Parse(File.ReadLines(Path.Combine(pack, "rows", "Promotions.jsonl")).First(l => l.Contains("\"dat-som-giam-15\"")))!.AsObject();
        var ownId = Guid.NewGuid().ToString();
        own["Id"] = ownId; own["CoverMediaId"] = null; own["ShowOnHomepage"] = false; own["CreateOperationId"] = Guid.NewGuid().ToString();
        await using (var connection = new NpgsqlConnection(target.ConnectionString))
        {
            await connection.OpenAsync();
            await using var insert = new NpgsqlCommand("""INSERT INTO "Promotions" SELECT * FROM jsonb_populate_record(NULL::"Promotions", @j)""", connection);
            insert.Parameters.Add(new NpgsqlParameter("j", NpgsqlTypes.NpgsqlDbType.Jsonb) { Value = own.ToJsonString() });
            await insert.ExecuteNonQueryAsync();
        }
        var rates = await target.CountAsync("""SELECT count(*) FROM "DailyRoomRates" """);
        var sum = decimal.Parse(await target.TextAsync("""SELECT coalesce(sum("Amount"), 0) FROM "DailyRoomRates" """) ?? "0", System.Globalization.CultureInfo.InvariantCulture);
        var later = File.ReadLines(Path.Combine(pack, "rows", "DailyRoomRates.jsonl")).Select(l => JsonNode.Parse(l)!.AsObject()).Where(r => r["PropertyId"]!.GetValue<string>() == RiversideId && string.CompareOrdinal(r["StayDate"]!.GetValue<string>(), "2026-12-20") > 0).ToList();

        var result = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(result.Exit == 0, result.Output);
        Assert.DoesNotContain("CONFLICT", result.Output);
        Assert.Contains("mapped to the target's own row: Promotions dat-som-giam-15", result.Output);
        // Its own rates (and their ids and prices) stay; only the nights it did not have are added.
        Assert.Equal(rates + later.Count, await target.CountAsync("""SELECT count(*) FROM "DailyRoomRates" """));
        Assert.Equal(sum + later.Sum(r => r["Amount"]!.GetValue<decimal>()), decimal.Parse((await target.TextAsync("""SELECT sum("Amount") FROM "DailyRoomRates" """))!, System.Globalization.CultureInfo.InvariantCulture));
        // Its own offer stays as it is (no room-type links, no cover of the pack); the other three arrive with theirs.
        Assert.Equal(4, await target.CountAsync("""SELECT count(*) FROM "Promotions" """));
        Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "Promotions" WHERE "Slug" = 'dat-som-giam-15' AND "Id" = '{ownId}' """));
        Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "PromotionRoomTypes" WHERE "PromotionId" = '{ownId}' """));
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "PromotionMedia" """));
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task D_a_damaged_pack_is_refused_before_the_database_is_touched_and_a_failed_copy_leaves_the_database_as_it_was()
    {
        await using var target = await NewTargetAsync();
        var pack = CopyPack();
        try
        {
            var firstFile = Directory.EnumerateFiles(Path.Combine(pack, "files", "blog")).First();
            File.Delete(firstFile);
            var missing = await target.RunAsync(target.Import(pack, "--apply"));
            Assert.Equal(1, missing.Exit);
            Assert.Contains("missing from the pack", missing.Output);
            Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Properties" """));

            File.Copy(Path.Combine(PackDir(), "files", "blog", Path.GetFileName(firstFile)), firstFile);
            File.AppendAllText(Path.Combine(pack, "rows", "Promotions.jsonl"), "\n");
            var changed = await target.RunAsync(target.Import(pack, "--apply"));
            Assert.Equal(1, changed.Exit);
            Assert.Contains("does not match the manifest", changed.Output);
            Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        }
        finally { Directory.Delete(pack, recursive: true); }

        // A copy that fails after every row was accepted (here: "blog" is a file, so the directory cannot be made) rolls the rows back.
        Directory.CreateDirectory(target.Media);
        await File.WriteAllTextAsync(Path.Combine(target.Media, "blog"), "in the way");
        var failed = await target.RunAsync(target.Import(PackDir(), "--apply"));
        Assert.Equal(1, failed.Exit);
        Assert.Contains("could not be copied", failed.Output);
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));

        File.Delete(Path.Combine(target.Media, "blog"));
        var finished = await target.RunAsync(target.Import(PackDir(), "--apply"));
        Assert.True(finished.Exit == 0, finished.Output);
        Assert.Contains("VERIFIED", finished.Output);
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task The_wrong_database_name_the_missing_actor_and_a_local_origin_are_refused()
    {
        await using var target = await NewTargetAsync(withActor: false);
        var pack = PackDir();

        var wrong = await target.RunAsync(ContentPackCommand.Import, "--expected-database", "not_this_one", "--pack", pack, "--media-base-url", BaseUrl, "--actor-email", Actor, "--dry-run");
        Assert.Equal(3, wrong.Exit);

        var noActor = await target.RunAsync(target.Import(pack, "--dry-run"));
        Assert.Equal(1, noActor.Exit);
        Assert.Contains("--actor-email must name an existing", noActor.Output);

        var local = await target.RunAsync(ContentPackCommand.Import, "--expected-database", target.Database, "--pack", pack, "--media-base-url", "https://localhost:3000", "--actor-email", Actor, "--dry-run");
        Assert.Equal(1, local.Exit);
        Assert.Contains("points at this machine", local.Output);

        // Catalog and promotions need no Staff: a fresh database takes them first, then its Staff, then the rest.
        var first = await target.RunAsync(ContentPackCommand.Import, "--expected-database", target.Database, "--pack", pack, "--media-base-url", BaseUrl, "--groups", "catalog,promotions", "--apply");
        Assert.True(first.Exit == 0, first.Output);
        Assert.Equal(4, await target.CountAsync("""SELECT count(*) FROM "Promotions" """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
    }

    [Fact]
    public async Task The_targets_own_property_is_used_when_it_has_another_id_and_the_pack_follows_it()
    {
        await using var target = await NewTargetAsync();
        var pack = PackDir();
        // The target already has "the-bha-riverside" under another id (its staff made it by hand).
        var line = File.ReadLines(Path.Combine(pack, "rows", "Properties.jsonl")).First(l => l.Contains(RiversideId));
        var own = Guid.NewGuid().ToString();
        var row = JsonNode.Parse(line)!.AsObject();
        row["Id"] = own;
        await using (var connection = new NpgsqlConnection(target.ConnectionString))
        {
            await connection.OpenAsync();
            await using var insert = new NpgsqlCommand("""INSERT INTO "Properties" SELECT * FROM jsonb_populate_record(NULL::"Properties", @j)""", connection);
            insert.Parameters.Add(new NpgsqlParameter("j", NpgsqlTypes.NpgsqlDbType.Jsonb) { Value = row.ToJsonString() });
            await insert.ExecuteNonQueryAsync();
        }

        var result = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(result.Exit == 0, result.Output);
        Assert.Contains("mapped to the target's own row: Properties", result.Output);
        Assert.Equal(2, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        Assert.Equal(3, await target.CountAsync($"""SELECT count(*) FROM "RoomTypes" WHERE "PropertyId" = '{own}' """));
        Assert.Equal(180, await target.CountAsync($"""SELECT count(*) FROM "DailyRoomRates" WHERE "PropertyId" = '{own}' """));
        Assert.Equal(4, await target.CountAsync($"""SELECT count(*) FROM "Promotions" WHERE "PropertyId" = '{own}' """));
        // The Blog's "propertyIntro" blocks name the target's property, not the pack's.
        Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "BlogPostRevisions" WHERE "BodyJson"::text LIKE '%{RiversideId}%' """));
        Assert.True(await target.CountAsync($"""SELECT count(*) FROM "BlogPostRevisions" WHERE "BodyJson"::text LIKE '%{own}%' """) > 0);
    }

    [Fact]
    public async Task Export_of_an_imported_database_gives_the_packs_rows_back_and_an_unclassified_table_stops_an_export()
    {
        await using var target = await NewTargetAsync();
        var pack = PackDir();
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);

        var output = Path.Combine(Path.GetTempPath(), "bha-export-" + Guid.NewGuid().ToString("N"));
        try
        {
            var export = await target.RunAsync(ContentPackCommand.Export, "--expected-database", target.Database, "--out", output, "--source-media-origin", BaseUrl);
            Assert.True(export.Exit == 0, export.Output);
            foreach (var table in new[] { "Properties", "RoomTypes", "PhysicalRooms", "DailyRoomRates", "Promotions", "PromotionRoomTypes", "BlogPosts", "BlogPostRevisions", "BlogRevisionCategories", "BlogRevisionMedia", "BlogPostSlugs" })
                Assert.Equal(await File.ReadAllTextAsync(Path.Combine(pack, "rows", table + ".jsonl")), await File.ReadAllTextAsync(Path.Combine(output, "rows", table + ".jsonl")));
            Assert.Equal(Directory.EnumerateFiles(Path.Combine(pack, "files"), "*", SearchOption.AllDirectories).Count(), Directory.EnumerateFiles(Path.Combine(output, "files"), "*", SearchOption.AllDirectories).Count());
        }
        finally { if (Directory.Exists(output)) Directory.Delete(output, recursive: true); }

        await target.ExecuteAsync("""CREATE TABLE "ZzNobodyClassifiedThis" ("Id" int PRIMARY KEY)""");
        var refused = await target.RunAsync(ContentPackCommand.Export, "--expected-database", target.Database, "--out", output + "-2");
        Assert.Equal(1, refused.Exit);
        Assert.Contains("unclassified tables", refused.Output);
        Assert.Contains("ZzNobodyClassifiedThis", refused.Output);
    }
}
