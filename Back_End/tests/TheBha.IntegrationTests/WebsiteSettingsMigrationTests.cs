using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Website;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// CUST-WEB-HEADER-001-CP02 acceptance A1 (migrations 10 and 11): they apply to a database that already holds booking and
/// Staff data, leave every existing row untouched, give no Staff the website permission, seed Vietnamese (active default,
/// VND), English (present, off, USD), VND (base, rate 1) and USD/EUR (off, no rate) with the 24 starter texts in the
/// namespaced key scheme; running the migration command again overwrites nothing; the guarded Down() methods refuse to
/// drop anything an operator administered or installed. Each test owns a disposable database so it controls which
/// migration is applied.
/// </summary>
public sealed class WebsiteSettingsMigrationTests : IAsyncLifetime
{
    private const string V9Migration = "20261001141847_AddStaffIdentityFoundation";
    private const string V10Migration = "20261015050047_AddWebsiteLocalizationSettings";
    private const string V11Migration = "20261015095908_AddRuntimeLanguagePacks";
    private const string V12Migration = "20261016014037_AddWebsiteMenus";

    /// <summary>The 24 texts migration 10 seeded, under the keys migration 11 gave them (the old note about a selector that did nothing is retired).</summary>
    private static readonly string[] StarterKeys =
    [
        "customer.header.account.account", "customer.header.account.createAccount", "customer.header.account.myAccount", "customer.header.account.signIn",
        "customer.header.account.signOut", "customer.header.menu.blog", "customer.header.menu.currency", "customer.header.menu.language",
        "customer.header.menu.languageCurrency", "customer.header.menu.menu", "customer.header.menu.offers", "customer.header.menu.openMenu",
        "customer.header.menu.riverside", "customer.header.menu.services", "customer.header.menu.templates", "customer.header.theme.toDark",
        "customer.header.theme.toLight", "shared.common.clearFilters", "shared.common.close", "shared.common.error.generic",
        "shared.common.error.loadFailed", "shared.common.error.network", "shared.common.loading", "shared.common.retry"
    ];
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-15T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 11, 1);
    private static readonly DateOnly CheckOut = new(2026, 11, 3);

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_websitemigration_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => AdministerAsync($"CREATE DATABASE \"{_builder.Database}\"");

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await AdministerAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)");
    }

    [Fact]
    public async Task A_fresh_database_gets_the_frozen_seed_in_the_namespaced_key_scheme()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();

        Assert.Equal(19, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());

        // Languages: Vietnamese is the active default, English exists for the operator but is off; each has its format and currency.
        Assert.Equal(
            ["vi|Tiếng Việt|true|true|vi-VN|VND|ltr", "en|English|false|false|en-US|USD|ltr"],
            await RowsAsync("""SELECT "NormalizedCode" || '|' || "NativeName" || '|' || "IsActive"::text || '|' || "IsDefault"::text || '|' || "FormatLocale" || '|' || COALESCE("DefaultCurrencyCode",'') || '|' || "Direction" FROM "WebsiteLanguages" ORDER BY "SortOrder" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "PackId" IS NOT NULL"""));   // nothing is installed from a pack yet
        Assert.Equal(WebsiteTestSeed.Vietnamese, await ScalarAsync<Guid>("""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' """));
        Assert.Equal(WebsiteTestSeed.English, await ScalarAsync<Guid>("""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));

        // Currencies: VND is the base and default at rate 1; USD and EUR have metadata only — no rate, off.
        Assert.Equal(
            ["VND|0|true|true|true|1.00000000", "USD|2|false|false|false|", "EUR|2|false|false|false|"],
            await RowsAsync("""SELECT "Code" || '|' || "MinorUnits"::text || '|' || "IsActive"::text || '|' || "IsDefault"::text || '|' || "IsBase"::text || '|' || COALESCE("VndPerUnit"::text, '') FROM "WebsiteCurrencies" ORDER BY "SortOrder" """));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "VndPerUnit" IS NULL AND "RateUpdatedAtUtc" IS NULL AND NOT "IsActive" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffAccounts" """));

        // Translations: both languages have exactly the 24 starter texts, under their new keys, with the built-in packs' texts.
        var vi = LocalizationAssets.BuiltInPack("vi")!.Messages;
        var en = LocalizationAssets.BuiltInPack("en")!.Messages;
        var expected = StarterKeys.SelectMany(key => new[] { $"vi|{key}|{vi[key]}|1", $"en|{key}|{en[key]}|1" }).Order(StringComparer.Ordinal).ToArray();
        var actual = (await RowsAsync(
            """SELECT l."NormalizedCode" || '|' || t."Key" || '|' || t."Value" || '|' || t."Version"::text FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE t."Key" NOT LIKE 'content.menuItem.%' AND t."Key" NOT LIKE 'content.hero%' """))
            .Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(expected, actual);

        // Migration 12: the header menu the site showed before (and FAQ after Blog), with its en labels; Vietnamese keeps its text in the menu row.
        Assert.Equal((1, 54), (await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteMenu" """), await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """)));
        Assert.Equal(54, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.menuItem.%' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002' AND NOT "IsManual" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.menuItem.%' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001' """));
        Assert.Equal("FAQ", await ScalarAsync<string>("""SELECT "Label" FROM "WebsiteMenuItems" WHERE "ParentId" IS NULL AND "Placement" = 'primary' ORDER BY "SortOrder" OFFSET 3 LIMIT 1"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE ("IsManual" OR "SourceHash" IS NOT NULL) AND "Key" NOT LIKE 'content.menuItem.%' AND "Key" NOT LIKE 'content.hero%'"""));
        // Migration 13: the home hero the Customer had in code, with its en texts (hash-stamped, not hand-edited).
        Assert.Equal(12, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE ("Key" LIKE 'content.heroSlideshow.%' OR "Key" LIKE 'content.heroSlide.%') AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002' AND NOT "IsManual" AND "SourceHash" IS NOT NULL"""));
        Assert.Equal((1, 4, 4), (await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteHero" """), await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroSlides" """), await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" """)));
        Assert.Equal("1|true|0899474888|tel:+84899474888|false|false|true", await ScalarAsync<string>("""SELECT "Version"::text || '|' || "PhoneEnabled"::text || '|' || "PhoneNumber" || '|' || "PhoneHref" || '|' || "MessengerEnabled"::text || '|' || "ZaloEnabled"::text || '|' || "BackToTopEnabled"::text FROM "WebsiteSocialSettings" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'header.%' OR "Key" LIKE 'common.%'"""));

        // Every starter key is still in the catalog, so the renamed rows are read by the product.
        Assert.All(StarterKeys, key => Assert.True(LocalizationAssets.CatalogByKey.ContainsKey(key), key));

        // The test seed (what every other test starts from) is a superset of it and keeps the same identities.
        await ExecuteAsync(WebsiteTestSeed.InsertSql());
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        Assert.Equal(LocalizationAssets.Catalog.Count * 2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """));
    }

    [Fact]
    public async Task Migration_11_renames_the_texts_an_operator_already_edited_and_keeps_their_values()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V10Migration);
        await ExecuteAsync("""UPDATE "WebsiteTranslations" SET "Value" = 'Ưu đãi riêng', "Version" = 3 WHERE "Key" = 'header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001'""");

        await migrator.MigrateAsync(V11Migration);

        Assert.Equal("Ưu đãi riêng", await ScalarAsync<string>("""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001'"""));
        Assert.Equal(3, await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteTranslations" WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001'"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = 'header.menu.offers'"""));
    }

    [Fact]
    public async Task A_V9_database_with_booking_customer_and_staff_data_upgrades_with_every_row_intact_and_nobody_gains_the_permission()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V9Migration);

        var propertyId = await SeedExistingDataAsync(context);
        var before = await TableFingerprintsAsync();
        Assert.True(before["Reservations"].Rows >= 1);
        Assert.True(before["InventoryHolds"].Rows >= 1);
        Assert.Equal(1, before["StaffAccounts"].Rows);

        await migrator.MigrateAsync();

        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        var after = await TableFingerprintsAsync();
        foreach (var (table, fingerprint) in before)
        {
            Assert.Equal(fingerprint, after[table]);        // every existing table: same rows, same content
        }

        Assert.Equal(1, await ScalarAsync<int>($"""SELECT count(*) FROM "Properties" WHERE "Id" = '{propertyId}' """));
        // The existing Staff account is exactly as it was and has no website permission; so does everyone.
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffAccounts" WHERE "CanManageWebsite" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "StaffAccounts" WHERE "NormalizedEmail" = 'EXISTING@EXAMPLE.COM' AND "IsActive" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "StaffPropertyMemberships" """));
        // And the website settings are there, valid, with no invented rate.
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" WHERE "IsDefault" AND "IsActive" AND "NormalizedCode" = 'vi' """));
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "IsBase" AND "IsDefault" AND "Code" = 'VND' AND "VndPerUnit" = 1 """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "Code" IN ('USD','EUR') AND ("VndPerUnit" IS NOT NULL OR "IsActive") """));
    }

    [Fact]
    public async Task Migration_12_seeds_the_menu_once_gives_every_installed_language_its_labels_keeps_what_an_operator_set_and_goes_down_cleanly()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V11Migration);
        await ExecuteAsync(
            """
            INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","FormatLocale") VALUES (gen_random_uuid(),'fr','fr','French','Français',30,true,false,1,now(),now(),'fr');
            UPDATE "WebsiteTranslations" SET "Value" = 'Ưu đãi riêng', "Version" = 3 WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001';
            """);
        const string Existing = """SELECT 'L' || "NormalizedCode" || "DisplayName" || "Version"::text || "IsActive"::text FROM "WebsiteLanguages" UNION ALL SELECT 'T' || "Key" || "Value" || "Version"::text FROM "WebsiteTranslations" UNION ALL SELECT 'C' || "Code" || COALESCE("VndPerUnit"::text,'') || "Version"::text FROM "WebsiteCurrencies" """;
        var before = (await RowsAsync(Existing)).Order(StringComparer.Ordinal).ToArray();

        await migrator.MigrateAsync();

        Assert.Equal((1, 54), (await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteMenu" """), await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """)));
        // The language that already existed got its labels (en and fr); Vietnamese keeps its text in the menu row.
        foreach (var (code, rows) in new[] { ("en", 54), ("fr", 54), ("vi", 0) })
        {
            Assert.Equal(rows, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = '{code}' AND t."Key" LIKE 'content.menuItem.%' """));
        }

        Assert.Equal("Offres", await ScalarAsync<string>("""SELECT t."Value" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' AND t."Key" LIKE 'content.menuItem.%' AND t."Value" = 'Offres' """));
        // Everything that existed is untouched (the operator's edit included); the only new rows are the menu's.
        var after = (await RowsAsync(Existing + """ """)).Where(row => !row.StartsWith("Tcontent.menuItem.", StringComparison.Ordinal) && !row.StartsWith("Tcontent.hero", StringComparison.Ordinal)).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(before, after);
        Assert.Equal("Ưu đãi riêng", await ScalarAsync<string>("""SELECT "Value" FROM "WebsiteTranslations" WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001' """));

        // Running the migrations again never reseeds or overwrites what an operator changed in the menu.
        await ExecuteAsync("""UPDATE "WebsiteMenuItems" SET "Label" = 'Của tôi', "Href" = '/mine' WHERE "Label" = 'FAQ'; UPDATE "WebsiteMenu" SET "Version" = 5; DELETE FROM "WebsiteMenuItems" WHERE "Label" = 'Chuyến bay (trang mẫu)'""");
        await migrator.MigrateAsync();
        Assert.Equal((5, 53, 1), (await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteMenu" """), await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """), await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" WHERE "Label" = 'Của tôi' AND "Href" = '/mine' """)));

        // Down removes the menu and its labels and nothing else; Up again restores the seed.
        await migrator.MigrateAsync(V11Migration);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.tables WHERE table_name IN ('WebsiteMenu', 'WebsiteMenuItems')"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.menuItem.%'"""));
        Assert.Equal(before, (await RowsAsync(Existing)).Order(StringComparer.Ordinal).ToArray());
        await migrator.MigrateAsync();
        Assert.Equal(54, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteMenuItems" """));
    }

    [Fact]
    public async Task Migration_13_seeds_the_hero_once_keeps_every_older_row_as_it_was_and_goes_down_cleanly()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V12Migration);
        await ExecuteAsync(
            """
            INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","FormatLocale") VALUES (gen_random_uuid(),'fr','fr','French','Français',30,true,false,1,now(),now(),'fr');
            UPDATE "WebsiteMenuItems" SET "Label" = 'Của tôi' WHERE "Label" = 'FAQ';
            UPDATE "WebsiteTranslations" SET "Value" = 'Ưu đãi riêng', "Version" = 3 WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001';
            """);
        const string Existing = """SELECT 'L' || "NormalizedCode" || "DisplayName" || "Version"::text || "IsActive"::text FROM "WebsiteLanguages" UNION ALL SELECT 'T' || "Key" || "Value" || "Version"::text FROM "WebsiteTranslations" UNION ALL SELECT 'C' || "Code" || COALESCE("VndPerUnit"::text,'') || "Version"::text FROM "WebsiteCurrencies" UNION ALL SELECT 'M' || "Id"::text || "Label" || "Href" FROM "WebsiteMenuItems" """;
        var before = (await RowsAsync(Existing)).Order(StringComparer.Ordinal).ToArray();

        await migrator.MigrateAsync();

        // The hero the Customer had in code: four credited photographs in order, default font, autoplay on, 6 seconds.
        Assert.Equal((1, "default", true, 6), (
            await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteHero" """), await ScalarAsync<string>("""SELECT "FontKey" FROM "WebsiteHero" """),
            await ScalarAsync<bool>("""SELECT "AutoplayEnabled" FROM "WebsiteHero" """), await ScalarAsync<int>("""SELECT "IntervalSeconds" FROM "WebsiteHero" """)));
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroSlides" """));
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroMedia" WHERE "Kind" = 'seed' """));
        Assert.Equal("Cầu Rồng và sông Hàn lúc hoàng hôn|Bãi biển Mỹ Khê|Đường chân trời Đà Nẵng lúc chạng vạng|Sông Hàn về đêm", await ScalarAsync<string>("""SELECT string_agg("Caption", '|' ORDER BY "SortOrder") FROM "WebsiteHeroSlides" """));
        // The languages that existed got their texts (4 shared + 2 per slide each); Vietnamese keeps its text in the row itself.
        foreach (var (code, rows) in new[] { ("en", 12), ("fr", 12), ("vi", 0) })
        {
            Assert.Equal(rows, await ScalarAsync<int>($"""SELECT count(*) FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = '{code}' AND (t."Key" LIKE 'content.heroSlideshow.%' OR t."Key" LIKE 'content.heroSlide.%') """));
        }

        Assert.Equal("Voir Riverside", await ScalarAsync<string>("""SELECT t."Value" FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" WHERE l."NormalizedCode" = 'fr' AND t."Key" = 'content.heroSlideshow.main.secondaryAction' """));
        // Everything that existed is untouched (the operator's edits included); the only new rows are the hero's.
        var after = (await RowsAsync(Existing)).Where(row => !row.StartsWith("Tcontent.hero", StringComparison.Ordinal)).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(before, after);

        // Running the migrations again never reseeds or overwrites what an operator changed in the hero.
        await ExecuteAsync("""UPDATE "WebsiteHero" SET "Version" = 7, "FontKey" = 'system-serif', "IntervalSeconds" = 20, "Title" = 'Của tôi'; DELETE FROM "WebsiteHeroSlides" WHERE "SortOrder" = 3""");
        await migrator.MigrateAsync();
        Assert.Equal((7, "system-serif", 20, "Của tôi", 3), (
            await ScalarAsync<int>("""SELECT "Version" FROM "WebsiteHero" """), await ScalarAsync<string>("""SELECT "FontKey" FROM "WebsiteHero" """),
            await ScalarAsync<int>("""SELECT "IntervalSeconds" FROM "WebsiteHero" """), await ScalarAsync<string>("""SELECT "Title" FROM "WebsiteHero" """),
            await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroSlides" """)));

        // Down removes the hero and its texts and nothing else; Up again restores the seed.
        await migrator.MigrateAsync(V12Migration);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.tables WHERE table_name IN ('WebsiteHero', 'WebsiteHeroSlides', 'WebsiteHeroMedia')"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.hero%'"""));
        Assert.Equal(before, (await RowsAsync(Existing)).Order(StringComparer.Ordinal).ToArray());
        await migrator.MigrateAsync();
        Assert.Equal(4, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteHeroSlides" """));
    }

    [Fact]
    public async Task Running_the_migration_command_again_changes_nothing_and_never_overwrites_what_an_operator_set()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        await ExecuteAsync(
            """
            UPDATE "WebsiteLanguages" SET "DisplayName" = 'Operator renamed', "Version" = 2, "IsActive" = true WHERE "NormalizedCode" = 'en';
            UPDATE "WebsiteTranslations" SET "Value" = 'Ưu đãi riêng', "Version" = 3 WHERE "Key" = 'customer.header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001';
            UPDATE "WebsiteCurrencies" SET "VndPerUnit" = 25400.5, "RateUpdatedAtUtc" = now(), "IsActive" = true, "Name" = 'Operator dollar', "Version" = 4 WHERE "Code" = 'USD';
            INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","FormatLocale") VALUES (gen_random_uuid(),'fr','fr','French','Français',30,true,false,1,now(),now(),'fr');
            """);
        var before = await RowsAsync("""SELECT 'L' || "NormalizedCode" || "DisplayName" || "Version"::text || "IsActive"::text FROM "WebsiteLanguages" UNION ALL SELECT 'T' || "Key" || "Value" || "Version"::text FROM "WebsiteTranslations" UNION ALL SELECT 'C' || "Code" || "Name" || COALESCE("VndPerUnit"::text,'-') || "Version"::text FROM "WebsiteCurrencies" """);

        await context.Database.MigrateAsync();
        await context.Database.MigrateAsync();

        Assert.Equal(19, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Equal(
            before.Order(StringComparer.Ordinal).ToArray(),
            (await RowsAsync("""SELECT 'L' || "NormalizedCode" || "DisplayName" || "Version"::text || "IsActive"::text FROM "WebsiteLanguages" UNION ALL SELECT 'T' || "Key" || "Value" || "Version"::text FROM "WebsiteTranslations" UNION ALL SELECT 'C' || "Code" || "Name" || COALESCE("VndPerUnit"::text,'-') || "Version"::text FROM "WebsiteCurrencies" """))
            .Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("Operator renamed", await ScalarAsync<string>("""SELECT "DisplayName" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));
        Assert.Equal("25400.50000000", await ScalarAsync<string>("""SELECT "VndPerUnit"::text FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """));
    }

    [Fact]
    public async Task Down_of_migration_11_restores_the_old_keys_and_refuses_anything_installed_or_edited()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync();

        // Each change is administered data migration 11 cannot restore: refused atomically, with nothing changed.
        (string Change, string Undo)[] changes =
        [
            ("""UPDATE "WebsiteLanguages" SET "PackId" = 'bha-en', "PackVersion" = '1' WHERE "NormalizedCode" = 'en'""", """UPDATE "WebsiteLanguages" SET "PackId" = NULL, "PackVersion" = NULL WHERE "NormalizedCode" = 'en'"""),
            ("""UPDATE "WebsiteTranslations" SET "IsManual" = true WHERE "Key" = 'shared.common.close' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002'""", """UPDATE "WebsiteTranslations" SET "IsManual" = false"""),
            ("""INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc") VALUES ('7b0c8a10-0001-4000-8000-000000000002','content.property.00000000-0000-0000-0000-000000000001.name','x',1,now())""", """DELETE FROM "WebsiteTranslations" WHERE "Key" LIKE 'content.%'"""),
            ("""UPDATE "WebsiteTranslations" SET "Value" = repeat('x', 1500) WHERE "Key" = 'shared.common.close' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002'""", """UPDATE "WebsiteTranslations" SET "Value" = 'Close' WHERE "Key" = 'shared.common.close' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002'"""),
            ("""INSERT INTO "WebsiteTranslations" ("LanguageId","Key","Value","Version","UpdatedAtUtc") VALUES ('7b0c8a10-0001-4000-8000-000000000002','customer.extra.one','x',1,now())""", """DELETE FROM "WebsiteTranslations" WHERE "Key" = 'customer.extra.one'"""),
            ("""INSERT INTO "WebsiteLanguages" ("Id","Code","NormalizedCode","DisplayName","NativeName","SortOrder","IsActive","IsDefault","Version","CreatedAtUtc","UpdatedAtUtc","FormatLocale") VALUES (gen_random_uuid(),'fr','fr','French','Français',30,false,false,1,now(),now(),'fr')""", """DELETE FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr'""")
        ];
        foreach (var (change, undo) in changes)
        {
            await ExecuteAsync(change);
            var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V10Migration));
            Assert.Equal("P0001", refused.SqlState);
            Assert.Equal(11, (await context.Database.GetAppliedMigrationsAsync()).Count());
            await ExecuteAsync(undo);
        }

        // Untouched, it goes down: the old key scheme is back (the retired note is not), the new columns are gone, and Up restores the same seed.
        await migrator.MigrateAsync(V10Migration);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.columns WHERE table_name = 'WebsiteLanguages' AND column_name IN ('FormatLocale','DefaultCurrencyCode','Direction','PackId','PackVersion')"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.columns WHERE table_name = 'WebsiteTranslations' AND column_name IN ('IsManual','SourceHash')"""));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" = 'header.menu.offers'"""));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" LIKE 'customer.%' OR "Key" LIKE 'shared.%'"""));
        await migrator.MigrateAsync();
        // Migrations 12 and 13 seed the header menu labels and the hero texts (en) on top of the starter texts; they are counted in their own tests.
        Assert.Equal(StarterKeys.Length * 2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" WHERE "Key" NOT LIKE 'content.menuItem.%' AND "Key" NOT LIKE 'content.hero%' """));
        Assert.Equal("USD", await ScalarAsync<string>("""SELECT "DefaultCurrencyCode" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en'"""));
    }

    [Fact]
    public async Task Down_of_migration_10_drops_an_untouched_seed_and_refuses_anything_administered_or_granted()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V10Migration);

        // Untouched: Down succeeds, the tables and the column are gone, and Up restores the same seed.
        await migrator.MigrateAsync(V9Migration);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'Website%' """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.columns WHERE table_name = 'StaffAccounts' AND column_name = 'CanManageWebsite' """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM pg_proc WHERE proname LIKE 'WebsiteSettings_AssertOneDefault%' """));
        await migrator.MigrateAsync(V10Migration);
        Assert.Equal(25 * 2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """));

        // Each kind of administered change is refused atomically, with nothing dropped.
        (string Change, string Undo)[] changes =
        [
            ("""INSERT INTO "WebsiteLanguages" VALUES (gen_random_uuid(),'fr','fr','French','Français',30,false,false,1,now(),now(),NULL)""", """DELETE FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'fr'"""),
            ("""UPDATE "WebsiteLanguages" SET "Version" = 2 WHERE "NormalizedCode" = 'en'""", """UPDATE "WebsiteLanguages" SET "Version" = 1 WHERE "NormalizedCode" = 'en'"""),
            ("""UPDATE "WebsiteCurrencies" SET "Version" = 2 WHERE "Code" = 'USD'""", """UPDATE "WebsiteCurrencies" SET "Version" = 1 WHERE "Code" = 'USD'"""),
            ("""INSERT INTO "WebsiteCurrencies" VALUES ('GBP','Pound','£',2,40,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL)""", """DELETE FROM "WebsiteCurrencies" WHERE "Code" = 'GBP'"""),
            ("""UPDATE "WebsiteTranslations" SET "Version" = 2 WHERE "Key" = 'common.close' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002'""", """UPDATE "WebsiteTranslations" SET "Version" = 1 WHERE "Key" = 'common.close'""")
        ];
        foreach (var (change, undo) in changes)
        {
            await ExecuteAsync(change);
            var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V9Migration));
            Assert.Equal("P0001", refused.SqlState);
            Assert.Equal(10, (await context.Database.GetAppliedMigrationsAsync()).Count());
            Assert.True(await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """) >= 2);
            await ExecuteAsync(undo);
        }

        // A granted permission is refused too.
        await ExecuteAsync(
            """
            INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","CanManageWebsite")
            VALUES (gen_random_uuid(),true,now(),'g@example.com','G@EXAMPLE.COM','g@example.com','G@EXAMPLE.COM',false,false,false,true,0,true)
            """);
        Assert.Equal("P0001", (await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V9Migration))).SqlState);
        await ExecuteAsync("""UPDATE "StaffAccounts" SET "CanManageWebsite" = false""");
        await migrator.MigrateAsync(V9Migration);     // now only the untouched seed is left: allowed
        Assert.Equal(1, await ScalarAsync<int>("""SELECT count(*) FROM "StaffAccounts" """));
    }

    [Fact]
    public async Task The_model_has_no_pending_changes_against_the_migration_snapshot()
    {
        await using var context = CreateContext();
        var migrationsAssembly = context.GetService<IMigrationsAssembly>();
        var snapshotModel = migrationsAssembly.ModelSnapshot?.Model;
        Assert.NotNull(snapshotModel);
        if (snapshotModel is IMutableModel mutable)
        {
            snapshotModel = mutable.FinalizeModel();
        }

        snapshotModel = context.GetService<IModelRuntimeInitializer>().Initialize(snapshotModel);
        var differences = context.GetService<IMigrationsModelDiffer>().GetDifferences(
            snapshotModel.GetRelationalModel(),
            context.GetService<IDesignTimeModel>().Model.GetRelationalModel());

        Assert.True(differences.Count == 0, "the model differs from the snapshot: " + string.Join("; ", differences.Select(operation => operation.GetType().Name)));
    }

    // ------------------------------------------------------------------ helpers

    private async Task<Guid> SeedExistingDataAsync(TheBhaDbContext context)
    {
        var property = new Property(
            Guid.NewGuid(), "Existing Hotel", "existing-hotel", null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(Guid.NewGuid(), property.Id, "EXS", "Standard", "existing-standard", null, 2, 4, true, Now);
        // Seed against the V9 schema without asking today's EF model to write the new CP01 columns.
        await context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
            VALUES ({property.Id},{property.Name},{property.Slug},{property.Description},{property.Address},{property.City},{property.Country},{property.TimeZone},{property.CheckInTime},{property.CheckOutTime},{property.IsActive},{property.CreatedAt},{property.UpdatedAt})
            """);
        await context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "RoomTypes" ("Id","PropertyId","Code","Name","Slug","Description","BaseOccupancy","MaxOccupancy","IsActive","CreatedAt","UpdatedAt")
            VALUES ({roomType.Id},{roomType.PropertyId},{roomType.Code},{roomType.Name},{roomType.Slug},{roomType.Description},{roomType.BaseOccupancy},{roomType.MaxOccupancy},{roomType.IsActive},{roomType.CreatedAt},{roomType.UpdatedAt})
            """);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "EXISTING", "existing", null, "VND", true, Now);
        var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, "E1", 1, OperationalStatus.Active, Now);
        context.Attach(property);
        context.Attach(roomType);
        context.AddRange(ratePlan, room);
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlan.Id, 100m)).ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomType.Id, 1, null, "Existing Guest", "guest@example.com", "+84 900 000 000",
            CheckIn, CheckOut, 2, 0, "VND", Now, Hash("idempotency"), Hash("fingerprint"), Hash("guest"), nights);
        context.Add(hold);
        context.Add(hold.Confirm(Guid.NewGuid(), "BHA-EXISTING-1", Now));
        // Today's model writes ListUnitAmount (migration 17), which the V9 schema does not have: add it for this seeding only and
        // drop it again, so the upgrade under test still has to add and backfill it.
        await ExecuteAsync("ALTER TABLE \"InventoryHoldItemNights\" ADD COLUMN \"ListUnitAmount\" numeric(18,2); ALTER TABLE \"ReservationUnitNights\" ADD COLUMN \"ListUnitAmount\" numeric(18,2);");
        await context.SaveChangesAsync();
        await ExecuteAsync("ALTER TABLE \"InventoryHoldItemNights\" DROP COLUMN \"ListUnitAmount\"; ALTER TABLE \"ReservationUnitNights\" DROP COLUMN \"ListUnitAmount\";");

        await ExecuteAsync(
            $"""
            INSERT INTO "AspNetUsers" ("Id","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{Guid.NewGuid()}','customer@example.com','CUSTOMER@EXAMPLE.COM','customer@example.com','CUSTOMER@EXAMPLE.COM',false,false,false,true,0);
            INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PasswordHash","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{Guid.Parse("90000000-0000-0000-0000-0000000000aa")}',true,now(),'existing@example.com','EXISTING@EXAMPLE.COM','existing@example.com','EXISTING@EXAMPLE.COM',false,'hash-stays-as-is',false,false,true,0);
            INSERT INTO "StaffPropertyMemberships" ("StaffAccountId","PropertyId","Role","CreatedAtUtc")
            VALUES ('{Guid.Parse("90000000-0000-0000-0000-0000000000aa")}','{property.Id}','Manager',now());
            """);
        return property.Id;

        static string Hash(string seed) =>
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes($"website-{seed}"))).ToLowerInvariant();
    }

    /// <summary>Row count and content hash of every table that exists before migration 10 (StaffAccounts without the new column).</summary>
    private async Task<Dictionary<string, (long Rows, string Hash)>> TableFingerprintsAsync()
    {
        var tables = await RowsAsync(
            """SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'Website%' AND table_name <> '__EFMigrationsHistory' ORDER BY 1""");
        var result = new Dictionary<string, (long, string)>();
        foreach (var table in tables)
        {
            var row = table switch
            {
                "StaffAccounts" => "(t.\"Id\", t.\"IsActive\", t.\"CreatedAtUtc\", t.\"DisabledAtUtc\", t.\"UserName\", t.\"NormalizedUserName\", t.\"Email\", t.\"NormalizedEmail\", t.\"PasswordHash\", t.\"SecurityStamp\", t.\"ConcurrencyStamp\", t.\"LockoutEnabled\", t.\"AccessFailedCount\")::text",
                "Properties" => "(to_jsonb(t) - 'ContentVersion' - 'ContentUpdatedByStaffId')::text",
                "RoomTypes" => "(to_jsonb(t) - 'ContentVersion' - 'ContentUpdatedByStaffId' - 'AreaSquareMeters' - 'Bedrooms' - 'BedDescription')::text",
                "PropertyMedia" or "RoomTypeMedia" => "(to_jsonb(t) - 'AltTextOverride')::text",
                "InventoryHoldItemNights" or "ReservationUnitNights" => "(to_jsonb(t) - 'ListUnitAmount')::text",
                _ => "t::text"
            };
            var rows = await ScalarAsync<long>($"SELECT count(*) FROM \"{table}\" t");
            var hash = await ScalarAsync<string>($"SELECT COALESCE(md5(string_agg({row}, '|' ORDER BY {row})), '') FROM \"{table}\" t");
            result[table] = (rows, hash);
        }

        return result;
    }

    private TheBhaDbContext CreateContext() => new(new DbContextOptionsBuilder<TheBhaDbContext>()
        .UseNpgsql(_builder.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
        .Options);

    private async Task<T> ScalarAsync<T>(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (T)Convert.ChangeType((await command.ExecuteScalarAsync())!, typeof(T));
    }

    private async Task<string[]> RowsAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return [.. rows];
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private async Task AdministerAsync(string sql)
    {
        var administrative = new NpgsqlConnectionStringBuilder(_builder.ConnectionString) { Database = "postgres" };
        await using var connection = new NpgsqlConnection(administrative.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
