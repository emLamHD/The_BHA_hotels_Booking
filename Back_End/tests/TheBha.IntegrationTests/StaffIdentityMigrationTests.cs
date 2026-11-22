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
    private const string V25Migration = "20261119162454_AddNewsletterUnseenBadge";
    private const string V27Migration = "20261121162308_AddNewsletterActivityCutover";
    private const string V28Migration = "20261122070757_AddDirectReservationSource";
    private const string V29Migration = "20261122085005_AddReservationFolio";
    private const string V26Migration = "20261120153842_AddAdminMenuActivity";
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

        Assert.Equal(29, (await context.Database.GetAppliedMigrationsAsync()).Count());
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
        Assert.Equal([V10Migration, V11Migration, V12Migration, V13Migration, V14Migration, V15Migration, V16Migration, V17Migration, V18Migration, V19Migration, V20Migration, V21Migration, V22Migration, V23Migration, V24Migration, V25Migration, V26Migration, V27Migration, V28Migration, V29Migration], await context.Database.GetPendingMigrationsAsync());

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
        Assert.Equal([V9Migration, V10Migration, V11Migration, V12Migration, V13Migration, V14Migration, V15Migration, V16Migration, V17Migration, V18Migration, V19Migration, V20Migration, V21Migration, V22Migration, V23Migration, V24Migration, V25Migration, V26Migration, V27Migration, V28Migration, V29Migration], await context.Database.GetPendingMigrationsAsync());
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

    [Fact]
    public async Task V23_subscribers_keep_the_language_of_their_latest_confirmation_mail_and_fall_back_to_Vietnamese()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V23Migration);
        string Id(int n) => $"00000000-0000-0000-0000-{n:D12}";
        string Hash(char c) => new(c, 64);
        // Subscriptions: 1 en, 2 fr, 3 several languages (the NEWEST is fr), 4 a tie on the instant (the larger request id wins), 5 no mail at all, 6 verified with an en mail.
        await ExecuteAsync(
            $"""
            INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc") VALUES
              ('{Id(1)}','en@example.com','homepage','PendingVerification',now() - interval '5 days',NULL),
              ('{Id(2)}','fr@example.com','homepage','PendingVerification',now() - interval '5 days',NULL),
              ('{Id(3)}','multi@example.com','homepage','PendingVerification',now() - interval '5 days',NULL),
              ('{Id(4)}','tie@example.com','homepage','PendingVerification',now() - interval '5 days',NULL),
              ('{Id(5)}','none@example.com','homepage','PendingVerification',now() - interval '5 days',NULL),
              ('{Id(6)}','verified-en@example.com','homepage','Verified',now() - interval '5 days',now() - interval '4 days');
            INSERT INTO "NewsletterVerificationRequests" ("Id","SubscriptionId","TokenHash","Language","Status","Attempts","CreatedAtUtc","ExpiresAtUtc","NextAttemptAtUtc") VALUES
              (gen_random_uuid(),'{Id(1)}','{Hash('1')}','en','Sent',1,now() - interval '2 days',now() + interval '1 day',now()),
              (gen_random_uuid(),'{Id(2)}','{Hash('2')}','fr','Sent',1,now() - interval '2 days',now() + interval '1 day',now()),
              (gen_random_uuid(),'{Id(3)}','{Hash('3')}','vi','Cancelled',1,now() - interval '4 days',now() - interval '2 days',now()),
              (gen_random_uuid(),'{Id(3)}','{Hash('4')}','en','Cancelled',1,now() - interval '3 days',now() - interval '1 day',now()),
              (gen_random_uuid(),'{Id(3)}','{Hash('5')}','fr','Sent',1,now() - interval '1 day',now() + interval '1 day',now()),
              ('{Id(100)}','{Id(4)}','{Hash('6')}','en','Sent',1,'2026-11-01T10:00:00Z','2026-11-30T10:00:00Z',now()),
              ('{Id(200)}','{Id(4)}','{Hash('7')}','fr','Sent',1,'2026-11-01T10:00:00Z','2026-11-30T10:00:00Z',now()),
              (gen_random_uuid(),'{Id(6)}','{Hash('8')}','en','Sent',1,now() - interval '4 days',now() - interval '2 days',now());
            """);

        await migrator.MigrateAsync(V24Migration);

        async Task<string> LanguageOf(int n) => await ScalarTextAsync($"""SELECT "Language" FROM "NewsletterSubscriptions" WHERE "Id" = '{Id(n)}' """);
        Assert.Equal("en", await LanguageOf(1));
        Assert.Equal("fr", await LanguageOf(2));
        Assert.Equal("fr", await LanguageOf(3));
        Assert.Equal("fr", await LanguageOf(4));          // same CreatedAtUtc: the larger request id (…200, fr) wins, and always the same one
        Assert.Equal("vi", await LanguageOf(5));
        Assert.Equal("en", await LanguageOf(6));
        // Nothing else moved: the requests keep their own language, nobody gets a Welcome, the verified address stays verified.
        Assert.Equal(8, await CountAsync("NewsletterVerificationRequests"));
        Assert.Equal(0, await ScalarAsync("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
        Assert.Equal("Verified", await ScalarTextAsync($"""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Id" = '{Id(6)}' """));

        // Down: what Up derived is not data (the mails keep their language), so the rollback is allowed and the upgrade can be repeated with the same result.
        await migrator.MigrateAsync(V23Migration);
        Assert.Equal(6, await CountAsync("NewsletterSubscriptions"));
        await migrator.MigrateAsync(V24Migration);
        Assert.Equal("fr", await LanguageOf(3));
        // A language that Up would not derive IS data: a visitor who chose English when no mail could be sent has an en row and no request at all.
        await ExecuteAsync("""INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","Language") VALUES (gen_random_uuid(),'chose-en@example.com','homepage','PendingVerification',now(),'en')""");
        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V23Migration));
        Assert.Contains("Down refused", refused.MessageText);
        Assert.Equal(7, await CountAsync("NewsletterSubscriptions"));
    }

    [Fact]
    public async Task V24_database_with_subscribers_and_mail_upgrades_intact_with_an_empty_stream_and_no_retroactive_activity_and_the_rollback_is_guarded()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V24Migration);
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
        var senderBefore = await ScalarAsync("""SELECT count(*) FROM "NewsletterSenderSettings" """);

        await migrator.MigrateAsync(V25Migration);

        // Everything that was there is there, and nothing was created for it: no Welcome, no activity (no retroactive badge), no cursor; the stream starts at 0.
        Assert.Equal(2, await CountAsync("NewsletterSubscriptions"));
        Assert.Equal(2, await CountAsync("NewsletterVerificationRequests"));
        Assert.Equal(senderBefore, await ScalarAsync("""SELECT count(*) FROM "NewsletterSenderSettings" """));
        Assert.Equal("Verified", await ScalarTextAsync($"""SELECT "Status" FROM "NewsletterSubscriptions" WHERE "Id" = '{verified}' """));
        Assert.Equal(0, await ScalarAsync("""SELECT count(*) FROM "NewsletterVerificationRequests" WHERE "Purpose" = 'Welcome' """));
        Assert.Equal(0, await CountAsync("NewsletterVerificationActivities"));
        Assert.Equal(0, await CountAsync("StaffMenuSeen"));
        Assert.Equal(1, await CountAsync("MenuActivityStreams"));
        Assert.Equal(0, await ScalarAsync("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
        // A Staff member with no cursor therefore counts 0 until something is verified (the same statement the API runs).
        Assert.Equal(0, await ScalarAsync("""SELECT count(*) FROM "NewsletterVerificationActivities" a WHERE a."Sequence" > 0 """));

        // The database enforces the stream's rules: a non-positive number, an activity of an unknown subscription, a cursor of an unknown menu.
        Assert.Equal("23514", (await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(
            $"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (0,'{verified}',now())"""))).SqlState);
        Assert.Equal("23503", (await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(
            $"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (1,'{Guid.NewGuid()}',now())"""))).SqlState);

        // An untouched stream is not data: the rollback is allowed and the upgrade can be repeated.
        await migrator.MigrateAsync(V24Migration);
        await migrator.MigrateAsync(V25Migration);
        Assert.Equal(0, await ScalarAsync("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));

        // A verification that has been counted IS data (a Down would hand every Staff member a different badge): refused, and nothing is dropped.
        await ExecuteAsync(
            $"""
            UPDATE "MenuActivityStreams" SET "LastSequence" = 1 WHERE "MenuKey" = 'newsletter';
            INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (1,'{verified}',now());
            """);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V24Migration));
        Assert.Contains("Down refused", refused.MessageText);
        Assert.Equal(1, await CountAsync("NewsletterVerificationActivities"));
        Assert.Equal(1, await CountAsync("MenuActivityStreams"));

        // A moved counter alone (an activity deleted with its subscription) is state too; deleting the subscription takes the activity with it (no address is kept anywhere).
        await ExecuteAsync($"""DELETE FROM "NewsletterVerificationRequests" WHERE "SubscriptionId" = '{verified}'; DELETE FROM "NewsletterSubscriptions" WHERE "Id" = '{verified}' """);   // as the Admin delete does: its mails first
        Assert.Equal(0, await CountAsync("NewsletterVerificationActivities"));
        var stillRefused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V24Migration));
        Assert.Contains("Down refused", stillRefused.MessageText);
        await ExecuteAsync("""UPDATE "MenuActivityStreams" SET "LastSequence" = 0 WHERE "MenuKey" = 'newsletter' """);
        await migrator.MigrateAsync(V24Migration);
        Assert.Equal(1, await CountAsync("NewsletterSubscriptions"));
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
