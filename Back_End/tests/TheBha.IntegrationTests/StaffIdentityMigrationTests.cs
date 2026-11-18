using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP01 migration evidence: migration 9 applies to a fresh database (migration 10, website settings, follows it),
/// upgrades a migration 8 database with Customer and Property rows intact, and its guarded
/// Down() refuses to drop Staff rows but succeeds when both new tables are empty.
/// Each test owns a disposable database so it controls which migration is applied.
/// </summary>
public sealed class StaffIdentityMigrationTests : IAsyncLifetime
{
    private const string V8Migration = "20260826035254_PhysicalRoomScheduleAvailabilityAuthority";
    private const string V9Migration = "20261001141847_AddStaffIdentityFoundation";
    private const string V10Migration = "20261015050047_AddWebsiteLocalizationSettings";
    private const string V11Migration = "20261015095908_AddRuntimeLanguagePacks";
    private const string V12Migration = "20261016014037_AddWebsiteMenus";
    private const string V13Migration = "20261017084454_AddWebsiteHero";
    private const string V14Migration = "20261017160333_AddWebsiteSocialSettings";
    private const string V15Migration = "20261018044944_AddAdminCatalogContent";
    private const string V16Migration = "20261018154408_AddAdminCatalogCreateOperations";
    private const string V17Migration = "20261021083007_AddBookingPromotions";
    private const string V18Migration = "20261021120804_AddBlogFoundation";
    private const string V19Migration = "20261021153708_AddBlogMediaLibrary";
    private const string V20Migration = "20261026093905_AddContentPackLedger";
    private const string V21Migration = "20261116043442_AddNewsletterSubscriptions";
    private const string V22Migration = "20261117103618_AddNewsletterVerification";
    private const string V23Migration = "20261117141958_AddNewsletterClaimFences";
    private const string V24Migration = "20261118050849_AddNewsletterManagement";
    private static readonly Guid PropertyId = Guid.Parse("90000000-0000-0000-0000-000000000011");
    private static readonly Guid CustomerId = Guid.Parse("90000000-0000-0000-0000-000000000012");

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException(
            "ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_staffidentity_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => AdministerAsync($"CREATE DATABASE \"{_builder.Database}\"");

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await AdministerAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Fresh_database_applies_all_eighteen_migrations()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();

