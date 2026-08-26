using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-BE-001.2 migration evidence: the "PhysicalRoomScheduleAvailabilityAuthority"
/// migration (migration 8) must apply cleanly to a fresh database, must upgrade
/// cleanly from migration 7 with existing catalog/commercial data intact, must
/// downgrade cleanly back to migration 7 when its three new tables are empty, and
/// its guarded Down() must refuse to discard non-empty RoomBlock/RoomOccupancySegment/
/// RoomOccupancySegmentAudit data (migration 7's schema has no representation for
/// any of it). This class owns its own disposable database per test — independent
/// of the shared, already-fully-migrated <see cref="PostgreSqlWebApplicationFactory"/>
/// database — because it must control exactly which migration is applied at each step.
/// </summary>
public sealed class PhysicalRoomScheduleAvailabilityAuthorityMigrationTests : IAsyncLifetime
{
    private const string V7Migration = "20260823084717_CommercialCommitmentV2Foundation";
    private const string V8Migration = "20260826035254_PhysicalRoomScheduleAvailabilityAuthority";

    private static readonly Guid PropertyId = Guid.Parse("80000000-0000-0000-0000-000000000001");
    private static readonly Guid RoomTypeId = Guid.Parse("80000000-0000-0000-0000-000000000002");
    private static readonly Guid PhysicalRoomId = Guid.Parse("80000000-0000-0000-0000-000000000003");

    private readonly string _administrativeConnectionString;
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public PhysicalRoomScheduleAvailabilityAuthorityMigrationTests()
    {
        var configured = Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase");
        if (string.IsNullOrWhiteSpace(configured))
        {
            throw new InvalidOperationException(
                "ConnectionStrings__TheBhaDatabase must target a real PostgreSQL test server.");
        }

        var adminBuilder = new NpgsqlConnectionStringBuilder(configured)
        {
            Database = "postgres",
            Pooling = false
        };
        _administrativeConnectionString = adminBuilder.ConnectionString;
    }

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("ConnectionStrings__TheBhaDatabase")!;
        _databaseName = $"thebha_scheduleauth_{Guid.NewGuid():N}";
        var builder = new NpgsqlConnectionStringBuilder(configured)
        {
            Database = _databaseName,
            Pooling = false
        };
        _connectionString = builder.ConnectionString;

        await using var connection = new NpgsqlConnection(_administrativeConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE \"{_databaseName}\"";
        await command.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(_administrativeConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Fresh_database_applies_all_eight_migrations()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V8Migration);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Equal(8, applied.Count());
        Assert.Contains(applied, migration => migration.EndsWith("_PhysicalRoomScheduleAvailabilityAuthority"));
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task V7_database_with_existing_catalog_data_upgrades_cleanly_and_preserves_it()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V7Migration);
        await SeedV7CatalogAsync();

        await GetMigrator(context).MigrateAsync(V8Migration);

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();

