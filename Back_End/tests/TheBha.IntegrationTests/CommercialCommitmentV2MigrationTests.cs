using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-BE-001.1 migration evidence: the "CommercialCommitmentV2Foundation" migration
/// (§5 of the Master Execution Prompt) must apply cleanly to a fresh database, must
/// deterministically backfill representative legacy v6 data into the normalized
/// authority with preserved counts/totals/lineage, and its guarded Down() must refuse
/// to discard normalized data it cannot safely represent in the legacy schema. This
/// class owns its own disposable database per test — independent of the shared,
/// already-fully-migrated <see cref="PostgreSqlWebApplicationFactory"/> database —
/// because it must control exactly which migration is applied at each step.
/// </summary>
public sealed class CommercialCommitmentV2MigrationTests : IAsyncLifetime
{
    private const string V6Migration = "20260723105404_AddBookingHoldReservationFoundation";
    private const string V7Migration = "20260823084717_CommercialCommitmentV2Foundation";

    private static readonly Guid PropertyId = Guid.Parse("70000000-0000-0000-0000-000000000001");
    private static readonly Guid RoomTypeId = Guid.Parse("70000000-0000-0000-0000-000000000002");
    private static readonly Guid RatePlanId = Guid.Parse("70000000-0000-0000-0000-000000000003");
    private static readonly Guid OtherRatePlanId = Guid.Parse("70000000-0000-0000-0000-000000000004");
    private static readonly Guid ActiveMultiRoomHoldId = Guid.Parse("70000000-0000-0000-0000-000000000010");
    private static readonly Guid ConfirmedHoldId = Guid.Parse("70000000-0000-0000-0000-000000000011");
    private static readonly Guid CancelledSourceHoldId = Guid.Parse("70000000-0000-0000-0000-000000000012");
    private static readonly Guid ConfirmedReservationId = Guid.Parse("70000000-0000-0000-0000-000000000020");
    private static readonly Guid CancelledReservationId = Guid.Parse("70000000-0000-0000-0000-000000000021");

    private readonly string _administrativeConnectionString;
    private string _connectionString = string.Empty;
    private string _databaseName = string.Empty;

