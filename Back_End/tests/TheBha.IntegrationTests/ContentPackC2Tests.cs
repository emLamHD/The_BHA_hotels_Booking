using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Api.Seeding;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Infrastructure.ContentPack;
using TheBha.Infrastructure.Persistence;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C2: one regression test per finding of the second Codex review, each written against the commit that had it
/// (the red run is in the report). Real PostgreSQL; the coordination between connections uses the database's own lock table and explicit
/// signals, never a sleep.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC2Tests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly long WebsiteLock = BookingAdvisoryLockKeys.ForWebsiteSettings();

    private Task<Target> NewTargetAsync(bool withActor = true) => ContentPackTestSupport.NewTargetAsync(factory, withActor);

    private static async Task<Guid> ActorAsync(Target t) => Guid.Parse((await t.TextAsync($"""SELECT "Id" FROM "StaffAccounts" WHERE "NormalizedEmail" = upper('{Actor}')"""))!);

    /// <summary>Waits (by asking the database, not by sleeping a guess) until some other backend is waiting for the website-settings advisory lock.</summary>
    private static async Task WaitForLockWaiterAsync(Target t)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            if (await t.CountAsync($"""SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND ((classid::bigint << 32) | objid::bigint) = {WebsiteLock}""") > 0) return;
            await Task.Delay(20);
        }
        throw new TimeoutException("nobody is waiting for the website-settings lock");
    }

    private static string NewDirectory(string prefix) => Path.Combine(Path.GetTempPath(), prefix + Guid.NewGuid().ToString("N"));

    /// <summary>The pack with the hero edited in the source (so the importer would, on a default target, take its title and slides).</summary>
    private static string EditedHeroPack()
    {
        var pack = CopyPack();
        var path = Path.Combine(pack, "rows", "WebsiteHero.jsonl");
        var row = JsonNode.Parse(File.ReadAllText(path).Trim())!.AsObject();
        row["Title"] = "Tiêu đề từ nguồn"; row["Version"] = 3; row["UpdatedByStaffId"] = "@actor";
        var text = row.ToJsonString(ContentPackSpec.Json) + "\n";
        File.WriteAllText(path, text);
        var manifestPath = Path.Combine(pack, "manifest.json");
        var manifest = JsonNode.Parse(File.ReadAllText(manifestPath))!.AsObject();
        foreach (var table in manifest["Tables"]!.AsArray()) if (table!["Name"]!.GetValue<string>() == "WebsiteHero") table["Sha256"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
        File.WriteAllText(manifestPath, manifest.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        return pack;
    }

    private ContentPackImportOptions Options(Target t, string pack, ContentPackMode mode, Func<CancellationToken, Task>? hook = null, params string[] groups) =>
        new(pack, t.Database, t.Media, BaseUrl, Actor, mode, false, groups.Length == 0 ? null : groups, false, hook);

    [Fact]
    public async Task F1_a_staff_save_that_holds_the_website_lock_is_waited_for_and_what_it_saved_is_kept()
    {
        await using var target = await NewTargetAsync();
        var pack = EditedHeroPack();
        try
        {
            var actor = await ActorAsync(target);
            // The staff are in the middle of saving the hero: they hold the very lock every website writer takes.
            await using var staff = new NpgsqlConnection(target.ConnectionString);
            await staff.OpenAsync();
            await using var transaction = await staff.BeginTransactionAsync();
            await using (var take = new NpgsqlCommand($"SELECT pg_advisory_xact_lock({WebsiteLock})", staff, transaction)) await take.ExecuteNonQueryAsync();
            await using (var edit = new NpgsqlCommand($"""UPDATE "WebsiteHero" SET "Title" = 'Tiêu đề của nhân viên', "Version" = 2, "UpdatedByStaffId" = '{actor}' """, staff, transaction)) await edit.ExecuteNonQueryAsync();

            var import = Task.Run(() => ContentPackImporter.ImportAsync(target.ConnectionString, Options(target, pack, ContentPackMode.Apply, null, "website"), "Development", CancellationToken.None));
            await WaitForLockWaiterAsync(target);
            Assert.False(import.IsCompleted, "the import must wait for the website lock");
            await transaction.CommitAsync();

            var report = await import;
            Assert.True(report.Ok, string.Join("\n", report.Problems.Concat(report.Conflicts)));
            // The importer read the hero AFTER the staff committed: it is edited, so it is kept.
            Assert.Equal("Tiêu đề của nhân viên", await target.TextAsync("""SELECT "Title" FROM "WebsiteHero" """));
            Assert.Contains(report.Lines, l => l.Contains("kept (the target differs from the pack): WebsiteHero"));
            Assert.Equal(4, await target.CountAsync("""SELECT count(*) FROM "WebsiteHeroSlides" """));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_a_real_staff_writer_waits_for_the_import_and_then_saves_and_a_failed_import_releases_the_lock()
    {
        await using var target = await NewTargetAsync();
        var pack = CopyPack();
        try
        {
            var actor = await ActorAsync(target);
            var holding = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var import = Task.Run(() => ContentPackImporter.ImportAsync(target.ConnectionString, Options(target, pack, ContentPackMode.Apply, async _ => { holding.SetResult(); await release.Task; }, "website"), "Development", CancellationToken.None));
            await holding.Task;

            // The real Admin writer (the same service the Social media screen calls) starts a save while the importer holds the lock.
            using var scope = target.Host.Services.CreateScope();
            var social = scope.ServiceProvider.GetRequiredService<IWebsiteSocialSettings>();
            var current = await social.GetAdminAsync(CancellationToken.None);
            var save = Task.Run(() => social.SaveAsync(new SaveWebsiteSocialCommand(current.Revision, true, "0905000111", false, null, false, null, true, actor), CancellationToken.None));
            await WaitForLockWaiterAsync(target);
            Assert.False(save.IsCompleted, "the staff save must wait for the importer's transaction");
            release.SetResult();

            var report = await import;
            Assert.True(report.Ok, string.Join("\n", report.Problems));
            var saved = await save;
            Assert.Equal(WebsiteMutationStatus.Succeeded, saved.Status);
            Assert.Equal("0905000111", await target.TextAsync("""SELECT "PhoneNumber" FROM "WebsiteSocialSettings" """));
        }
        finally { Directory.Delete(pack, recursive: true); }

        // A run that fails (here: a slug owned by another category) rolls back and the lock is free again at once.
        await using var other = await NewTargetAsync();
        await other.ExecuteAsync("""INSERT INTO "BlogCategorySlugs" ("Locale","Slug","CategoryId","IsCurrent") VALUES ('vi','am-thuc-da-nang','b10c0001-0000-4000-8000-000000000001', false)""");
        var failed = await other.RunAsync(other.Import(PackDir(), "--apply"));
        Assert.Equal(4, failed.Exit);
        await using var probe = new NpgsqlConnection(other.ConnectionString);
        await probe.OpenAsync();
        await using var tx = await probe.BeginTransactionAsync();
        await using var tryLock = new NpgsqlCommand($"SELECT pg_try_advisory_xact_lock({WebsiteLock}), pg_try_advisory_xact_lock({ContentPackSpec.AdvisoryLockKey})", probe, tx);
        await using var reader = await tryLock.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.True(reader.GetBoolean(0) && reader.GetBoolean(1), "both locks must be free after a failed import");
    }

    // ---- F2: a hero or menu collection the staff edited before the first import ----

    [Fact]
    public async Task F2_slides_and_menu_items_the_staff_changed_before_the_first_import_are_kept_as_they_are()
    {
        await using var target = await NewTargetAsync();
        var actor = await ActorAsync(target);
        var pack = PackDir();

        // The staff replaced the whole slideshow (a hero save raises its version and records the author) ...
        var media = (await target.TextAsync("""SELECT "Id" FROM "WebsiteHeroMedia" ORDER BY "StorageKey" LIMIT 1"""))!;
        await target.ExecuteAsync($"""UPDATE "WebsiteHero" SET "Version" = 2, "UpdatedByStaffId" = '{actor}' """);
        await target.ExecuteAsync("""DELETE FROM "WebsiteHeroSlides" """);
        await target.ExecuteAsync($"""INSERT INTO "WebsiteHeroSlides" ("Id","MediaId","SortOrder","FocalPosition","Alt","Caption") VALUES (gen_random_uuid(),'{media}',0,'50% 50%','Ảnh của nhân viên','Nhân viên')""");
        // ... and removed one menu item, then saved (version raised).
        await target.ExecuteAsync($"""UPDATE "WebsiteMenu" SET "Version" = 2, "UpdatedByStaffId" = '{actor}' """);
        await target.ExecuteAsync("""DELETE FROM "WebsiteMenuItems" WHERE "Id" = (SELECT "Id" FROM "WebsiteMenuItems" WHERE "ParentId" IS NOT NULL ORDER BY "Label" LIMIT 1)""");
        var items = await target.CountAsync("""SELECT count(*) FROM "WebsiteMenuItems" """);

        var dry = await target.RunAsync(target.Import(pack, "--dry-run", "--groups", "website"));
        Assert.True(dry.Exit == 0, dry.Output);
        var applied = await target.RunAsync(target.Import(pack, "--apply", "--groups", "website"));
        Assert.True(applied.Exit == 0, applied.Output);
        Assert.Equal(1, await target.CountAsync("""SELECT count(*) FROM "WebsiteHeroSlides" """));
        Assert.Equal("Ảnh của nhân viên", await target.TextAsync("""SELECT "Alt" FROM "WebsiteHeroSlides" """));
        Assert.Equal(items, await target.CountAsync("""SELECT count(*) FROM "WebsiteMenuItems" """));
        var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
        Assert.True(verify.Exit == 0, verify.Output);
        Assert.Contains("kept (the target's collection was edited)", verify.Output);

        // A menu the staff emptied on purpose stays empty.
        await using var emptied = await NewTargetAsync();
        await emptied.ExecuteAsync($"""UPDATE "WebsiteMenu" SET "Version" = 2, "UpdatedByStaffId" = '{await ActorAsync(emptied)}' """);
        await emptied.ExecuteAsync("""DELETE FROM "WebsiteMenuItems" """);
        Assert.Equal(0, (await emptied.RunAsync(emptied.Import(pack, "--apply", "--groups", "website"))).Exit);
        Assert.Equal(0, await emptied.CountAsync("""SELECT count(*) FROM "WebsiteMenuItems" """));
        Assert.Equal(0, (await emptied.RunAsync(emptied.Verify(pack, "--groups", "website"))).Exit);

        // A database whose collections are still the migration's gets the pack's, whole.
        await using var fresh = await NewTargetAsync();
        await fresh.ExecuteAsync("""DELETE FROM "WebsiteHeroSlides" WHERE "SortOrder" = 3""");
        Assert.Equal(0, (await fresh.RunAsync(fresh.Import(pack, "--apply", "--groups", "website"))).Exit);
        Assert.Equal(4, await fresh.CountAsync("""SELECT count(*) FROM "WebsiteHeroSlides" """));
        Assert.Equal(54, await fresh.CountAsync("""SELECT count(*) FROM "WebsiteMenuItems" """));
    }

    // ---- F3: a picture from before the image pipeline (no recorded hash) ----

    private async Task<(Target Source, string Key)> LegacySourceAsync()
    {
        var source = await NewTargetAsync();
        var actor = await ActorAsync(source);
        var original = PackRow("BlogMedia", _ => true);
        var key = $"blog/{Guid.NewGuid():N}.jpg";
        var file = Directory.EnumerateFiles(Path.Combine(PackDir(), "files", "blog"), "*.jpg").First();
        Directory.CreateDirectory(Path.Combine(source.Media, "blog"));
        File.Copy(file, Path.Combine(source.Media, key));
        original["Id"] = Guid.NewGuid().ToString(); original["StorageKey"] = key; original["OriginalSha256"] = null; original["Generation"] = 0;
        original["ByteSize"] = new FileInfo(file).Length; original["CreatedByStaffId"] = actor.ToString(); original["UpdatedByStaffId"] = null;
        await source.InsertRowAsync("BlogMedia", original);
        return (source, key);
    }

    [Fact]
    public async Task F3_a_legacy_picture_without_a_recorded_hash_exports_and_imports_and_a_missing_or_wrong_original_is_reported_clearly()
    {
        var (source, key) = await LegacySourceAsync();
        await using var _ = source;
        var output = NewDirectory("bha-legacy-");
        try
        {
            var export = await source.RunAsync(ContentPackCommand.Export, "--expected-database", source.Database, "--out", output, "--source-media-origin", BaseUrl);
            Assert.True(export.Exit == 0, export.Output);
            Assert.DoesNotContain("NullReference", export.Output);
            Assert.True(File.Exists(Path.Combine(output, "files", key)));
            await using var target = await NewTargetAsync();
            var imported = await target.RunAsync(target.Import(output, "--apply"));
            Assert.True(imported.Exit == 0, imported.Output);
            // The pipeline's backfill gave the legacy picture its variants.
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "BlogMedia" m WHERE m."StorageKey" = '{key}' AND m."Generation" >= 1 AND EXISTS (SELECT 1 FROM "BlogMediaVariants" v WHERE v."MediaId" = m."Id") """));
            Assert.Equal(File.ReadAllBytes(Path.Combine(output, "files", key)), File.ReadAllBytes(Path.Combine(target.Media, key)));

            // The original is gone: a clear problem, no stack trace.
            File.Delete(Path.Combine(source.Media, key));
            var missing = await source.RunAsync(ContentPackCommand.Export, "--expected-database", source.Database, "--out", output + "-2", "--source-media-origin", BaseUrl);
            Assert.Equal(1, missing.Exit);
            Assert.Contains(key, missing.Output);
            Assert.Contains("missing", missing.Output);
            Assert.DoesNotContain("NullReference", missing.Output);
            Assert.False(Directory.Exists(output + "-2"));

            // A recorded hash that is not the file's is still caught.
            File.Copy(Directory.EnumerateFiles(Path.Combine(PackDir(), "files", "blog"), "*.jpg").First(), Path.Combine(source.Media, key));
            await source.ExecuteAsync($"""UPDATE "BlogMedia" SET "OriginalSha256" = '{new string('a', 64)}' WHERE "StorageKey" = '{key}'""");
            var wrong = await source.RunAsync(ContentPackCommand.Export, "--expected-database", source.Database, "--out", output + "-3", "--source-media-origin", BaseUrl);
            Assert.Equal(1, wrong.Exit);
            Assert.Contains("does not match", wrong.Output);
        }
        finally { foreach (var d in new[] { output, output + "-2", output + "-3" }) if (Directory.Exists(d)) Directory.Delete(d, recursive: true); }
    }

    // ---- F4: a property-scoped export must not leave a Blog dependency out ----

    [Fact]
    public async Task F4_a_scoped_export_whose_blog_points_at_a_property_it_leaves_out_is_refused_with_the_cause_and_a_clean_scope_exports_and_imports()
    {
        await using var source = await NewTargetAsync();
        Assert.Equal(0, (await source.RunAsync(source.Import(PackDir(), "--apply"))).Exit);
        var output = NewDirectory("bha-scoped-");
        try
        {
            var refused = await source.RunAsync(ContentPackCommand.Export, "--expected-database", source.Database, "--out", output, "--property-slug", "the-bha-riverside", "--source-media-origin", BaseUrl);
            Assert.Equal(1, refused.Exit);
            Assert.Contains("the-bha-hotel", refused.Output);
            Assert.Contains("propertyIntro", refused.Output);
            Assert.Contains("5 revisions", refused.Output);
            Assert.False(Directory.Exists(output), "no pack may be left behind");
        }
        finally { if (Directory.Exists(output)) Directory.Delete(output, recursive: true); }

        // Without any Blog in the source nothing depends on the left-out property: the scoped export works and its pack imports into an empty database.
        await using var catalogOnly = await NewTargetAsync();
        Assert.Equal(0, (await catalogOnly.RunAsync(catalogOnly.Import(PackDir(), "--apply", "--groups", "catalog,promotions"))).Exit);
        var scoped = NewDirectory("bha-scoped-ok-");
        try
        {
            var export = await catalogOnly.RunAsync(ContentPackCommand.Export, "--expected-database", catalogOnly.Database, "--out", scoped, "--property-slug", "the-bha-riverside", "--source-media-origin", BaseUrl);
            Assert.True(export.Exit == 0, export.Output);
            await using var target = await NewTargetAsync();
            var imported = await target.RunAsync(target.Import(scoped, "--apply", "--groups", "catalog,promotions"));
            Assert.True(imported.Exit == 0, imported.Output);
            Assert.Equal(1, await target.CountAsync("""SELECT count(*) FROM "Properties" """));
        }
        finally { if (Directory.Exists(scoped)) Directory.Delete(scoped, recursive: true); }
    }

    // ---- F5: a picture the staff deleted after the import ----

    [Fact]
    public async Task F5_a_picture_deleted_through_the_service_after_the_import_stays_deleted_for_apply_and_verify_and_comes_back_only_when_asked()
    {
        // The pack plus one picture that no post uses (the staff can delete it).
        var pack = CopyPack();
        var id = Guid.NewGuid(); var key = $"blog/{Guid.NewGuid():N}.jpg";
        try
        {
            var original = PackRow("BlogMedia", _ => true);
            var file = Directory.EnumerateFiles(Path.Combine(pack, "files", "blog"), "*.jpg").First();
            original["Id"] = id.ToString(); original["StorageKey"] = key;
            File.Copy(file, Path.Combine(pack, "files", key));
            var rowsPath = Path.Combine(pack, "rows", "BlogMedia.jsonl");
            var rowsText = File.ReadAllText(rowsPath) + original.ToJsonString(ContentPackSpec.Json) + "\n";
            File.WriteAllText(rowsPath, rowsText);
            var manifestPath = Path.Combine(pack, "manifest.json");
            var manifest = JsonNode.Parse(File.ReadAllText(manifestPath))!.AsObject();
            foreach (var table in manifest["Tables"]!.AsArray())
                if (table!["Name"]!.GetValue<string>() == "BlogMedia") { table["Rows"] = table["Rows"]!.GetValue<int>() + 1; table["Sha256"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rowsText))).ToLowerInvariant(); }
            var bytes = File.ReadAllBytes(Path.Combine(pack, "files", key));
            manifest["Files"]!.AsArray().Add(new JsonObject { ["Key"] = key, ["Kind"] = "blog-original", ["Bytes"] = bytes.Length, ["Sha256"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant() });
            File.WriteAllText(manifestPath, manifest.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));

            await using var target = await NewTargetAsync();
            var first = await target.RunAsync(target.Import(pack, "--apply"));
            Assert.True(first.Exit == 0, first.Output);
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "BlogMedia" WHERE "Id" = '{id}' """));
            var files = target.MediaFiles();

            // The staff delete it with the real service: the row and every file of it go.
            using (var scope = target.Host.Services.CreateScope())
            {
                var blog = scope.ServiceProvider.GetRequiredService<IAdminBlog>();
                var version = int.Parse((await target.TextAsync($"""SELECT "Version" FROM "BlogMedia" WHERE "Id" = '{id}'"""))!);
                var deleted = await blog.DeleteMediaAsync(new DeleteBlogMediaCommand(id, version, await ActorAsync(target)), CancellationToken.None);
                Assert.Equal(WebsiteMutationStatus.Succeeded, deleted.Status);
            }
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "BlogMedia" WHERE "Id" = '{id}' """));
            Assert.False(File.Exists(Path.Combine(target.Media, key)));
            var afterDelete = target.MediaFiles();
            Assert.True(afterDelete < files);

            foreach (var args in new[] { target.Import(pack, "--dry-run"), target.Verify(pack), target.Import(pack, "--apply") })
            {
                var run = await target.RunAsync(args);
                Assert.True(run.Exit == 0, run.Output);
                Assert.Contains("deleted since the import (not put back): BlogMedia", run.Output);
                Assert.Contains(key, run.Output);
            }
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "BlogMedia" WHERE "Id" = '{id}' """));
            Assert.False(File.Exists(Path.Combine(target.Media, key)));
            Assert.Equal(afterDelete, target.MediaFiles());

            var restored = await target.RunAsync(target.Import(pack, "--apply", "--restore-deleted"));
            Assert.True(restored.Exit == 0, restored.Output);
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "BlogMedia" WHERE "Id" = '{id}' AND "Generation" >= 1 """));
            Assert.True(File.Exists(Path.Combine(target.Media, key)));
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack))).Exit);

            var again = await target.RunAsync(target.Import(pack, "--apply"));
            Assert.True(again.Exit == 0, again.Output);
            Assert.Equal(41, await target.CountAsync("""SELECT count(*) FROM "BlogMedia" """));
            Assert.Equal(files, target.MediaFiles());
        }
        finally { Directory.Delete(pack, recursive: true); }
    }
}
