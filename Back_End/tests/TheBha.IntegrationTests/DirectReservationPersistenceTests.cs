using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Promotions;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// BHA-CHECKOUT-001-PR01 on the fully migrated schema: the Direct (no source Hold) Reservation persists and reads back (T-03, T-05, T-07 assignment, T-09,
/// T-10 persistence) and the database refuses every invalid Source/SourceHoldId shape. Cancellation, locks and capacity are in
/// <see cref="ReservationCancellationApiTests"/>.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class DirectReservationPersistenceTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 12, 20);
    private static readonly DateOnly CheckOut = new(2026, 12, 22);
    private static readonly string TokenHash = new('a', BookingFieldLimits.Sha256Hash);
    private static readonly string OtherTokenHash = new('b', BookingFieldLimits.Sha256Hash);

    [Fact]
    public async Task Two_direct_reservations_persist_with_null_hold_and_the_stored_source_is_Direct()
    {
        var data = await SeedAsync();
        var first = data.Direct("BHA-DIRECT-0001", TokenHash);
        var second = data.Direct("BHA-DIRECT-0002", OtherTokenHash);
        var holdSourced = await data.HoldSourcedAsync("BHA-HOLD-0001");
        await using (var context = factory.CreateDbContext())
        {
            context.Reservations.AddRange(first, second);
            await context.SaveChangesAsync();
        }

        await using var read = factory.CreateDbContext();
        var rows = await read.Reservations.AsNoTracking().Include(r => r.Units).ThenInclude(u => u.Nights).OrderBy(r => r.ConfirmationNumber).ToListAsync();

        Assert.Equal(3, rows.Count);
        Assert.Equal(2, rows.Count(r => r.Source == ReservationSource.Direct && r.SourceHoldId is null));
        Assert.Single(rows, r => r.Source == ReservationSource.Hold && r.SourceHoldId == holdSourced.SourceHoldId);
        Assert.Equal(["Direct", "Direct", "Hold"], await StoredAsync("""SELECT "Source" FROM "Reservations" ORDER BY "Source", "ConfirmationNumber" """));
        Assert.All(rows.Single(r => r.Id == first.Id).Units, u => Assert.Null(u.SourceInventoryHoldItemId));
        Assert.Equal(first.TotalAmount, rows.Single(r => r.Id == first.Id).Units.SelectMany(u => u.Nights).Sum(n => n.UnitAmount));
    }

    [Fact]
    public async Task The_database_refuses_every_invalid_source_shape()
    {
        var data = await SeedAsync();
        var direct = data.Direct("BHA-DIRECT-0003", TokenHash);
        var holdSourced = await data.HoldSourcedAsync("BHA-HOLD-0002");
        await using (var context = factory.CreateDbContext())
        {
            context.Reservations.Add(direct);
            await context.SaveChangesAsync();
        }

        // Source and SourceHoldId must agree (CK_Reservations_Source), in both directions.
        await AssertRawErrorAsync($"""UPDATE "Reservations" SET "SourceHoldId" = '{holdSourced.SourceHoldId}' WHERE "Id" = '{direct.Id}'""", PostgresErrorCodes.CheckViolation, "CK_Reservations_Source");
        await AssertRawErrorAsync($"""UPDATE "Reservations" SET "SourceHoldId" = NULL WHERE "Id" = '{holdSourced.Id}'""", PostgresErrorCodes.CheckViolation, "CK_Reservations_Source");
        await AssertRawErrorAsync($"""UPDATE "Reservations" SET "Source" = 'Hold' WHERE "Id" = '{direct.Id}'""", PostgresErrorCodes.CheckViolation, "CK_Reservations_Source");
        await AssertRawErrorAsync($"""UPDATE "Reservations" SET "Source" = 'Other' WHERE "Id" = '{direct.Id}'""", PostgresErrorCodes.CheckViolation, "CK_Reservations_Source");

        // A second Reservation on the same Hold.
        await AssertSaveErrorAsync(
            () => new Reservation(Guid.NewGuid(), "BHA-HOLD-0003", holdSourced.SourceHoldId!.Value, data.Property.Id, null, "Guest", "guest@example.com", "+84 900 000 000",
                CheckIn, CheckOut, 1, 0, "VND", ReservationStatus.Confirmed, Now, null, null, TokenHash, [new ReservationUnitPlan(null, data.RoomType.Id, data.Nights(100m))]),
            PostgresErrorCodes.UniqueViolation, "IX_Reservations_SourceHoldId");
        // A Hold that does not exist (composite FK, same property).
        await AssertSaveErrorAsync(
            () => new Reservation(Guid.NewGuid(), "BHA-HOLD-0004", Guid.NewGuid(), data.Property.Id, null, "Guest", "guest@example.com", "+84 900 000 000",
                CheckIn, CheckOut, 1, 0, "VND", ReservationStatus.Confirmed, Now, null, null, TokenHash, [new ReservationUnitPlan(null, data.RoomType.Id, data.Nights(100m))]),
            PostgresErrorCodes.ForeignKeyViolation, "FK_Reservations_InventoryHolds_PropertyId_SourceHoldId");
        // A Direct Reservation still has to name a real Property (the Hold FK being skipped for NULL does not skip this one).
        await AssertSaveErrorAsync(
            () => Reservation.CreateDirect(Guid.NewGuid(), "BHA-DIRECT-0004", Guid.NewGuid(), null, "Guest", "guest@example.com", "+84 900 000 000", CheckIn, CheckOut, 1, 0, "VND", Now, TokenHash,
                [new ReservationUnitPlan(null, data.RoomType.Id, data.Nights(100m))]),
            PostgresErrorCodes.ForeignKeyViolation, "FK_Reservations_Properties_PropertyId");
        // A second Direct Reservation (NULL hold) is fine; a duplicate confirmation number is not.
        await AssertSaveErrorAsync(() => data.Direct("BHA-DIRECT-0003", OtherTokenHash), PostgresErrorCodes.UniqueViolation, "IX_Reservations_ConfirmationNumber");
    }

    [Fact]
    public async Task The_promotion_snapshot_database_shapes_hold_hold_confirmed_direct_and_reject_neither()
    {
        var data = await SeedAsync();
        var promotion = await data.SeedPromotionAsync();
        var snapshot = new AppliedPromotionSnapshot(promotion, 1, "direct-promo", "Direct promo", PromotionDiscountKind.Percent, 10m, null);
        var direct = data.Direct("BHA-DIRECT-0005", TokenHash, snapshot);
        await using (var context = factory.CreateDbContext())
        {
            context.Reservations.Add(direct);
            await context.SaveChangesAsync();
        }

        await using var read = factory.CreateDbContext();
        var saved = await read.BookingPromotionApplications.AsNoTracking().SingleAsync();
        Assert.Equal(direct.Id, saved.ReservationId);
        Assert.Null(saved.HoldId);
        Assert.NotEqual(Guid.Empty, saved.Id);
        Assert.Equal(20m, saved.DiscountTotalAmount);
        Assert.Equal(200m, saved.ListTotalAmount);

        // Neither id: refused. A second snapshot for the same Reservation: refused (unique ReservationId).
        await AssertRawErrorAsync(
            $"""
             INSERT INTO "BookingPromotionApplications" ("PromotionId","PromotionVersion","Slug","Title","Kind","Value","ListTotalAmount","DiscountTotalAmount")
             VALUES ('{promotion}', 1, 's', 't', 'Percent', 10, 200, 20)
             """,
            PostgresErrorCodes.CheckViolation, "CK_BookingPromotionApplications_Source");
        await AssertRawErrorAsync(
            $"""
             INSERT INTO "BookingPromotionApplications" ("ReservationId","PromotionId","PromotionVersion","Slug","Title","Kind","Value","ListTotalAmount","DiscountTotalAmount")
             VALUES ('{direct.Id}', '{promotion}', 1, 's', 't', 'Percent', 10, 200, 20)
             """,
            PostgresErrorCodes.UniqueViolation, "IX_BookingPromotionApplications_ReservationId");
    }

    [Fact]
    public async Task A_confirmed_hold_promotion_carries_both_ids_and_a_direct_one_only_the_reservation()
    {
        var data = await SeedAsync();
        var promotion = await data.SeedPromotionAsync();
        var snapshot = new AppliedPromotionSnapshot(promotion, 1, "p", "P", PromotionDiscountKind.Percent, 10m, null);
        var hold = new InventoryHold(
            Guid.NewGuid(), data.Property.Id, data.RoomType.Id, 1, null, "Guest", "guest@example.com", "+84 900 000 000", CheckIn, CheckOut, 1, 0, "VND", Now,
            new string('c', 64), new string('d', 64), TokenHash, data.Nights(90m, 100m), snapshot);
        await using (var context = factory.CreateDbContext())
        {
            context.InventoryHolds.Add(hold);
            await context.SaveChangesAsync();
        }

        await using (var context = factory.CreateDbContext())
        {
            var unconfirmed = await context.BookingPromotionApplications.AsNoTracking().SingleAsync();
            Assert.Equal((hold.Id, (Guid?)null), (unconfirmed.HoldId, unconfirmed.ReservationId));
        }

        Reservation reservation;
        await using (var context = factory.CreateDbContext())
        {
            var loaded = await context.InventoryHolds.Include(h => h.Items).ThenInclude(i => i.Nights).Include(h => h.PromotionApplication).SingleAsync();
            reservation = loaded.Confirm(Guid.NewGuid(), "BHA-HOLD-0010", Now);
            context.Reservations.Add(reservation);
            await context.SaveChangesAsync();
        }

        await using var read = factory.CreateDbContext();
        var confirmed = await read.BookingPromotionApplications.AsNoTracking().SingleAsync();
        Assert.Equal((hold.Id, (Guid?)reservation.Id), (confirmed.HoldId, confirmed.ReservationId));
        Assert.NotEqual(Guid.Empty, confirmed.Id);
        Assert.Equal(1, await read.BookingPromotionApplications.CountAsync());
        await AssertRawErrorAsync(
            $"""
             INSERT INTO "BookingPromotionApplications" ("HoldId","PromotionId","PromotionVersion","Slug","Title","Kind","Value","ListTotalAmount","DiscountTotalAmount")
             VALUES ('{hold.Id}', '{promotion}', 1, 's', 't', 'Percent', 10, 200, 20)
             """,
            PostgresErrorCodes.UniqueViolation, "IX_BookingPromotionApplications_HoldId");
    }

    [Fact]
    public async Task A_direct_reservation_reads_back_for_its_token_and_its_account_and_for_nobody_else()
    {
        var data = await SeedAsync(includeCustomer: true);
        var byToken = data.Direct("BHA-DIRECT-0011", TokenHash);
        var byAccount = data.Direct("BHA-DIRECT-0012", null, customerId: data.Customer!.Id);
        await using (var context = factory.CreateDbContext())
        {
            context.Reservations.AddRange(byToken, byAccount);
            await context.SaveChangesAsync();
        }

        await using var scope = factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IReservationReadStore>();

        var token = await store.GetAsync(byToken.Id, null, TokenHash, CancellationToken.None);
        Assert.Equal(ReservationReadStatus.Found, token.Status);
        Assert.Equal(byToken.TotalAmount, token.Reservation!.TotalAmount);
        Assert.Equal(1, token.Reservation.Rooms);
        Assert.Equal(ReservationReadStatus.Found, (await store.GetAsync(byAccount.Id, data.Customer.Id, null, CancellationToken.None)).Status);
        Assert.Equal(ReservationReadStatus.NotFound, (await store.GetAsync(byToken.Id, null, OtherTokenHash, CancellationToken.None)).Status);
        Assert.Equal(ReservationReadStatus.NotFound, (await store.GetAsync(byToken.Id, Guid.NewGuid(), null, CancellationToken.None)).Status);
        Assert.Equal(ReservationReadStatus.NotFound, (await store.GetAsync(byAccount.Id, null, TokenHash, CancellationToken.None)).Status);
        Assert.Equal(ReservationReadStatus.NotFound, (await store.GetAsync(Guid.NewGuid(), null, TokenHash, CancellationToken.None)).Status);
    }

    [Fact]
    public async Task A_direct_promotion_is_saved_read_and_unchanged_by_later_promotion_edits()
    {
        var data = await SeedAsync();
        var promotion = await data.SeedPromotionAsync();
        var direct = data.Direct("BHA-DIRECT-0013", TokenHash, new AppliedPromotionSnapshot(promotion, 1, "direct-promo", "Direct promo", PromotionDiscountKind.Percent, 10m, null));
        await using (var context = factory.CreateDbContext())
        {
            context.Reservations.Add(direct);
            await context.SaveChangesAsync();
        }

        // The Owner edits the promotion afterwards: the snapshot belongs to the Reservation and does not follow.
        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "Promotions" SET "Value" = 50, "Version" = 2, "Status" = 'Disabled' WHERE "Id" = {promotion}""");
        }

        await using var scope = factory.Services.CreateAsyncScope();
        var dto = (await scope.ServiceProvider.GetRequiredService<IReservationReadStore>().GetAsync(direct.Id, null, TokenHash, CancellationToken.None)).Reservation!;
        Assert.Equal("direct-promo", dto.AppliedPromotion!.Slug);
        Assert.Equal(10m, dto.AppliedPromotion.Value);
        Assert.Equal(180m, dto.TotalAmount);
        Assert.Equal(20m, dto.DiscountTotalAmount);
        Assert.Equal(200m, dto.ListTotalAmount);
    }

    [Fact]
    public async Task A_direct_reservation_unit_takes_a_physical_room_and_shows_on_the_admin_board()
    {
        var data = await SeedAsync(rooms: 2);
        var direct = data.Direct("BHA-DIRECT-0014", TokenHash);
        await using (var context = factory.CreateDbContext())
        {
            context.Reservations.Add(direct);
            await context.SaveChangesAsync();
        }

        await using var scope = factory.Services.CreateAsyncScope();
        var result = await scope.ServiceProvider.GetRequiredService<IAssignmentMutationStore>().CreateAsync(
            new CreateAssignmentCommand(data.Property.Id, direct.Units[0].Id, new AssignmentDestination(data.Rooms[0].Id, CheckIn, CheckOut), "actor:front-desk", null, null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);

        var board = await scope.ServiceProvider.GetRequiredService<IReservationBoardDataSource>()
            .LoadAsync(data.Property.Id, CheckIn, CheckOut, null, CancellationToken.None);
        var unit = Assert.Single(board!.Units);
        Assert.Equal((direct.Id, direct.Units[0].Id, "BHA-DIRECT-0014"), (unit.ReservationId, unit.ReservationUnitId, unit.ConfirmationNumber));
        Assert.Single(board.Assignments, a => a.ReservationUnitId == unit.ReservationUnitId && a.PhysicalRoomId == data.Rooms[0].Id);
    }

    // ---- fixture ---------------------------------------------------------------------------------------------------

    private async Task<Data> SeedAsync(bool includeCustomer = false, int rooms = 0)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Direct Hotel", $"direct-hotel-{Guid.NewGuid():N}", null, "1 Hotel Street", "Da Nang", "Vietnam", "Asia/Ho_Chi_Minh",
            new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(Guid.NewGuid(), property.Id, "DIR", "Direct", $"direct-{Guid.NewGuid():N}", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "DIRPLAN", "Direct plan", null, "VND", true, Now);
        context.AddRange(property, roomType, ratePlan);
        var roomList = Enumerable.Range(0, rooms)
            .Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, $"D{i}", 1, OperationalStatus.Active, Now))
            .ToList();
        context.AddRange(roomList);
        CustomerAccount? customer = null;
        if (includeCustomer)
        {
            customer = new CustomerAccount
            {
                Id = Guid.NewGuid(),
                Email = "direct@example.com",
                NormalizedEmail = "DIRECT@EXAMPLE.COM",
                UserName = "direct@example.com",
                NormalizedUserName = "DIRECT@EXAMPLE.COM",
                SecurityStamp = Guid.NewGuid().ToString(),
                ConcurrencyStamp = Guid.NewGuid().ToString()
            };
            context.CustomerAccounts.Add(customer);
        }

        await context.SaveChangesAsync();
        return new Data(factory, property, roomType, ratePlan, roomList, customer);
    }

    private async Task<List<string>> StoredAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync())
        {
            values.Add(reader.GetString(0));
        }

        return values;
    }

    private async Task AssertRawErrorAsync(string sql, string sqlState, string constraint)
    {
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        var error = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal((sqlState, constraint), (error.SqlState, error.ConstraintName));
    }

    private async Task AssertSaveErrorAsync(Func<Reservation> build, string sqlState, string constraint)
    {
        await using var context = factory.CreateDbContext();
        context.Reservations.Add(build());
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        var postgres = Assert.IsType<PostgresException>(error.InnerException);
        Assert.Equal((sqlState, constraint), (postgres.SqlState, postgres.ConstraintName));
    }

    private sealed class Data(
        PostgreSqlWebApplicationFactory factory,
        Property property,
        RoomType roomType,
        RatePlan ratePlan,
        List<PhysicalRoom> rooms,
        CustomerAccount? customer)
    {
        public Property Property => property;
        public RoomType RoomType => roomType;
        public List<PhysicalRoom> Rooms => rooms;
        public CustomerAccount? Customer => customer;

        public NightlyCommitmentSnapshot[] Nights(decimal unit, decimal? list = null) =>
        [
            new(CheckIn, ratePlan.Id, unit, list),
            new(CheckIn.AddDays(1), ratePlan.Id, unit, list)
        ];

        public Reservation Direct(string confirmationNumber, string? guestHash, AppliedPromotionSnapshot? promotion = null, Guid? customerId = null) =>
            Reservation.CreateDirect(
                Guid.NewGuid(), confirmationNumber, property.Id, customerId, "Direct Guest", "direct@example.com", "+84 900 000 777", CheckIn, CheckOut, 2, 0, "VND", Now,
                guestHash,
                [new ReservationUnitPlan(null, roomType.Id, promotion is null ? Nights(100m) : Nights(90m, 100m))],
                promotion);

        public async Task<Reservation> HoldSourcedAsync(string confirmationNumber)
        {
            await using var context = factory.CreateDbContext();
            var hold = new InventoryHold(
                Guid.NewGuid(), property.Id, roomType.Id, 1, null, "Guest", "guest@example.com", "+84 900 000 000", CheckIn, CheckOut, 1, 0, "VND", Now,
                Convert.ToHexString(Guid.NewGuid().ToByteArray()).ToLowerInvariant().PadRight(64, '1'), new string('d', 64), new string('c', 64),
                Nights(100m));
            context.InventoryHolds.Add(hold);
            var reservation = hold.Confirm(Guid.NewGuid(), confirmationNumber, Now);
            context.Reservations.Add(reservation);
            await context.SaveChangesAsync();
            return reservation;
        }

        public async Task<Guid> SeedPromotionAsync()
        {
            var id = Guid.NewGuid();
            await using var context = factory.CreateDbContext();
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO "Promotions" ("Id","PropertyId","Slug","Status","Kind","Value","AllRoomTypes","MinNights","Title","Summary","BodyParagraphs","ShowOnHomepage","SortOrder","CreatedAtUtc","UpdatedAtUtc","CreatedByStaffId","UpdatedByStaffId","CreateOperationId","CreateFingerprint")
                 VALUES ({id},{property.Id},{"p-" + id.ToString("N")},'Active','Percent',10,true,1,'Direct promo','Summary',ARRAY['x']::text[],false,0,{Now},{Now},{Guid.NewGuid()},{Guid.NewGuid()},{Guid.NewGuid()},{new string('a', 64)})
                 """);
            return id;
        }
    }
}
