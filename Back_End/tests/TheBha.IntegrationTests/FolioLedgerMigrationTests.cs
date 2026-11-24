using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Domain.Bookings;
using TheBha.Infrastructure.Persistence;
using Xunit.Abstractions;
using static TheBha.IntegrationTests.FolioTestSupport;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR02 rehearsal: the real migration chain builds the schema immediately before PR02 (after AddDirectReservationSource), synthetic Hold-sourced, Direct and non-VND Reservations are written to it,
/// "AddReservationFolio" is applied and its Down is proven on every outcome: empty, populated, and with an uncommitted writer. One disposable database per test; the output carries counts and hashes only.
/// </summary>
public sealed class FolioLedgerMigrationTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string PreMigration = "20261122070757_AddDirectReservationSource";
    private const string PrMigration = "20261122085005_AddReservationFolio";

    private readonly string _administrativeConnectionString = AdministrativeConnectionString();
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public async Task InitializeAsync()
    {
        _databaseName = $"thebha_pr02_{Guid.NewGuid():N}";
        _connectionString = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")!)
        {
            Database = _databaseName,
            Pooling = false
        }.ConnectionString;
        await ExecuteOnAsync(_administrativeConnectionString, $"CREATE DATABASE \"{_databaseName}\"");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteOnAsync(_administrativeConnectionString, $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Up_keeps_every_existing_reservation_byte_for_byte_and_leaves_an_empty_ledger_in_which_each_is_NotRecorded()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        output.WriteLine($"PostgreSQL {await ScalarAsync<string>("SHOW server_version")}; schema = real migration chain up to {PreMigration}");
        var seed = await SeedAsync(CreateContext);
        var before = await ReservationChecksumsAsync();
        Assert.Equal(4, before["Reservations"].Count);
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM "Reservations" WHERE "Source" = 'Direct' AND "CurrencyCode" = 'VND'"""));

        await Migrator(context).MigrateAsync(PrMigration);

        var after = await ReservationChecksumsAsync();
        foreach (var (table, hash) in before)
        {
            output.WriteLine($"{table}: {hash.Count} rows, before={hash.Checksum} after={after[table].Checksum}");
            Assert.Equal(hash, after[table]);
        }

        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "FolioEntries" """));
        Assert.False(context.Database.HasPendingModelChanges()); // the migration and the model agree
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        Assert.Equal(["20261122104705_AddTransactionalEmailOutbox", "20261122120541_AddStaffBookingNotificationRecipients", "20261122134842_AddDirectReservationCreationRequests", "20261124045303_AddReservationManagementAccess"], await context.Database.GetPendingMigrationsAsync()); // only the migrations PR03, PR04 and PR05 added after this one
        Assert.Equal(1, await ScalarAsync<long>("SELECT count(*) FROM pg_proc WHERE proname = 'thebha_folio_entries_guard'"));
        Assert.Equal(2, await ScalarAsync<long>("""SELECT count(*) FROM pg_trigger WHERE tgrelid = '"FolioEntries"'::regclass AND NOT tgisinternal"""));

        // Every pre-existing Reservation (Hold-sourced, Direct, non-VND) reads as NotRecorded: no backfill happened and none of them has an amount.
        await using var read = CreateContext();
        foreach (var reservationId in new[] { seed.HoldSourcedId, seed.DirectId, seed.UsdDirectId })
        {
            var entries = await read.FolioEntries.AsNoTracking().Where(entry => entry.ReservationId == reservationId).ToListAsync();
            Assert.Equal(LedgerState.NotRecorded, ReservationBalance.From(entries).State);
        }
    }

    [Fact]
    public async Task Down_on_an_empty_ledger_removes_the_table_the_function_and_the_triggers_and_loses_no_reservation_data()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        await SeedAsync(CreateContext);
        var schemaBefore = await CatalogAsync();
        var before = await ReservationChecksumsAsync();

        await Migrator(context).MigrateAsync(PrMigration);
        await Migrator(context).MigrateAsync(PreMigration);

        Assert.Equal(schemaBefore, await CatalogAsync());
        Assert.Equal(before, await ReservationChecksumsAsync());
        Assert.Equal(0, await ScalarAsync<long>("SELECT count(*) FROM pg_proc WHERE proname = 'thebha_folio_entries_guard'"));
        Assert.Equal(0, await ScalarAsync<long>("SELECT count(*) FROM information_schema.tables WHERE table_name = 'FolioEntries'"));
        Assert.DoesNotContain(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine("Down on an empty ledger: catalog and reservation checksums equal the pre-migration ones.");

        // The chain can go forward again.
        await Migrator(context).MigrateAsync(PrMigration);
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "FolioEntries" """));
    }

    [Fact]
    public async Task Down_refuses_a_populated_ledger_before_dropping_anything_and_changes_nothing()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        var seed = await SeedAsync(CreateContext);
        await Migrator(context).MigrateAsync(PrMigration);
        await PostChargeAsync(seed);
        var schema = await CatalogAsync();
        var data = await ScalarAsync<string>("""SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY "Id")) FROM "FolioEntries" f""");

        var error = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));

        Assert.Contains("Cannot downgrade AddReservationFolio: 1 FolioEntries row(s)", error.MessageText);
        Assert.Equal(schema, await CatalogAsync());
        Assert.Equal(data, await ScalarAsync<string>("""SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY "Id")) FROM "FolioEntries" f"""));
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        // The guard and the append-only trigger are still in place after the refused Down.
        Assert.Equal(("XBHA5", null), await RawAsync(_connectionString, """DELETE FROM "FolioEntries" """));
        output.WriteLine($"Down with a populated ledger: refused ({error.SqlState}), catalog + data identical.");
    }

    [Fact]
    public async Task Down_cannot_pass_a_writer_that_has_not_committed_yet_and_then_sees_its_row()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        var seed = await SeedAsync(CreateContext);
        await Migrator(context).MigrateAsync(PrMigration);

        // A writer inserts an entry and has not committed: the table has no committed row, so a Down that only counted would see an empty ledger and then drop what the writer is about to commit.
        await using var writer = new NpgsqlConnection(_connectionString);
        await writer.OpenAsync();
        await using var transaction = await writer.BeginTransactionAsync();
        await using (var insert = new NpgsqlCommand(InsertChargeSql(seed), writer, transaction))
        {
            await insert.ExecuteNonQueryAsync();
        }

        var blocked = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Equal(PostgresErrorCodes.LockNotAvailable, blocked.SqlState);
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());

        await transaction.CommitAsync();
        var refused = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Contains("Cannot downgrade AddReservationFolio: 1 FolioEntries row(s)", refused.MessageText);
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "FolioEntries" """));
        output.WriteLine($"Down with an uncommitted writer: {blocked.SqlState} (lock not available); after its commit: refused, row kept.");
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private async Task PostChargeAsync(FolioSeed seed)
    {
        await using var write = CreateContext();
        write.FolioEntries.Add(new FolioEntry(
            Guid.NewGuid(), seed.PropertyId, seed.DirectId, FolioEntryKind.RoomCharge, 200m, "VND", "charge:initial", null, FolioActor.System, null, Now, Now));
        await write.SaveChangesAsync();
    }

    private static string InsertChargeSql(FolioSeed seed) =>
        $"""
         INSERT INTO "FolioEntries" ("Id","PropertyId","ReservationId","Kind","Amount","CurrencyCode","PostingKey","ActorKind","OccurredAtUtc","RecordedAtUtc")
         VALUES ('{Guid.NewGuid()}','{seed.PropertyId}','{seed.DirectId}','RoomCharge',200,'VND','charge:initial','System',now(),now())
         """;

    private async Task<Dictionary<string, (long Count, string Checksum)>> ReservationChecksumsAsync()
    {
        var result = new Dictionary<string, (long, string)>();
        foreach (var (table, key) in new[] { ("Reservations", "Id"), ("ReservationUnits", "Id"), ("ReservationUnitNights", "ReservationUnitId\", \"StayDate"), ("InventoryHolds", "Id") })
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand(
                $"""SELECT count(*), coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY "{key}")), '') FROM "{table}" t""", connection);
            await using var reader = await command.ExecuteReaderAsync();
            await reader.ReadAsync();
            result[table] = (reader.GetInt64(0), reader.GetString(1));
        }

        return result;
    }

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
        if (string.IsNullOrWhiteSpace(configured))
        {
            throw new InvalidOperationException("ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server.");
        }

        return new NpgsqlConnectionStringBuilder(configured) { Database = "postgres", Pooling = false }.ConnectionString;
    }

    private TheBhaDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TheBhaDbContext>()
            .UseNpgsql(_connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .Options);

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