    public CommercialCommitmentV2MigrationTests()
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
        _databaseName = $"thebha_v2migration_{Guid.NewGuid():N}";
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
    public async Task Fresh_database_applies_all_seven_migrations()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V7Migration);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Equal(7, applied.Count());
        Assert.Contains(applied, migration => migration.EndsWith("_CommercialCommitmentV2Foundation"));
        // PMS-BE-001.2's migration 8 now exists in the assembly beyond this test's V7
        // target, so it is legitimately still pending here — this test only proves V7
        // applies cleanly in isolation, not that the whole chain is exhausted.
        Assert.Equal(
            ["20260826035254_PhysicalRoomScheduleAvailabilityAuthority"],
            await context.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task V6_database_with_representative_data_upgrades_with_exact_counts_totals_and_lineage()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V6Migration);
        await SeedRepresentativeLegacyDataAsync();

        await GetMigrator(context).MigrateAsync(V7Migration);

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();

        // Active Hold, 3 rooms, 2 nights -> 3 Items, 6 ItemNights, unchanged total.
        Assert.Equal(3, await ScalarAsync<long>(
            connection,
            "SELECT COUNT(*) FROM \"InventoryHoldItems\" WHERE \"InventoryHoldId\" = @id",
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(6, await ScalarAsync<long>(
            connection,
            """
            SELECT COUNT(*) FROM "InventoryHoldItemNights" ihn
            JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
            WHERE ihi."InventoryHoldId" = @id
            """,
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(3003.00m, await ScalarAsync<decimal>(
            connection,
            "SELECT \"TotalAmount\" FROM \"InventoryHolds\" WHERE \"Id\" = @id",
            ("id", ActiveMultiRoomHoldId)));

        // Confirmed Reservation, 2 rooms -> 2 Committed Units, ordinal-paired 1:1 to
        // their source Hold's Items, RatePlan lineage preserved.
        Assert.Equal(2, await ScalarAsync<long>(
            connection,
            "SELECT COUNT(*) FROM \"ReservationUnits\" WHERE \"ReservationId\" = @id",
            ("id", ConfirmedReservationId)));
        Assert.Equal(2, await ScalarAsync<long>(
            connection,
            """
            SELECT COUNT(*) FROM "ReservationUnits" WHERE "ReservationId" = @id
                AND "CommitmentStatus" = 'Committed'
            """,
            ("id", ConfirmedReservationId)));
        Assert.Equal(0, await ScalarAsync<long>(
            connection,
            """
            SELECT COUNT(*) FROM "ReservationUnits" ru
            LEFT JOIN "InventoryHoldItems" ihi ON ihi."Id" = ru."SourceInventoryHoldItemId"
            WHERE ru."ReservationId" = @id AND ihi."Id" IS NULL
            """,
            ("id", ConfirmedReservationId)));
        Assert.Equal(RatePlanId, await ScalarAsync<Guid>(
            connection,
            """
            SELECT DISTINCT run."RatePlanId" FROM "ReservationUnitNights" run
            JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
            WHERE ru."ReservationId" = @id
            """,
            ("id", ConfirmedReservationId)));

        // Cancelled Reservation -> Cancelled Units, immutable snapshot preserved.
        Assert.Equal(1, await ScalarAsync<long>(
            connection,
            """
            SELECT COUNT(*) FROM "ReservationUnits" WHERE "ReservationId" = @id
                AND "CommitmentStatus" = 'Cancelled'
            """,
            ("id", CancelledReservationId)));
        Assert.Equal(600.00m, await ScalarAsync<decimal>(
            connection,
            """
            SELECT SUM(run."UnitAmount") FROM "ReservationUnitNights" run
            JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
            WHERE ru."ReservationId" = @id
            """,
            ("id", CancelledReservationId)));

        // Source Item -> Unit uniqueness: no Item is claimed by more than one Unit.
        Assert.Equal(0, await ScalarAsync<long>(
            connection,
            """
            SELECT COUNT(*) FROM (
                SELECT "SourceInventoryHoldItemId" FROM "ReservationUnits"
                WHERE "SourceInventoryHoldItemId" IS NOT NULL
                GROUP BY "SourceInventoryHoldItemId" HAVING COUNT(*) > 1
            ) d
            """));

        // See Fresh_database_applies_all_seven_migrations for why migration 8 is
        // legitimately still pending relative to this test's V7 target.
        Assert.Equal(
            ["20260826035254_PhysicalRoomScheduleAvailabilityAuthority"],
            await context.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task Downgrade_from_v7_to_v6_reconstructs_the_legacy_shape_exactly()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V6Migration);
        await SeedRepresentativeLegacyDataAsync();
        await GetMigrator(context).MigrateAsync(V7Migration);

        await GetMigrator(context).MigrateAsync(V6Migration);

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();

        Assert.Equal(3, await ScalarAsync<int>(
            connection,
            "SELECT \"Rooms\" FROM \"BookingHolds\" WHERE \"Id\" = @id",
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(RoomTypeId, await ScalarAsync<Guid>(
            connection,
            "SELECT \"RoomTypeId\" FROM \"BookingHolds\" WHERE \"Id\" = @id",
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(RatePlanId, await ScalarAsync<Guid>(
            connection,
            "SELECT \"RatePlanId\" FROM \"BookingHolds\" WHERE \"Id\" = @id",
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(3003.00m, await ScalarAsync<decimal>(
            connection,
            "SELECT \"TotalAmount\" FROM \"BookingHolds\" WHERE \"Id\" = @id",
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(2, await ScalarAsync<int>(
            connection,
            "SELECT \"Rooms\" FROM \"Reservations\" WHERE \"Id\" = @id",
            ("id", ConfirmedReservationId)));
        Assert.Equal(RatePlanId, await ScalarAsync<Guid>(
            connection,
            "SELECT \"RatePlanId\" FROM \"Reservations\" WHERE \"Id\" = @id",
            ("id", ConfirmedReservationId)));
        Assert.Equal("Cancelled", await ScalarAsync<string>(
            connection,
            "SELECT \"Status\" FROM \"Reservations\" WHERE \"Id\" = @id",
            ("id", CancelledReservationId)));

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.DoesNotContain(applied, migration => migration.EndsWith("_CommercialCommitmentV2Foundation"));
    }

    [Fact]
    public async Task Downgrade_fails_and_preserves_all_normalized_data_when_a_hold_spans_more_than_one_room_type()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V6Migration);
        await SeedRepresentativeLegacyDataAsync();
        await GetMigrator(context).MigrateAsync(V7Migration);

        await using (var connection = new NpgsqlConnection(_connectionString))
        {
            await connection.OpenAsync();
            await using var insertOtherRoomType = connection.CreateCommand();
            insertOtherRoomType.CommandText =
                """
                INSERT INTO "RoomTypes"
                    ("Id","PropertyId","Code","Name","Slug","Description","BaseOccupancy",
                     "MaxOccupancy","IsActive","CreatedAt","UpdatedAt")
                VALUES
                    ('70000000-0000-0000-0000-000000000099', @propertyId, 'OTHER','Other','other-migration-smoke',
                     NULL, 2, 4, true, '2026-07-23T10:00:00Z', '2026-07-23T10:00:00Z')
                """;
            insertOtherRoomType.Parameters.AddWithValue("propertyId", PropertyId);
            await insertOtherRoomType.ExecuteNonQueryAsync();

            await using var corrupt = connection.CreateCommand();
            corrupt.CommandText =
                """
                UPDATE "InventoryHoldItems" SET "RoomTypeId" = '70000000-0000-0000-0000-000000000099'
                WHERE "Id" = (
                    SELECT "Id" FROM "InventoryHoldItems"
                    WHERE "InventoryHoldId" = @holdId LIMIT 1
                )
                """;
            corrupt.Parameters.AddWithValue("holdId", ActiveMultiRoomHoldId);
            await corrupt.ExecuteNonQueryAsync();
        }

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => GetMigrator(context).MigrateAsync(V6Migration));
        Assert.Equal("P0001", exception.SqlState);
        Assert.Contains("span more than one RoomType", exception.MessageText, StringComparison.Ordinal);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, migration => migration.EndsWith("_CommercialCommitmentV2Foundation"));
        await using var verify = new NpgsqlConnection(_connectionString);
        await verify.OpenAsync();
        Assert.Equal(3, await ScalarAsync<long>(
            verify,
            "SELECT COUNT(*) FROM \"InventoryHoldItems\" WHERE \"InventoryHoldId\" = @id",
            ("id", ActiveMultiRoomHoldId)));
    }

    [Fact]
    public async Task Downgrade_fails_and_preserves_all_normalized_data_when_a_hold_spans_more_than_one_rate_plan_across_stay_dates()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V6Migration);
        await SeedRepresentativeLegacyDataAsync();
        await GetMigrator(context).MigrateAsync(V7Migration);

        await using (var connection = new NpgsqlConnection(_connectionString))
        {
            await connection.OpenAsync();
            await using var insertOtherRatePlan = connection.CreateCommand();
            insertOtherRatePlan.CommandText =
                """
                INSERT INTO "RatePlans" ("Id","PropertyId","Code","Name","Description","CurrencyCode","IsActive","CreatedAt","UpdatedAt")
                VALUES (@otherRatePlanId, @propertyId, 'OTHERRP','Other Rate Plan',NULL,'VND',true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z')
                """;
            insertOtherRatePlan.Parameters.AddWithValue("otherRatePlanId", OtherRatePlanId);
            insertOtherRatePlan.Parameters.AddWithValue("propertyId", PropertyId);
            await insertOtherRatePlan.ExecuteNonQueryAsync();

            // Every Item keeps the same RoomType (RoomType guard still passes) and
            // every Item on the second stay date shares the same new RatePlan (the
            // old per-(Hold, StayDate) guard would see uniformity within each night
            // and miss this entirely). Only the aggregate-wide check catches it.
            await using var corrupt = connection.CreateCommand();
            corrupt.CommandText =
                """
                UPDATE "InventoryHoldItemNights" SET "RatePlanId" = @otherRatePlanId
                WHERE "InventoryHoldItemId" IN (
                    SELECT "Id" FROM "InventoryHoldItems" WHERE "InventoryHoldId" = @holdId
                )
                AND "StayDate" = '2026-08-11'
                """;
            corrupt.Parameters.AddWithValue("otherRatePlanId", OtherRatePlanId);
            corrupt.Parameters.AddWithValue("holdId", ActiveMultiRoomHoldId);
            await corrupt.ExecuteNonQueryAsync();
        }

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => GetMigrator(context).MigrateAsync(V6Migration));
        Assert.Equal("P0001", exception.SqlState);
        Assert.Contains(
            "span more than one RatePlan across their Items/nights",
            exception.MessageText,
            StringComparison.Ordinal);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, migration => migration.EndsWith("_CommercialCommitmentV2Foundation"));

        await using var verify = new NpgsqlConnection(_connectionString);
        await verify.OpenAsync();
        Assert.Equal(3, await ScalarAsync<long>(
            verify,
            "SELECT COUNT(*) FROM \"InventoryHoldItems\" WHERE \"InventoryHoldId\" = @id",
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(6, await ScalarAsync<long>(
            verify,
            """
            SELECT COUNT(*) FROM "InventoryHoldItemNights" ihn
            JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
            WHERE ihi."InventoryHoldId" = @id
            """,
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(RatePlanId, await ScalarAsync<Guid>(
            verify,
            """
            SELECT DISTINCT ihn."RatePlanId" FROM "InventoryHoldItemNights" ihn
            JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
            WHERE ihi."InventoryHoldId" = @id AND ihn."StayDate" = '2026-08-10'
            """,
            ("id", ActiveMultiRoomHoldId)));
        Assert.Equal(OtherRatePlanId, await ScalarAsync<Guid>(
            verify,
            """
            SELECT DISTINCT ihn."RatePlanId" FROM "InventoryHoldItemNights" ihn
            JOIN "InventoryHoldItems" ihi ON ihi."Id" = ihn."InventoryHoldItemId"
            WHERE ihi."InventoryHoldId" = @id AND ihn."StayDate" = '2026-08-11'
            """,
            ("id", ActiveMultiRoomHoldId)));
    }

    [Fact]
    public async Task Downgrade_fails_and_preserves_all_normalized_data_when_a_reservation_spans_more_than_one_rate_plan_across_stay_dates()
    {
        await using var context = CreateContext();
        await GetMigrator(context).MigrateAsync(V6Migration);
        await SeedRepresentativeLegacyDataAsync();
        await GetMigrator(context).MigrateAsync(V7Migration);

        await using (var connection = new NpgsqlConnection(_connectionString))
        {
            await connection.OpenAsync();
            await using var insertOtherRatePlan = connection.CreateCommand();
            insertOtherRatePlan.CommandText =
                """
                INSERT INTO "RatePlans" ("Id","PropertyId","Code","Name","Description","CurrencyCode","IsActive","CreatedAt","UpdatedAt")
                VALUES (@otherRatePlanId, @propertyId, 'OTHERRP2','Other Rate Plan 2',NULL,'VND',true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z')
                """;
            insertOtherRatePlan.Parameters.AddWithValue("otherRatePlanId", OtherRatePlanId);
            insertOtherRatePlan.Parameters.AddWithValue("propertyId", PropertyId);
            await insertOtherRatePlan.ExecuteNonQueryAsync();

            await using var corrupt = connection.CreateCommand();
            corrupt.CommandText =
                """
                UPDATE "ReservationUnitNights" SET "RatePlanId" = @otherRatePlanId
                WHERE "ReservationUnitId" IN (
                    SELECT "Id" FROM "ReservationUnits" WHERE "ReservationId" = @reservationId
                )
                AND "StayDate" = '2026-08-16'
                """;
            corrupt.Parameters.AddWithValue("otherRatePlanId", OtherRatePlanId);
            corrupt.Parameters.AddWithValue("reservationId", ConfirmedReservationId);
            await corrupt.ExecuteNonQueryAsync();
        }

        var exception = await Assert.ThrowsAsync<PostgresException>(
            () => GetMigrator(context).MigrateAsync(V6Migration));
        Assert.Equal("P0001", exception.SqlState);
        Assert.Contains(
            "span more than one RatePlan across their Units/nights",
            exception.MessageText,
            StringComparison.Ordinal);

        var applied = await context.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, migration => migration.EndsWith("_CommercialCommitmentV2Foundation"));

        await using var verify = new NpgsqlConnection(_connectionString);
        await verify.OpenAsync();
        Assert.Equal(2, await ScalarAsync<long>(
            verify,
            "SELECT COUNT(*) FROM \"ReservationUnits\" WHERE \"ReservationId\" = @id",
            ("id", ConfirmedReservationId)));
        Assert.Equal(RatePlanId, await ScalarAsync<Guid>(
            verify,
            """
            SELECT DISTINCT run."RatePlanId" FROM "ReservationUnitNights" run
            JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
            WHERE ru."ReservationId" = @id AND run."StayDate" = '2026-08-15'
            """,
            ("id", ConfirmedReservationId)));
        Assert.Equal(OtherRatePlanId, await ScalarAsync<Guid>(
            verify,
            """
            SELECT DISTINCT run."RatePlanId" FROM "ReservationUnitNights" run
            JOIN "ReservationUnits" ru ON ru."Id" = run."ReservationUnitId"
            WHERE ru."ReservationId" = @id AND run."StayDate" = '2026-08-16'
            """,
            ("id", ConfirmedReservationId)));
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

    private async Task SeedRepresentativeLegacyDataAsync()
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText =
                $"""
                INSERT INTO "Properties" ("Id","Name","Slug","Description","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
                VALUES ('{PropertyId}','Migration Smoke Property','migration-smoke-property',NULL,'1 Test St','Da Nang','Vietnam','Asia/Ho_Chi_Minh','14:00:00','12:00:00',true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z');

                INSERT INTO "RoomTypes" ("Id","PropertyId","Code","Name","Slug","Description","BaseOccupancy","MaxOccupancy","IsActive","CreatedAt","UpdatedAt")
                VALUES ('{RoomTypeId}','{PropertyId}','DLX','Deluxe','deluxe-migration-smoke',NULL,2,4,true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z');

                INSERT INTO "RatePlans" ("Id","PropertyId","Code","Name","Description","CurrencyCode","IsActive","CreatedAt","UpdatedAt")
                VALUES ('{RatePlanId}','{PropertyId}','STD','Standard',NULL,'VND',true,'2026-07-23T10:00:00Z','2026-07-23T10:00:00Z');

                INSERT INTO "BookingHolds"
                    ("Id","PropertyId","RoomTypeId","RatePlanId","CustomerAccountId","FullName","Email","Phone",
                     "CheckIn","CheckOut","Adults","Children","Rooms","CurrencyCode","TotalAmount","Status",
                     "CreatedAtUtc","ExpiresAtUtc","IdempotencyKeyHash","RequestFingerprint","GuestAccessTokenHash")
                VALUES
                    ('{ActiveMultiRoomHoldId}','{PropertyId}','{RoomTypeId}','{RatePlanId}',
                     NULL,'Guest Active','guest-active@example.com','+84 900 000 001',
                     '2026-08-10','2026-08-12',2,1,3,'VND',3003.00,'Active',
                     '2026-08-23T09:00:00Z','2026-08-23T09:15:00Z',
                     repeat('a',64),repeat('b',64),repeat('c',64));

                INSERT INTO "BookingHoldNights" ("BookingHoldId","StayDate","Rooms","UnitAmount","NightTotal") VALUES
                    ('{ActiveMultiRoomHoldId}','2026-08-10',3,500.00,1500.00),
                    ('{ActiveMultiRoomHoldId}','2026-08-11',3,501.00,1503.00);

                INSERT INTO "BookingHolds"
                    ("Id","PropertyId","RoomTypeId","RatePlanId","CustomerAccountId","FullName","Email","Phone",
                     "CheckIn","CheckOut","Adults","Children","Rooms","CurrencyCode","TotalAmount","Status",
                     "CreatedAtUtc","ExpiresAtUtc","IdempotencyKeyHash","RequestFingerprint","GuestAccessTokenHash")
                VALUES
                    ('{ConfirmedHoldId}','{PropertyId}','{RoomTypeId}','{RatePlanId}',
                     NULL,'Guest Confirmed','guest-confirmed@example.com','+84 900 000 003',
                     '2026-08-15','2026-08-17',2,0,2,'VND',2000.00,'Confirmed',
                     '2026-08-01T00:00:00Z','2026-08-01T00:15:00Z',
                     repeat('f',64),repeat('1',64),repeat('2',64));

                INSERT INTO "BookingHoldNights" ("BookingHoldId","StayDate","Rooms","UnitAmount","NightTotal") VALUES
                    ('{ConfirmedHoldId}','2026-08-15',2,500.00,1000.00),
                    ('{ConfirmedHoldId}','2026-08-16',2,500.00,1000.00);

                INSERT INTO "Reservations"
                    ("Id","ConfirmationNumber","SourceHoldId","PropertyId","RoomTypeId","RatePlanId","CustomerAccountId",
                     "FullName","Email","Phone","CheckIn","CheckOut","Adults","Children","Rooms","CurrencyCode",
                     "TotalAmount","Status","ConfirmedAtUtc","CancelledAtUtc","CancellationReason","GuestAccessTokenHash")
                VALUES
                    ('{ConfirmedReservationId}','BHA-V2MIGRATION-0001','{ConfirmedHoldId}',
                     '{PropertyId}','{RoomTypeId}','{RatePlanId}',NULL,'Guest Confirmed','guest-confirmed@example.com',
                     '+84 900 000 003','2026-08-15','2026-08-17',2,0,2,'VND',2000.00,'Confirmed',
                     '2026-08-01T00:05:00Z',NULL,NULL,repeat('2',64));

                INSERT INTO "ReservationNights" ("ReservationId","StayDate","Rooms","UnitAmount","NightTotal") VALUES
                    ('{ConfirmedReservationId}','2026-08-15',2,500.00,1000.00),
                    ('{ConfirmedReservationId}','2026-08-16',2,500.00,1000.00);

                INSERT INTO "BookingHolds"
                    ("Id","PropertyId","RoomTypeId","RatePlanId","CustomerAccountId","FullName","Email","Phone",
                     "CheckIn","CheckOut","Adults","Children","Rooms","CurrencyCode","TotalAmount","Status",
                     "CreatedAtUtc","ExpiresAtUtc","IdempotencyKeyHash","RequestFingerprint","GuestAccessTokenHash")
                VALUES
                    ('{CancelledSourceHoldId}','{PropertyId}','{RoomTypeId}','{RatePlanId}',
                     NULL,'Guest Cancelled','guest-cancelled@example.com','+84 900 000 004',
                     '2026-08-20','2026-08-21',1,0,1,'VND',600.00,'Confirmed',
                     '2026-08-02T00:00:00Z','2026-08-02T00:15:00Z',
                     repeat('3',64),repeat('4',64),repeat('5',64));

                INSERT INTO "BookingHoldNights" ("BookingHoldId","StayDate","Rooms","UnitAmount","NightTotal") VALUES
                    ('{CancelledSourceHoldId}','2026-08-20',1,600.00,600.00);

                INSERT INTO "Reservations"
                    ("Id","ConfirmationNumber","SourceHoldId","PropertyId","RoomTypeId","RatePlanId","CustomerAccountId",
                     "FullName","Email","Phone","CheckIn","CheckOut","Adults","Children","Rooms","CurrencyCode",
                     "TotalAmount","Status","ConfirmedAtUtc","CancelledAtUtc","CancellationReason","GuestAccessTokenHash")
                VALUES
                    ('{CancelledReservationId}','BHA-V2MIGRATION-0002','{CancelledSourceHoldId}',
                     '{PropertyId}','{RoomTypeId}','{RatePlanId}',NULL,'Guest Cancelled','guest-cancelled@example.com',
                     '+84 900 000 004','2026-08-20','2026-08-21',1,0,1,'VND',600.00,'Cancelled',
                     '2026-08-02T00:05:00Z','2026-08-02T01:00:00Z','Migration smoke cancellation.',repeat('5',64));

                INSERT INTO "ReservationNights" ("ReservationId","StayDate","Rooms","UnitAmount","NightTotal") VALUES
                    ('{CancelledReservationId}','2026-08-20',1,600.00,600.00);
                """;
            await command.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
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
