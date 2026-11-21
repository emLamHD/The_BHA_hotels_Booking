using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR14 P1 (ADR 0011 §E): migration 27 on a real PostgreSQL database that already holds the legacy Newsletter badge data. It adds the marker table and an INERT fence and changes nothing
/// else; Down refuses once a marker exists and otherwise removes exactly what Up added. Each test owns a disposable database.
/// </summary>
public sealed class NewsletterCutoverMigrationTests : IAsyncLifetime
{
    private const string V26Migration = "20261120153842_AddAdminMenuActivity";
    private const string V27Migration = "20261121162308_AddNewsletterActivityCutover";
    private static readonly Guid SubscriptionId = Guid.Parse("90000000-0000-0000-0000-000000000027");

    private readonly NpgsqlConnectionStringBuilder _builder = new(
        Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")
        ?? throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server."))
    {
        Database = $"thebha_cutovermig_{Guid.NewGuid():N}",
        Pooling = false
    };

    public Task InitializeAsync() => ExecuteAsync($"CREATE DATABASE \"{_builder.Database}\"", administrative: true);

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteAsync($"DROP DATABASE IF EXISTS \"{_builder.Database}\" WITH (FORCE)", administrative: true);
    }

    [Fact]
    public async Task V26_database_upgrades_additively_and_the_fence_is_inert_until_the_marker_exists()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V26Migration);
        await SeedLegacyAsync();

        await migrator.MigrateAsync(V27Migration);

        // Nothing that exists changed: rows, counter (with its gap) and cursor are as they were, and the marker table is empty.
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        Assert.Equal(3, await ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "AdminActivities" """));
        // The explicit primary key, foreign key and CHECK only: PostgreSQL 18 also lists each NOT NULL column in pg_constraint (contype 'n', e.g. MenuActivityCutovers_CutoverAtUtc_not_null), PostgreSQL 17 does not.
        // Filtering by type, not by a name suffix, keeps this failing if one of the three is missing or renamed; the columns' nullability is asserted separately below.
        Assert.Equal(
            ["CK_MenuActivityCutovers_LegacyMaxSequence", "FK_MenuActivityCutovers_MenuActivityStreams_MenuKey", "PK_MenuActivityCutovers"],
            (await QueryAsync("""SELECT conname FROM pg_constraint WHERE conrelid = '"MenuActivityCutovers"'::regclass AND contype IN ('p', 'f', 'c') """)).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(
            ["CutoverAtUtc:timestamp with time zone:NO", "LegacyMaxSequence:bigint:NO", "MenuKey:character varying:NO"],
            (await QueryAsync("""SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns WHERE table_name = 'MenuActivityCutovers' """)).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM pg_trigger WHERE tgrelid = '"NewsletterVerificationActivities"'::regclass AND tgname = 'TR_NewsletterVerificationActivities_Fence' AND tgenabled = 'O' """));
        Assert.False(context.Database.HasPendingModelChanges());

        // Inert: with no marker a legacy insert works exactly as before.
        await ExecuteAsync($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (4,'{SubscriptionId}',now())""");

        // Armed: once the marker row exists the same insert fails with the fence's own SQLSTATE and writes nothing.
        await ExecuteAsync("""INSERT INTO "MenuActivityCutovers" ("MenuKey","LegacyMaxSequence","CutoverAtUtc") VALUES ('newsletter',4,now())""");
        var fenced = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (5,'{SubscriptionId}',now())"""));
        Assert.Equal("BH014", fenced.SqlState);
        Assert.Equal(3, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        // Reads and deletes of the legacy copy are not fenced (a subscription delete still cascades).
        await ExecuteAsync($"""DELETE FROM "NewsletterSubscriptions" WHERE "Id" = '{SubscriptionId}' """);
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
    }

    [Fact]
    public async Task Down_refuses_after_a_committed_cutover_and_otherwise_removes_exactly_what_Up_added()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V26Migration);
        await SeedLegacyAsync();
        await migrator.MigrateAsync(V27Migration);
        await ExecuteAsync("""INSERT INTO "MenuActivityCutovers" ("MenuKey","LegacyMaxSequence","CutoverAtUtc") VALUES ('newsletter',3,now())""");

        var refused = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V26Migration));
        Assert.Contains("Down refused", refused.MessageText, StringComparison.Ordinal);
        // Atomic refusal: the fence, the function and the table are all still there, and the marker is untouched.
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "MenuActivityCutovers" """));
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_NewsletterVerificationActivities_Fence' """));
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM pg_proc WHERE proname = 'NewsletterVerificationActivities_Fence' """));

        await ExecuteAsync("""DELETE FROM "MenuActivityCutovers" """);
        await migrator.MigrateAsync(V26Migration);

        Assert.Null(await ScalarAsync<string?>("""SELECT to_regclass('"MenuActivityCutovers"')::text"""));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_NewsletterVerificationActivities_Fence' """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM pg_proc WHERE proname = 'NewsletterVerificationActivities_Fence' """));
        // The legacy data is not part of this Down.
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "NewsletterVerificationActivities" """));
        Assert.Equal(3, await ScalarAsync<long>("""SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter' """));
    }

    [Fact]
    public async Task Down_fails_at_once_while_a_legacy_writer_is_in_flight()
    {
        await using var context = CreateContext();
        var migrator = context.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(V26Migration);
        await SeedLegacyAsync();
        await migrator.MigrateAsync(V27Migration);

        await using var writer = new NpgsqlConnection(_builder.ConnectionString);
        await writer.OpenAsync();
        await using var transaction = await writer.BeginTransactionAsync();
        await using (var insert = new NpgsqlCommand($"""INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (4,'{SubscriptionId}',now())""", writer, transaction))
            await insert.ExecuteNonQueryAsync();

        var failed = await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(V26Migration));
        Assert.Equal(PostgresErrorCodes.LockNotAvailable, failed.SqlState);                       // NOWAIT: it neither waits nor reads a half-seen state
        await transaction.RollbackAsync();
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_NewsletterVerificationActivities_Fence' """));
    }

    // The legacy Newsletter badge as it stands after real use: two verifications (sequences 1 and 3: a gap), the counter at 3 and the subscription that carries them.
    private Task SeedLegacyAsync() => ExecuteAsync(
        $"""
        INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc","VerifiedAtUtc")
        VALUES ('{SubscriptionId}','verified@example.com','homepage','Verified',now() - interval '3 days',now() - interval '2 days');
        INSERT INTO "NewsletterVerificationActivities" ("Sequence","SubscriptionId","OccurredAtUtc") VALUES (1,'{SubscriptionId}',now()),(3,'{SubscriptionId}',now());
        UPDATE "MenuActivityStreams" SET "LastSequence" = 3 WHERE "MenuKey" = 'newsletter';
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