        Assert.Equal(1, await ScalarAsync<long>(
            connection,
            "SELECT COUNT(*) FROM \"PhysicalRooms\" WHERE \"Id\" = @id",
            ("id", PhysicalRoomId)));
        Assert.Equal(0, await ScalarAsync<long>(connection, "SELECT COUNT(*) FROM \"RoomBlocks\""));
        Assert.Equal(0, await ScalarAsync<long>(connection, "SELECT COUNT(*) FROM \"RoomOccupancySegments\""));
        Assert.Equal(0, await ScalarAsync<long>(connection, "SELECT COUNT(*) FROM \"RoomOccupancySegmentAudits\""));
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task Downgrade_from_v8_to_v7_succeeds_when_the_three_new_tables_are_empty()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V7Migration);
        await SeedV7CatalogAsync();
        await GetMigrator(context).MigrateAsync(V8Migration);

        await GetMigrator(context).MigrateAsync(V7Migration);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.DoesNotContain(applied, migration => migration.EndsWith("_PhysicalRoomScheduleAvailabilityAuthority"));

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        Assert.Equal(1, await ScalarAsync<long>(
            connection,
            "SELECT COUNT(*) FROM \"PhysicalRooms\" WHERE \"Id\" = @id",
            ("id", PhysicalRoomId)));
    }

    [Fact]
    public async Task Downgrade_fails_and_preserves_data_when_room_occupancy_segments_is_non_empty()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V7Migration);
        await SeedV7CatalogAsync();
        await GetMigrator(context).MigrateAsync(V8Migration);
        await InsertOneSegmentAsync();

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => GetMigrator(context).MigrateAsync(V7Migration));
        Assert.Contains("RoomOccupancySegments row(s) exist", exception.MessageText, StringComparison.Ordinal);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, migration => migration.EndsWith("_PhysicalRoomScheduleAvailabilityAuthority"));

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        Assert.Equal(1, await ScalarAsync<long>(connection, "SELECT COUNT(*) FROM \"RoomOccupancySegments\""));
    }

    [Fact]
    public async Task Downgrade_fails_and_preserves_data_when_room_blocks_is_non_empty_with_no_segments()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V7Migration);
        await SeedV7CatalogAsync();
        await GetMigrator(context).MigrateAsync(V8Migration);

        await using (var connection = new NpgsqlConnection(_connectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO "RoomBlocks" ("Id","PropertyId","Reason","CreatedByActorReference","CreatedAtUtc")
                VALUES (@id, @propertyId, 'Maintenance', 'actor:migration-test', '2026-07-22T00:00:00Z')
                """;
            command.Parameters.AddWithValue("id", Guid.NewGuid());
            command.Parameters.AddWithValue("propertyId", PropertyId);
            await command.ExecuteNonQueryAsync();
        }

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => GetMigrator(context).MigrateAsync(V7Migration));
        Assert.Contains("RoomBlocks row(s) exist", exception.MessageText, StringComparison.Ordinal);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, migration => migration.EndsWith("_PhysicalRoomScheduleAvailabilityAuthority"));

        await using var verify = new NpgsqlConnection(_connectionString);
        await verify.OpenAsync();
        Assert.Equal(1, await ScalarAsync<long>(verify, "SELECT COUNT(*) FROM \"RoomBlocks\""));
    }

    private TheBhaDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<TheBhaDbContext>()
            .UseNpgsql(_connectionString, npgsql => npgsql.MigrationsAssembly("TheBha.Infrastructure"))
            .Options;
        return new TheBhaDbContext(options);
    }

    private static IMigrator GetMigrator(TheBhaDbContext context) =>
        context.GetInfrastructure().GetRequiredService<IMigrator>();

    private async Task SeedV7CatalogAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            $"""
            INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
            VALUES ('{PropertyId}','Schedule Authority Property','schedule-authority-property',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z');

            INSERT INTO "RoomTypes" ("Id","PropertyId","Code","Name","Slug","Description","BaseOccupancy","MaxOccupancy","IsActive","CreatedAt","UpdatedAt")
            VALUES ('{RoomTypeId}','{PropertyId}','DLX','Deluxe','deluxe-schedule-authority',NULL,2,4,true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z');

            INSERT INTO "PhysicalRooms" ("Id","PropertyId","RoomTypeId","RoomNumber","Floor","OperationalStatus","CreatedAt","UpdatedAt")
            VALUES ('{PhysicalRoomId}','{PropertyId}','{RoomTypeId}','101',1,'Active','2026-07-23T10:00:00Z','2026-07-23T10:00:00Z');
            """;
        await command.ExecuteNonQueryAsync();
    }

    private async Task InsertOneSegmentAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();

        // A RoomBlock/OperationalBlock segment is used here so this insert has no
        // dependency on ReservationUnits/Reservations existing in this migration-only
        // fixture — it only needs to prove the guard sees a non-empty
        // RoomOccupancySegments table.
        await using var blockCommand = connection.CreateCommand();
        var blockId = Guid.NewGuid();
        blockCommand.CommandText =
            """
            INSERT INTO "RoomBlocks" ("Id","PropertyId","Reason","CreatedByActorReference","CreatedAtUtc")
            VALUES (@id, @propertyId, 'Maintenance', 'actor:migration-test', '2026-07-22T00:00:00Z')
            """;
        blockCommand.Parameters.AddWithValue("id", blockId);
        blockCommand.Parameters.AddWithValue("propertyId", PropertyId);
        await blockCommand.ExecuteNonQueryAsync();

        await using var segmentCommand = connection.CreateCommand();
        segmentCommand.CommandText =
            """
            INSERT INTO "RoomOccupancySegments"
                ("Id","PropertyId","PhysicalRoomId","Type","Status","StartDate","EndDate",
                 "ReservationUnitId","RoomBlockId","CreatedAtUtc")
            VALUES
                (@id, @propertyId, @physicalRoomId, 'OperationalBlock', 'Effective',
                 '2026-09-01', '2026-09-02', NULL, @roomBlockId, '2026-07-22T00:00:00Z')
            """;
        segmentCommand.Parameters.AddWithValue("id", Guid.NewGuid());
        segmentCommand.Parameters.AddWithValue("propertyId", PropertyId);
        segmentCommand.Parameters.AddWithValue("physicalRoomId", PhysicalRoomId);
        segmentCommand.Parameters.AddWithValue("roomBlockId", blockId);
        await segmentCommand.ExecuteNonQueryAsync();
    }

    private static async Task<T> ScalarAsync<T>(
        NpgsqlConnection connection,
        string sql,
        params (string Name, object Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync();
        return (T)result!;
    }
}
