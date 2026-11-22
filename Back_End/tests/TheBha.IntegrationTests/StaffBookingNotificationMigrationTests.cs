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
/// BHA-CHECKOUT-001-PR04, R-05: the real chain builds the schema immediately before PR04 (after AddTransactionalEmailOutbox) with synthetic Staff, membership, booking and outbox rows, then
/// "AddStaffBookingNotificationRecipients" is applied. Up must leave every preference table EMPTY (no recipient is invented from a login address, a membership or a role) and every existing row byte for byte;
/// Down is proven empty, populated (each table alone refuses) and with an uncommitted writer. One disposable database per test; the output carries counts, hashes and the server version only.
/// </summary>
public sealed class StaffBookingNotificationMigrationTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string PreMigration = "20261122104705_AddTransactionalEmailOutbox";
    private const string PrMigration = "20261122120541_AddStaffBookingNotificationRecipients";
    private const string Payload = "{\"reservationId\":\"1\"}";
    private static readonly string[] NewTables = ["StaffBookingNotificationPreferences", "BookingNotificationFallbacks", "BookingNotificationAudits"];

    private readonly string _administrativeConnectionString = AdministrativeConnectionString();
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public async Task InitializeAsync()
    {
        _databaseName = $"thebha_pr04_{Guid.NewGuid():N}";
        _connectionString = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")!) { Database = _databaseName, Pooling = false }.ConnectionString;
        await ExecuteOnAsync(_administrativeConnectionString, $"CREATE DATABASE \"{_databaseName}\"");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await ExecuteOnAsync(_administrativeConnectionString, $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
    }

    [Fact]
    public async Task Up_adds_three_empty_tables_keeps_every_staff_membership_booking_and_outbox_row_and_the_model_agrees()
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        output.WriteLine($"PostgreSQL {await ScalarAsync<string>("SHOW server_version")}; schema = real migration chain up to {PreMigration}");
        await SeedFixturesAsync();
        var before = await ChecksumsAsync();
        Assert.Equal(1, before["StaffAccounts"].Count);
        Assert.Equal(1, before["StaffPropertyMemberships"].Count);
        Assert.Equal(1, before["EmailOutboxEvents"].Count);

        await Migrator(context).MigrateAsync(PrMigration);

        var after = await ChecksumsAsync();
        foreach (var (table, hash) in before)
        {
            output.WriteLine($"{table}: {hash.Count} rows, before={hash.Checksum} after={after[table].Checksum}");
            Assert.Equal(hash, after[table]);
        }

        foreach (var table in NewTables) Assert.Equal(0, await ScalarAsync<long>($"SELECT count(*) FROM \"{table}\""));
        Assert.False(context.Database.HasPendingModelChanges()); // the whole chain and today's model agree
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task Down_on_empty_tables_removes_them_and_changes_nothing_else()
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
        Assert.Equal(0, await ScalarAsync<long>("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('StaffBookingNotificationPreferences','BookingNotificationFallbacks','BookingNotificationAudits')"));
        Assert.DoesNotContain(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine("Down on empty tables: catalog and fixture checksums equal the pre-migration ones.");

        await Migrator(context).MigrateAsync(PrMigration); // and the chain can go forward again
        Assert.Equal(0, await ScalarAsync<long>("""SELECT count(*) FROM "StaffBookingNotificationPreferences" """));
    }

    [Theory]
    [InlineData("StaffBookingNotificationPreferences")]
    [InlineData("BookingNotificationFallbacks")]
    [InlineData("BookingNotificationAudits")]
    public async Task Down_refuses_while_any_one_table_holds_a_row_and_changes_nothing(string populated)
    {
        await using var context = CreateContext();
        await Migrator(context).MigrateAsync(PreMigration);
        var seed = await SeedFixturesAsync();
        await Migrator(context).MigrateAsync(PrMigration);
        await ExecuteOnAsync(_connectionString, InsertSql(populated, seed));
        var schema = await CatalogAsync();
        var data = await ScalarAsync<string>($"SELECT md5(string_agg(to_jsonb(t)::text, '|')) FROM \"{populated}\" t");

        var error = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));

        Assert.Contains("Cannot downgrade AddStaffBookingNotificationRecipients", error.MessageText);
        Assert.Equal(schema, await CatalogAsync());
        Assert.Equal(data, await ScalarAsync<string>($"SELECT md5(string_agg(to_jsonb(t)::text, '|')) FROM \"{populated}\" t"));
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());
        output.WriteLine($"Down with a row in {populated}: refused ({error.SqlState}), catalog + data identical.");
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
        await using (var insert = new NpgsqlCommand(InsertSql("BookingNotificationFallbacks", seed), writer, transaction)) await insert.ExecuteNonQueryAsync();

        var blocked = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Equal(PostgresErrorCodes.LockNotAvailable, blocked.SqlState);
        Assert.Contains(PrMigration, await context.Database.GetAppliedMigrationsAsync());

        await transaction.CommitAsync();
        var refused = await Assert.ThrowsAsync<PostgresException>(() => Migrator(context).MigrateAsync(PreMigration));
        Assert.Contains("1 fallback(s)", refused.MessageText);
        Assert.Equal(1, await ScalarAsync<long>("""SELECT count(*) FROM "BookingNotificationFallbacks" """));
    }

    [Fact]
    public async Task The_constraints_keep_the_address_clean_and_a_membership_revoked_by_the_operator_is_never_blocked()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
        var seed = await SeedFixturesAsync();
        const string Columns = """("PropertyId","StaffAccountId","NotificationEmail","IsEnabled","Version","CreatedAtUtc","UpdatedAtUtc")""";
        string Pref(Guid property, Guid staff, string email, int version = 1) =>
            $"INSERT INTO \"StaffBookingNotificationPreferences\" {Columns} VALUES ('{property}','{staff}',{email},true,{version},now(),now())";

        Assert.Equal(("23503", "FK_StaffBookingNotificationPreferences_Properties_PropertyId"), await RawAsync(_connectionString, Pref(Guid.NewGuid(), seed.StaffId, "'a@b.example'")));
        Assert.Equal(("23503", "FK_StaffBookingNotificationPreferences_StaffAccounts_StaffAcco~"), await RawAsync(_connectionString, Pref(seed.PropertyId, Guid.NewGuid(), "'a@b.example'")));
        Assert.Equal(("23514", "CK_StaffBookingNotificationPreferences_Email"), await RawAsync(_connectionString, Pref(seed.PropertyId, seed.StaffId, "'a@b.example' || chr(10)")));
        Assert.Equal(("23514", "CK_StaffBookingNotificationPreferences_Email"), await RawAsync(_connectionString, Pref(seed.PropertyId, seed.StaffId, "'   '")));
        Assert.Equal(("23514", "CK_StaffBookingNotificationPreferences_Version"), await RawAsync(_connectionString, Pref(seed.PropertyId, seed.StaffId, "'a@b.example'", version: 0)));
        Assert.Null(await RawAsync(_connectionString, Pref(seed.PropertyId, seed.StaffId, "'a@b.example'")));
        Assert.Equal(("23505", "PK_StaffBookingNotificationPreferences"), await RawAsync(_connectionString, Pref(seed.PropertyId, seed.StaffId, "'c@d.example'")));
        // The same Staff member may hold an own, independent row at another Property.
        Assert.Null(await RawAsync(_connectionString, Pref(seed.OtherPropertyId, seed.StaffId, "NULL")));
        Assert.Equal(("23514", "CK_BookingNotificationFallbacks_Email"), await RawAsync(_connectionString, $"INSERT INTO \"BookingNotificationFallbacks\" (\"PropertyId\",\"Email\",\"Version\",\"UpdatedAtUtc\") VALUES ('{seed.PropertyId}','x@y.example' || chr(13),1,now())"));

        // The operator revokes the membership (the CLI has no verb; a row delete is what revocation is): the preference neither blocks it nor disappears with it.
        Assert.Null(await RawAsync(_connectionString, $"DELETE FROM \"StaffPropertyMemberships\" WHERE \"StaffAccountId\" = '{seed.StaffId}' AND \"PropertyId\" = '{seed.PropertyId}'"));
        Assert.Equal(1, await ScalarAsync<long>($"SELECT count(*) FROM \"StaffBookingNotificationPreferences\" WHERE \"StaffAccountId\" = '{seed.StaffId}' AND \"PropertyId\" = '{seed.PropertyId}'"));
    }

    // ---- helpers -------------------------------------------------------------------------------------------------

    private async Task<FolioSeed> SeedFixturesAsync()
    {
        var seed = await SeedAsync(CreateContext);
        await ExecuteOnAsync(_connectionString,
            $"""
             INSERT INTO "StaffPropertyMemberships" ("StaffAccountId","PropertyId","Role","CreatedAtUtc") VALUES ('{seed.StaffId}','{seed.PropertyId}','Manager',now());
             INSERT INTO "EmailOutboxEvents" ("Id","EventType","SchemaVersion","PropertyId","Payload","Status","FanoutAttempts","NextAttemptAtUtc","CreatedAtUtc")
             VALUES ('{Guid.NewGuid()}','test.synthetic',1,'{seed.PropertyId}','{Payload}'::jsonb,'Pending',0,now(),now());
             """);
        return seed;
    }

    private static string InsertSql(string table, FolioSeed seed) => table switch
    {
        "StaffBookingNotificationPreferences" =>
            $"""INSERT INTO "StaffBookingNotificationPreferences" ("PropertyId","StaffAccountId","NotificationEmail","IsEnabled","Version","CreatedAtUtc","UpdatedAtUtc") VALUES ('{seed.PropertyId}','{seed.StaffId}','a@b.example',true,1,now(),now())""",
        "BookingNotificationFallbacks" =>
            $"""INSERT INTO "BookingNotificationFallbacks" ("PropertyId","Email","Version","UpdatedAtUtc") VALUES ('{seed.PropertyId}','desk@b.example',1,now())""",
        _ =>
            $"""INSERT INTO "BookingNotificationAudits" ("Id","PropertyId","ActorStaffId","TargetStaffId","Action","AtUtc") VALUES ('{Guid.NewGuid()}','{seed.PropertyId}','{seed.StaffId}',NULL,'fallback-set',now())"""
    };

    private async Task<Dictionary<string, (long Count, string Checksum)>> ChecksumsAsync()
    {
        var result = new Dictionary<string, (long, string)>();
        foreach (var (table, key) in new[] { ("Reservations", "Id"), ("ReservationUnits", "Id"), ("FolioEntries", "Id"), ("StaffAccounts", "Id"), ("StaffPropertyMemberships", "StaffAccountId\", \"PropertyId"), ("EmailOutboxEvents", "Id") })
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
