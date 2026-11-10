using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Website;
using static TheBha.IntegrationTests.ContentPackTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CONTENT-PERSIST-001-C6: a text the source's staff removed from the hero or the menu must not survive on a target that takes the source's collection.
/// Real PostgreSQL; the staff's actions go through the real hero and menu services.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ContentPackC6Tests(PostgreSqlWebApplicationFactory factory)
{
    private const string SecondaryKey = "content.heroSlideshow.main.secondaryAction";
    private const string PrimaryKey = "content.heroSlideshow.main.primaryAction";
    private const string TitleKey = "content.heroSlideshow.main.title";
    private const string OtherCollectionKey = "content.amenity.00000000-0000-0000-0000-0000000000c6.name";

    private Task<Target> NewTargetAsync() => ContentPackTestSupport.NewTargetAsync(factory);

    private static async Task<T> WithAsync<T, TService>(Target t, Func<TService, Task<T>> action) where TService : notnull
    {
        await using var scope = t.Host.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<TService>());
    }

    private static string En(string key) => $"""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" = '{key}'""";

    /// <summary>Keeps the texts outside the hero and the menu as they are now; <see cref="ChangedOutside"/> counts those that were changed or removed since.</summary>
    private static Task SnapshotOutsideAsync(Target t) => t.ExecuteAsync("""CREATE TABLE c6_before AS SELECT "LanguageId", "Key", "Value", "Version" FROM "WebsiteTranslations" WHERE "Key" NOT LIKE 'content.hero%' AND "Key" NOT LIKE 'content.menuItem.%'""");

    private static Task<long> ChangedOutsideAsync(Target t) => t.CountAsync("""SELECT count(*) FROM c6_before b LEFT JOIN "WebsiteTranslations" t ON t."LanguageId" = b."LanguageId" AND t."Key" = b."Key" WHERE t."Value" IS DISTINCT FROM b."Value" OR t."Version" IS DISTINCT FROM b."Version" """);

    private static string Total => """SELECT count(*) FROM "WebsiteTranslations" """;

    private static Task StaffSaveHeroTextsAsync(Target t, Func<HeroTextsDto, HeroTextsDto> change, int? interval = null) =>
        WithAsync<bool, IWebsiteHero>(t, async hero =>
        {
            var admin = await hero.GetAdminAsync(CancellationToken.None);
            var actor = await ContentPackC3Tests.ActorAsync(t);
            var slides = admin.Slides.Select(s => new HeroSlideInput(s.Id, s.MediaId, s.FocalPosition, s.Alt, s.Caption)).ToList();
            var saved = await hero.SaveAsync(new SaveHeroCommand(admin.Revision, admin.FontKey, admin.AutoplayEnabled, interval ?? admin.IntervalSeconds, change(admin.Texts), slides, actor), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return true;
        });

    private static IReadOnlyDictionary<string, string?> With(IReadOnlyDictionary<string, string?>? labels, string code, string? value) =>
        new Dictionary<string, string?>(labels ?? new Dictionary<string, string?>()) { [code] = value };

    private static Task StaffSaveMenuAsync(Target t, Func<IReadOnlyList<MenuItemDto>, IEnumerable<MenuItemInput>> change) =>
        WithAsync<bool, IWebsiteMenus>(t, async menus =>
        {
            var admin = await menus.GetAdminAsync(CancellationToken.None);
            var saved = await menus.SaveAsync(new SaveMenuCommand(admin.Revision, [.. change(admin.Items)], await ContentPackC3Tests.ActorAsync(t)), CancellationToken.None);
            Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
            return true;
        });

    private static MenuItemInput AsInput(MenuItemDto i, IReadOnlyDictionary<string, string?>? labels = null) => new(i.Id, i.ParentId, i.Placement, i.IsEnabled, i.Href, i.OpenInNewTab, labels ?? i.Labels);

    private static string Shape(IReadOnlyList<PublicMenuItemDto> items) => string.Join(",", items.Select(i => $"{i.Id}:{i.Label}({Shape(i.Children)})"));

    private static string MenuKey(Guid id) => $"content.menuItem.{id}.label";

    // ---- the hero ----

    [Fact]
    public async Task A_hero_label_the_source_cleared_is_gone_from_a_fresh_target_and_the_public_reader_falls_back_as_at_the_source()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        Assert.Equal(1, await source.CountAsync(En(SecondaryKey)));
        await StaffSaveHeroTextsAsync(source, t => t with { SecondaryAction = With(t.SecondaryAction, "en", null) });
        Assert.Equal(0, await source.CountAsync(En(SecondaryKey)));
        Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await SnapshotOutsideAsync(target);
            var totalBefore = await target.CountAsync(Total);

            // Dry-run: says it, writes nothing.
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.True(dry.Output.Contains(SecondaryKey), dry.Output);
            Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(totalBefore, await target.CountAsync(Total));

            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(1, await target.CountAsync(En(PrimaryKey)));
            Assert.Equal(0, await ChangedOutsideAsync(target));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);

            var total = await target.CountAsync(Total);
            var again = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(again.Exit == 0, again.Output);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(total, await target.CountAsync(Total));
            Assert.Equal(0, await ChangedOutsideAsync(target));

            var sourcePublic = await WithAsync<PublicHeroDto, IWebsiteHero>(source, h => h.GetPublicAsync("en", CancellationToken.None));
            var targetPublic = await WithAsync<PublicHeroDto, IWebsiteHero>(target, h => h.GetPublicAsync("en", CancellationToken.None));
            Assert.Equal("en", targetPublic.Locale);
            Assert.NotEqual("View Riverside", sourcePublic.SecondaryAction);
            Assert.Equal(sourcePublic.SecondaryAction, targetPublic.SecondaryAction);
            Assert.Equal(sourcePublic.PrimaryAction, targetPublic.PrimaryAction);
            Assert.Equal(sourcePublic.Title, targetPublic.Title);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task Verify_names_the_seeded_text_the_source_no_longer_has_when_nothing_else_differs()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        // No language is switched on at either side, so the languages match; only the hero differs.
        await StaffSaveHeroTextsAsync(source, t => t with { SecondaryAction = With(t.SecondaryAction, "en", null) });
        Assert.Equal(0, await source.CountAsync(En(SecondaryKey)));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            var early = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.NotEqual(0, early.Exit);
            Assert.True(early.Output.Contains(SecondaryKey), early.Output);
            Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            var late = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(late.Exit == 0, late.Output);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- the menu ----

    [Fact]
    public async Task A_menu_label_the_source_cleared_and_the_texts_of_an_item_it_removed_are_gone_from_a_fresh_target()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        var admin = await WithAsync<MenuAdminDto, IWebsiteMenus>(source, m => m.GetAdminAsync(CancellationToken.None));
        var leaves = admin.Items.Where(i => !admin.Items.Any(c => c.ParentId == i.Id) && i.Labels.GetValueOrDefault("en") is not null).ToList();
        var cleared = leaves[0].Id;
        var removed = leaves[1].Id;
        var kept = leaves[2].Id;
        await StaffSaveMenuAsync(source, items => items.Where(i => i.Id != removed).Select(i => i.Id == cleared ? AsInput(i, With(i.Labels, "en", null)) : AsInput(i)));
        Assert.Equal(0, await source.CountAsync(En(MenuKey(cleared))));
        Assert.Equal(0, await source.CountAsync(En(MenuKey(removed))));
        Assert.Equal(1, await target.CountAsync(En(MenuKey(cleared))));
        Assert.Equal(1, await target.CountAsync(En(MenuKey(removed))));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await SnapshotOutsideAsync(target);
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Equal(1, await target.CountAsync(En(MenuKey(cleared))));
            Assert.Equal(1, await target.CountAsync(En(MenuKey(removed))));

            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal(0, await target.CountAsync(En(MenuKey(cleared))));
            Assert.Equal(0, await target.CountAsync(En(MenuKey(removed))));
            Assert.Equal(1, await target.CountAsync(En(MenuKey(kept))));
            Assert.Equal(0, await ChangedOutsideAsync(target));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            var total = await target.CountAsync(Total);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(total, await target.CountAsync(Total));
            Assert.Equal(0, await target.CountAsync(En(MenuKey(cleared))));

            var sourcePublic = await WithAsync<PublicMenuDto, IWebsiteMenus>(source, m => m.GetPublicAsync("en", CancellationToken.None));
            var targetPublic = await WithAsync<PublicMenuDto, IWebsiteMenus>(target, m => m.GetPublicAsync("en", CancellationToken.None));
            Assert.Equal(Shape(sourcePublic.Primary), Shape(targetPublic.Primary));
            Assert.Equal(Shape(sourcePublic.Secondary), Shape(targetPublic.Secondary));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    // ---- what the target's staff did stays ----

    [Fact]
    public async Task A_target_whose_staff_saved_the_hero_keeps_its_own_texts_and_deletions_and_a_text_outside_the_hero_is_untouched()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
        await StaffSaveHeroTextsAsync(source, t => t with { SecondaryAction = With(t.SecondaryAction, "en", null) });
        // The target's staff: their own English title, and they cleared the English primary label on purpose. The secondary label is left as the migration made it.
        await StaffSaveHeroTextsAsync(target, t => t with { Title = With(t.Title, "en", "Staff title"), PrimaryAction = With(t.PrimaryAction, "en", null) }, interval: 8);
        await target.ExecuteAsync($"""INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","UpdatedByStaffId","IsManual","SourceHash") SELECT "Id", '{OtherCollectionKey}', 'Seed-like text', 1, now(), NULL, false, NULL FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");
        Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await SnapshotOutsideAsync(target);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"))).Exit);
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal("Staff title", await target.TextAsync($"""SELECT t."Value" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" = '{TitleKey}'"""));
            Assert.Equal(0, await target.CountAsync(En(PrimaryKey)));
            // The collection is the target's own: the label the source cleared stays where its staff left it.
            Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(1, await target.CountAsync(En(OtherCollectionKey)));
            Assert.Equal(0, await ChangedOutsideAsync(target));
            Assert.Equal(8, (await WithAsync<HeroAdminDto, IWebsiteHero>(target, h => h.GetAdminAsync(CancellationToken.None))).IntervalSeconds);
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(0, await target.CountAsync(En(PrimaryKey)));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task On_an_untouched_hero_a_text_the_target_edited_or_that_is_outside_the_hero_is_kept_while_the_cleared_seed_goes()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await StaffSaveHeroTextsAsync(source, t => t with { SecondaryAction = With(t.SecondaryAction, "en", null), PrimaryAction = With(t.PrimaryAction, "en", null) });
        var actor = await ContentPackC3Tests.ActorAsync(target);
        // The hero itself is untouched on the target, but its staff edited one English text (a language-pack style write: the hero row keeps version 1) and another sits outside the hero.
        await target.ExecuteAsync($"""UPDATE "WebsiteTranslations" t SET "Value" = 'Staff wording', "Version" = 2, "IsManual" = true, "UpdatedByStaffId" = '{actor}' FROM "WebsiteLanguages" l WHERE l."Id" = t."LanguageId" AND l."NormalizedCode" = 'en' AND t."Key" = '{PrimaryKey}'""");
        await target.ExecuteAsync($"""INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","UpdatedByStaffId","IsManual","SourceHash") SELECT "Id", '{OtherCollectionKey}', 'Seed-like text', 1, now(), NULL, false, NULL FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal("Staff wording", await target.TextAsync($"""SELECT t."Value" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" = '{PrimaryKey}'"""));
            Assert.Equal(1, await target.CountAsync(En(OtherCollectionKey)));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal("Staff wording", await target.TextAsync($"""SELECT t."Value" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" = '{PrimaryKey}'"""));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }
}
