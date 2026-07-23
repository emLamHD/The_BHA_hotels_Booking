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
        context.BookingHolds.AddRange(guest, authenticated);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var saved = await context.BookingHolds
            .Include(hold => hold.Nights)
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
            Assert.Equal([CheckIn, CheckIn.AddDays(1)], hold.Nights.Select(night => night.StayDate));
            Assert.Equal([200.50m, 200.50m], hold.Nights.Select(night => night.NightTotal));
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
        context.BookingHolds.AddRange(guestHold, authenticatedHold);
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
            .Include(reservation => reservation.Nights)
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
            Assert.Equal([CheckIn, CheckIn.AddDays(1)], reservation.Nights.Select(night => night.StayDate));
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
        context.BookingHolds.Add(hold);

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
        context.BookingHolds.Add(hold);
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
                $"DELETE FROM \"BookingHolds\" WHERE \"Id\" = {hold.Id}"),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Aggregate_deletion_cascades_only_to_its_nights()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        var hold = CreateHold(references, '7');
        context.BookingHolds.Add(hold);
        await context.SaveChangesAsync();

        context.BookingHolds.Remove(hold);
        await context.SaveChangesAsync();

        Assert.Empty(await context.BookingHoldNights.ToListAsync());
        Assert.Equal(1, await context.Properties.CountAsync());
        Assert.Equal(1, await context.RoomTypes.CountAsync());
        Assert.Equal(1, await context.RatePlans.CountAsync());
    }

    [Fact]
    public async Task PostgreSql_enforces_hold_and_reservation_uniqueness()
    {
        await factory.ResetDatabaseAsync();
        ReferenceData references;
        BookingHold firstHold;
        BookingHold secondHold;
        await using (var setup = factory.CreateDbContext())
        {
            references = AddReferences(setup, includeCustomer: false);
            firstHold = CreateHold(references, '8');
            secondHold = CreateHold(references, '9');
            setup.BookingHolds.AddRange(firstHold, secondHold);
            await setup.SaveChangesAsync();
            setup.Reservations.Add(CreateReservation(
                references,
                firstHold.Id,
                "BHA-UNIQUE-0001"));
            await setup.SaveChangesAsync();
        }

        await using (var duplicateIdempotency = factory.CreateDbContext())
        {
            duplicateIdempotency.BookingHolds.Add(
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
        await AssertPostgresErrorAsync(
            () => raw.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "BookingHoldNights"
                    ("BookingHoldId", "StayDate", "Rooms", "UnitAmount", "NightTotal")
                VALUES ({firstHold.Id}, {CheckIn}, 2, 100.25, 200.50)
                """),
            PostgresErrorCodes.UniqueViolation);
        var reservationId = await raw.Reservations
            .Where(reservation => reservation.SourceHoldId == firstHold.Id)
            .Select(reservation => reservation.Id)
            .SingleAsync();
        await AssertPostgresErrorAsync(
            () => raw.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "ReservationNights"
                    ("ReservationId", "StayDate", "Rooms", "UnitAmount", "NightTotal")
                VALUES ({reservationId}, {CheckIn}, 2, 100.25, 200.50)
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
        context.BookingHolds.Add(hold);
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
        yield return ["UPDATE \"BookingHolds\" SET \"Adults\" = 0"];
        yield return ["UPDATE \"BookingHolds\" SET \"Children\" = -1"];
        yield return ["UPDATE \"BookingHolds\" SET \"Rooms\" = 0"];
        yield return ["UPDATE \"BookingHolds\" SET \"CheckOut\" = \"CheckIn\""];
        yield return ["UPDATE \"BookingHolds\" SET \"CurrencyCode\" = 'VN1'"];
        yield return ["UPDATE \"BookingHolds\" SET \"TotalAmount\" = 0"];
        yield return ["UPDATE \"BookingHolds\" SET \"Status\" = 'Unknown'"];
        yield return ["UPDATE \"BookingHolds\" SET \"ExpiresAtUtc\" = \"CreatedAtUtc\" + INTERVAL '16 minutes'"];
        yield return ["UPDATE \"BookingHolds\" SET \"IdempotencyKeyHash\" = 'short'"];
        yield return ["UPDATE \"BookingHolds\" SET \"GuestAccessTokenHash\" = NULL"];
        yield return ["UPDATE \"BookingHolds\" SET \"FullName\" = '  '"];
    }

    [Theory]
    [MemberData(nameof(InvalidHoldUpdates))]
    public async Task PostgreSql_rejects_invalid_hold_rows(string updateSql)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        context.BookingHolds.Add(CreateHold(references, 'b'));
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
        context.BookingHolds.Add(hold);
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

    [Theory]
    [InlineData("hold-rooms")]
    [InlineData("hold-amount")]
    [InlineData("reservation-rooms")]
    [InlineData("reservation-amount")]
    public async Task PostgreSql_rejects_invalid_night_rows(string invalidPart)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var references = AddReferences(context, includeCustomer: false);
        var hold = CreateHold(references, 'd');
        context.BookingHolds.Add(hold);
        await context.SaveChangesAsync();
        var reservation = CreateReservation(
            references,
            hold.Id,
            "BHA-NIGHT-0001");
        context.Reservations.Add(reservation);
        await context.SaveChangesAsync();

        var sql = invalidPart switch
        {
            "hold-rooms" =>
                "UPDATE \"BookingHoldNights\" SET \"Rooms\" = 0",
            "hold-amount" =>
                "UPDATE \"BookingHoldNights\" SET \"NightTotal\" = \"UnitAmount\"",
            "reservation-rooms" =>
                "UPDATE \"ReservationNights\" SET \"Rooms\" = 0",
            _ =>
                "UPDATE \"ReservationNights\" SET \"NightTotal\" = \"UnitAmount\""
        };
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
                  ('BookingHolds', 'BookingHoldNights', 'Reservations', 'ReservationNights')
              AND column_name IN
                  ('CheckIn', 'CheckOut', 'StayDate', 'TotalAmount', 'UnitAmount',
                   'NightTotal', 'CreatedAtUtc', 'ExpiresAtUtc', 'ConfirmedAtUtc',
                   'CancelledAtUtc', 'IdempotencyKeyHash', 'RequestFingerprint',
                   'GuestAccessTokenHash')
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

        Assert.Equal("date", columns["BookingHolds.CheckIn"].DataType);
        Assert.Equal("date", columns["BookingHoldNights.StayDate"].DataType);
        Assert.Equal(
            new ColumnMetadata("numeric", 18, 2, null),
            columns["BookingHolds.TotalAmount"]);
        Assert.Equal(
            new ColumnMetadata("numeric", 18, 2, null),
            columns["ReservationNights.NightTotal"]);
        Assert.Equal(
            "timestamp with time zone",
            columns["BookingHolds.CreatedAtUtc"].DataType);
        Assert.Equal(
            "timestamp with time zone",
            columns["Reservations.CancelledAtUtc"].DataType);
        Assert.Equal(
            new ColumnMetadata("character", null, null, 64),
            columns["BookingHolds.IdempotencyKeyHash"]);
        Assert.Equal(
            new ColumnMetadata("character", null, null, 64),
            columns["Reservations.GuestAccessTokenHash"]);

        var foreignKeys = await ReadNameCodeMapAsync(
            connection,
            """
            SELECT conname, confdeltype::text
            FROM pg_constraint
            WHERE contype = 'f'
              AND conrelid IN
                  ('"BookingHolds"'::regclass, '"BookingHoldNights"'::regclass,
                   '"Reservations"'::regclass, '"ReservationNights"'::regclass)
            ORDER BY conname;
            """);
        Assert.Equal("r", foreignKeys["FK_BookingHolds_AspNetUsers_CustomerAccountId"]);
        Assert.Equal("r", foreignKeys["FK_BookingHolds_RoomTypes_PropertyId_RoomTypeId"]);
        Assert.Equal("r", foreignKeys["FK_BookingHolds_RatePlans_PropertyId_RatePlanId"]);
        Assert.Equal("r", foreignKeys["FK_Reservations_BookingHolds_SourceHoldId"]);
        Assert.Equal("r", foreignKeys["FK_Reservations_AspNetUsers_CustomerAccountId"]);
        Assert.Equal("c", foreignKeys["FK_BookingHoldNights_BookingHolds_BookingHoldId"]);
        Assert.Equal("c", foreignKeys["FK_ReservationNights_Reservations_ReservationId"]);

        var indexes = await ReadNamesAsync(
            connection,
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename IN
                  ('BookingHolds', 'BookingHoldNights', 'Reservations', 'ReservationNights');
            """);
        Assert.Contains("IX_BookingHolds_IdempotencyKeyHash", indexes);
        Assert.Contains(
            "IX_BookingHolds_PropertyId_RoomTypeId_Status_ExpiresAtUtc",
            indexes);
        Assert.Contains("PK_BookingHoldNights", indexes);
        Assert.Contains("IX_BookingHoldNights_StayDate_BookingHoldId", indexes);
        Assert.Contains("IX_Reservations_SourceHoldId", indexes);
        Assert.Contains("IX_Reservations_ConfirmationNumber", indexes);
        Assert.Contains("IX_Reservations_PropertyId_RoomTypeId_Status", indexes);
        Assert.Contains("PK_ReservationNights", indexes);
        Assert.Contains("IX_ReservationNights_StayDate_ReservationId", indexes);

        var checks = await ReadNamesAsync(
            connection,
            """
            SELECT conname
            FROM pg_constraint
            WHERE contype = 'c'
              AND conrelid IN
                  ('"BookingHolds"'::regclass, '"BookingHoldNights"'::regclass,
                   '"Reservations"'::regclass, '"ReservationNights"'::regclass);
            """);
        Assert.Contains("CK_BookingHolds_FixedLifetime", checks);
        Assert.Contains("CK_BookingHolds_Ownership", checks);
        Assert.Contains("CK_BookingHolds_Hashes", checks);
        Assert.Contains("CK_BookingHoldNights_Amounts", checks);
        Assert.Contains("CK_Reservations_Cancellation", checks);
        Assert.Contains("CK_Reservations_Ownership", checks);
        Assert.Contains("CK_ReservationNights_Amounts", checks);
    }

    [Fact]
    public async Task Development_seed_creates_no_transactional_booking_rows()
    {
        await factory.ResetDatabaseAsync();
        await using var scope = factory.Services.CreateAsyncScope();
        var seeder = scope.ServiceProvider.GetRequiredService<DevelopmentDataSeeder>();

        await seeder.SeedAsync(CancellationToken.None);

        await using var context = factory.CreateDbContext();
        Assert.Equal(0, await context.BookingHolds.CountAsync());
        Assert.Equal(0, await context.BookingHoldNights.CountAsync());
        Assert.Equal(0, await context.Reservations.CountAsync());
        Assert.Equal(0, await context.ReservationNights.CountAsync());
    }

    [Fact]
    public async Task OpenApi_has_only_the_approved_hold_creation_path_and_no_reservation_paths()
    {
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/swagger/v1/swagger.json");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var payload = await response.Content.ReadAsStreamAsync();
        using var document = await JsonDocument.ParseAsync(payload);

        var paths = document.RootElement.GetProperty("paths");
        var holdPath = paths.GetProperty("/api/v1/booking-holds");
        Assert.True(holdPath.TryGetProperty("post", out _));
        Assert.DoesNotContain(
            paths.EnumerateObject(),
            path => path.Name.Contains("reservation", StringComparison.OrdinalIgnoreCase));
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

    private static BookingHold CreateHold(
        ReferenceData references,
        char hashCharacter,
        Guid? customerAccountId = null,
        Guid? roomTypeId = null,
        Guid? ratePlanId = null,
        char fingerprintCharacter = 'f')
    {
        return new BookingHold(
            Guid.NewGuid(),
            references.Property.Id,
            roomTypeId ?? references.RoomType.Id,
            ratePlanId ?? references.RatePlan.Id,
            customerAccountId,
            "Booking Guest",
            "booking@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            2,
            "VND",
            401.00m,
            Now,
            Hash(hashCharacter),
            Hash(fingerprintCharacter),
            customerAccountId.HasValue ? null : Hash('a'),
            ValidNights());
    }

    private static Reservation CreateReservation(
        ReferenceData references,
        Guid sourceHoldId,
        string confirmationNumber,
        Guid? customerAccountId = null,
        Guid? roomTypeId = null,
        Guid? ratePlanId = null)
    {
        return new Reservation(
            Guid.NewGuid(),
            confirmationNumber,
            sourceHoldId,
            references.Property.Id,
            roomTypeId ?? references.RoomType.Id,
            ratePlanId ?? references.RatePlan.Id,
            customerAccountId,
            "Booking Guest",
            "booking@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            2,
            "VND",
            401.00m,
            ReservationStatus.Confirmed,
            Now.AddMinutes(5),
            null,
            null,
            customerAccountId.HasValue ? null : Hash('a'),
            ValidNights());
    }

    private static BookingNightSnapshot[] ValidNights() =>
    [
        new(CheckIn, 2, 100.25m, 200.50m),
        new(CheckIn.AddDays(1), 2, 100.25m, 200.50m)
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
