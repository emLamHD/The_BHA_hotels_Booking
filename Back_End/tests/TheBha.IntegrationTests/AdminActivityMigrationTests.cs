using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR02 (ADR 0011 §A, §F): migration 26 on a real PostgreSQL database that already holds the legacy Newsletter badge data of migration 25. It adds three tables and 14
/// counter rows and changes nothing that exists; its guarded Down removes only what it created and refuses, atomically, while any of it is in use. Each test owns a disposable database.
/// </summary>
public sealed class AdminActivityMigrationTests : IAsyncLifetime
{
    private const string V25Migration = "20261119162454_AddNewsletterUnseenBadge";
    private const string V26Migration = "20261120153842_AddAdminMenuActivity";

    // ADR 0011 §F "Menu keys (fixed)", written out here on purpose: the test must not read the constants the migration was generated from.
    private static readonly string[] NewKeys =
    [
        "blog-posts", "blog-categories", "blog-media", "blog-settings", "website-hero", "website-menus", "website-languages", "website-translations",
        "website-currencies", "website-social", "newsletter-sender", "promotions", "catalog", "calendar"
    ];

    private static readonly Guid PropertyId = Guid.Parse("90000000-0000-0000-0000-000000000026");
    private static readonly Guid StaffId = Guid.Parse("5a000000-0000-4000-8000-000000000026");
    private static readonly Guid SubscriptionId = Guid.Parse("90000000-0000-0000-0000-000000000027");

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_adminactivity_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => ExecuteAsync($"CREATE DATABASE \"{_builder.Database}\"", administrative: true);

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)", administrative: true);
    }

    [Fact]
    public async Task V25_database_with_legacy_Newsletter_data_upgrades_to_the_new_schema_and_keeps_every_legacy_value()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V25Migration);
        await SeedLegacyNewsletterAsync();

        await migrator.MigrateAsync(V26Migration);

        // Legacy data, counter (with its gap) and cursor are exactly as they were; the newsletter counter is not re-seeded.
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        Assert.Equal(3, await ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT "LastSeenSequence" FROM "StaffMenuSeen" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterSubscriptions" """));

        // Every new menu has a counter at 0, and nothing else was written.
        Assert.Equal(NewKeys.Append("newsletter").Order(StringComparer.Ordinal).ToArray(), (await QueryAsync("""SELECT "MenuKey" FROM "MenuActivityStreams" """)).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(14, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityStreams" WHERE "MenuKey" <> 'newsletter' AND "LastSequence" = 0 """));
        foreach (var table in new[] { "AdminActivities", "StaffMenuPropertySeen", "StaffEntitySeen" }) Assert.Equal(0, await ScalarAsync<long>($"SELECT count(*) FROM \"{table}\""));

        await AssertSchemaAsync();
        await AssertConstraintsEnforcedAsync();
        Assert.False(context.Database.HasPendingModelChanges()); // the migration and the model agree
    }

    [Fact]
    public async Task Down_succeeds_while_the_new_part_is_unused_and_leaves_the_legacy_Newsletter_data_alone()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V25Migration);
        await SeedLegacyNewsletterAsync();
        await migrator.MigrateAsync(V26Migration);

        await migrator.MigrateAsync(V25Migration);

        Assert.Null(await ScalarAsync<string?>("""SELECT to_regclass('"AdminActivities"')::text"""));
        Assert.Null(await ScalarAsync<string?>("""SELECT to_regclass('"StaffMenuPropertySeen"')::text"""));
        Assert.Null(await ScalarAsync<string?>("""SELECT to_regclass('"StaffEntitySeen"')::text"""));
        Assert.Equal(["newsletter"], await QueryAsync("""SELECT "MenuKey" FROM "MenuActivityStreams" """));
        Assert.Equal(3, await ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT "LastSeenSequence" FROM "StaffMenuSeen" WHERE "MenuKey" = 'newsletter' """));

        await migrator.MigrateAsync(V26Migration); // and the upgrade can be repeated
        Assert.Equal(15, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityStreams" """));
    }

    // One protection each. Every case sets up exactly one condition, so a refusal proves that this guard fires; nothing may be dropped; and the same Down succeeds once that one condition is gone.
    [Theory]
    [InlineData("an activity row",
        """INSERT INTO "AdminActivities" ("MenuKey","Sequence","Id","ActorKind","Action","EntityKind","EntityKey","TitleSnapshot","ItemCount","OccurredAtUtc") VALUES ('blog-posts',1,gen_random_uuid(),'System','Created','post','settings','t',1,now())""",
        """DELETE FROM "AdminActivities" """)]
    [InlineData("a Property cursor",
        """INSERT INTO "StaffMenuPropertySeen" ("StaffAccountId","MenuKey","PropertyId","LastSeenSequence","UpdatedAtUtc") VALUES ('{S}','promotions','{P}',0,now())""",
        """DELETE FROM "StaffMenuPropertySeen" """)]
    [InlineData("an entity cursor",
        """INSERT INTO "StaffEntitySeen" ("StaffAccountId","PropertyId","EntityKind","EntityKey","LastSeenSequence","UpdatedAtUtc") VALUES ('{S}','{P}','room-block','k',0,now())""",
        """DELETE FROM "StaffEntitySeen" """)]
    [InlineData("a StaffMenuSeen cursor of a new menu",
        """INSERT INTO "StaffMenuSeen" ("StaffAccountId","MenuKey","LastSeenSequence","UpdatedAtUtc") VALUES ('{S}','calendar',0,now())""",
        """DELETE FROM "StaffMenuSeen" WHERE "MenuKey" = 'calendar' """)]
    [InlineData("a moved counter of a new menu",
        """UPDATE "MenuActivityStreams" SET "LastSequence" = 1 WHERE "MenuKey" = 'catalog' """,
        """UPDATE "MenuActivityStreams" SET "LastSequence" = 0 WHERE "MenuKey" = 'catalog' """)]
    public async Task Down_is_refused_atomically_by_each_protection(string condition, string setUp, string clear)
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V25Migration);
        await SeedLegacyNewsletterAsync();
        await migrator.MigrateAsync(V26Migration);
        await ExecuteAsync(setUp.Replace("{S}", StaffId.ToString()).Replace("{P}", PropertyId.ToString()));

        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V25Migration));
        Assert.True(refused.MessageText.Contains("Down refused"), condition);

        // Nothing was dropped or deleted: the failed Down rolled back as a whole and the migration is still applied.
        Assert.Contains(V26Migration, await context.Database.GetAppliedMigrationsAsync());
        foreach (var table in new[] { "AdminActivities", "StaffMenuPropertySeen", "StaffEntitySeen" }) Assert.NotNull(await ScalarAsync<string?>($"SELECT to_regclass('\"{table}\"')::text"));
        Assert.Equal(15, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityStreams" """));
        Assert.Equal(3, await ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));

        await ExecuteAsync(clear);
        await migrator.MigrateAsync(V25Migration);
        Assert.Equal(["newsletter"], await QueryAsync("""SELECT "MenuKey" FROM "MenuActivityStreams" """));
    }

    private async Task AssertSchemaAsync()
    {
        Assert.Equal(
            ["Action:character varying:40:NO", "ActorKind:character varying:10:NO", "ActorStaffId:uuid::YES", "CorrelationId:uuid::YES", "EntityKey:character varying:80:NO", "EntityKind:character varying:40:NO",
             "Id:uuid::NO", "ItemCount:integer::NO", "MenuKey:character varying:40:NO", "OccurredAtUtc:timestamp with time zone::NO", "PropertyId:uuid::YES", "Sequence:bigint::NO", "TitleSnapshot:character varying:200:NO"],
            (await QueryAsync(Columns("AdminActivities"))).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(
            ["LastSeenSequence:bigint::NO", "MenuKey:character varying:40:NO", "PropertyId:uuid::NO", "StaffAccountId:uuid::NO", "UpdatedAtUtc:timestamp with time zone::NO"],
            (await QueryAsync(Columns("StaffMenuPropertySeen"))).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(
            ["EntityKey:character varying:80:NO", "EntityKind:character varying:40:NO", "LastSeenSequence:bigint::NO", "PropertyId:uuid::NO", "StaffAccountId:uuid::NO", "UpdatedAtUtc:timestamp with time zone::NO"],
            (await QueryAsync(Columns("StaffEntitySeen"))).Order(StringComparer.Ordinal).ToArray());

        var indexes = (await QueryAsync("""SELECT indexname || '|' || indexdef FROM pg_indexes WHERE tablename IN ('AdminActivities','StaffMenuPropertySeen','StaffEntitySeen') """)).ToDictionary(r => r.Split('|')[0], r => r.Split('|', 2)[1]);
        AssertIndex(indexes, "PK_AdminActivities", unique: true, "(\"MenuKey\", \"Sequence\")");
        AssertIndex(indexes, "UX_AdminActivities_Id", unique: true, "(\"Id\")");
        AssertIndex(indexes, "IX_AdminActivities_MenuKey_PropertyId_Sequence", unique: false, "(\"MenuKey\", \"PropertyId\", \"Sequence\")");
        AssertIndex(indexes, "IX_AdminActivities_MenuKey_EntityKind_EntityKey_Sequence", unique: false, "(\"MenuKey\", \"EntityKind\", \"EntityKey\", \"Sequence\")");
        AssertIndex(indexes, "UX_AdminActivities_Correlation", unique: true, "(\"MenuKey\", \"CorrelationId\", \"Action\") WHERE (\"CorrelationId\" IS NOT NULL)");
        AssertIndex(indexes, "PK_StaffMenuPropertySeen", unique: true, "(\"StaffAccountId\", \"MenuKey\", \"PropertyId\")");
        AssertIndex(indexes, "PK_StaffEntitySeen", unique: true, "(\"StaffAccountId\", \"PropertyId\", \"EntityKind\", \"EntityKey\")");

        // The activity table references no content table: only the stream counter, Properties and StaffAccounts (all Restrict). The cursors cascade only with their Staff account.
        Assert.Equal(
            ["\"AdminActivities\".ActorStaffId->\"StaffAccounts\":r", "\"AdminActivities\".MenuKey->\"MenuActivityStreams\":r", "\"AdminActivities\".PropertyId->\"Properties\":r",
             "\"StaffEntitySeen\".PropertyId->\"Properties\":r", "\"StaffEntitySeen\".StaffAccountId->\"StaffAccounts\":c",
             "\"StaffMenuPropertySeen\".MenuKey->\"MenuActivityStreams\":r", "\"StaffMenuPropertySeen\".PropertyId->\"Properties\":r", "\"StaffMenuPropertySeen\".StaffAccountId->\"StaffAccounts\":c"],
            (await QueryAsync(
                """
                SELECT conrelid::regclass::text || '.' || (SELECT string_agg(attname, ',') FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey)) || '->' || confrelid::regclass::text || ':' || confdeltype::text
                FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('"AdminActivities"'::regclass, '"StaffMenuPropertySeen"'::regclass, '"StaffEntitySeen"'::regclass)
                """)).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(
            ["CK_AdminActivities_ActorKind", "CK_AdminActivities_ActorStaff", "CK_AdminActivities_ItemCount", "CK_AdminActivities_Sequence", "CK_StaffEntitySeen_LastSeenSequence", "CK_StaffMenuPropertySeen_LastSeenSequence"],
            (await QueryAsync("""SELECT conname FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('"AdminActivities"'::regclass, '"StaffMenuPropertySeen"'::regclass, '"StaffEntitySeen"'::regclass) """)).Order(StringComparer.Ordinal).ToArray());

        static string Columns(string table) =>
            $"SELECT column_name || ':' || data_type || ':' || COALESCE(character_maximum_length::text, '') || ':' || is_nullable FROM information_schema.columns WHERE table_name = '{table}'";

        static void AssertIndex(Dictionary<string, string> all, string name, bool unique, string tail)
        {
            Assert.True(all.TryGetValue(name, out var definition), name);
            Assert.Equal(unique, definition.StartsWith("CREATE UNIQUE INDEX", StringComparison.Ordinal));
            Assert.EndsWith(tail, definition);
        }
    }

    private async Task AssertConstraintsEnforcedAsync()
    {
        await ExpectConstraintAsync("CK_AdminActivities_Sequence", Insert(sequence: 0));
        await ExpectConstraintAsync("CK_AdminActivities_ItemCount", Insert(itemCount: 0));
        await ExpectConstraintAsync("CK_AdminActivities_ActorKind", Insert(actorKind: "Robot"));
        await ExpectConstraintAsync("CK_AdminActivities_ActorStaff", Insert(actorKind: "Staff"));                          // a Staff actor needs a Staff id
        await ExpectConstraintAsync("CK_AdminActivities_ActorStaff", Insert(actorKind: "Public", staff: StaffId.ToString())); // and nobody else may carry one
        await ExpectConstraintAsync("FK_AdminActivities_MenuActivityStreams_MenuKey", Insert(menu: "no-such-menu"));
        await ExecuteAsync(Insert(sequence: 1, correlation: Guid.Empty.ToString(), action: "Created"));
        await ExpectConstraintAsync("PK_AdminActivities", Insert(sequence: 1));
        await ExpectConstraintAsync("UX_AdminActivities_Correlation", Insert(sequence: 2, correlation: Guid.Empty.ToString(), action: "Created")); // the backstop
        await ExecuteAsync(Insert(sequence: 3, correlation: Guid.Empty.ToString(), action: "Published"));                                          // another action is another row
        await ExecuteAsync(Insert(sequence: 4)); await ExecuteAsync(Insert(sequence: 5));                                                           // NULL correlations never collide
        await ExecuteAsync("""DELETE FROM "AdminActivities" """);

        static string Insert(long sequence = 1, int itemCount = 1, string actorKind = "System", string? staff = null, string menu = "blog-posts", string? correlation = null, string action = "Created") =>
            string.Format(
                """INSERT INTO "AdminActivities" ("MenuKey","Sequence","Id","ActorKind","ActorStaffId","Action","EntityKind","EntityKey","TitleSnapshot","ItemCount","CorrelationId","OccurredAtUtc") VALUES ('{0}',{1},gen_random_uuid(),'{2}',{3},'{4}','post','k','t',{5},{6},now())""",
                menu, sequence, actorKind, staff is null ? "NULL" : $"'{staff}'", action, itemCount, correlation is null ? "NULL" : $"'{correlation}'");
    }

    private async Task ExpectConstraintAsync(string constraint, string sql) =>
        Assert.Equal(constraint, (await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(sql))).ConstraintName);

    // The legacy Newsletter badge as it stands after real use: two counted verifications (sequences 1 and 3, so there is a gap), the counter at 3 and one Staff cursor at 2.
    private async Task SeedLegacyNewsletterAsync() => await ExecuteAsync(
        $"""
        INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
        VALUES ('{PropertyId}','P','p-26',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,now(),now());
        INSERT INTO "StaffAccounts" ("Id","IsActive","CreatedAtUtc","UserName","NormalizedUserName","Email","NormalizedEmail","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount","CanManageWebsite","CanEditBlog","CanPublishBlog")
        VALUES ('{StaffId}',true,now(),'s@example.com','S@EXAMPLE.COM','s@example.com','S@EXAMPLE.COM',false,false,false,true,0,true,false,false);
        INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc")
        VALUES ('{SubscriptionId}','verified@example.com','homepage','Verified',now() - interval '3 days',now() - interval '2 days');
        INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (1,'{SubscriptionId}',now()),(3,'{SubscriptionId}',now());
        UPDATE "MenuActivityStreams" SET "LastSequence" = 3 WHERE "MenuKey" = 'newsletter';
        INSERT INTO "StaffMenuSeen" ("StaffAccountId","MenuKey","LastSeenSequence","UpdatedAtUtc") VALUES ('{StaffId}','newsletter',2,now());
        """);

    private async Task<T> ScalarAsync<T>(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        var value = await command.ExecuteScalarAsync();
        return value is null or DBNull ? default! : (T)value;
    }

    private async Task<List<string>> QueryAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await reader.ReadAsync()) rows.Add(reader.GetString(0));
        return rows;
    }

    private async Task ExecuteAsync(string sql, bool administrative = false)
    {
        var connectionString = administrative ? new NpgsqlConnectionStringBuilder(_builder.ConnectionString) { Database = "postgres" }.ConnectionString : _builder.ConnectionString;
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private TheBhaDbContext CreateContext() => new(new DbContextOptionsBuilder<TheBhaDbContext>()
        .UseNpgsql(_builder.ConnectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
        .Options);
}
