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

    // ---- C6.1: the staff clear a hero / menu text in Admin → Translations: the row goes, the parent's version stays 1 ----

    private static async Task<int> TextVersionAsync(Target t, string key) =>
        (int)await t.CountAsync($"""SELECT t."Version" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" = '{key}'""");

    /// <summary>What the Admin translation editor does (the real settings store): the row is deleted and no hero or menu version moves.</summary>
    private static async Task StaffClearInTranslatorAsync(Target t, string key)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        var version = await TextVersionAsync(t, key);
        var cleared = await WithAsync<WebsiteMutationResult<WebsiteTranslationRowDto>, IWebsiteSettingsStore>(t, s => s.ClearTranslationAsync(new ClearTranslationCommand("en", key, version, actor), CancellationToken.None));
        Assert.True(cleared.Status == WebsiteMutationStatus.Succeeded, cleared.Message);
    }

    private static async Task StaffSaveInTranslatorAsync(Target t, string key, string value)
    {
        var actor = await ContentPackC3Tests.ActorAsync(t);
        var version = await TextVersionAsync(t, key);
        var saved = await WithAsync<WebsiteMutationResult<WebsiteTranslationRowDto>, IWebsiteSettingsStore>(t, s => s.SaveTranslationAsync(new SaveTranslationCommand("en", key, value, version, actor), CancellationToken.None));
        Assert.True(saved.Status == WebsiteMutationStatus.Succeeded, saved.Message);
    }

    private static async Task AssertParentsUntouchedAsync(Target t)
    {
        Assert.Equal(1, await t.CountAsync("""SELECT "Version" FROM "WebsiteHero" """));
        Assert.Equal(1, await t.CountAsync("""SELECT "Version" FROM "WebsiteMenu" """));
    }

    private static string TextOf(Target t, string key) =>
        t.TextAsync($"""SELECT t."Value" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" = '{key}'""").GetAwaiter().GetResult() ?? "<none>";

    private static async Task<string> RewriteManifestAsync(string pack, Func<System.Text.Json.Nodes.JsonObject, System.Text.Json.Nodes.JsonObject> change)
    {
        var path = Path.Combine(pack, "manifest.json");
        var manifest = System.Text.Json.Nodes.JsonNode.Parse(await File.ReadAllTextAsync(path))!.AsObject();
        await File.WriteAllTextAsync(path, change(manifest).ToJsonString());
        return pack;
    }

    [Fact]
    public async Task A_hero_label_cleared_in_the_translator_while_the_hero_stays_at_version_1_is_gone_from_a_fresh_target()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await StaffClearInTranslatorAsync(source, SecondaryKey);
        Assert.Equal(0, await source.CountAsync(En(SecondaryKey)));
        await AssertParentsUntouchedAsync(source);
        var sourcePublic = await WithAsync<PublicHeroDto, IWebsiteHero>(source, h => h.GetPublicAsync("en", CancellationToken.None));
        Assert.Equal("Xem Riverside", sourcePublic.SecondaryAction);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await SnapshotOutsideAsync(target);
            Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0 && dry.Output.Contains(SecondaryKey), dry.Output);
            Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(1, await target.CountAsync(En(PrimaryKey)));
            Assert.Equal(0, await ChangedOutsideAsync(target));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            var targetPublic = await WithAsync<PublicHeroDto, IWebsiteHero>(target, h => h.GetPublicAsync("en", CancellationToken.None));
            Assert.Equal(sourcePublic.SecondaryAction, targetPublic.SecondaryAction);
            Assert.Equal(sourcePublic.PrimaryAction, targetPublic.PrimaryAction);

            var total = await target.CountAsync(Total);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(total, await target.CountAsync(Total));
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(0, await ChangedOutsideAsync(target));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task Verify_names_the_seeded_text_cleared_in_the_translator_when_nothing_else_differs()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await StaffClearInTranslatorAsync(source, SecondaryKey);
        await AssertParentsUntouchedAsync(source);
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

    [Fact]
    public async Task A_menu_label_cleared_in_the_translator_while_the_menu_stays_at_version_1_is_gone_from_a_fresh_target()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        var admin = await WithAsync<MenuAdminDto, IWebsiteMenus>(source, m => m.GetAdminAsync(CancellationToken.None));
        var leaves = admin.Items.Where(i => i.Labels.GetValueOrDefault("en") is not null).Take(2).Select(i => i.Id).ToList();
        foreach (var id in leaves) await StaffClearInTranslatorAsync(source, MenuKey(id));
        var kept = admin.Items.First(i => !leaves.Contains(i.Id) && i.Labels.GetValueOrDefault("en") is not null).Id;
        await AssertParentsUntouchedAsync(source);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            await SnapshotOutsideAsync(target);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"))).Exit);
            foreach (var id in leaves) Assert.Equal(1, await target.CountAsync(En(MenuKey(id))));
            var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(apply.Exit == 0, apply.Output);
            foreach (var id in leaves) Assert.Equal(0, await target.CountAsync(En(MenuKey(id))));
            Assert.Equal(1, await target.CountAsync(En(MenuKey(kept))));
            Assert.Equal(0, await ChangedOutsideAsync(target));
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
            var sourcePublic = await WithAsync<PublicMenuDto, IWebsiteMenus>(source, m => m.GetPublicAsync("en", CancellationToken.None));
            var targetPublic = await WithAsync<PublicMenuDto, IWebsiteMenus>(target, m => m.GetPublicAsync("en", CancellationToken.None));
            Assert.Equal(Shape(sourcePublic.Primary), Shape(targetPublic.Primary));
            Assert.Equal(Shape(sourcePublic.Secondary), Shape(targetPublic.Secondary));
            var total = await target.CountAsync(Total);
            Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
            Assert.Equal(total, await target.CountAsync(Total));
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task What_the_targets_staff_did_survives_a_translator_cleared_source()
    {
        await using var source = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await StaffClearInTranslatorAsync(source, SecondaryKey);
        await StaffClearInTranslatorAsync(source, PrimaryKey);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            // (a) hero and menu untouched, but the target's staff edited the English secondary label in the translator and a text outside sits next to it.
            await using (var target = await NewTargetAsync())
            {
                await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
                await StaffSaveInTranslatorAsync(target, SecondaryKey, "Staff wording");
                await target.ExecuteAsync($"""INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc","UpdatedByStaffId","IsManual","SourceHash") SELECT "Id", '{OtherCollectionKey}', 'Seed-like text', 1, now(), NULL, false, NULL FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'""");
                var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
                Assert.True(apply.Exit == 0, apply.Output);
                Assert.Equal("Staff wording", TextOf(target, SecondaryKey));
                Assert.Equal(1, await target.CountAsync(En(OtherCollectionKey)));
                Assert.True((await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit == 0);
                Assert.Equal(0, (await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"))).Exit);
                Assert.Equal("Staff wording", TextOf(target, SecondaryKey));
            }
            // (b) the target's staff saved the hero (their own collection): its seed texts stay, the cleared labels are not taken from the source.
            await using (var target = await NewTargetAsync())
            {
                await ContentPackC3Tests.StaffActivateEnglishAsync(target, makeDefault: false);
                await StaffSaveHeroTextsAsync(target, t => t with { Title = With(t.Title, "en", "Staff title") }, interval: 8);
                var apply = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
                Assert.True(apply.Exit == 0, apply.Output);
                Assert.Equal("Staff title", TextOf(target, TitleKey));
                Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
                Assert.Equal(1, await target.CountAsync(En(PrimaryKey)));
                Assert.Equal(8, (await WithAsync<HeroAdminDto, IWebsiteHero>(target, h => h.GetAdminAsync(CancellationToken.None))).IntervalSeconds);
                Assert.True((await target.RunAsync(target.Verify(pack, "--groups", "website"))).Exit == 0);
            }
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task A_label_the_targets_staff_cleared_in_the_translator_after_an_import_is_not_put_back_by_the_next_one()
    {
        await using var source = await NewTargetAsync();
        await using var target = await NewTargetAsync();
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            var first = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(first.Exit == 0, first.Output);
            var menuKey = MenuKey(Guid.Parse((await target.TextAsync("""SELECT substring(t."Key" from 'content\.menuItem\.(.*)\.label') FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'en' AND t."Key" LIKE 'content.menuItem.%' ORDER BY t."Key" LIMIT 1"""))!));
            await StaffClearInTranslatorAsync(target, SecondaryKey);
            await StaffClearInTranslatorAsync(target, menuKey);
            await AssertParentsUntouchedAsync(target);
            var dry = await target.RunAsync(target.Import(pack, "--groups", "website", "--dry-run"));
            Assert.True(dry.Exit == 0, dry.Output);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            var again = await target.RunAsync(target.Import(pack, "--groups", "website", "--apply"));
            Assert.True(again.Exit == 0, again.Output);
            Assert.Equal(0, await target.CountAsync(En(SecondaryKey)));
            Assert.Equal(0, await target.CountAsync(En(menuKey)));
            Assert.Matches(@"WebsiteTranslations\s.*deleted-since\s+[1-9]", again.Output);
            var verify = await target.RunAsync(target.Verify(pack, "--groups", "website"));
            Assert.True(verify.Exit == 0, verify.Output);
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    [Fact]
    public async Task A_pack_without_the_text_scope_or_without_the_language_is_never_read_as_a_request_to_delete()
    {
        await using var source = await NewTargetAsync();
        await ContentPackC3Tests.StaffActivateEnglishAsync(source, makeDefault: false);
        await StaffClearInTranslatorAsync(source, SecondaryKey);
        var pack = await ContentPackC3Tests.ExportAsync(source);
        try
        {
            // The pack as an older export wrote it (no statement of which languages' texts it carries in full) …
            var old = await RewriteManifestAsync(CopyDirectoryTo(pack, ContentPackC3Tests.NewDirectory("bha-c6-old-")), m => { m.Remove("CompleteTextLanguages"); return m; });
            // … and one that states a scope which does not include English.
            var other = await RewriteManifestAsync(CopyDirectoryTo(pack, ContentPackC3Tests.NewDirectory("bha-c6-scope-")), m => { m["CompleteTextLanguages"] = new System.Text.Json.Nodes.JsonArray("vi"); return m; });
            try
            {
                foreach (var weak in new[] { old, other })
                {
                    await using var target = await NewTargetAsync();
                    var dry = await target.RunAsync(target.Import(weak, "--groups", "website", "--dry-run"));
                    Assert.True(dry.Exit == 0, dry.Output);
                    var apply = await target.RunAsync(target.Import(weak, "--groups", "website", "--apply"));
                    Assert.True(apply.Exit == 0, apply.Output);
                    Assert.Equal(1, await target.CountAsync(En(SecondaryKey)));
                    var verify = await target.RunAsync(target.Verify(weak, "--groups", "website"));
                    Assert.True(verify.Exit == 0, verify.Output);
                    if (ReferenceEquals(weak, old)) Assert.Contains("NOTE", apply.Output);
                }
            }
            finally { Directory.Delete(old, recursive: true); Directory.Delete(other, recursive: true); }
        }
        finally { Directory.Delete(pack, recursive: true); }
    }

    private static string CopyDirectoryTo(string from, string to) { CopyDirectory(from, to); return to; }

    private static void CopyDirectory(string from, string to)
    {
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var destination = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination);
        }
    }
}
