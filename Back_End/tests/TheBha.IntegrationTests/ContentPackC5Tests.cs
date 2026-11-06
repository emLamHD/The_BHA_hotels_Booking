using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using TheBha.Infrastructure.ContentPack;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C5: one regression test group per finding of the fifth Codex review. Real PostgreSQL; the staff's actions go through the real
/// services, and the order of events is set by explicit signals and by the database's own lock table, never by a sleep.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC5Tests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly Guid Featured = TheBha.Infrastructure.Persistence.BlogSeed.FeaturedDestinationsCategoryId;

    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    private static async Task<T> WithAsync<T, TService>(Target t, Func<TService, Task<T>> action) where TService : notnull
    {
        await using var scope = t.Host.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<TService>());
    }

    private static ContentPackImportOptions Options(Target t, string pack, string groups, Func<string, CancellationToken, Task>? checkpoint = null) =>
        new(pack, t.Database, t.Media, BaseUrl, Actor, ContentPackMode.Apply, false, [groups], false, null, checkpoint);

    private static async Task AssertCleanAsync(Target t, string pack, string groups)
    {
        Assert.Equal(0, (await t.RunAsync(t.Import(pack, "--groups", groups, "--dry-run"))).Exit);
        var apply = await t.RunAsync(t.Import(pack, "--groups", groups, "--apply"));
        Assert.True(apply.Exit == 0, apply.Output);
        var verify = await t.RunAsync(t.Verify(pack, "--groups", groups));
        Assert.True(verify.Exit == 0, verify.Output);
        var again = await t.RunAsync(t.Import(pack, "--groups", groups, "--apply"));
        Assert.True(again.Exit == 0, again.Output);
    }

    // ---- F1: the parent's current decision protects the category's texts and slugs ----

    private static Task<WebsiteMutationResult<BlogCategoryAdminDto>> StaffSaveFeaturedAsync(Target t, int expectedVersion, int sortOrder, Dictionary<string, BlogCategoryText> texts) =>
        WithAsync<WebsiteMutationResult<BlogCategoryAdminDto>, IAdminBlog>(t, async blog =>
            await blog.UpdateCategoryAsync(new UpdateBlogCategoryCommand(Featured, expectedVersion, sortOrder, texts, await ContentPackC3Tests.ActorAsync(t)), CancellationToken.None));

    private async Task<(Target Source, Target Target, string Pack)> BlogSetUpAsync()
    {
        var source = await NewTargetAsync();
        var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        // The source's staff rename the seeded category's English slug and name, through the Blog service.
        var renamed = await StaffSaveFeaturedAsync(source, 1, 10, new() { ["en"] = new("Featured places", "featured-places", "Places worth a visit") });
        Assert.True(renamed.Status == WebsiteMutationStatus.Succeeded, renamed.Message);
        return (source, target, await ContentPackC3Tests.ExportAsync(source));
    }

    [Fact]
    public async Task F1_a_staff_save_between_the_early_read_and_the_category_keeps_the_staffs_text_and_slug()
    {
        var (source, target, pack) = await BlogSetUpAsync();
        await using var sourceDb = source; await using var targetDb = target;
        try
        {
            var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var staffDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var import = Task.Run(() => ContentPackImporter.ImportAsync(target.ConnectionString, Options(target, pack, "blog", async (name, _) =>
            {
                if (name != "references-resolved") return;
                reached.SetResult();
                await staffDone.Task;
            }), "Development", CancellationToken.None));
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(60));
            // The importer has read the target's categories as untouched; now the staff save the seeded category (a new name and description, the slug as it is).
            var saved = await StaffSaveFeaturedAsync(target, 1, 10, new() { ["en"] = new("Staff name", "featured-destinations", "Staff description") });
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            staffDone.SetResult();
            var report = await import;
            Assert.True(report.Applied && report.Ok, string.Join('\n', report.Conflicts.Concat(report.Problems)));

            Assert.Equal("Staff name", await target.TextAsync($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal("Staff description", await target.TextAsync($"""SELECT "Description" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal("featured-destinations", await target.TextAsync($"""SELECT string_agg("Slug", ',') FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "IsCurrent" """));
            Assert.Equal(1, await target.CountAsync($"""SELECT count(*) FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal(2, await target.CountAsync($"""SELECT "Version" FROM "BlogCategories" WHERE "Id" = '{Featured}' """));
            var current = await WithAsync<PublicBlogCategoryLookup, IWebsiteBlog>(target, b => b.GetCategoryAsync("en", "featured-destinations", CancellationToken.None));
            Assert.Equal("Staff name", current.Category!.Name);
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "blog"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_a_staff_save_that_starts_after_the_decision_waits_and_is_then_refused_as_stale()
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
            // The importer has decided (the category is untouched) and holds it. A save of the category now has to wait for the commit.
            var staff = Task.Run(() => StaffSaveFeaturedAsync(target, 1, 11, []));
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (await target.CountAsync("""SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE "BlogCategories"%'""") == 0)
            {
                Assert.True(DateTime.UtcNow < deadline, "the staff save was not held by the importer's decision");
                await Task.Delay(20);
            }
            release.SetResult();
            var report = await import;
            var saved = await staff;
            Assert.True(report.Applied && report.Ok, string.Join('\n', report.Conflicts.Concat(report.Problems)));
            // The staff's save was not silently applied over the import: it is refused as stale and the import's category, texts and slug stand together.
            Assert.NotEqual(WebsiteMutationStatus.Succeeded, saved.Status);
            Assert.Equal("Featured places", await target.TextAsync($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal("featured-places", await target.TextAsync($"""SELECT string_agg("Slug", ',') FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "IsCurrent" """));
            Assert.Equal("false", await target.TextAsync($"""SELECT "IsCurrent"::text FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "Slug" = 'featured-destinations' """));
            Assert.Equal(10, await target.CountAsync($"""SELECT "SortOrder" FROM "BlogCategories" WHERE "Id" = '{Featured}' """));
            var old = await WithAsync<PublicBlogCategoryLookup, IWebsiteBlog>(target, b => b.GetCategoryAsync("en", "featured-destinations", CancellationToken.None));
            Assert.Equal("featured-places", old.RedirectSlug);
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "blog"))).Exit);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F2: a pristine hero / menu is replaced as a whole ----

    private static async Task<HeroAdminDto> HeroAdminAsync(Target t) => await WithAsync<HeroAdminDto, IWebsiteHero>(t, h => h.GetAdminAsync(CancellationToken.None));

    private static async Task StaffSaveHeroAsync(Target t, Func<IReadOnlyList<HeroSlideDto>, IEnumerable<HeroSlideInput>> slides, int interval = 6)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        await WithAsync<bool, IWebsiteHero>(t, async hero =>
        {
            var admin = await hero.GetAdminAsync(CancellationToken.None);
            var saved = await hero.SaveAsync(new SaveHeroCommand(admin.Revision, admin.FontKey, admin.AutoplayEnabled, interval, admin.Texts, [.. slides(admin.Slides)], actor), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return true;
        });
    }

    private static HeroSlideInput AsInput(HeroSlideDto s) => new(s.Id, s.MediaId, s.FocalPosition, s.Alt, s.Caption);

    private static async Task<Guid[]> PublicSlidesAsync(Target t) =>
        [.. (await WithAsync<PublicHeroDto, IWebsiteHero>(t, h => h.GetPublicAsync("vi", CancellationToken.None))).Slides.Select(s => s.Id)];

    [Fact]
    public async Task F2_two_hero_slides_that_swap_places_import_into_a_database_the_staff_have_not_touched()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await StaffSaveHeroAsync(source, slides => { var l = slides.Select(AsInput).ToList(); (l[0], l[1]) = (l[1], l[0]); return l; });
        var swapped = await PublicSlidesAsync(source);
        var original = await PublicSlidesAsync(target);
        Assert.NotEqual(original, swapped);
        Assert.Equal(original.Order(), swapped.Order());
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");
            Assert.Equal(swapped, await PublicSlidesAsync(target));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    private static IEnumerable<(Guid Id, Guid? Parent)> Tree(MenuAdminDto menu) => menu.Items.Select(i => (i.Id, i.ParentId));

    [Fact]
    public async Task F2_a_menu_item_that_moves_to_another_parent_while_the_old_parent_is_deleted_imports_into_a_database_the_staff_have_not_touched()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        var actor = await ContentPackC3Tests.ActorAsync(source);
        await WithAsync<bool, IWebsiteMenus>(source, async menus =>
        {
            var admin = await menus.GetAdminAsync(CancellationToken.None);
            var parents = admin.Items.Where(i => i.ParentId is null && admin.Items.Any(c => c.ParentId == i.Id)).ToList();
            var old = parents[0];
            var moving = admin.Items.First(c => c.ParentId == old.Id);
            var newParent = parents[1];
            // The old parent and its other children go; the one child stays under another parent (same id).
            var gone = admin.Items.Where(i => i.Id == old.Id || (i.ParentId == old.Id && i.Id != moving.Id)).Select(i => i.Id).ToHashSet();
            var items = admin.Items.Where(i => !gone.Contains(i.Id)).Select(i => new MenuItemInput(i.Id, i.Id == moving.Id ? newParent.Id : i.ParentId, i.Placement, i.IsEnabled, i.Href, i.OpenInNewTab, i.Labels)).ToList();
            var saved = await menus.SaveAsync(new SaveMenuCommand(admin.Revision, items, actor), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return true;
        });
        var sourceTree = Tree(await WithAsync<MenuAdminDto, IWebsiteMenus>(source, m => m.GetAdminAsync(CancellationToken.None))).OrderBy(t => t.Id).ToList();
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");
            Assert.Equal(sourceTree, Tree(await WithAsync<MenuAdminDto, IWebsiteMenus>(target, m => m.GetAdminAsync(CancellationToken.None))).OrderBy(t => t.Id).ToList());
            var sourcePublic = await WithAsync<PublicMenuDto, IWebsiteMenus>(source, m => m.GetPublicAsync("vi", CancellationToken.None));
            var targetPublic = await WithAsync<PublicMenuDto, IWebsiteMenus>(target, m => m.GetPublicAsync("vi", CancellationToken.None));
            Assert.Equal(Shape(sourcePublic.Primary), Shape(targetPublic.Primary));
            Assert.Equal(Shape(sourcePublic.Secondary), Shape(targetPublic.Secondary));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    private static string Shape(IReadOnlyList<PublicMenuItemDto> items) => string.Join(",", items.Select(i => $"{i.Id}({Shape(i.Children)})"));

    /// <summary>The staff delete one leaf menu item (the <paramref name="skip"/>th leaf) through the real service; returns its id.</summary>
    private static async Task<Guid> StaffDeleteLeafAsync(Target t, int skip)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        return await WithAsync<Guid, IWebsiteMenus>(t, async menus =>
        {
            var admin = await menus.GetAdminAsync(CancellationToken.None);
            var leaf = admin.Items.Where(i => !admin.Items.Any(c => c.ParentId == i.Id)).ElementAt(skip);
            var items = admin.Items.Where(i => i.Id != leaf.Id).Select(i => new MenuItemInput(i.Id, i.ParentId, i.Placement, i.IsEnabled, i.Href, i.OpenInNewTab, i.Labels)).ToList();
            var saved = await menus.SaveAsync(new SaveMenuCommand(admin.Revision, items, actor), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return leaf.Id;
        });
    }

    [Fact]
    public async Task F2_a_target_the_staff_saved_keeps_its_own_hero_and_menu()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await StaffSaveHeroAsync(source, slides => { var l = slides.Select(AsInput).ToList(); (l[0], l[1]) = (l[1], l[0]); return l; });
        await StaffSaveHeroAsync(target, slides => slides.Select(AsInput).Reverse(), interval: 8);
        // The source's staff changed the menu too (a leaf removed); the target's staff removed another one.
        var removedAtSource = await StaffDeleteLeafAsync(source, 0);
        var removedAtTarget = await StaffDeleteLeafAsync(target, 1);
        var own = await PublicSlidesAsync(target);
        var ownTree = Tree(await WithAsync<MenuAdminDto, IWebsiteMenus>(target, m => m.GetAdminAsync(CancellationToken.None))).OrderBy(t => t.Id).ToList();
        Assert.DoesNotContain(ownTree, t => t.Id == removedAtTarget);
        Assert.Contains(ownTree, t => t.Id == removedAtSource);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");
            Assert.Equal(own, await PublicSlidesAsync(target));
            Assert.Equal(8, (await HeroAdminAsync(target)).IntervalSeconds);
            // The target's menu is its own: neither the item its staff removed came back nor the one the source removed went.
            Assert.Equal(ownTree, Tree(await WithAsync<MenuAdminDto, IWebsiteMenus>(target, m => m.GetAdminAsync(CancellationToken.None))).OrderBy(t => t.Id).ToList());
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F3: the files of hero uploads follow the media rows the target keeps ----

    private static async Task<(Guid Media, string Key, byte[] Bytes)> StaffAddUploadedSlideAsync(Target t)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        var key = $"hero/{Guid.NewGuid():N}.webp";
        var bytes = new byte[2048]; new Random(11).NextBytes(bytes);
        Directory.CreateDirectory(Path.Combine(t.Media, "hero"));
        await File.WriteAllBytesAsync(Path.Combine(t.Media, key), bytes);
        var media = Guid.NewGuid();
        await t.ExecuteAsync($"""INSERT INTO "WebsiteHeroMedia" ("Id","Kind","StorageKey","ContentType","ByteSize","Width","Height","CreatedAtUtc","CreatedByStaffId") VALUES ('{media}','upload','{key}','image/webp',{bytes.Length},1920,900,now(),'{actor}')""");
        await StaffSaveHeroAsync(t, slides => slides.Select(AsInput).Append(new HeroSlideInput(Guid.NewGuid(), media, "50% 50%", slides[0].Alt, slides[0].Caption)));
        return (media, key, bytes);
    }

    [Fact]
    public async Task F3_the_files_of_an_imported_hero_are_still_verified_and_restored_after_the_first_import_and_a_damaged_one_is_not_overwritten()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        var (media, key, bytes) = await StaffAddUploadedSlideAsync(source);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            var path = Path.Combine(target.Media, key);
            // 1. Imported; the second verify runs when the hero carries the source's version and author (no longer the migration's).
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(bytes, await File.ReadAllBytesAsync(path));
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit);

            // 2. The file the slide uses goes missing: verify fails, apply puts it back from the pack, the picture is served again.
            var imageUrl = (await WithAsync<PublicHeroDto, IWebsiteHero>(target, h => h.GetPublicAsync("vi", CancellationToken.None))).Slides.Single(s => s.ImageUrl.Contains(media.ToString(), StringComparison.OrdinalIgnoreCase)).ImageUrl;
            using var client = target.Host.CreateClient(new() { AllowAutoRedirect = false });
            var working = await client.GetAsync(imageUrl);
            Assert.Equal(System.Net.HttpStatusCode.OK, working.StatusCode);
            Assert.Equal(bytes, await working.Content.ReadAsByteArrayAsync());
            File.Delete(path);
            Assert.NotEqual(System.Net.HttpStatusCode.OK, (await client.GetAsync(imageUrl)).StatusCode);
            var missing = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.NotEqual(0, missing.Exit);
            Assert.Contains(key, missing.Output);
            Assert.Null(await WithAsync<HeroMediaFile?, IWebsiteHero>(target, h => h.OpenMediaAsync(media, CancellationToken.None)));
            var restored = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(restored.Exit == 0, restored.Output);
            Assert.Equal(bytes, await File.ReadAllBytesAsync(path));
            var served = await WithAsync<byte[], IWebsiteHero>(target, async h => { await using var file = (await h.OpenMediaAsync(media, CancellationToken.None))!.Content; using var memory = new MemoryStream(); await file.CopyToAsync(memory); return memory.ToArray(); });
            Assert.Equal(bytes, served);
            var again = await client.GetAsync(imageUrl);
            Assert.Equal(System.Net.HttpStatusCode.OK, again.StatusCode);
            Assert.Equal(bytes, await again.Content.ReadAsByteArrayAsync());
            Assert.Equal(0, (await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit);

            // 3. Another file under the same key: the existing policy (a conflict, never overwritten), in verify and in apply.
            var damaged = bytes.Append((byte)1).ToArray();
            await File.WriteAllBytesAsync(path, damaged);
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.NotEqual(0, verify.Exit);
            Assert.Contains("a different file is already there", verify.Output);
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.NotEqual(0, apply.Exit);
            Assert.Equal(damaged, await File.ReadAllBytesAsync(path));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F3_a_target_with_its_own_hero_does_not_get_the_packs_picture_and_verify_does_not_miss_it()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        var (_, key, _) = await StaffAddUploadedSlideAsync(source);
        await StaffSaveHeroAsync(target, slides => slides.Select(AsInput).Reverse(), interval: 8);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");
            Assert.False(File.Exists(Path.Combine(target.Media, key)));
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "WebsiteHeroMedia" WHERE "StorageKey" = '{key}' """));
            Assert.Equal(8, (await HeroAdminAsync(target)).IntervalSeconds);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }
}
