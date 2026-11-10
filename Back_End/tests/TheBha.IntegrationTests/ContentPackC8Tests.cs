using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Infrastructure.ContentPack;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C8, the two findings of the eighth Codex review. Real PostgreSQL; the staff's save goes through the real Blog service, and the order of events is set by
/// explicit signals and by the database's own lock table, never by a sleep.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC8Tests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly Guid Featured = TheBha.Infrastructure.Persistence.BlogSeed.FeaturedDestinationsCategoryId;

    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    // ---- F1: the category row is locked first by both writers ----

    private static async Task<WebsiteMutationResult<BlogCategoryAdminDto>> StaffRenameAsync(Target t, int sortOrder)
    {
        await using var scope = t.Host.Services.CreateAsyncScope();
        var blog = scope.ServiceProvider.GetRequiredService<IAdminBlog>();
        // A real slug rename: the old live slug becomes a redirect (set-based update of its row), the new one is added.
        return await blog.UpdateCategoryAsync(new UpdateBlogCategoryCommand(Featured, 1, sortOrder, new Dictionary<string, BlogCategoryText> { ["en"] = new("Staff name", "staff-places", "Staff description") }, await ContentPackC3Tests.ActorAsync(t)), CancellationToken.None);
    }

    private async Task<(Target Source, Target Target, string Pack)> BlogSetUpAsync()
    {
        var source = await NewTargetAsync();
        var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        var renamed = await StaffSaveOnSourceAsync(source);
        Assert.True(renamed.Status == WebsiteMutationStatus.Succeeded, renamed.Message);
        return (source, target, await ContentPackC3Tests.ExportAsync(source));
    }

    private static async Task<WebsiteMutationResult<BlogCategoryAdminDto>> StaffSaveOnSourceAsync(Target source)
    {
        await using var scope = source.Host.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IAdminBlog>().UpdateCategoryAsync(
            new UpdateBlogCategoryCommand(Featured, 1, 10, new Dictionary<string, BlogCategoryText> { ["en"] = new("Featured places", "featured-places", "Places worth a visit") }, await ContentPackC3Tests.ActorAsync(source)), CancellationToken.None);
    }

    private static ContentPackImportOptions Options(Target t, string pack, string groups, Func<string, CancellationToken, Task>? checkpoint = null) =>
        new(pack, t.Database, t.Media, BaseUrl, Actor, ContentPackMode.Apply, false, [groups], false, null, checkpoint);

    /// <summary>Waits until some session of this database is waiting for a lock with a query that matches <paramref name="like"/>.</summary>
    private static async Task WaitForLockWaitAsync(Target t, string like, string what)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (await t.CountAsync($"SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '{like}'") == 0)
        {
            Assert.True(DateTime.UtcNow < deadline, what);
            await Task.Delay(20);
        }
    }

    private static async Task AssertNoDeadlockAsync(Target t)
    {
        // Postgres counts the deadlocks it resolved per database.
        Assert.Equal(0, await t.CountAsync("SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()"));
    }

    [Fact]
    public async Task F1_the_importer_decides_first_and_a_staff_slug_rename_waits_and_is_refused_as_stale_without_a_deadlock()
    {
        var (source, target, pack) = await BlogSetUpAsync();
        await using var sourceDb = source; await using var targetDb = target;
        try
        {
            var locked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var import = Task.Run(() => ContentPackImporter.ImportAsync(target.ConnectionString, Options(target, pack, "blog", async (name, _) =>
            {
                if (name != "categories-locked") return;
                locked.SetResult();
                await release.Task;
            }), "Development", CancellationToken.None));
            await locked.Task.WaitAsync(TimeSpan.FromSeconds(60));
            // The importer holds the category. The staff's rename (old slug -> redirect, new slug) must wait for it, whatever it has done before reaching the category row.
            var staff = Task.Run(() => StaffRenameAsync(target, 11));
            await WaitForLockWaitAsync(target, "%\"BlogCategories\"%", "the staff rename was not held by the importer's decision");
            release.SetResult();
            var report = await import.WaitAsync(TimeSpan.FromSeconds(120));
            var saved = await staff.WaitAsync(TimeSpan.FromSeconds(120));
            Assert.True(report.Applied && report.Ok, string.Join('\n', report.Conflicts.Concat(report.Problems)));
            Assert.NotEqual(WebsiteMutationStatus.Succeeded, saved.Status);
            await AssertNoDeadlockAsync(target);

            // One current slug, the importer's; the old one redirects to it; nothing of the refused rename is left.
            Assert.Equal("Featured places", await target.TextAsync($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal("featured-places", await target.TextAsync($"""SELECT string_agg("Slug", ',') FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "IsCurrent" """));
            Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogCategorySlugs" WHERE "Slug" = 'staff-places'"""));
            Assert.Equal("false", await target.TextAsync($"""SELECT "IsCurrent"::text FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "Slug" = 'featured-destinations' """));
            Assert.Equal(10, await target.CountAsync($"""SELECT "SortOrder" FROM "BlogCategories" WHERE "Id" = '{Featured}' """));
            await using var scope = target.Host.Services.CreateAsyncScope();
            var old = await scope.ServiceProvider.GetRequiredService<IWebsiteBlog>().GetCategoryAsync("en", "featured-destinations", CancellationToken.None);
            Assert.Equal("featured-places", old.RedirectSlug);
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "blog"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_a_staff_slug_rename_in_flight_is_waited_for_by_the_importer_which_then_keeps_the_staffs_category_without_a_deadlock()
    {
        var (source, target, pack) = await BlogSetUpAsync();
        await using var sourceDb = source; await using var targetDb = target;
        try
        {
            // A third session holds the old slug's row, which stops the staff's rename right after it has taken what it takes first.
            await using var hold = new NpgsqlConnection(target.ConnectionString);
            await hold.OpenAsync();
            await using var tx = await hold.BeginTransactionAsync();
            await using (var lockRow = new NpgsqlCommand($"""SELECT 1 FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "Slug" = 'featured-destinations' FOR UPDATE""", hold, tx))
                await lockRow.ExecuteScalarAsync();

            var staff = Task.Run(() => StaffRenameAsync(target, 11));
            await WaitForLockWaitAsync(target, "UPDATE \"BlogCategorySlugs\"%", "the staff rename did not reach the old slug");
            var import = Task.Run(() => ContentPackImporter.ImportAsync(target.ConnectionString, Options(target, pack, "blog"), "Development", CancellationToken.None));
            await WaitForLockWaitAsync(target, "%\"BlogCategories\"%FOR UPDATE%", "the importer did not wait for the staff's category");
            await tx.CommitAsync();

            var saved = await staff.WaitAsync(TimeSpan.FromSeconds(120));
            var report = await import.WaitAsync(TimeSpan.FromSeconds(120));
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            Assert.True(report.Applied && report.Ok, string.Join('\n', report.Conflicts.Concat(report.Problems)));
            await AssertNoDeadlockAsync(target);

            // The staff's category, text and slug stand together; the old slug redirects to theirs; the importer wrote none of its own.
            Assert.Equal("Staff name", await target.TextAsync($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal("staff-places", await target.TextAsync($"""SELECT string_agg("Slug", ',') FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "IsCurrent" """));
            Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "BlogCategorySlugs" WHERE "Slug" = 'featured-places'"""));
            Assert.Equal(2, await target.CountAsync($"""SELECT "Version" FROM "BlogCategories" WHERE "Id" = '{Featured}' """));
            await using var scope = target.Host.Services.CreateAsyncScope();
            var old = await scope.ServiceProvider.GetRequiredService<IWebsiteBlog>().GetCategoryAsync("en", "featured-destinations", CancellationToken.None);
            Assert.Equal("staff-places", old.RedirectSlug);
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "blog"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F2: the property check follows what the run imports ----

    private static async Task<Guid> OwnPropertyAsync(Target t)
    {
        var property = PackRow("Properties", l => l.Contains("the-bha-riverside"));
        var id = Guid.NewGuid();
        property["Id"] = id.ToString(); property["Slug"] = "c8-own-property"; property["Name"] = "C8 own property";
        await t.InsertRowAsync("Properties", property);
        return id;
    }

    /// <summary>The target's own offer for <paramref name="slug"/> (another id, on the target's own property), with its own cover when the pack's offer has one.</summary>
    private static async Task OwnOfferAsync(Target t, Guid property, string slug)
    {
        var offer = PackRow("Promotions", l => l.Contains($"\"{slug}\""));
        string? cover = null;
        if (offer["CoverMediaId"] is not null)
        {
            var media = PackRow("PromotionMedia", l => l.Contains(offer["CoverMediaId"]!.GetValue<string>()));
            var id = Guid.NewGuid();
            media["Id"] = id.ToString(); media["StorageKey"] = $"promo/{id:N}.webp"; media["PropertyId"] = property.ToString();
            await t.InsertRowAsync("PromotionMedia", media);
            cover = id.ToString();
        }
        offer["Id"] = Guid.NewGuid().ToString(); offer["PropertyId"] = property.ToString(); offer["CoverMediaId"] = cover; offer["AllRoomTypes"] = false;
        offer["CreateOperationId"] = Guid.NewGuid().ToString(); offer["CreateFingerprint"] = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        await t.InsertRowAsync("Promotions", offer);
    }

    private static readonly string[] AllOffers = ["o-dai-giam-200k", "gia-dinh-giam-10", "dat-som-giam-15", "ban-nhap-chua-mo"];

    private static string Count(string table) => $"SELECT count(*) FROM \"{table}\"";

    [Fact]
    public async Task F2_every_offer_already_the_targets_own_needs_no_property_from_the_pack_and_the_run_writes_nothing_of_the_catalog()
    {
        await using var target = await NewTargetAsync();
        var property = await OwnPropertyAsync(target);
        foreach (var slug in AllOffers) await OwnOfferAsync(target, property, slug);
        // One own offer also has a real room-type link (a room type of the target's own property, one the pack does not have).
        var room = PackRow("RoomTypes", l => l.Contains("RIV-2BR"));
        var roomId = Guid.NewGuid();
        room["Id"] = roomId.ToString(); room["PropertyId"] = property.ToString(); room["Code"] = "C8-OWN"; room["Slug"] = "c8-own-room";
        await target.InsertRowAsync("RoomTypes", room);
        await target.ExecuteAsync($"""INSERT INTO "PromotionRoomTypes" ("PromotionId","RoomTypeId","PropertyId") SELECT "Id", '{roomId}', '{property}' FROM "Promotions" WHERE "Slug" = 'gia-dinh-giam-10'""");
        const string Snapshot = """SELECT string_agg(concat_ws('|', p."Slug", p."Id", p."CoverMediaId", p."PropertyId", (SELECT string_agg(l."RoomTypeId"::text, ',' ORDER BY l."RoomTypeId") FROM "PromotionRoomTypes" l WHERE l."PromotionId" = p."Id")), ';' ORDER BY p."Slug") FROM "Promotions" p""";
        var before = await target.TextAsync(Snapshot);
        Assert.Contains(roomId.ToString(), before);
        var (offers, media, links, properties, rooms, files) = (await target.CountAsync(Count("Promotions")), await target.CountAsync(Count("PromotionMedia")), await target.CountAsync(Count("PromotionRoomTypes")),
            await target.CountAsync(Count("Properties")), await target.CountAsync(Count("RoomTypes")), target.MediaFiles());
        Assert.Equal(0, await target.CountAsync("""SELECT count(*) FROM "Properties" WHERE "Slug" = 'the-bha-riverside'"""));

        foreach (var mode in new[] { "--dry-run", "--apply", "--apply" })
        {
            var run = await target.RunAsync(target.Import(PackDir(), "--groups", "promotions", mode));
            Assert.True(run.Exit == 0, run.Output);
            Assert.Equal((offers, media, links, properties, rooms, files), (await target.CountAsync(Count("Promotions")), await target.CountAsync(Count("PromotionMedia")), await target.CountAsync(Count("PromotionRoomTypes")),
                await target.CountAsync(Count("Properties")), await target.CountAsync(Count("RoomTypes")), target.MediaFiles()));
        }
        // The target's offers (ids, covers, properties) and links are exactly as they were.
        Assert.Equal(before, await target.TextAsync(Snapshot));
        var verify = await target.RunAsync(target.Verify(PackDir(), "--groups", "promotions"));
        Assert.True(verify.Exit == 0, verify.Output);
        Assert.Equal(AllOffers.Length, await target.CountAsync($"""SELECT count(*) FROM "Promotions" WHERE "PropertyId" = '{property}'"""));
    }

    [Theory]
    [InlineData("ban-nhap-chua-mo")]   // a new offer without a cover
    [InlineData("dat-som-giam-15")]    // a new offer with a cover
    public async Task F2_an_offer_still_to_import_still_names_the_missing_property_and_nothing_is_written_or_copied(string newOffer)
    {
        await using var target = await NewTargetAsync();
        var property = await OwnPropertyAsync(target);
        foreach (var slug in AllOffers.Where(s => s != newOffer)) await OwnOfferAsync(target, property, slug);
        var (offers, media, properties, files) = (await target.CountAsync(Count("Promotions")), await target.CountAsync(Count("PromotionMedia")), await target.CountAsync(Count("Properties")), target.MediaFiles());

        foreach (var mode in new[] { "--dry-run", "--apply" })
        {
            var run = await target.RunAsync(target.Import(PackDir(), "--groups", "promotions", mode));
            Assert.NotEqual(0, run.Exit);
            Assert.Contains("needs the property 'the-bha-riverside'", run.Output);
            Assert.Equal((offers, media, properties, files), (await target.CountAsync(Count("Promotions")), await target.CountAsync(Count("PromotionMedia")), await target.CountAsync(Count("Properties")), target.MediaFiles()));
        }
        Assert.NotEqual(0, (await target.RunAsync(target.Verify(PackDir(), "--groups", "promotions"))).Exit);
    }
}
