using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Api.Seeding;
using TheBha.Application.Blog;
using TheBha.Application.Website;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C4: one regression test group per finding of the fourth Codex review. Real PostgreSQL; the staff's actions go through the
/// real services (menu, hero, Blog, settings), so versions and authors are the ones Admin writes. The test database's time zone is whatever the server
/// has; the report states it (UTC).
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC4Tests(PostgreSqlWebApplicationFactory factory)
{
    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    private static async Task<T> WithAsync<T, TService>(Target t, Func<TService, Task<T>> action) where TService : notnull
    {
        await using var scope = t.Host.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<TService>());
    }

    private static string[] Run(Target t, string pack, string groups, string mode) => t.Import(pack, "--groups", groups, mode);

    private static async Task AssertCleanAsync(Target t, string pack, string groups)
    {
        var dry = await t.RunAsync(Run(t, pack, groups, "--dry-run"));
        Assert.True(dry.Exit == 0, dry.Output);
        var apply = await t.RunAsync(Run(t, pack, groups, "--apply"));
        Assert.True(apply.Exit == 0, apply.Output);
        var verify = await t.RunAsync(t.Verify(pack, "--groups", groups));
        Assert.True(verify.Exit == 0, verify.Output);
        var again = await t.RunAsync(Run(t, pack, groups, "--apply"));
        Assert.True(again.Exit == 0, again.Output);
    }

    // ---- F1: a hero / menu text the staff cleared on purpose stays cleared ----

    private const string EnglishId = """(SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en')""";

    private static string MenuKey(Guid id) => $"content.menuItem.{id}.label";

    private static Task<long> EnglishTextsAsync(Target t, string like) => t.CountAsync($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "LanguageId" = {EnglishId} AND "Key" LIKE '{like}' """);

    /// <summary>The staff clear the English label of one menu item through the real service.</summary>
    private static async Task<(Guid Item, string Text)> StaffClearMenuLabelAsync(Target t)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        return await WithAsync<(Guid, string), IWebsiteMenus>(t, async menus =>
        {
            var admin = await menus.GetAdminAsync(CancellationToken.None);
            var victim = admin.Items.First(i => i.Labels.TryGetValue("en", out var label) && !string.IsNullOrWhiteSpace(label) && label != i.Labels["vi"]);
            var items = admin.Items.Select(i => new MenuItemInput(i.Id, i.ParentId, i.Placement, i.IsEnabled, i.Href, i.OpenInNewTab,
                i.Id == victim.Id ? new Dictionary<string, string?>(i.Labels) { ["en"] = null } : i.Labels)).ToList();
            var saved = await menus.SaveAsync(new SaveMenuCommand(admin.Revision, items, actor), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return (victim.Id, victim.Labels["en"]!);
        });
    }

    private static async Task StaffClearHeroActionAsync(Target t)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        await WithAsync<bool, IWebsiteHero>(t, async hero =>
        {
            var admin = await hero.GetAdminAsync(CancellationToken.None);
            var texts = new HeroTextsDto(admin.Texts.Title, admin.Texts.Description, admin.Texts.PrimaryAction, new Dictionary<string, string?>(admin.Texts.SecondaryAction!) { ["en"] = null });
            var slides = admin.Slides.Select(s => new HeroSlideInput(s.Id, s.MediaId, s.FocalPosition, s.Alt, s.Caption)).ToList();
            var saved = await hero.SaveAsync(new SaveHeroCommand(admin.Revision, admin.FontKey, admin.AutoplayEnabled, admin.IntervalSeconds, texts, slides, actor), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return true;
        });
    }

    [Fact]
    public async Task F1_a_menu_label_the_staff_cleared_before_the_first_import_is_not_put_back_and_the_other_collection_still_is()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        var (item, packText) = await StaffClearMenuLabelAsync(target);
        // The hero is untouched on the target: a text of it that is missing comes back, so the protection is limited to the menu.
        await target.ExecuteAsync($"""DELETE FROM "WebsiteTranslations" WHERE "LanguageId" = {EnglishId} AND "Key" = 'content.heroSlideshow.main.primaryAction' """);
        Assert.Equal(0, await EnglishTextsAsync(target, MenuKey(item)));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            Assert.Equal(1, await source.CountAsync($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = '{MenuKey(item)}' AND "LanguageId" = {EnglishId}"""));
            var dry = await target.RunAsync(Run(target, pack, "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Equal(0, await EnglishTextsAsync(target, MenuKey(item)));
            await AssertCleanAsync(target, pack, "website");

            Assert.Equal(0, await EnglishTextsAsync(target, MenuKey(item)));
            Assert.Equal(1, await EnglishTextsAsync(target, "content.heroSlideshow.main.primaryAction"));
            var menu = await WithAsync<PublicMenuDto, IWebsiteMenus>(target, m => m.GetPublicAsync("en", CancellationToken.None));
            var label = menu.Primary.Concat(menu.Secondary).SelectMany(Flatten).Single(i => i.Id == item).Label;
            Assert.NotEqual(packText, label);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    private static IEnumerable<PublicMenuItemDto> Flatten(PublicMenuItemDto item) => new[] { item }.Concat(item.Children.SelectMany(Flatten));

    [Fact]
    public async Task F1_a_hero_text_the_staff_cleared_is_not_put_back()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        await StaffClearHeroActionAsync(target);
        const string Key = "content.heroSlideshow.main.secondaryAction";
        Assert.Equal(0, await EnglishTextsAsync(target, Key));
        var packText = await source.TextAsync($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{Key}' AND "LanguageId" = {EnglishId}""");
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");
            Assert.Equal(0, await EnglishTextsAsync(target, Key));
            var hero = await WithAsync<PublicHeroDto, IWebsiteHero>(target, h => h.GetPublicAsync("en", CancellationToken.None));
            Assert.NotEqual(packText, hero.SecondaryAction);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F1_on_a_database_the_staff_have_not_touched_the_packs_menu_and_hero_texts_come_in_and_show()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        var itemKey = (await source.TextAsync($"""SELECT "Key" FROM "WebsiteTranslations" WHERE "LanguageId" = {EnglishId} AND "Key" LIKE 'content.menuItem.%' ORDER BY "Key" LIMIT 1"""))!;
        var item = Guid.Parse(itemKey["content.menuItem.".Length..^".label".Length]);
        // The pack's English texts differ from the target's: the target's rows are removed so the pack's must come in.
        await target.ExecuteAsync($"""DELETE FROM "WebsiteTranslations" WHERE "LanguageId" = {EnglishId} AND ("Key" LIKE 'content.menuItem.%' OR "Key" LIKE 'content.heroSlideshow.%')""");
        var packText = (await source.TextAsync($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = '{MenuKey(item)}' AND "LanguageId" = {EnglishId}"""))!;
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");
            Assert.Equal(1, await EnglishTextsAsync(target, MenuKey(item)));
            var menu = await WithAsync<PublicMenuDto, IWebsiteMenus>(target, m => m.GetPublicAsync("en", CancellationToken.None));
            Assert.Equal(packText, menu.Primary.Concat(menu.Secondary).SelectMany(Flatten).Single(i => i.Id == item).Label);
            Assert.Equal(1, await EnglishTextsAsync(target, "content.heroSlideshow.main.secondaryAction"));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F2: a stored-content text is keyed by the id of what it translates; the key follows the target's own row ----

    private static async Task<(Guid Property, Guid RoomType, Guid RatePlan, Guid Amenity)> PackIdsAsync()
    {
        await Task.CompletedTask;
        Guid Id(string table) => Guid.Parse(PackRow(table, l => l.Contains(RiversideId))["Id"]!.GetValue<string>());
        var amenity = Guid.Parse(PackRow("Amenities", _ => true)["Id"]!.GetValue<string>());
        return (Guid.Parse(RiversideId), Id("RoomTypes"), Id("RatePlans"), amenity);
    }

    /// <summary>The target's catalog: the same property, room type, rate plan and amenity (same natural keys) under other ids.</summary>
    private static async Task<(Guid Property, Guid RoomType, Guid RatePlan, Guid Amenity)> OwnCatalogAsync(Target target)
    {
        var (property, roomType, ratePlan, amenity) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var p = PackRow("Properties", l => l.Contains(RiversideId)); p["Id"] = property.ToString();
        await target.InsertRowAsync("Properties", p);
        var a = PackRow("Amenities", _ => true); a["Id"] = amenity.ToString();
        await target.InsertRowAsync("Amenities", a);
        var r = PackRow("RoomTypes", l => l.Contains(RiversideId)); r["Id"] = roomType.ToString(); r["PropertyId"] = property.ToString();
        await target.InsertRowAsync("RoomTypes", r);
        var plan = PackRow("RatePlans", l => l.Contains(RiversideId)); plan["Id"] = ratePlan.ToString(); plan["PropertyId"] = property.ToString();
        await target.InsertRowAsync("RatePlans", plan);
        return (property, roomType, ratePlan, amenity);
    }

    private static string Text(Target t, string key, string value, bool staff = false, Guid? actor = null) => $"""
        INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","UpdatedByStaffId","IsManual","SourceHash")
        VALUES ({EnglishId}, '{key}', '{value}', {(staff ? 2 : 1)}, now(), {(staff ? $"'{actor}'" : "NULL")}, true, 'c4c4c4c4c4c4c4c4')
        """;

    [Fact]
    public async Task F2_texts_of_the_catalog_follow_the_targets_own_ids_and_a_staff_text_under_the_target_key_is_kept()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        Assert.Equal(0, (await source.RunAsync(source.Import(PackDir(), "--groups", "catalog", "--apply"))).Exit);
        var (sp, sr, sl, sa) = await PackIdsAsync();
        // English first: a language is switched on only while its texts are complete, and the catalog added after it has none yet.
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        var (tp, tr, tl, ta) = await OwnCatalogAsync(target);
        foreach (var (entity, id, field, value) in new[] { ("property", sp, "name", "C4 property"), ("roomType", sr, "name", "C4 room type"), ("ratePlan", sl, "name", "C4 rate plan"), ("amenity", sa, "name", "C4 amenity") })
            await source.ExecuteAsync(Text(source, $"content.{entity}.{id}.{field}", value));
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        Assert.Equal("true", await target.TextAsync("""SELECT "IsActive"::text FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));
        // A Staff text on the target already sits under the target's own key: it is kept, not replaced by the pack's.
        var actor = await ContentPackC3Tests.ActorAsync(target);
        await target.ExecuteAsync(Text(target, $"content.roomType.{tr}.name", "Staff room type", staff: true, actor: actor));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "website");

            Assert.Equal("C4 property", await target.TextAsync($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.property.{tp}.name' """));
            Assert.Equal("C4 rate plan", await target.TextAsync($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.ratePlan.{tl}.name' """));
            Assert.Equal("C4 amenity", await target.TextAsync($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.amenity.{ta}.name' """));
            Assert.Equal("Staff room type", await target.TextAsync($"""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'content.roomType.{tr}.name' """));
            // Nothing new under a source id, and the catalog was not written (the website group only).
            Assert.Equal(0, await target.CountAsync($"""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" IN ('content.property.{sp}.name','content.roomType.{sr}.name','content.ratePlan.{sl}.name','content.amenity.{sa}.name')"""));
            Assert.Equal(1, await target.CountAsync("""SELECT count(*) FROM "Properties" WHERE "Slug" = 'the-bha-riverside' """));

            var dictionary = await WithAsync<PublicDictionaryDto, IWebsitePublicReader>(target, r => r.GetDictionaryAsync(new PublicDictionaryQuery("en", [], ["content."]), CancellationToken.None));
            Assert.Equal("true", await target.TextAsync("""SELECT "IsActive"::text FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));
            Assert.Equal("en", dictionary.ResolvedLocale);
            Assert.Equal("C4 property", dictionary.Entries[$"content.property.{tp}.name"]);
            Assert.Equal("C4 rate plan", dictionary.Entries[$"content.ratePlan.{tl}.name"]);
            Assert.Equal("C4 amenity", dictionary.Entries[$"content.amenity.{ta}.name"]);
            Assert.Equal("Staff room type", dictionary.Entries[$"content.roomType.{tr}.name"]);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- F3: the source's edit of the seeded Blog category and settings travels over an untouched seed ----

    private static readonly Guid Featured = TheBha.Infrastructure.Persistence.BlogSeed.FeaturedDestinationsCategoryId;

    /// <summary>The staff rename the Featured destinations category's English slug, add a category and make it the homepage's — all through the Blog service.</summary>
    private static async Task<(Guid Other, string FeaturedSlug, string OtherSlug)> StaffEditBlogAsync(Target t, string featuredSlug, string otherSlug, bool createOther)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        var other = Guid.NewGuid();
        await WithAsync<bool, IAdminBlog>(t, async blog =>
        {
            var renamed = await blog.UpdateCategoryAsync(new UpdateBlogCategoryCommand(Featured, 1, 10,
                new Dictionary<string, BlogCategoryText> { ["en"] = new("Featured places", featuredSlug, "Places worth a visit") }, actor), CancellationToken.None);
            Assert.True(renamed.Status == WebsiteMutationStatus.Succeeded, renamed.Message);
            if (!createOther) return true;
            var created = await blog.CreateCategoryAsync(new CreateBlogCategoryCommand(other, 20, new Dictionary<string, BlogCategoryText>
            {
                ["vi"] = new("Mẹo đi lại", otherSlug + "-vi", null), ["en"] = new("Travel tips", otherSlug, null),
            }, actor), CancellationToken.None);
            Assert.True(created.Status == WebsiteMutationStatus.Succeeded, created.Message);
            var settings = await blog.SetSettingsAsync(new SetBlogSettingsCommand((await blog.GetSettingsAsync(CancellationToken.None)).Version, other, actor), CancellationToken.None);
            Assert.True(settings.Status == WebsiteMutationStatus.Succeeded, settings.Message);
            return true;
        });
        return (other, featuredSlug, otherSlug);
    }

    private static Task<string?> CurrentSlugAsync(Target t, Guid category) => t.TextAsync($"""SELECT string_agg("Slug", ',') FROM "BlogCategorySlugs" WHERE "CategoryId" = '{category}' AND "Locale" = 'en' AND "IsCurrent" """);

    [Fact]
    public async Task F3_the_sources_renamed_category_and_homepage_choice_travel_to_a_freshly_migrated_database()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        var (other, featuredSlug, otherSlug) = await StaffEditBlogAsync(source, "featured-places", "travel-tips", createOther: true);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "blog");

            Assert.Equal(featuredSlug, await CurrentSlugAsync(target, Featured));
            Assert.Equal("Featured places", await target.TextAsync($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal("false", await target.TextAsync($"""SELECT "IsCurrent"::text FROM "BlogCategorySlugs" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' AND "Slug" = 'featured-destinations' """));
            Assert.Equal(other.ToString(), await target.TextAsync("""SELECT "HomeSectionCategoryId"::text FROM "BlogSettings" """));

            var current = await WithAsync<PublicBlogCategoryLookup, IWebsiteBlog>(target, b => b.GetCategoryAsync("en", featuredSlug, CancellationToken.None));
            Assert.Equal("Featured places", current.Category!.Name);
            var old = await WithAsync<PublicBlogCategoryLookup, IWebsiteBlog>(target, b => b.GetCategoryAsync("en", "featured-destinations", CancellationToken.None));
            Assert.Equal(featuredSlug, old.RedirectSlug);
            var home = await WithAsync<PublicBlogHomeSectionDto, IWebsiteBlog>(target, b => b.HomeSectionAsync("en", 3, CancellationToken.None));
            Assert.Equal(otherSlug, home.Category!.Slug);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task F3_a_target_whose_staff_already_renamed_the_category_and_chose_another_homepage_category_keeps_both()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        await StaffEditBlogAsync(source, "featured-places", "travel-tips", createOther: true);
        var (own, ownFeatured, _) = await StaffEditBlogAsync(target, "my-own-slug", "my-own-list", createOther: true);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await AssertCleanAsync(target, pack, "blog");

            Assert.Equal(ownFeatured, await CurrentSlugAsync(target, Featured));
            Assert.Equal("Featured places", await target.TextAsync($"""SELECT "Name" FROM "BlogCategoryTranslations" WHERE "CategoryId" = '{Featured}' AND "Locale" = 'en' """));
            Assert.Equal(own.ToString(), await target.TextAsync("""SELECT "HomeSectionCategoryId"::text FROM "BlogSettings" """));
            var home = await WithAsync<PublicBlogHomeSectionDto, IWebsiteBlog>(target, b => b.HomeSectionAsync("en", 3, CancellationToken.None));
            Assert.Equal("my-own-list", home.Category!.Slug);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }
}
