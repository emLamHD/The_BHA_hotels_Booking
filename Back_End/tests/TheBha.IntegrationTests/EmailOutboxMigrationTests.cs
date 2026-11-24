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
/// BHA-CHECKOUT-001-PR03, E-07, in the way PR02 rehearsed its migration: the real chain builds the schema immediately before PR03 (after AddReservationFolio) with synthetic booking, folio and newsletter rows, "AddTransactionalEmailOutbox"
/// is applied and its Down is proven on every outcome: empty, populated, and with an uncommitted writer. The same file proves the constraints and the "frozen" trigger of the new tables. One disposable database per test; the output
/// carries counts, hashes and the server version only.
/// </summary>
public sealed class EmailOutboxMigrationTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string PreMigration = "20261122085005_AddReservationFolio";
    private const string PrMigration = "20261122104705_AddTransactionalEmailOutbox";

    private readonly string _administrativeConnectionString = AdministrativeConnectionString();
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public async Task InitializeAsync()
    {
        _databaseName = $"thebha_pr03_{Guid.NewGuid():N}";
        _connectionString = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")!) { Database = _databaseName, Pooling = false }.ConnectionString;
        await ExecuteOnAsync(_administrativeConnectionString, $"CREATE DATABASE \"{_databaseName}\"");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteOnAsync(_administrativeConnectionString, $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Up_leaves_an_empty_queue_and_keeps_every_booking_folio_and_newsletter_row_byte_for_byte()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        output.WriteLine($"PostgreSQL {await ScalarAsync<string>("SHOW server_version")}; schema = real migration chain up to {PreMigration}");
        var seed = await SeedFixturesAsync();
        var before = await ChecksumsAsync();
        Assert.Equal(4, before["Reservations"].Count);
        Assert.Equal(1, before["FolioEntries"].Count);
        Assert.Equal(1, before["NewsletterSubscriptions"].Count);

        await Migrator(context).MigrateAsync(PrMigration);

        var after = await ChecksumsAsync();
        foreach (var (table, hash) in before)
        {
            output.WriteLine($"{table}: {hash.Count} rows, before={hash.Checksum} after={after[table].Checksum}");
            Assert.Equal(hash, after[table]);
        }

        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "EmailOutboxEvents" """));
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "EmailOutboxDeliveries" """));
        // "the migration and the model agree" is asserted on the whole chain by StaffBookingNotificationMigrationTests: today's model already includes the later PR04 tables.
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        Assert.Equal(["20261122120541_AddStaffBookingNotificationRecipients", "20261122134842_AddDirectReservationCreationRequests", "20261124045303_AddReservationManagementAccess"], await context.Database.GetPendingMigrationsAsync()); // only the migrations PR04 and PR05 added after this one
        Assert.Equal(1, await ScalarAsync<long>("SELECT count(*) FROM pg_proc WHERE proname = 'thebha_email_outbox_deliveries_frozen'"));
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM pg_trigger WHERE tgrelid = '"EmailOutboxDeliveries"'::regclass AND NOT tgisinternal"""));
        foreach (var index in new[] { "IX_EmailOutboxEvents_Due", "IX_EmailOutboxEvents_Failed", "IX_EmailOutboxDeliveries_Pending", "IX_EmailOutboxDeliveries_Lease", "IX_EmailOutboxDeliveries_Failures", "IX_EmailOutboxDeliveries_EventId_Purpose_RecipientKey" })
        {
            Assert.Equal(1, await ScalarAsync<long>($"SELECT count(*) FROM pg_indexes WHERE indexname = '{index}'"));
        }

        _ = seed;
    }

    [Fact]
    public async Task Down_on_an_empty_queue_removes_both_tables_and_the_function_and_changes_nothing_else()
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
        Assert.Equal(0, await ScalarAsync<long>("SELECT count(*) FROM pg_proc WHERE proname = 'thebha_email_outbox_deliveries_frozen'"));
        Assert.Equal(0, await ScalarAsync<long>("SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'EmailOutbox%'"));
        Assert.DoesNotContain(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine("Down on an empty queue: catalog and fixture checksums equal the pre-migration ones.");

        await Migrator(context).MigrateAsync(PrMigration); // and the chain can go forward again
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "EmailOutboxEvents" """));
    }

    [Fact]
    public async Task Down_refuses_a_populated_queue_before_dropping_anything_and_changes_nothing()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        var seed = await SeedFixturesAsync();
        await Migrator(context).MigrateAsync(PrMigration);
        await InsertEventAsync(seed.PropertyId, Guid.NewGuid());
        var schema = await CatalogAsync();
        var data = await ScalarAsync<string>("""SELECT md5(string_agg(to_jsonb(e)::text, '|' ORDER BY "Id")) FROM "EmailOutboxEvents" e""");

        var error = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));

        Assert.Contains("Cannot downgrade AddTransactionalEmailOutbox: 1 event(s) and 0 delivery row(s)", error.MessageText);
        Assert.Equal(schema, await CatalogAsync());
        Assert.Equal(data, await ScalarAsync<string>("""SELECT md5(string_agg(to_jsonb(e)::text, '|' ORDER BY "Id")) FROM "EmailOutboxEvents" e"""));
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine($"Down with a populated queue: refused ({error.SqlState}), catalog + data identical.");
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
        await using (var insert = new NpgsqlCommand(EventSql(seed.PropertyId, Guid.NewGuid()), writer, transaction)) await insert.ExecuteNonQueryAsync();

        var blocked = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Equal(PostgresErrorCodes.LockNotAvailable, blocked.SqlState);
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());

        await transaction.CommitAsync();
        var refused = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Contains("Cannot downgrade AddTransactionalEmailOutbox: 1 event(s)", refused.MessageText);
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "EmailOutboxEvents" """));
        output.WriteLine($"Down with an uncommitted writer: {blocked.SqlState} (lock not available); after its commit: refused, row kept.");
    }

    [Fact]
    public async Task The_constraints_refuse_what_the_application_never_writes()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        var seed = await SeedFixturesAsync();
        var eventId = Guid.NewGuid();
        await InsertEventAsync(seed.PropertyId, eventId);

        Assert.Equal(("23503", "FK_EmailOutboxEvents_Properties_PropertyId"), await RawAsync(_connectionString, EventSql(Guid.NewGuid(), Guid.NewGuid())));
        Assert.Equal(("23514", "CK_EmailOutboxEvents_Payload"), await RawAsync(_connectionString, EventSql(seed.PropertyId, Guid.NewGuid(), payload: "[1]")));
        Assert.Equal(("23514", "CK_EmailOutboxEvents_Status"), await RawAsync(_connectionString, EventSql(seed.PropertyId, Guid.NewGuid(), status: "Done")));
        Assert.Equal(("23514", "CK_EmailOutboxEvents_Completed"), await RawAsync(_connectionString, EventSql(seed.PropertyId, Guid.NewGuid(), status: "Completed")));
        Assert.Equal(("23514", "CK_EmailOutboxEvents_Version"), await RawAsync(_connectionString, EventSql(seed.PropertyId, Guid.NewGuid(), version: 0)));

        // A delivery must belong to its event's Property, and a Sending row must carry its claim and lease.
        Assert.Equal(("23503", "FK_EmailOutboxDeliveries_EmailOutboxEvents_PropertyId_EventId"), await RawAsync(_connectionString, DeliverySql(eventId, seed.OtherPropertyId)));
        Assert.Equal(("23514", "CK_EmailOutboxDeliveries_Claim"), await RawAsync(_connectionString, DeliverySql(eventId, seed.PropertyId, status: "Sending")));
        Assert.Equal(("23514", "CK_EmailOutboxDeliveries_Payload"), await RawAsync(_connectionString, DeliverySql(eventId, seed.PropertyId, recipient: "NULL")));
        Assert.Equal(("23514", "CK_EmailOutboxDeliveries_Pin"), await RawAsync(_connectionString, DeliverySql(eventId, seed.PropertyId, extra: ",\"FirstAttemptAtUtc\"", extraValue: ",now()")));
        Assert.Null(await RawAsync(_connectionString, DeliverySql(eventId, seed.PropertyId)));
    }

    [Fact]
    public async Task The_frozen_trigger_keeps_the_message_the_identity_and_the_pin_fixed_and_lets_only_the_erase_and_the_state_changes_through()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        var seed = await SeedFixturesAsync();
        var eventId = Guid.NewGuid();
        await InsertEventAsync(seed.PropertyId, eventId);
        Assert.Null(await RawAsync(_connectionString, DeliverySql(eventId, seed.PropertyId, purpose: "p")));
        const string where = """WHERE "Purpose" = 'p'""";
        string Update(string set) => $"""UPDATE "EmailOutboxDeliveries" SET {set} {where}""";

        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"ProtectedMessage\" = 'other'")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"ProtectedRecipient\" = 'other'")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"Purpose\" = 'q'")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"CreatedAtUtc\" = now() + interval '1 day'")));

        // State changes and the pin are allowed once; after that the pin never moves.
        Assert.Null(await RawAsync(_connectionString, Update("\"FirstAttemptAtUtc\" = now(), \"PinnedFingerprint\" = 'fp', \"PinnedFrom\" = 'a@b.example', \"Attempts\" = 1")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"PinnedFingerprint\" = 'other'")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"PinnedFrom\" = 'c@d.example'")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"FirstAttemptAtUtc\" = now() + interval '1 hour'")));
        Assert.Null(await RawAsync(_connectionString, Update("\"Attempts\" = 2, \"LastOutcome\" = 'no-response'")));

        // Accepted erases the message and the address, and is final.
        Assert.Null(await RawAsync(_connectionString, Update("\"Status\" = 'Accepted', \"AcceptedAtUtc\" = now(), \"ProviderMessageId\" = 're_1', \"ProtectedRecipient\" = NULL, \"ProtectedMessage\" = NULL")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"Status\" = 'Pending', \"AcceptedAtUtc\" = NULL")));
        Assert.Equal(("XBHA8", null), await RawAsync(_connectionString, Update("\"ProtectedMessage\" = 'back again'")));
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private async Task<FolioSeed> SeedFixturesAsync()
    {
        var seed = await SeedAsync(CreateContext);
        await ExecuteOnAsync(_connectionString,
            $"""
             INSERT INTO "FolioEntries" ("Id","PropertyId","ReservationId","Kind","Amount","CurrencyCode","PostingKey","ActorKind","OccurredAtUtc","RecordedAtUtc")
             VALUES ('{Guid.NewGuid()}','{seed.PropertyId}','{seed.DirectId}','RoomCharge',200,'VND','charge:initial','System',now(),now());
             INSERT INTO "NewsletterSubscriptions" ("Id","Email","Source","Status","ReceivedAtUtc") VALUES ('{Guid.NewGuid()}','fixture@example.test','homepage','PendingVerification',now());
             """);
        return seed;
    }

    private Task InsertEventAsync(Guid propertyId, Guid eventId) => ExecuteOnAsync(_connectionString, EventSql(propertyId, eventId));

    private static string EventSql(Guid propertyId, Guid eventId, string payload = """{"reservationId":"1"}""", string status = "Pending", int version = 1) =>
        $"""
         INSERT INTO "EmailOutboxEvents" ("Id","EventType","SchemaVersion","PropertyId","Payload","Status","FanoutAttempts","NextAttemptAtUtc","CreatedAtUtc")
         VALUES ('{eventId}','test.synthetic',{version},'{propertyId}','{payload}'::jsonb,'{status}',0,now(),now())
         """;

    private static string DeliverySql(Guid eventId, Guid propertyId, string status = "Pending", string recipient = "'x'", string purpose = "p", string extra = "", string extraValue = "") =>
        $"""
         INSERT INTO "EmailOutboxDeliveries" ("Id","EventId","PropertyId","Purpose","RecipientKey","TemplateKey","Locale","ProtectedRecipient","ProtectedMessage","Status","Attempts","NextAttemptAtUtc","UncertainSend","CreatedAtUtc"{extra})
         VALUES ('{Guid.NewGuid()}','{eventId}','{propertyId}','{purpose}','k','t','en',{recipient},'y','{status}',0,now(),false,now(){extraValue})
         """;

    private async Task<Dictionary<string, (long Count, string Checksum)>> ChecksumsAsync()
    {
        var result = new Dictionary<string, (long, string)>();
        foreach (var (table, key) in new[] { ("Reservations", "Id"), ("ReservationUnits", "Id"), ("ReservationUnitNights", "ReservationUnitId\", \"StayDate"), ("InventoryHolds", "Id"), ("FolioEntries", "Id"), ("NewsletterSubscriptions", "Id") })
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"""SELECT count(*), coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY "{key}")), '') FROM "{table}" t""", connection);
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
