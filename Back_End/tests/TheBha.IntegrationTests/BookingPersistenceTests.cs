using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class BookingPersistenceTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse(
        "2026-07-23T10:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 8, 10);
    private static readonly DateOnly CheckOut = new(2026, 8, 12);

    [Fact]
    public async Task Guest_and_authenticated_holds_round_trip_complete_snapshots()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: true);
        var guest = CreateHold(references, '1');
        var authenticated = CreateHold(
            references,
            '2',
            references.Customer!.Id);
        context.InventoryHolds.AddRange(guest, authenticated);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var saved = await context.InventoryHolds
            .Include(hold => hold.Items)
            .ThenInclude(item => item.Nights)
            .OrderBy(hold => hold.IdempotencyKeyHash)
            .ToListAsync();

        Assert.Equal(2, saved.Count);
        Assert.Null(saved[0].CustomerAccountId);
        Assert.Equal(Hash('a'), saved[0].GuestAccessTokenHash);
        Assert.Equal(references.Customer.Id, saved[1].CustomerAccountId);
        Assert.Null(saved[1].GuestAccessTokenHash);
        Assert.All(saved, hold =>
        {
            Assert.Equal(BookingHoldStatus.Active, hold.Status);
            Assert.Equal(Now.AddMinutes(15), hold.ExpiresAtUtc);
            Assert.Equal(2, hold.Items.Count);
            Assert.Equal(2, hold.Items.Select(item => item.Id).Distinct().Count());
            Assert.All(hold.Items, item =>
            {
                Assert.Equal(references.RoomType.Id, item.RoomTypeId);
                Assert.Equal(
                    [CheckIn, CheckIn.AddDays(1)],
                    item.Nights.OrderBy(night => night.StayDate).Select(night => night.StayDate));
                Assert.Equal(
                    [100.25m, 100.25m],
                    item.Nights.Select(night => night.UnitAmount));
            });
            Assert.Equal(401.00m, hold.TotalAmount);
        });
    }

    [Fact]
    public async Task Guest_and_authenticated_reservations_round_trip_copied_snapshots()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: true);
        var guestHold = CreateHold(references, '3');
        var authenticatedHold = CreateHold(
            references,
            '4',
            references.Customer!.Id);
        context.InventoryHolds.AddRange(guestHold, authenticatedHold);
        await context.SaveChangesAsync();

        var guest = CreateReservation(
            references,
            guestHold.Id,
            "BHA-GUEST-3001");
        var authenticated = CreateReservation(
            references,
            authenticatedHold.Id,
            "BHA-AUTH-4001",
            references.Customer.Id);
        context.Reservations.AddRange(guest, authenticated);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var saved = await context.Reservations
            .Include(reservation => reservation.Units)
            .ThenInclude(unit => unit.Nights)
            .OrderBy(reservation => reservation.ConfirmationNumber)
            .ToListAsync();

        Assert.Equal(2, saved.Count);
        Assert.Equal(references.Customer.Id, saved[0].CustomerAccountId);
        Assert.Null(saved[0].GuestAccessTokenHash);
        Assert.Null(saved[1].CustomerAccountId);
        Assert.Equal(Hash('a'), saved[1].GuestAccessTokenHash);
        Assert.All(saved, reservation =>
        {
            Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
            Assert.Equal("Booking Guest", reservation.FullName);
            Assert.Equal("booking@example.com", reservation.Email);
            Assert.Equal("+84 912 345 678", reservation.Phone);
            Assert.Equal(2, reservation.Units.Count);
            Assert.All(
                reservation.Units,
                unit =>
                {
                    Assert.Equal(CommitmentStatus.Committed, unit.CommitmentStatus);
                    Assert.Equal(
                        [CheckIn, CheckIn.AddDays(1)],
                        unit.Nights.OrderBy(night => night.StayDate).Select(night => night.StayDate));
                });
            Assert.Equal(401.00m, reservation.TotalAmount);
        });
    }

    [Theory]
    [InlineData("room")]
    [InlineData("rate")]
    public async Task Same_property_room_type_and_rate_plan_are_enforced(string invalidPart)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var first = AddReferences(context, includeCustomer: false, suffix: "first");
        var second = AddReferences(context, includeCustomer: false, suffix: "second");
        await context.SaveChangesAsync();
        var hold = CreateHold(
            first,
            '5',
            roomTypeId: invalidPart == "room" ? second.RoomType.Id : first.RoomType.Id,
            ratePlanId: invalidPart == "rate" ? second.RatePlan.Id : first.RatePlan.Id);
        context.InventoryHolds.Add(hold);

        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Nullable_customer_linkage_and_restrictive_history_deletes_are_enforced()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: true);
        var hold = CreateHold(references, '6', references.Customer!.Id);
        context.InventoryHolds.Add(hold);
        await context.SaveChangesAsync();

        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM \"AspNetUsers\" WHERE \"Id\" = {references.Customer.Id}"),
            PostgresErrorCodes.ForeignKeyViolation);
        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM \"RoomTypes\" WHERE \"Id\" = {references.RoomType.Id}"),
            PostgresErrorCodes.ForeignKeyViolation);
        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM \"RatePlans\" WHERE \"Id\" = {references.RatePlan.Id}"),
            PostgresErrorCodes.ForeignKeyViolation);
        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM \"Properties\" WHERE \"Id\" = {references.Property.Id}"),
            PostgresErrorCodes.ForeignKeyViolation);

        var reservation = CreateReservation(
            references,
            hold.Id,
            "BHA-RESTRICT-0001",
            references.Customer.Id);
        context.Reservations.Add(reservation);
        await context.SaveChangesAsync();
        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM \"InventoryHolds\" WHERE \"Id\" = {hold.Id}"),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Aggregate_deletion_cascades_only_to_its_items_and_nights()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        var hold = CreateHold(references, '7');
        context.InventoryHolds.Add(hold);
        await context.SaveChangesAsync();

        context.InventoryHolds.Remove(hold);
        await context.SaveChangesAsync();

        Assert.Empty(await context.InventoryHoldItems.ToListAsync());
        Assert.Empty(await context.InventoryHoldItemNights.ToListAsync());
        Assert.Equal(1, await context.Properties.CountAsync());
        Assert.Equal(1, await context.RoomTypes.CountAsync());
        Assert.Equal(1, await context.RatePlans.CountAsync());
    }

    [Fact]
    public async Task PostgreSql_enforces_hold_and_reservation_uniqueness()
    {
        await factory.ResetDatabaseAsync();
        ReferenceData references;
        InventoryHold firstHold;
        InventoryHold secondHold;
        await using (var setup = factory.CreateDbContext())
        {
            references = AddReferences(setup, includeCustomer: false);
            firstHold = CreateHold(references, '8');
            secondHold = CreateHold(references, '9');
            setup.InventoryHolds.AddRange(firstHold, secondHold);
            await setup.SaveChangesAsync();
            setup.Reservations.Add(CreateReservation(
                references,
                firstHold.Id,
                "BHA-UNIQUE-0001"));
            await setup.SaveChangesAsync();
        }

        await using (var duplicateIdempotency = factory.CreateDbContext())
        {
            duplicateIdempotency.InventoryHolds.Add(
                CreateHold(references, '8', fingerprintCharacter: 'e'));
            await AssertDatabaseErrorAsync(
                () => duplicateIdempotency.SaveChangesAsync(),
                PostgresErrorCodes.UniqueViolation);
        }

        await using (var duplicateSource = factory.CreateDbContext())
        {
            duplicateSource.Reservations.Add(CreateReservation(
                references,
                firstHold.Id,
                "BHA-UNIQUE-0002"));
            await AssertDatabaseErrorAsync(
                () => duplicateSource.SaveChangesAsync(),
                PostgresErrorCodes.UniqueViolation);
        }

        await using (var duplicateConfirmation = factory.CreateDbContext())
        {
            duplicateConfirmation.Reservations.Add(CreateReservation(
                references,
                secondHold.Id,
                "BHA-UNIQUE-0001"));
            await AssertDatabaseErrorAsync(
                () => duplicateConfirmation.SaveChangesAsync(),
                PostgresErrorCodes.UniqueViolation);
        }

        await using var raw = factory.CreateDbContext();
        var firstItem = await raw.InventoryHoldItems
            .Where(item => item.InventoryHoldId == firstHold.Id)
            .Select(item => new { item.Id, item.PropertyId })
            .FirstAsync();
        await AssertPostgresErrorAsync(
            () => raw.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "InventoryHoldItemNights"
                    ("InventoryHoldItemId", "PropertyId", "StayDate", "RatePlanId", "UnitAmount")
                VALUES ({firstItem.Id}, {firstItem.PropertyId}, {CheckIn}, {references.RatePlan.Id}, 100.25)
                """),
            PostgresErrorCodes.UniqueViolation);

        var firstUnit = await raw.ReservationUnits
            .Where(unit => unit.ReservationId ==
                raw.Reservations.Where(r => r.SourceHoldId == firstHold.Id).Select(r => r.Id).First())
            .Select(unit => new { unit.Id, unit.PropertyId, unit.SourceInventoryHoldItemId })
            .FirstAsync();
        await AssertPostgresErrorAsync(
            () => raw.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "ReservationUnitNights"
                    ("ReservationUnitId", "PropertyId", "StayDate", "RatePlanId", "UnitAmount")
                VALUES ({firstUnit.Id}, {firstUnit.PropertyId}, {CheckIn}, {references.RatePlan.Id}, 100.25)
                """),
            PostgresErrorCodes.UniqueViolation);

        // Invariant #9 (ADR 0005): each source Item creates at most one Unit. Link one
        // real Unit to firstItem, then attempt a second Unit claiming the same source.
        var reservationForUnitTest = await raw.Reservations.Select(r => r.Id).FirstAsync();
        await raw.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "ReservationUnits"
                ("Id", "ReservationId", "PropertyId", "RoomTypeId", "SourceInventoryHoldItemId",
                 "CommitmentStatus")
            VALUES ({Guid.NewGuid()}, {reservationForUnitTest}, {firstItem.PropertyId},
                    {references.RoomType.Id}, {firstItem.Id}, 'Committed')
            """);
        await AssertPostgresErrorAsync(
            () => raw.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "ReservationUnits"
                    ("Id", "ReservationId", "PropertyId", "RoomTypeId", "SourceInventoryHoldItemId",
                     "CommitmentStatus")
                VALUES ({Guid.NewGuid()}, {reservationForUnitTest}, {firstItem.PropertyId},
                        {references.RoomType.Id}, {firstItem.Id}, 'Committed')
                """),
            PostgresErrorCodes.UniqueViolation);
    }

    [Theory]
    [InlineData("source")]
    [InlineData("customer")]
    [InlineData("room")]
    [InlineData("rate")]
    public async Task Reservation_relationships_are_enforced(string invalidPart)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var first = AddReferences(context, includeCustomer: true, suffix: "reservation-first");
        var second = AddReferences(context, includeCustomer: false, suffix: "reservation-second");
        var hold = CreateHold(first, 'a', first.Customer!.Id);
        context.InventoryHolds.Add(hold);
        await context.SaveChangesAsync();
        var reservation = CreateReservation(
            first,
            invalidPart == "source" ? Guid.NewGuid() : hold.Id,
            $"BHA-FK-{invalidPart.ToUpperInvariant()}",
            invalidPart == "customer" ? Guid.NewGuid() : first.Customer.Id,
            invalidPart == "room" ? second.RoomType.Id : first.RoomType.Id,
            invalidPart == "rate" ? second.RatePlan.Id : first.RatePlan.Id);
        context.Reservations.Add(reservation);

        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    public static IEnumerable<object[]> InvalidHoldUpdates()
    {
        yield return ["UPDATE \"InventoryHolds\" SET \"Adults\" = 0"];
        yield return ["UPDATE \"InventoryHolds\" SET \"Children\" = -1"];
        yield return ["UPDATE \"InventoryHolds\" SET \"CheckOut\" = \"CheckIn\""];
        yield return ["UPDATE \"InventoryHolds\" SET \"CurrencyCode\" = 'VN1'"];
        yield return ["UPDATE \"InventoryHolds\" SET \"TotalAmount\" = 0"];
        yield return ["UPDATE \"InventoryHolds\" SET \"Status\" = 'Unknown'"];
        yield return ["UPDATE \"InventoryHolds\" SET \"ExpiresAtUtc\" = \"CreatedAtUtc\" + INTERVAL '16 minutes'"];
        yield return ["UPDATE \"InventoryHolds\" SET \"IdempotencyKeyHash\" = 'short'"];
        yield return ["UPDATE \"InventoryHolds\" SET \"GuestAccessTokenHash\" = NULL"];
        yield return ["UPDATE \"InventoryHolds\" SET \"FullName\" = '  '"];
    }

    [Theory]
    [MemberData(nameof(InvalidHoldUpdates))]
    public async Task PostgreSql_rejects_invalid_hold_rows(string updateSql)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        context.InventoryHolds.Add(CreateHold(references, 'b'));
        await context.SaveChangesAsync();

        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlRawAsync(updateSql),
            PostgresErrorCodes.CheckViolation);
    }

    public static IEnumerable<object[]> InvalidReservationUpdates()
    {
        yield return ["UPDATE \"Reservations\" SET \"Adults\" = 0"];
        yield return ["UPDATE \"Reservations\" SET \"CheckOut\" = \"CheckIn\""];
        yield return ["UPDATE \"Reservations\" SET \"CurrencyCode\" = '1ND'"];
        yield return ["UPDATE \"Reservations\" SET \"TotalAmount\" = -1"];
        yield return ["UPDATE \"Reservations\" SET \"Status\" = 'Unknown'"];
        yield return ["UPDATE \"Reservations\" SET \"ConfirmationNumber\" = 'bad/value'"];
        yield return ["UPDATE \"Reservations\" SET \"GuestAccessTokenHash\" = NULL"];
        yield return ["UPDATE \"Reservations\" SET \"Status\" = 'Cancelled'"];
        yield return ["UPDATE \"Reservations\" SET \"CancelledAtUtc\" = \"ConfirmedAtUtc\""];
    }

    [Theory]
    [MemberData(nameof(InvalidReservationUpdates))]
    public async Task PostgreSql_rejects_invalid_reservation_rows(string updateSql)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        var hold = CreateHold(references, 'c');
        context.InventoryHolds.Add(hold);
        await context.SaveChangesAsync();
        context.Reservations.Add(CreateReservation(
            references,
            hold.Id,
            "BHA-CHECK-0001"));
        await context.SaveChangesAsync();

        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlRawAsync(updateSql),
            PostgresErrorCodes.CheckViolation);
    }

    public static IEnumerable<object[]> InvalidReservationUnitUpdates()
    {
        yield return ["UPDATE \"ReservationUnits\" SET \"CommitmentStatus\" = 'Unknown'"];
    }

    [Theory]
    [MemberData(nameof(InvalidReservationUnitUpdates))]
    public async Task PostgreSql_rejects_invalid_reservation_unit_rows(string updateSql)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        var hold = CreateHold(references, '6');
        context.InventoryHolds.Add(hold);
        await context.SaveChangesAsync();
        context.Reservations.Add(CreateReservation(
            references,
            hold.Id,
            "BHA-UNIT-CHECK-0001"));
        await context.SaveChangesAsync();

        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlRawAsync(updateSql),
            PostgresErrorCodes.CheckViolation);
    }

    [Theory]
    [InlineData("hold-amount")]
    [InlineData("reservation-amount")]
    public async Task PostgreSql_rejects_invalid_night_rows(string invalidPart)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        var hold = CreateHold(references, 'd');
        context.InventoryHolds.Add(hold);
        await context.SaveChangesAsync();
        var reservation = CreateReservation(
            references,
            hold.Id,
            "BHA-NIGHT-0001");
        context.Reservations.Add(reservation);
        await context.SaveChangesAsync();

        var sql = invalidPart == "hold-amount"
            ? "UPDATE \"InventoryHoldItemNights\" SET \"UnitAmount\" = 0"
            : "UPDATE \"ReservationUnitNights\" SET \"UnitAmount\" = 0";
        await AssertPostgresErrorAsync(
            () => context.Database.ExecuteSqlRawAsync(sql),
            PostgresErrorCodes.CheckViolation);
    }

    [Fact]
    public async Task PostgreSql_schema_uses_locked_types_relationships_constraints_and_indexes()
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();

        var columns = new Dictionary<string, ColumnMetadata>(StringComparer.Ordinal);
        await using (var command = new NpgsqlCommand(
            """
            SELECT table_name, column_name, data_type, numeric_precision, numeric_scale,
                   character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN
                  ('InventoryHolds', 'InventoryHoldItems', 'InventoryHoldItemNights',
                   'Reservations', 'ReservationUnits', 'ReservationUnitNights')
              AND column_name IN
                  ('CheckIn', 'CheckOut', 'StayDate', 'TotalAmount', 'UnitAmount',
                   'CreatedAtUtc', 'ExpiresAtUtc', 'ConfirmedAtUtc',
                   'CancelledAtUtc', 'IdempotencyKeyHash', 'RequestFingerprint',
                   'GuestAccessTokenHash', 'CommitmentStatus')
            ORDER BY table_name, column_name;
            """,
            connection))
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns.Add(
                    $"{reader.GetString(0)}.{reader.GetString(1)}",
                    new ColumnMetadata(
                        reader.GetString(2),
                        reader.IsDBNull(3) ? null : reader.GetInt32(3),
                        reader.IsDBNull(4) ? null : reader.GetInt32(4),
                        reader.IsDBNull(5) ? null : reader.GetInt32(5)));
            }
        }

        Assert.Equal("date", columns["InventoryHolds.CheckIn"].DataType);
        Assert.Equal("date", columns["InventoryHoldItemNights.StayDate"].DataType);
        Assert.Equal(
            new ColumnMetadata("numeric", 18, 2, null),
            columns["InventoryHolds.TotalAmount"]);
        Assert.Equal(
            new ColumnMetadata("numeric", 18, 2, null),
            columns["ReservationUnitNights.UnitAmount"]);
        Assert.Equal(
            "timestamp with time zone",
            columns["InventoryHolds.CreatedAtUtc"].DataType);
        Assert.Equal(
            "timestamp with time zone",
            columns["Reservations.CancelledAtUtc"].DataType);
        Assert.Equal(
            new ColumnMetadata("character", null, null, 64),
            columns["InventoryHolds.IdempotencyKeyHash"]);
        Assert.Equal(
            new ColumnMetadata("character", null, null, 64),
            columns["Reservations.GuestAccessTokenHash"]);
        Assert.Equal("character varying", columns["ReservationUnits.CommitmentStatus"].DataType);

        var foreignKeys = await ReadNameCodeMapAsync(
            connection,
            """
            SELECT conname, confdeltype::text
            FROM pg_constraint
            WHERE contype = 'f'
              AND conrelid IN
                  ('"InventoryHolds"'::regclass, '"InventoryHoldItems"'::regclass,
                   '"InventoryHoldItemNights"'::regclass, '"Reservations"'::regclass,
                   '"ReservationUnits"'::regclass, '"ReservationUnitNights"'::regclass)
            ORDER BY conname;
            """);
        Assert.Equal("r", foreignKeys["FK_InventoryHolds_AspNetUsers_CustomerAccountId"]);
        Assert.Equal("r", foreignKeys["FK_InventoryHoldItems_RoomTypes_PropertyId_RoomTypeId"]);
        Assert.Equal("r", foreignKeys["FK_InventoryHoldItemNights_RatePlans_PropertyId_RatePlanId"]);
        Assert.Equal("r", foreignKeys["FK_ReservationUnits_RoomTypes_PropertyId_RoomTypeId"]);
        Assert.Equal("r", foreignKeys["FK_ReservationUnitNights_RatePlans_PropertyId_RatePlanId"]);
        Assert.Equal("r", foreignKeys["FK_Reservations_AspNetUsers_CustomerAccountId"]);
        Assert.Equal("c", foreignKeys["FK_InventoryHoldItems_InventoryHolds_PropertyId_InventoryHoldId"]);
        // PostgreSQL truncates identifiers over 63 bytes; EF appends "~" to the
        // truncated name (verified against the scaffolded migration).
        Assert.Equal(
            "c",
            foreignKeys["FK_InventoryHoldItemNights_InventoryHoldItems_PropertyId_Inven~"]);
        Assert.Equal("c", foreignKeys["FK_ReservationUnits_Reservations_PropertyId_ReservationId"]);
        Assert.Equal(
            "c",
            foreignKeys["FK_ReservationUnitNights_ReservationUnits_PropertyId_Reservati~"]);
        Assert.Equal(
            "r",
            foreignKeys["FK_ReservationUnits_InventoryHoldItems_PropertyId_SourceInvent~"]);

        var indexes = await ReadNamesAsync(
            connection,
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename IN
                  ('InventoryHolds', 'InventoryHoldItems', 'InventoryHoldItemNights',
                   'Reservations', 'ReservationUnits', 'ReservationUnitNights');
            """);
        Assert.Contains("IX_InventoryHolds_IdempotencyKeyHash", indexes);
        Assert.Contains("IX_InventoryHoldItemNights_StayDate_InventoryHoldItemId", indexes);
        Assert.Contains("IX_Reservations_SourceHoldId", indexes);
        Assert.Contains("IX_Reservations_ConfirmationNumber", indexes);
        Assert.Contains("IX_ReservationUnits_SourceInventoryHoldItemId", indexes);
        Assert.Contains("IX_ReservationUnitNights_StayDate_ReservationUnitId", indexes);

        var checks = await ReadNamesAsync(
            connection,
            """
            SELECT conname
            FROM pg_constraint
            WHERE contype = 'c'
              AND conrelid IN
                  ('"InventoryHolds"'::regclass, '"InventoryHoldItems"'::regclass,
                   '"InventoryHoldItemNights"'::regclass, '"Reservations"'::regclass,
                   '"ReservationUnits"'::regclass, '"ReservationUnitNights"'::regclass);
            """);
        Assert.Contains("CK_InventoryHolds_FixedLifetime", checks);
        Assert.Contains("CK_InventoryHolds_Ownership", checks);
        Assert.Contains("CK_InventoryHolds_Hashes", checks);
        Assert.Contains("CK_InventoryHoldItemNights_Amount", checks);
        Assert.Contains("CK_Reservations_Cancellation", checks);
        Assert.Contains("CK_Reservations_Ownership", checks);
        Assert.Contains("CK_ReservationUnitNights_Amount", checks);
        Assert.Contains("CK_ReservationUnits_CommitmentStatus", checks);
    }

    [Fact]
    public async Task Development_seed_creates_no_transactional_booking_rows()
    {
        await factory.ResetDatabaseAsync();
        await using var scope = factory.Services.CreateAsyncScope();
        var seeder = scope.ServiceProvider.GetRequiredService<DevelopmentDataSeeder>();

        await seeder.SeedAsync(CancellationToken.None);

        await using var context = factory.CreateDbContext();
        Assert.Equal(0, await context.InventoryHolds.CountAsync());
        Assert.Equal(0, await context.InventoryHoldItems.CountAsync());
        Assert.Equal(0, await context.InventoryHoldItemNights.CountAsync());
        Assert.Equal(0, await context.Reservations.CountAsync());
        Assert.Equal(0, await context.ReservationUnits.CountAsync());
        Assert.Equal(0, await context.ReservationUnitNights.CountAsync());
    }

    [Fact]
    public async Task OpenApi_exposes_only_the_approved_hold_and_reservation_lifecycle_paths()
    {
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/swagger/v1/swagger.json");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var payload = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(payload);

        var paths = document.RootElement.GetProperty("paths");
        var holdPath = paths.GetProperty("/api/v1/booking-holds");
        Assert.True(holdPath.TryGetProperty("post", out _));

        var reservationRelatedPaths = paths.EnumerateObject()
            .Where(path => path.Name.Contains("reservation", StringComparison.OrdinalIgnoreCase) ||
                path.Name.Contains("confirm", StringComparison.OrdinalIgnoreCase) ||
                (path.Name.StartsWith("/api/v1/booking-holds/", StringComparison.Ordinal) &&
                    path.Name.Contains("holdId", StringComparison.Ordinal)))
            .Select(path => path.Name)
            .Order()
            .ToArray();
        Assert.Equal(
            new[]
            {
                "/api/admin/v1/properties/{propertyId}/reservation-board",
                "/api/v1/booking-holds/{holdId}",
                "/api/v1/booking-holds/{holdId}/cancel",
                "/api/v1/booking-holds/{holdId}/confirm",
                "/api/v1/reservations/{reservationId}",
                "/api/v1/reservations/{reservationId}/cancel"
            }.Order(),
            reservationRelatedPaths);
        Assert.True(paths.GetProperty("/api/admin/v1/properties/{propertyId}/reservation-board")
            .TryGetProperty("get", out _));
        Assert.False(paths.GetProperty("/api/admin/v1/properties/{propertyId}/reservation-board")
            .TryGetProperty("post", out _));
        Assert.True(paths.GetProperty("/api/v1/booking-holds/{holdId}")
            .TryGetProperty("get", out _));
        Assert.True(paths.GetProperty("/api/v1/booking-holds/{holdId}/cancel")
            .TryGetProperty("post", out _));
        Assert.True(paths.GetProperty("/api/v1/booking-holds/{holdId}/confirm")
            .TryGetProperty("post", out _));
        Assert.True(paths.GetProperty("/api/v1/reservations/{reservationId}")
            .TryGetProperty("get", out _));
        Assert.True(paths.GetProperty("/api/v1/reservations/{reservationId}/cancel")
            .TryGetProperty("post", out _));
        Assert.False(paths.GetProperty("/api/v1/reservations/{reservationId}")
            .TryGetProperty("delete", out _));
        Assert.False(paths.GetProperty("/api/v1/booking-holds/{holdId}")
            .TryGetProperty("delete", out _));
    }

    private static ReferenceData AddReferences(
        TheBhaDbContext context,
        bool includeCustomer,
        string suffix = "booking")
    {
        var property = new Property(
            Guid.NewGuid(),
            $"Hotel {suffix}",
            $"hotel-{suffix}-{Guid.NewGuid():N}",
            null,
            "1 Hotel Street",
            "Ho Chi Minh City",
            "Vietnam",
            "Asia/Ho_Chi_Minh",
            new TimeOnly(14, 0),
            new TimeOnly(12, 0),
            true,
            Now);
        var roomType = new RoomType(
            Guid.NewGuid(),
            property.Id,
            $"ROOM-{suffix}",
            $"Room {suffix}",
            $"room-{suffix}-{Guid.NewGuid():N}",
            null,
            2,
            4,
            true,
            Now);
        var ratePlan = new RatePlan(
            Guid.NewGuid(),
            property.Id,
            $"RATE-{suffix}",
            $"Rate {suffix}",
            null,
            "VND",
            true,
            Now);
        CustomerAccount? customer = null;
        if (includeCustomer)
        {
            customer = new CustomerAccount
            {
                Id = Guid.NewGuid(),
                Email = $"{suffix}@example.com",
                NormalizedEmail = $"{suffix}@example.com".ToUpperInvariant(),
                UserName = $"{suffix}@example.com",
                NormalizedUserName = $"{suffix}@example.com".ToUpperInvariant(),
                SecurityStamp = Guid.NewGuid().ToString(),
                ConcurrencyStamp = Guid.NewGuid().ToString()
            };
            context.CustomerAccounts.Add(customer);
        }

        context.AddRange(property, roomType, ratePlan);
        return new ReferenceData(property, roomType, ratePlan, customer);
    }

    private static InventoryHold CreateHold(
        ReferenceData references,
        char hashCharacter,
        Guid? customerAccountId = null,
        Guid? roomTypeId = null,
        Guid? ratePlanId = null,
        char fingerprintCharacter = 'f')
    {
        return new InventoryHold(
            Guid.NewGuid(),
            references.Property.Id,
            roomTypeId ?? references.RoomType.Id,
            2,
            customerAccountId,
            "Booking Guest",
            "booking@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            "VND",
            Now,
            Hash(hashCharacter),
            Hash(fingerprintCharacter),
            customerAccountId.HasValue ? null : Hash('a'),
            ValidNightPlan(ratePlanId ?? references.RatePlan.Id));
    }

    private static Reservation CreateReservation(
        ReferenceData references,
        Guid sourceHoldId,
        string confirmationNumber,
        Guid? customerAccountId = null,
        Guid? roomTypeId = null,
        Guid? ratePlanId = null)
    {
        var nights = ValidNightPlan(ratePlanId ?? references.RatePlan.Id);
        var resolvedRoomTypeId = roomTypeId ?? references.RoomType.Id;
        // No source InventoryHoldItem is created by these persistence-focused
        // fixtures, so SourceInventoryHoldItemId stays null (the FK is nullable
        // precisely for this — ADR 0005 item 3 — and MATCH SIMPLE bypasses the
        // composite FK check when null).
        var unitPlans = new[]
        {
            new ReservationUnitPlan(null, resolvedRoomTypeId, nights),
            new ReservationUnitPlan(null, resolvedRoomTypeId, nights)
        };
        return new Reservation(
            Guid.NewGuid(),
            confirmationNumber,
            sourceHoldId,
            references.Property.Id,
            customerAccountId,
            "Booking Guest",
            "booking@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            "VND",
            ReservationStatus.Confirmed,
            Now.AddMinutes(5),
            null,
            null,
            customerAccountId.HasValue ? null : Hash('a'),
            unitPlans);
    }

    private static NightlyCommitmentSnapshot[] ValidNightPlan(Guid ratePlanId) =>
    [
        new(CheckIn, ratePlanId, 100.25m),
        new(CheckIn.AddDays(1), ratePlanId, 100.25m)
    ];

    private static string Hash(char character) =>
        new(character, BookingFieldLimits.Sha256Hash);

    private static async Task<HashSet<string>> ReadNamesAsync(
        NpgsqlConnection connection,
        string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var names = new HashSet<string>(StringComparer.Ordinal);
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    private static async Task<Dictionary<string, string>> ReadNameCodeMapAsync(
        NpgsqlConnection connection,
        string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        while (await reader.ReadAsync())
        {
            values.Add(reader.GetString(0), reader.GetString(1));
        }

        return values;
    }

    private static async Task AssertDatabaseErrorAsync(
        Func<Task> action,
        string sqlState)
    {
        var exception = await Assert.ThrowsAsync<DbUpdateException>(action);
        var postgresException = Assert.IsType<PostgresException>(exception.InnerException);
        Assert.Equal(sqlState, postgresException.SqlState);
    }

    private static async Task AssertPostgresErrorAsync(
        Func<Task> action,
        string sqlState)
    {
        var exception = await Assert.ThrowsAsync<PostgresException>(action);
        Assert.Equal(sqlState, exception.SqlState);
    }

    private sealed record ReferenceData(
        Property Property,
        RoomType RoomType,
        RatePlan RatePlan,
        CustomerAccount? Customer);

    private sealed record ColumnMetadata(
        string DataType,
        int? NumericPrecision,
        int? NumericScale,
        int? CharacterMaximumLength);
}