        Assert.Equal(24, (await context.Database.GetAppliedMigrationsAsync()).Count());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        Assert.Equal(0, await CountAsync("StaffAccounts"));
        Assert.Equal(0, await CountAsync("StaffPropertyMemberships"));
    }

    [Fact]
    public async Task V8_database_upgrades_with_customer_and_property_rows_intact_and_downgrades_only_when_empty()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V8Migration);
        await ExecuteAsync(
            $"""
            INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
            VALUES ('{PropertyId}','Upgrade Property','upgrade-property',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now());
            INSERT INTO "AspNetUsers" ("Id","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{CustomerId}','c@example.com','C@EXAMPLE.COM','c@example.com','C@EXAMPLE.COM',false,false,false,true,0);
            """);

        await migrator.MigrateAsync(V9Migration);

        Assert.Equal(1, await CountAsync("Properties"));
        Assert.Equal(1, await CountAsync("AspNetUsers"));
        // Migration 10 (website settings) is the only one left beyond this test's V9 target.
        Assert.Equal([V10Migration, V11Migration, V12Migration, V13Migration, V14Migration, V15Migration, V16Migration, V17Migration, V18Migration, V19Migration, V20Migration, V21Migration, V22Migration, V23Migration, V24Migration], await context.Database.GetPendingMigrationsAsync());

        await ExecuteAsync(
            $"""
            INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
            VALUES ('{CustomerId}',true,now(),'c@example.com','C@EXAMPLE.COM','c@example.com','C@EXAMPLE.COM',false,false,false,true,0)
            """);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V8Migration));
        Assert.Equal("P0001", refused.SqlState);
        Assert.Equal(1, await CountAsync("StaffAccounts"));

        await ExecuteAsync("DELETE FROM \"StaffAccounts\"");
        await migrator.MigrateAsync(V8Migration);
        Assert.Equal([V9Migration, V10Migration, V11Migration, V12Migration, V13Migration, V14Migration, V15Migration, V16Migration, V17Migration, V18Migration, V19Migration, V20Migration, V21Migration, V22Migration, V23Migration, V24Migration], await context.Database.GetPendingMigrationsAsync());
        Assert.Equal(1, await CountAsync("AspNetUsers"));
    }

    [Fact]
    public async Task V23_database_with_subscribers_and_queued_mail_upgrades_without_losing_a_row_and_without_a_retroactive_Welcome()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V23Migration);
        var pending = Guid.NewGuid();
        var verified = Guid.NewGuid();
        await ExecuteAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc")
            VALUES ('{pending}','pending@example.com','homepage','PendingVerification',now() - interval '2 days',NULL),
                   ('{verified}','verified@example.com','homepage','Verified',now() - interval '3 days',now() - interval '2 days');
            INSERT INTO "NewsletterVerificationRequests" ("Id","SubscriptionId","TokenHash","Language","Status","Attempts","CreatedAtUtc","ExpiresAtUtc","NextAttemptAtUtc")
            VALUES (gen_random_uuid(),'{pending}','{new string('a', 64)}','vi','Pending',0,now() - interval '1 hour',now() + interval '47 hours',now()),
                   (gen_random_uuid(),'{verified}','{new string('b', 64)}','vi','Sent',1,now() - interval '3 days',now() - interval '1 day',now() - interval '3 days');
            """);

        await migrator.MigrateAsync(V24Migration);

        // Every row is still there, in the state it had, with the defaults of the new columns: version 1, the default language, no creator, nothing stopped or hidden.
        Assert.Equal(2, await CountAsync("NewsletterSubscriptions"));
        Assert.Equal(2, await CountAsync("NewsletterVerificationRequests"));
        Assert.Equal(2, await ScalarAsync("""SELECT count(*) FROM "NewsletterSubscriptions" WHERE "Version" = 1 AND "Language" = 'vi' AND "CreatedByStaffId" IS NULL AND "UnsubscribedAtUtc" IS NULL AND "ArchivedAtUtc" IS NULL AND "Source" = 'homepage' """));
        Assert.Equal("Verified", await ScalarTextAsync($"""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Id" = '{verified}' """));
        Assert.Equal(2, await ScalarAsync("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Verification' AND "ForVerifiedAtUtc" IS NULL AND "RevokedAtUtc" IS NULL """));
        // The address verified before the upgrade is not greeted after it.
        Assert.Equal(0, await ScalarAsync("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));

        // The new rules are enforced by the database itself.
        var noCreator = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(
            """INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'admin@example.com','admin','PendingVerification',now())"""));
        Assert.Equal("CK_NewsletterSubscriptions_CreatedBy", noCreator.ConstraintName);
        var noStamp = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(
            """INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES (gen_random_uuid(),'stopped@example.com','homepage','Unsubscribed',now())"""));
        Assert.Equal("CK_NewsletterSubscriptions_UnsubscribedAt", noStamp.ConstraintName);
        var badLanguage = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync("""UPDATE "NewsletterSubscriptions" SET "Language" = 'de' """));
        Assert.Equal("CK_NewsletterSubscriptions_Language", badLanguage.ConstraintName);
        string WelcomeSql(string hash) =>
            $"""
            INSERT INTO "NewsletterVerificationRequests" ("Id","SubscriptionId","Purpose","ForVerifiedAtUtc","TokenHash","Language","Status","Attempts","CreatedAtUtc","ExpiresAtUtc","NextAttemptAtUtc")
            VALUES (gen_random_uuid(),'{verified}','Welcome','2026-11-01T00:00:00Z','{hash}','vi','Pending',0,now(),now() + interval '7 days',now())
            """;
        await ExecuteAsync(WelcomeSql(new string('c', 64)));
        var twice = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(WelcomeSql(new string('d', 64))));
        Assert.Equal("UX_NewsletterVerificationRequests_WelcomePerVerification", twice.ConstraintName);

        // Going back is refused while anything the new structures hold would be lost, and allowed (keeping every old row) once it is gone.
        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V23Migration));
        Assert.Equal("P0001", refused.SqlState);
        Assert.Equal(3, await CountAsync("NewsletterVerificationRequests"));
        await ExecuteAsync("""DELETE FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """);
        await migrator.MigrateAsync(V23Migration);
        Assert.Equal(2, await CountAsync("NewsletterSubscriptions"));
        Assert.Equal(2, await CountAsync("NewsletterVerificationRequests"));
    }

    private async Task<long> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> ScalarTextAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private TheBhaDbContext CreateContext() => new(new DbContextOptionsBuilder<TheBhaDbContext>()
        .UseNpgsql(_builder.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
        .Options);

    private async Task<long> CountAsync(string table)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"SELECT COUNT(*) FROM \"{table}\"", connection);
        return (long)(await command.ExecuteScalarAsync())!;
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
