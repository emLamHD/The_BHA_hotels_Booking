using System.Text.Json.Nodes;
using Npgsql;
using TheBha.Api.Seeding;
using TheBha.Infrastructure.ContentPack;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C1, the parts of the Owner's scope the first delivery left out: the export is one snapshot (F6), the website configuration travels (S1),
/// a row the staff deleted after an import is not put back while one a failed run never placed is (S3), and verify says what it found (S4).
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackScopeTests(PostgreSqlWebApplicationFactory factory)
{
    private static string NewDirectory(string prefix) => Path.Combine(Path.GetTempPath(), prefix + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task F6_the_export_is_one_snapshot_even_when_the_staff_commit_a_parent_and_its_child_while_it_runs()
    {
        await using var source = await NewTargetAsync(factory);
        Assert.Equal(0, (await source.RunAsync(source.Import(PackDir(), "--apply"))).Exit);
        var output = NewDirectory("bha-snapshot-");
        var interfered = false;
        try
        {
            var options = new ContentPackExportOptions(output, source.Database, [], source.Media, BaseUrl, null, async (table, ct) =>
            {
                // After the posts were read and before their translations are: a second connection commits a new post and its translation.
                if (table != "BlogPosts" || interfered) return;
                interfered = true;
                var staffId = (await source.TextAsync($"""SELECT "Id" FROM "StaffAccounts" WHERE "NormalizedEmail" = upper('{Actor}')"""))!;
                var post = PackRow("BlogPosts", _ => true); var postId = Guid.NewGuid().ToString();
                post["Id"] = postId; post["CreatedByStaffId"] = staffId;
                var translation = PackRow("BlogPostTranslations", _ => true);
                translation["Id"] = Guid.NewGuid().ToString(); translation["PostId"] = postId; translation["Status"] = "Draft"; translation["DraftRevisionId"] = null; translation["PublishedRevisionId"] = null; translation["FirstPublishedAtUtc"] = null;
                translation["UpdatedByStaffId"] = staffId;
                await source.InsertRowAsync("BlogPosts", post);
                await source.InsertRowAsync("BlogPostTranslations", translation);
            });
            var report = await ContentPackExporter.ExportAsync(source.ConnectionString, options, CancellationToken.None);
            Assert.True(interfered);
            Assert.True(report.Ok, string.Join("\n", report.Problems));
            // The new rows are in neither table of the pack: it is the state at the start of the export.
            Assert.Equal(23, File.ReadAllLines(Path.Combine(output, "rows", "BlogPosts.jsonl")).Length);
            Assert.Equal(30, File.ReadAllLines(Path.Combine(output, "rows", "BlogPostTranslations.jsonl")).Length);
            Assert.Equal(31, await source.CountAsync("""SELECT count(*) FROM "BlogPostTranslations" """));

            // And the pack can be imported.
            await using var target = await NewTargetAsync(factory);
            var imported = await target.RunAsync(target.Import(output, "--apply"));
            Assert.True(imported.Exit == 0, imported.Output);
            Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
        }
        finally { if (Directory.Exists(output)) Directory.Delete(output, recursive: true); }
    }

    [Fact]
    public async Task F6_a_picture_that_changes_while_the_export_runs_fails_the_export_and_leaves_no_pack()
    {
        await using var source = await NewTargetAsync(factory);
        Assert.Equal(0, (await source.RunAsync(source.Import(PackDir(), "--apply"))).Exit);
        var output = NewDirectory("bha-changing-");
        var key = (await source.TextAsync("""SELECT "StorageKey" FROM "BlogMedia" ORDER BY "Id" LIMIT 1"""))!;
        var options = new ContentPackExportOptions(output, source.Database, [], source.Media, BaseUrl, null, (table, _) =>
        {
            if (table == "BlogMedia") File.AppendAllText(Path.Combine(source.Media, key), "x");
            return Task.CompletedTask;
        });
        var report = await ContentPackExporter.ExportAsync(source.ConnectionString, options, CancellationToken.None);
        Assert.False(report.Ok);
        Assert.Contains(report.Problems, p => p.Contains(key) && p.Contains("does not match"));
        Assert.False(Directory.Exists(output));
    }

    private async Task<Guid> ActorAsync(Target t) => Guid.Parse((await t.TextAsync($"""SELECT "Id" FROM "StaffAccounts" WHERE "NormalizedEmail" = upper('{Actor}')"""))!);

    /// <summary>What Admin would have recorded after the staff changed the website's configuration (versions raised, an author set).</summary>
    private async Task ConfigureAsync(Target source)
    {
        var actor = await ActorAsync(source);
        await source.ExecuteAsync($"""UPDATE "WebsiteHero" SET "Title" = 'Xin chào Đà Nẵng', "Description" = 'Đặt phòng trực tiếp tại sông Hàn', "IntervalSeconds" = 9, "Version" = 3, "UpdatedByStaffId" = '{actor}' """);
        await source.ExecuteAsync($"""UPDATE "WebsiteSocialSettings" SET "PhoneEnabled" = true, "PhoneNumber" = '0905000000', "PhoneHref" = 'tel:+84905000000', "Version" = 2, "UpdatedByStaffId" = '{actor}' """);
        await source.ExecuteAsync($"""UPDATE "WebsiteCurrencies" SET "IsActive" = true, "VndPerUnit" = 25500, "RateUpdatedAtUtc" = now(), "RateUpdatedByStaffId" = '{actor}', "Version" = 2, "UpdatedByStaffId" = '{actor}' WHERE "Code" = 'USD' """);
        await source.ExecuteAsync($"""UPDATE "WebsiteLanguages" SET "IsActive" = true, "Version" = 2, "UpdatedByStaffId" = '{actor}' WHERE "NormalizedCode" = 'en' """);
        // A language that exists but is switched off, with texts.
        var en = JsonNode.Parse((await source.TextAsync("""SELECT to_jsonb(l)::text FROM "WebsiteLanguages" l WHERE "NormalizedCode" = 'en' """))!)!.AsObject();
        var fr = Guid.NewGuid().ToString();
        en["Id"] = fr; en["Code"] = "fr"; en["NormalizedCode"] = "fr"; en["DisplayName"] = "French"; en["NativeName"] = "Français"; en["SortOrder"] = 30; en["IsActive"] = false; en["IsDefault"] = false; en["FormatLocale"] = "fr-FR";
        await source.InsertRowAsync("WebsiteLanguages", en);
        await source.ExecuteAsync($"""
            INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","UpdatedByStaffId","IsManual","SourceHash")
            SELECT '{fr}', "Key", 'Texte ' || left("Key", 20), 2, now(), '{actor}', true, "SourceHash" FROM "WebsiteTranslations" WHERE "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi') ORDER BY "Key" LIMIT 5
            """);
        await source.ExecuteAsync($"""
            UPDATE "WebsiteTranslations" SET "Value" = 'Chào mừng bạn', "IsManual" = true, "Version" = 2, "UpdatedByStaffId" = '{actor}'
            WHERE ("LanguageId", "Key") = (SELECT "LanguageId", "Key" FROM "WebsiteTranslations" WHERE "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi') ORDER BY "Key" LIMIT 1)
            """);
        // The menu: one label changed, one item added.
        await source.ExecuteAsync($"""UPDATE "WebsiteMenu" SET "Version" = 2, "UpdatedByStaffId" = '{actor}' """);
        await source.ExecuteAsync("""UPDATE "WebsiteMenuItems" SET "Label" = 'Đặt phòng ngay' WHERE "Id" = (SELECT "Id" FROM "WebsiteMenuItems" WHERE "ParentId" IS NULL ORDER BY "SortOrder" LIMIT 1)""");
        await source.ExecuteAsync("""INSERT INTO "WebsiteMenuItems" ("Id","ParentId","Placement","SortOrder","Label","Href","OpenInNewTab","IsEnabled") VALUES (gen_random_uuid(), NULL, 'secondary', 900, 'Ưu đãi mùa hè', '/offers', false, true)""");
        // A hero picture the staff uploaded (a row and a file) and a slide that uses it.
        var key = $"hero/{Guid.NewGuid():N}.webp";
        var bytes = new byte[2048]; new Random(7).NextBytes(bytes);
        Directory.CreateDirectory(Path.Combine(source.Media, "hero"));
        await File.WriteAllBytesAsync(Path.Combine(source.Media, key), bytes);
        var media = Guid.NewGuid().ToString();
        await source.ExecuteAsync($"""INSERT INTO "WebsiteHeroMedia" ("Id","Kind","StorageKey","ContentType","ByteSize","Width","Height","CreatedAtUtc","CreatedByStaffId") VALUES ('{media}','upload','{key}','image/webp',{bytes.Length},1920,900,now(),'{actor}')""");
        await source.ExecuteAsync($"""INSERT INTO "WebsiteHeroSlides" ("Id","MediaId","SortOrder","FocalPosition","Alt","Caption") VALUES (gen_random_uuid(),'{media}',4,'50% 50%','Cầu Rồng về đêm','Cầu Rồng')""");
    }

    private static readonly string[] ConfigTables = ["WebsiteCurrencies", "WebsiteLanguages", "WebsiteTranslations", "WebsiteHero", "WebsiteHeroMedia", "WebsiteHeroSlides", "WebsiteMenu", "WebsiteMenuItems", "WebsiteSocialSettings"];

    /// <summary>A hash of a table's content: the rows without their clocks and authors, ordered.</summary>
    private static async Task<string> FingerprintAsync(Target t, string table)
    {
        var columns = (await t.TextAsync($"""SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name = '{table}' AND (column_name LIKE '%AtUtc' OR column_name LIKE '%ByStaffId' OR column_name = 'Version')"""))?.Split(',', StringSplitOptions.RemoveEmptyEntries) ?? [];
        var expr = "to_jsonb(x)" + string.Concat(columns.Select(c => $" - '{c}'"));
        return (await t.TextAsync($"""SELECT count(*) || ':' || coalesce(md5(string_agg(({expr})::text, '|' ORDER BY ({expr})::text)), '-') FROM "{table}" x"""))!;
    }

    [Fact]
    public async Task S1_the_website_configuration_of_the_source_travels_including_what_is_switched_off_and_a_hero_upload()
    {
        await using var source = await NewTargetAsync(factory);
        await ConfigureAsync(source);
        var output = NewDirectory("bha-config-");
        try
        {
            var export = await source.RunAsync(ContentPackCommand.Export, "--expected-database", source.Database, "--out", output, "--source-media-origin", BaseUrl);
            Assert.True(export.Exit == 0, export.Output);
            Assert.Single(Directory.EnumerateFiles(Path.Combine(output, "files", "hero")));
            Assert.DoesNotContain(File.ReadAllText(Path.Combine(output, "rows", "WebsiteHero.jsonl")), "StaffAccounts");

            // A new database: the configuration, the French texts of the switched-off language and the picture all arrive.
            await using var target = await NewTargetAsync(factory);
            var dry = await target.RunAsync(target.Import(output, "--dry-run", "--groups", "website"));
            Assert.True(dry.Exit == 0, dry.Output);
            var applied = await target.RunAsync(target.Import(output, "--apply", "--groups", "website"));
            Assert.True(applied.Exit == 0, applied.Output);
            Assert.Contains("VERIFIED", applied.Output);
            foreach (var table in ConfigTables) Assert.Equal(await FingerprintAsync(source, table), await FingerprintAsync(target, table));
            Assert.Equal("Xin chào Đà Nẵng", await target.TextAsync("""SELECT "Title" FROM "WebsiteHero" """));
            Assert.Equal("False", await target.TextAsync("""SELECT "IsActive" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr' """));
            Assert.Equal(5, await target.CountAsync("""SELECT count(*) FROM "WebsiteTranslations" WHERE "LanguageId" = (SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr') """));
            Assert.Equal(1, target.MediaFiles());
            Assert.Equal(0, (await target.RunAsync(target.Verify(output, "--groups", "website"))).Exit);

            // A target whose staff already edited the hero keeps its own hero (and its slides); a translation the staff wrote is not overwritten either.
            await using var edited = await NewTargetAsync(factory);
            await edited.ExecuteAsync($"""UPDATE "WebsiteHero" SET "Title" = 'Tiêu đề của nhân viên', "Version" = 2, "UpdatedByStaffId" = '{await ActorAsync(edited)}' """);
            var result = await edited.RunAsync(edited.Import(output, "--apply", "--groups", "website"));
            Assert.True(result.Exit == 0, result.Output);
            Assert.Equal("Tiêu đề của nhân viên", await edited.TextAsync("""SELECT "Title" FROM "WebsiteHero" """));
            Assert.Contains("kept (the target differs from the pack): WebsiteHero", result.Output);
            Assert.Equal(4, await edited.CountAsync("""SELECT count(*) FROM "WebsiteHeroSlides" WHERE "SortOrder" < 4 """));
            Assert.Equal("Xin chào Đà Nẵng", await target.TextAsync("""SELECT "Title" FROM "WebsiteHero" """));
        }
        finally { if (Directory.Exists(output)) Directory.Delete(output, recursive: true); }
    }

    [Fact]
    public async Task S3_a_run_that_failed_is_finished_by_the_next_one_and_a_row_deleted_after_an_import_is_not_put_back_unless_asked()
    {
        await using var target = await NewTargetAsync(factory);
        var pack = PackDir();

        // A failed run places nothing (and records nothing): the next one does everything.
        Directory.CreateDirectory(target.Media);
        await File.WriteAllTextAsync(Path.Combine(target.Media, "blog"), "in the way");
        Assert.Equal(1, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "ContentPackLedger" """));
        File.Delete(Path.Combine(target.Media, "blog"));
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);
        Assert.Equal(23, await target.CountAsync("""SELECT count(*) FROM "BlogPosts" """));
        Assert.True(await target.CountAsync("""SELECT count(*) FROM "ContentPackLedger" """) > 500);

        // A run that stopped after the commit (the pictures' variants) is finished by running the same command again.
        var picture = (await target.TextAsync("""SELECT "MediaId" FROM "BlogMediaVariants" LIMIT 1"""))!;
        foreach (var key in (await target.TextAsync($"""SELECT string_agg("StorageKey", ',') FROM "BlogMediaVariants" WHERE "MediaId" = '{picture}'"""))!.Split(',')) File.Delete(Path.Combine(target.Media, key));
        await target.ExecuteAsync($"""DELETE FROM "BlogMediaVariants" WHERE "MediaId" = '{picture}'""");
        await target.ExecuteAsync($"""UPDATE "BlogMedia" SET "Generation" = 0 WHERE "Id" = '{picture}'""");
        Assert.Equal(1, (await target.RunAsync(target.Verify(pack))).Exit);
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);
        Assert.Equal(0, (await target.RunAsync(target.Verify(pack))).Exit);

        // The staff delete an offer (with its links), an unpinned post and a rate; a normal run does not bring them back.
        await target.ExecuteAsync("""DELETE FROM "PromotionRoomTypes" WHERE "PromotionId" = (SELECT "Id" FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10')""");
        await target.ExecuteAsync("""DELETE FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10'""");
        await target.ExecuteAsync("""DELETE FROM "BlogCategoryPins" """);
        await target.ExecuteAsync($"""DELETE FROM "DailyRoomRates" WHERE "PropertyId" = '{RiversideId}' AND "StayDate" > '2026-12-20'""");
        var again = await target.RunAsync(target.Import(pack, "--apply"));
        Assert.True(again.Exit == 0, again.Output);
        Assert.Contains("deleted since the import (not put back): Promotions", again.Output);
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10' """));
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogCategoryPins" """));
        Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "DailyRoomRates" WHERE "PropertyId" = '{RiversideId}' AND "StayDate" > '2026-12-20'"""));
        var verify = await target.RunAsync(target.Verify(pack));
        Assert.Equal(0, verify.Exit);
        Assert.Contains("deleted since the import", verify.Output);

        // Asked to, it does bring them back.
        var restored = await target.RunAsync(target.Import(pack, "--apply", "--restore-deleted"));
        Assert.True(restored.Exit == 0, restored.Output);
        Assert.Equal(1, await target.CountAsync("""SELECT count(*) FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10' """));
        Assert.Equal(6, await target.CountAsync("""SELECT count(*) FROM "BlogCategoryPins" """));
    }

    [Fact]
    public async Task S4_verify_tells_what_matches_what_keeps_the_targets_version_what_was_deleted_and_what_is_missing()
    {
        await using var target = await NewTargetAsync(factory);
        var pack = PackDir();
        Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--apply"))).Exit);

        await target.ExecuteAsync("""UPDATE "RoomTypes" SET "Name" = 'Căn hộ do nhân viên đặt tên' WHERE "Code" = 'RIV-2BR' """);
        await target.ExecuteAsync("""DELETE FROM "PromotionRoomTypes" WHERE "PromotionId" = (SELECT "Id" FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10')""");
        await target.ExecuteAsync("""DELETE FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10'""");
        var verify = await target.RunAsync(target.Verify(pack));
        Assert.Equal(0, verify.Exit);
        Assert.Contains("kept (the target differs from the pack): RoomTypes", verify.Output);
        Assert.Contains("— Name", verify.Output);
        Assert.Contains("deleted since the import (not put back): Promotions", verify.Output);
        Assert.DoesNotContain("every row of the pack is on the target", verify.Output);
        // The kept edit was not overwritten to make the result look like the source.
        Assert.Equal("Căn hộ do nhân viên đặt tên", await target.TextAsync("""SELECT "Name" FROM "RoomTypes" WHERE "Code" = 'RIV-2BR' """));

        // A pack row that no import placed and the target does not have is a failure with the row named.
        await target.ExecuteAsync("""DELETE FROM "ContentPackLedger" WHERE "TableName" = 'Promotions' """);
        var missing = await target.RunAsync(target.Verify(pack));
        Assert.Equal(1, missing.Exit);
        Assert.Contains("Promotions", missing.Output);
        Assert.Contains("missing from the target", missing.Output);
    }

    private Task<Target> NewTargetAsync(PostgreSqlWebApplicationFactory f) => ContentPackTestSupport.NewTargetAsync(f);
}
