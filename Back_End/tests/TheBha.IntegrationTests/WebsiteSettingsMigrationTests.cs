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
/// CUST-WEB-HEADER-001-CP02 acceptance A1: migration 10 applies to a database that already holds booking and Staff
/// data, leaves every existing row untouched, gives no Staff the website permission, seeds Vietnamese (active
/// default), English (present, off), VND (base, rate 1) and USD/EUR (off, no rate); the seed is frozen and equals the key
/// catalog; running the migration command again overwrites nothing; its guarded Down() refuses to drop anything an
/// operator administered. Each test owns a disposable database so it controls which migration is applied.
/// </summary>
public sealed class WebsiteSettingsMigrationTests : IAsyncLifetime
{
    private const string V9Migration = "20261001141847_AddStaffIdentityFoundation";
    private const string V10Migration = "20261015050047_AddWebsiteLocalizationSettings";
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
    public async Task A_fresh_database_gets_the_frozen_seed_and_it_equals_the_key_catalog()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();

        Assert.Equal(10, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());

        // Languages: Vietnamese is the active default, English exists for the operator but is off.
        Assert.Equal(
            ["vi|Tiếng Việt|true|true|1", "en|English|false|false|1"],
            await RowsAsync("""SELECT "NormalizedCode" || '|' || "NativeName" || '|' || "IsActive"::text || '|' || "IsDefault"::text || '|' || "Version"::text FROM "WebsiteLanguages" ORDER BY "SortOrder" """));
        Assert.Equal(WebsiteTestSeed.Vietnamese, await ScalarAsync<Guid>("""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'vi' """));
        Assert.Equal(WebsiteTestSeed.English, await ScalarAsync<Guid>("""SELECT "Id" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));

        // Currencies: VND is the base and default at rate 1; USD and EUR have metadata only — no rate, off.
        Assert.Equal(
            ["VND|0|true|true|true|1.00000000", "USD|2|false|false|false|", "EUR|2|false|false|false|"],
            await RowsAsync("""SELECT "Code" || '|' || "MinorUnits"::text || '|' || "IsActive"::text || '|' || "IsDefault"::text || '|' || "IsBase"::text || '|' || COALESCE("VndPerUnit"::text, '') FROM "WebsiteCurrencies" ORDER BY "SortOrder" """));
        Assert.Equal(2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteCurrencies" WHERE "VndPerUnit" IS NULL AND "RateUpdatedAtUtc" IS NULL AND NOT "IsActive" """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM "StaffAccounts" """));

        // Translations: both languages have every catalog key, with the catalog's text, and nothing else.
        var expected = WebsiteTranslationCatalog.All.SelectMany(definition => new[]
        {
            $"vi|{definition.Key}|{definition.Vietnamese}|1",
            $"en|{definition.Key}|{definition.English}|1"
        }).Order(StringComparer.Ordinal).ToArray();
        var actual = (await RowsAsync(
            """SELECT l."NormalizedCode" || '|' || t."Key" || '|' || t."Value" || '|' || t."Version"::text FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" """))
            .Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(expected, actual);
        Assert.Equal(WebsiteTranslationCatalog.All.Count * 2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """));

        // The test seed (what every other test starts from) is the same thing, built from the catalog.
        await ExecuteAsync(WebsiteTestSeed.InsertSql().Replace("{{", "{"));
        Assert.Equal(expected, (await RowsAsync(
            """SELECT l."NormalizedCode" || '|' || t."Key" || '|' || t."Value" || '|' || t."Version"::text FROM "WebsiteTranslations" t JOIN "WebsiteLanguages" l ON l."Id" = t."LanguageId" """))
            .Order(StringComparer.Ordinal).ToArray());
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

        await migrator.MigrateAsync(V10Migration);

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
    public async Task Running_the_migration_command_again_changes_nothing_and_never_overwrites_what_an_operator_set()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        await ExecuteAsync(
            """
            UPDATE "WebsiteLanguages" SET "DisplayName" = 'Operator renamed', "Version" = 2, "IsActive" = true WHERE "NormalizedCode" = 'en';
            UPDATE "WebsiteTranslations" SET "Value" = 'Ưu đãi riêng', "Version" = 3 WHERE "Key" = 'header.menu.offers' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000001';
            UPDATE "WebsiteCurrencies" SET "VndPerUnit" = 25400.5, "RateUpdatedAtUtc" = now(), "IsActive" = true, "Name" = 'Operator dollar', "Version" = 4 WHERE "Code" = 'USD';
            INSERT INTO "WebsiteLanguages" VALUES (gen_random_uuid(),'fr','fr','French','Français',30,true,false,1,now(),now(),NULL);
            """);
        var before = await RowsAsync("""SELECT 'L' || "NormalizedCode" || "DisplayName" || "Version"::text || "IsActive"::text FROM "WebsiteLanguages" UNION ALL SELECT 'T' || "Key" || "Value" || "Version"::text FROM "WebsiteTranslations" UNION ALL SELECT 'C' || "Code" || "Name" || COALESCE("VndPerUnit"::text,'-') || "Version"::text FROM "WebsiteCurrencies" """);

        await context.Database.MigrateAsync();
        await context.Database.MigrateAsync();

        Assert.Equal(10, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Equal(
            before.Order(StringComparer.Ordinal).ToArray(),
            (await RowsAsync("""SELECT 'L' || "NormalizedCode" || "DisplayName" || "Version"::text || "IsActive"::text FROM "WebsiteLanguages" UNION ALL SELECT 'T' || "Key" || "Value" || "Version"::text FROM "WebsiteTranslations" UNION ALL SELECT 'C' || "Code" || "Name" || COALESCE("VndPerUnit"::text,'-') || "Version"::text FROM "WebsiteCurrencies" """))
            .Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("Operator renamed", await ScalarAsync<string>("""SELECT "DisplayName" FROM "WebsiteLanguages" WHERE "NormalizedCode" = 'en' """));
        Assert.Equal("25400.50000000", await ScalarAsync<string>("""SELECT "VndPerUnit"::text FROM "WebsiteCurrencies" WHERE "Code" = 'USD' """));
    }

    [Fact]
    public async Task Down_drops_an_untouched_seed_and_refuses_anything_administered_or_granted()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync();

        // Untouched: Down succeeds, the tables and the column are gone, and Up restores the same seed.
        await migrator.MigrateAsync(V9Migration);
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'Website%' """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM information_schema.columns WHERE table_name = 'StaffAccounts' AND column_name = 'CanManageWebsite' """));
        Assert.Equal(0, await ScalarAsync<int>("""SELECT count(*) FROM pg_proc WHERE proname LIKE 'WebsiteSettings_AssertOneDefault%' """));
        await migrator.MigrateAsync();
        Assert.Equal(WebsiteTranslationCatalog.All.Count * 2, await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteTranslations" """));

        // Each kind of administered change is refused atomically, with nothing dropped.
        string[] changes =
        [
            """INSERT INTO "WebsiteLanguages" VALUES (gen_random_uuid(),'fr','fr','French','Français',30,false,false,1,now(),now(),NULL)""",
            """UPDATE "WebsiteLanguages" SET "Version" = 2 WHERE "NormalizedCode" = 'en'""",
            """UPDATE "WebsiteCurrencies" SET "Version" = 2 WHERE "Code" = 'USD'""",
            """INSERT INTO "WebsiteCurrencies" VALUES ('GBP','Pound','£',2,40,false,false,false,NULL,NULL,NULL,'manual',1,now(),now(),NULL)""",
            """UPDATE "WebsiteTranslations" SET "Version" = 2 WHERE "Key" = 'common.close' AND "LanguageId" = '7b0c8a10-0001-4000-8000-000000000002'"""
        ];
        foreach (var change in changes)
        {
            await ExecuteAsync(change);
            var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V9Migration));
            Assert.Equal("P0001", refused.SqlState);
            Assert.Equal(10, (await context.Database.GetAppliedMigrationsAsync()).Count());
            Assert.True(await ScalarAsync<int>("""SELECT count(*) FROM "WebsiteLanguages" """) >= 2);
            // Put the seed back so the next change is judged on its own.
            await ExecuteAsync(WebsiteTestSeed.InsertSql().Replace("{{", "{"));
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
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "EXISTING", "existing", null, "VND", true, Now);
        var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, "E1", 1, OperationalStatus.Active, Now);
        context.AddRange(property, roomType, ratePlan, room);
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlan.Id, 100m)).ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomType.Id, 1, null, "Existing Guest", "guest@example.com", "+84 900 000 000",
            CheckIn, CheckOut, 2, 0, "VND", Now, Hash("idempotency"), Hash("fingerprint"), Hash("guest"), nights);
        context.Add(hold);
        context.Add(hold.Confirm(Guid.NewGuid(), "BHA-EXISTING-1", Now));
        await context.SaveChangesAsync();

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
            var row = table == "StaffAccounts"
                ? "(t.\"Id\", t.\"IsActive\", t.\"CreatedAtUtc\", t.\"DisabledAtUtc\", t.\"UserName\", t.\"NormalizedUserName\", t.\"Email\", t.\"NormalizedEmail\", t.\"PasswordHash\", t.\"SecurityStamp\", t.\"ConcurrencyStamp\", t.\"LockoutEnabled\", t.\"AccessFailedCount\")::text"
                : "t::text";
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
