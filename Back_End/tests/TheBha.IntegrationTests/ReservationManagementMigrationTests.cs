using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;
using Xunit.Abstractions;
using static TheBha.IntegrationTests.FolioTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR06, M-06: the real migration chain builds the schema immediately before PR06 (after AddDirectReservationCreationRequests) with synthetic reservations (Hold-sourced, Direct, USD), folio, outbox and
/// request rows, then "AddReservationManagementAccess" is applied. Up must leave every existing row byte for byte and the three new tables empty; the database itself refuses a link or session of another Property's
/// Reservation, a repeated hash, a malformed hash and a second session for one link; Down is proven empty, with each kind of row present, and with an uncommitted writer. One disposable database per test
/// (PostgreSQL 18.3 in CI and in the local evidence; the server version is written to the test output).
/// </summary>
public sealed class ReservationManagementMigrationTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string PreMigration = "20261122134842_AddDirectReservationCreationRequests";
    private const string PrMigration = "20261124045303_AddReservationManagementAccess";
    private static readonly string[] NewTables = ["ReservationManagementLinks", "ReservationManagementSessions", "ReservationArrivalEstimates"];
    private const string Payload = "{\"reservationId\":\"1\"}";
    private static readonly string Hash1 = new('a', 64);
    private static readonly string Hash2 = new('b', 64);
    private static readonly string Hash3 = new('c', 64);

    private readonly string _administrativeConnectionString = AdministrativeConnectionString();
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public async Task InitializeAsync()
    {
        _databaseName = $"thebha_pr06_{Guid.NewGuid():N}";
        _connectionString = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")!) { Database = _databaseName, Pooling = false }.ConnectionString;
        await ExecuteOnAsync(_administrativeConnectionString, $"CREATE DATABASE \"{_databaseName}\"");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteOnAsync(_administrativeConnectionString, $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Up_adds_three_empty_tables_keeps_every_existing_row_byte_for_byte_and_the_model_agrees()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        output.WriteLine($"PostgreSQL {await ScalarAsync<string>("SHOW server_version")}; schema = real migration chain up to {PreMigration}");
        await SeedFixturesAsync();
        var before = await ChecksumsAsync();
        Assert.True(before["Reservations"].Count >= 4);

        await Migrator(context).MigrateAsync(PrMigration);

        var after = await ChecksumsAsync();
        foreach (var (table, hash) in before)
        {
            output.WriteLine($"{table}: {hash.Count} rows, before={hash.Checksum} after={after[table].Checksum}");
            Assert.Equal(hash, after[table]);
        }

        foreach (var table in NewTables)
        {
            Assert.Equal(0, await ScalarAsync<long>($"SELECT count(*) FROM \"{table}\"")); // no link, session or arrival is invented for a reservation that already exists
        }

        Assert.False(context.Database.HasPendingModelChanges()); // the whole chain and today's model agree
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task Down_on_empty_tables_removes_them_changes_nothing_else_and_the_chain_can_go_forward_again()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        await SeedFixturesAsync();
        var schemaBefore = await CatalogAsync();
        var before = await ChecksumsAsync();

        await Migrator(context).MigrateAsync(PrMigration);
        await Migrator(context).MigrateAsync(PreMigration);

        Assert.Equal(schemaBefore, await CatalogAsync());
        Assert.Equal(before, await ChecksumsAsync());
        foreach (var table in NewTables)
        {
            Assert.Equal(0, await ScalarAsync<long>($"SELECT count(*) FROM information_schema.tables WHERE table_name = '{table}'"));
        }

        Assert.DoesNotContain(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        await Migrator(context).MigrateAsync(PrMigration);
        foreach (var table in NewTables)
        {
            Assert.Equal(0, await ScalarAsync<long>($"SELECT count(*) FROM \"{table}\""));
        }
    }

    [Theory]
    [InlineData("link")]
    [InlineData("session")]
    [InlineData("estimate")]
    public async Task Down_refuses_while_any_management_row_exists_and_changes_nothing(string kind)
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        var seed = await SeedFixturesAsync();
        await Migrator(context).MigrateAsync(PrMigration);
        var linkId = Guid.NewGuid();
        // A session needs its link, so the "session" case has both; the others have only the one row.
        if (kind is "link" or "session")
        {
            Assert.Null(await RawAsync(_connectionString, InsertLink(seed.PropertyId, seed.DirectId, linkId)));
        }

        if (kind == "session")
        {
            Assert.Null(await RawAsync(_connectionString, InsertSession(seed.PropertyId, seed.DirectId, linkId)));
        }

        if (kind == "estimate")
        {
            Assert.Null(await RawAsync(_connectionString, InsertEstimate(seed.PropertyId, seed.DirectId)));
        }

        var schema = await CatalogAsync();
        var data = await DataDigestAsync();

        var error = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));

        Assert.Contains("Cannot downgrade AddReservationManagementAccess", error.MessageText);
        Assert.Equal(schema, await CatalogAsync());
        Assert.Equal(data, await DataDigestAsync());
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine($"Down with a {kind} row: refused ({error.SqlState}): {error.MessageText}");
    }

    [Fact]
    public async Task Down_cannot_pass_a_writer_that_has_not_committed_yet_and_then_sees_its_row()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        var seed = await SeedFixturesAsync();
        await Migrator(context).MigrateAsync(PrMigration);

        await using var writer = new NpgsqlConnection(_connectionString);
        await writer.OpenAsync();
        await using var transaction = await writer.BeginTransactionAsync();
        await using (var insert = new NpgsqlCommand(InsertEstimate(seed.PropertyId, seed.DirectId), writer, transaction)) await insert.ExecuteNonQueryAsync();

        var blocked = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Equal(PostgresErrorCodes.LockNotAvailable, blocked.SqlState);
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());

        await transaction.CommitAsync();
        var refused = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Contains("1 estimated arrival(s)", refused.MessageText);
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "ReservationArrivalEstimates" """));
    }

    [Fact]
    public async Task The_database_refuses_a_wrong_property_a_repeated_hash_a_malformed_hash_a_second_session_and_a_second_arrival()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        var seed = await SeedFixturesAsync();
        var link1 = Guid.NewGuid();
        var link2 = Guid.NewGuid();

        // A link or arrival for a Reservation of another Property, or one that does not exist.
        Assert.Equal(("23503", "FK_ReservationManagementLinks_Reservations_PropertyId_Reservat~"), await RawAsync(_connectionString, InsertLink(seed.OtherPropertyId, seed.DirectId, Guid.NewGuid())));
        Assert.Equal(("23503", "FK_ReservationManagementLinks_Reservations_PropertyId_Reservat~"), await RawAsync(_connectionString, InsertLink(seed.PropertyId, Guid.NewGuid(), Guid.NewGuid())));
        Assert.Equal(("23503", "FK_ReservationArrivalEstimates_Reservations_PropertyId_Reserva~"), await RawAsync(_connectionString, InsertEstimate(seed.OtherPropertyId, seed.DirectId)));
        // The right Property: accepted. The same hash again is refused; another hash for the same Reservation is another link.
        Assert.Null(await RawAsync(_connectionString, InsertLink(seed.PropertyId, seed.DirectId, link1)));
        Assert.Equal(("23505", "IX_ReservationManagementLinks_TokenHash"), await RawAsync(_connectionString, InsertLink(seed.PropertyId, seed.UsdDirectId, Guid.NewGuid())));
        Assert.Null(await RawAsync(_connectionString, InsertLink(seed.PropertyId, seed.DirectId, link2, hash: Hash2)));
        // Hash shape, empty ids and a link that expires before it was made.
        Assert.Equal(("23514", "CK_ReservationManagementLinks_Hash"), await RawAsync(_connectionString, InsertLink(seed.PropertyId, seed.DirectId, Guid.NewGuid(), hash: new string('A', 64))));
        Assert.Equal(("23514", "CK_ReservationManagementLinks_Ids"), await RawAsync(_connectionString, InsertLink(Guid.Empty, Guid.Empty, Guid.Empty, hash: Hash3)));
        Assert.Equal(("23514", "CK_ReservationManagementLinks_Times"), await RawAsync(_connectionString, InsertLink(seed.PropertyId, seed.DirectId, Guid.NewGuid(), hash: Hash3, expires: "now() - interval '1 hour'")));
        // One session per link, only for the link's own Reservation, and only an existing link.
        Assert.Null(await RawAsync(_connectionString, InsertSession(seed.PropertyId, seed.DirectId, link1)));
        Assert.Equal(("23505", "IX_ReservationManagementSessions_LinkId"), await RawAsync(_connectionString, InsertSession(seed.PropertyId, seed.DirectId, link1, hash: Hash3)));
        Assert.Equal(("23505", "IX_ReservationManagementSessions_SessionHash"), await RawAsync(_connectionString, InsertSession(seed.PropertyId, seed.DirectId, link2)));
        Assert.Equal(("23503", "FK_ReservationManagementSessions_ReservationManagementLinks_Li~"), await RawAsync(_connectionString, InsertSession(seed.PropertyId, seed.DirectId, Guid.NewGuid(), hash: Hash3)));
        Assert.Equal(("23514", "CK_ReservationManagementSessions_Hash"), await RawAsync(_connectionString, InsertSession(seed.PropertyId, seed.DirectId, link2, hash: "xyz")));
        // One arrival per Reservation.
        Assert.Null(await RawAsync(_connectionString, InsertEstimate(seed.PropertyId, seed.DirectId)));
        Assert.Equal(("23505", "PK_ReservationArrivalEstimates"), await RawAsync(_connectionString, InsertEstimate(seed.PropertyId, seed.DirectId)));
        Assert.Equal(("23514", "CK_ReservationArrivalEstimates_TimeZone"), await RawAsync(_connectionString, InsertEstimate(seed.PropertyId, seed.UsdDirectId, zone: " ")));
        // A Reservation that has a link cannot be deleted from under it (and no code path deletes one).
        Assert.Equal("23001", (await RawAsync(_connectionString, $"""DELETE FROM "Reservations" WHERE "Id" = '{seed.DirectId}'"""))!.Value.SqlState); // restrict (the folio and the request refuse it too)
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private static string InsertLink(Guid propertyId, Guid reservationId, Guid id, string? hash = null, string expires = "now() + interval '72 hours'") =>
        $"""
         INSERT INTO "ReservationManagementLinks" ("Id","PropertyId","ReservationId","TokenHash","CreatedAtUtc","ExpiresAtUtc")
         VALUES ('{id}','{propertyId}','{reservationId}','{hash ?? Hash1}',now(),{expires})
         """;

    private static string InsertSession(Guid propertyId, Guid reservationId, Guid linkId, string? hash = null) =>
        $"""
         INSERT INTO "ReservationManagementSessions" ("Id","PropertyId","ReservationId","LinkId","SessionHash","CreatedAtUtc","ExpiresAtUtc")
         VALUES ('{Guid.NewGuid()}','{propertyId}','{reservationId}','{linkId}','{hash ?? Hash2}',now(),now() + interval '24 hours')
         """;

    private static string InsertEstimate(Guid propertyId, Guid reservationId, string zone = "Asia/Ho_Chi_Minh") =>
        $"""
         INSERT INTO "ReservationArrivalEstimates" ("ReservationId","PropertyId","ArrivalDate","ArrivalTime","TimeZoneId","UpdatedAtUtc")
         VALUES ('{reservationId}','{propertyId}','2026-12-20','21:30','{zone}',now())
         """;

    private async Task<FolioSeed> SeedFixturesAsync()
    {
        var seed = await SeedAsync(CreateContext);
        await ExecuteOnAsync(_connectionString,
            $"""
             INSERT INTO "FolioEntries" ("Id","PropertyId","ReservationId","Kind","Amount","CurrencyCode","PostingKey","ActorKind","OccurredAtUtc","RecordedAtUtc")
             VALUES ('{Guid.NewGuid()}','{seed.PropertyId}','{seed.DirectId}','RoomCharge',1500000,'VND','charge:initial','System',now(),now());
             INSERT INTO "EmailOutboxEvents" ("Id","EventType","SchemaVersion","PropertyId","Payload","Status","FanoutAttempts","NextAttemptAtUtc","CreatedAtUtc")
             VALUES ('{Guid.NewGuid()}','test.synthetic',1,'{seed.PropertyId}','{Payload}'::jsonb,'Pending',0,now(),now());
             INSERT INTO "ReservationCreationRequests" ("ScopeHash","KeyHash","RequestFingerprint","PropertyId","ReservationId","CreatedAtUtc")
             VALUES ('{Hash1}','{Hash2}','{Hash3}','{seed.PropertyId}','{seed.DirectId}',now());
             """);
        return seed;
    }

    private async Task<Dictionary<string, (long Count, string Checksum)>> ChecksumsAsync()
    {
        var result = new Dictionary<string, (long, string)>();
        foreach (var table in new[] { "Reservations", "ReservationUnits", "ReservationUnitNights", "InventoryHolds", "FolioEntries", "EmailOutboxEvents", "ReservationCreationRequests", "Properties" })
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"""SELECT count(*), coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text)), '') FROM "{table}" t""", connection);
            await using var reader = await command.ExecuteReaderAsync();
            await reader.ReadAsync();
            result[table] = (reader.GetInt64(0), reader.GetString(1));
        }

        return result;
    }

    private async Task<string> DataDigestAsync() =>
        string.Join('|', await Task.WhenAll(NewTables.Select(table => ScalarAsync<string>($"""SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text)), '') FROM "{table}" t"""))));

    /// <summary>Every table, column, constraint, index and function name of the public schema: equal before and after a Down means the schema is back to what it was.</summary>
    private async Task<string> CatalogAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT string_agg(item, E'\n' ORDER BY item) FROM (
                SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable AS item FROM information_schema.columns WHERE table_schema = 'public'
                UNION ALL SELECT 'con|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
                UNION ALL SELECT 'idx|' || indexdef FROM pg_indexes WHERE schemaname = 'public'
                UNION ALL SELECT 'fn|' || proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
            ) s
            """, connection);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private static string AdministrativeConnectionString()
    {
        var configured = Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase");
        if (string.IsNullOrWhiteSpace(configured)) throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server.");
        return new NpgsqlConnectionStringBuilder(configured) { Database = "postgres", Pooling = false }.ConnectionString;
    }

    private TheBhaDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TheBhaDbContext>().UseNpgsql(_connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure")).Options);

    private static IMigrator Migrator(TheBhaDbContext context) => context.GetInfrastructure().GetRequiredService<IMigrator>();

    private static async Task ExecuteOnAsync(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private Task<T> ScalarAsync<T>(string sql) => FolioTestSupport.ScalarAsync<T>(_connectionString, sql);
}
