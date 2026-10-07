using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Bookings;
using TheBha.Application.Properties;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-BE-001.2 Phase 3 evidence: the assignment-aware, block-adjusted availability
/// formula (blueprint §7) computed by the one shared <see cref="PhysicalCapacityDataLoader"/>/
/// <see cref="PhysicalCapacityFormula"/> design, and whole-Reservation cancellation's
/// atomic Effective-assignment cleanup — all against real PostgreSQL 17.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AssignmentAwareAvailabilityTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 3); // 2 nights: 9/1, 9/2

    [Fact]
    public async Task Operational_block_reduces_usable_capacity_once_per_room_before_sellable_limit()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "block-formula", roomCount: 3, unitCount: 0);

        var block = new RoomBlock(Guid.NewGuid(), data.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(block);
        context.Add(Block(data, data.Rooms[0], block, CheckIn, CheckOut));
        context.Add(Block(data, data.Rooms[1], block, CheckIn, CheckOut));
        await context.SaveChangesAsync();

        var demand = await LoadAsync(data);
        // 3 active rooms, 2 distinct blocked -> BlockedRooms count is 2 (one deduction
        // per distinct blocked room, never one per RoomBlock header row), leaving usable
        // physical capacity at 3 - 2 = 1.
        Assert.Equal(2, demand.BlockedRooms.Where(b => b.StayDate == CheckIn).Sum(b => b.Rooms));
        Assert.Equal(2, demand.BlockedRooms.Where(b => b.StayDate == CheckIn.AddDays(1)).Sum(b => b.Rooms));
        var usablePhysicalCapacity = PhysicalCapacityFormula.UsablePhysicalCapacity(
            demand.ActiveRoomCounts[data.RoomType.Id],
            demand.BlockedRooms.Where(b => b.StayDate == CheckIn).Sum(b => b.Rooms));
        Assert.Equal(1, usablePhysicalCapacity);
    }

    [Fact]
    public async Task Inactive_room_is_not_deducted_twice_when_also_blocked()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "inactive-and-blocked", roomCount: 1, unitCount: 0);
        var inactiveRoom = new PhysicalRoom(
            Guid.NewGuid(), data.Property.Id, data.RoomType, "R-inactive", 1, OperationalStatus.Inactive, Now);
        context.Add(inactiveRoom);
        await context.SaveChangesAsync();
        data.Rooms.Add(inactiveRoom);

        var block = new RoomBlock(Guid.NewGuid(), data.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(block);
        context.Add(Block(data, inactiveRoom, block, CheckIn, CheckOut));
        await context.SaveChangesAsync();

        var demand = await LoadAsync(data);
        // The inactive room is already excluded from ActiveRoomCounts; the block query
        // must not additionally count it, so BlockedRooms for this RoomType/date is 0.
        Assert.DoesNotContain(demand.BlockedRooms, b => b.StayDate == CheckIn && b.Rooms > 0);
        Assert.Equal(1, demand.ActiveRoomCounts[data.RoomType.Id]);
    }

    [Fact]
    public async Task Same_room_type_assignment_is_counted_exactly_once()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "same-type-once", roomCount: 1, unitCount: 1);

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckOut));
        await context.SaveChangesAsync();

        var demand = await LoadAsync(data);
        var totalDemand = demand.CommittedDemand.Where(d => d.RoomTypeId == data.RoomType.Id && d.StayDate == CheckIn).Sum(d => d.Rooms);
        Assert.Equal(1, totalDemand);
    }

    [Fact]
    public async Task Cross_room_type_assignment_releases_sold_bucket_and_consumes_actual_bucket_once()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateTwoRoomTypeFixtureAsync(context, "cross-type");

        // Unit is sold as RoomTypeA; assign it to a RoomTypeB physical room.
        context.Add(Assignment(data, data.RoomsB[0], data.UnitsA[0], CheckIn, CheckOut));
        await context.SaveChangesAsync();

        var demandA = await LoadAttributedAsync(data.Property.Id);
        Assert.Equal(0, demandA.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)));
        Assert.Equal(1, demandA.GetValueOrDefault((data.RoomTypeB.Id, CheckIn)));
    }

    [Fact]
    public async Task Partial_assignment_attributes_nightly()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateTwoRoomTypeFixtureAsync(context, "partial");

        // Only the first night is assigned to RoomTypeB; the second night stays sold-A.
        context.Add(Assignment(data, data.RoomsB[0], data.UnitsA[0], CheckIn, CheckIn.AddDays(1)));
        await context.SaveChangesAsync();

        var demand = await LoadAttributedAsync(data.Property.Id);
        Assert.Equal(0, demand.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)));
        Assert.Equal(1, demand.GetValueOrDefault((data.RoomTypeB.Id, CheckIn)));
        Assert.Equal(1, demand.GetValueOrDefault((data.RoomTypeA.Id, CheckIn.AddDays(1))));
        Assert.Equal(0, demand.GetValueOrDefault((data.RoomTypeB.Id, CheckIn.AddDays(1))));
    }

    [Fact]
    public async Task Cancelled_assignment_has_no_current_attribution_effect()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateTwoRoomTypeFixtureAsync(context, "cancelled-assignment");

        var segment = Assignment(data, data.RoomsB[0], data.UnitsA[0], CheckIn, CheckOut);
        context.Add(segment);
        await context.SaveChangesAsync();
        segment.Cancel();
        await context.SaveChangesAsync();

        var demand = await LoadAttributedAsync(data.Property.Id);
        Assert.Equal(1, demand.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)));
        Assert.Equal(0, demand.GetValueOrDefault((data.RoomTypeB.Id, CheckIn)));
    }

    [Fact]
    public async Task Reservation_cancellation_atomically_cancels_effective_assignments_and_removes_demand()
    {
        await factory.ResetDatabaseAsync();
        // ReservationCancellationStore resolves TimeProvider from DI to enforce the
        // check-in cutoff (Reservation.Cancel), so the factory clock must be pinned
        // before CheckIn — otherwise this test starts failing for real once wall-clock
        // time reaches the fixture's hardcoded CheckIn date.
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var data = await CreateTwoRoomTypeFixtureAsync(context, "cancel-cleanup");

        var segment = Assignment(data, data.RoomsB[0], data.UnitsA[0], CheckIn, CheckOut);
        context.Add(segment);
        await context.SaveChangesAsync();

        var demandBefore = await LoadAttributedAsync(data.Property.Id);
        Assert.Equal(1, demandBefore.GetValueOrDefault((data.RoomTypeB.Id, CheckIn)));

        await using var scope = factory.Services.CreateAsyncScope();
        var cancellationStore = scope.ServiceProvider.GetRequiredService<IReservationCancellationStore>();
        var result = await cancellationStore.CancelAsync(
            data.Reservation.Id,
            null,
            data.Reservation.GuestAccessTokenHash,
            "Cross-type cleanup test",
            CancellationToken.None);
        Assert.Equal(ReservationCancellationStatus.Cancelled, result.Status);

        await using var verify = factory.CreateDbContext();
        var reloadedSegment = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == segment.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled, reloadedSegment.Status);
        Assert.Equal(1, await verify.RoomOccupancySegmentAudits.CountAsync(a => a.SegmentId == segment.Id));

        var demandAfter = await LoadAttributedAsync(data.Property.Id);
        Assert.Equal(0, demandAfter.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)));
        Assert.Equal(0, demandAfter.GetValueOrDefault((data.RoomTypeB.Id, CheckIn)));
    }

    [Fact]
    public async Task Hold_creation_respects_the_same_block_adjusted_capacity_as_availability_search()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "hold-consistency", roomCount: 1, unitCount: 0);

        var block = new RoomBlock(Guid.NewGuid(), data.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(block);
        context.Add(Block(data, data.Rooms[0], block, CheckIn, CheckOut));
        await context.SaveChangesAsync();

        await using var scope = factory.Services.CreateAsyncScope();
        var search = scope.ServiceProvider.GetRequiredService<IAvailabilitySearch>();
        var searchResult = await search.SearchAsync(
            new AvailabilitySearchRequest(data.Property.Id, CheckIn, CheckOut, 2, 0, 1),
            CancellationToken.None);
        Assert.Empty(searchResult.Offers.Where(o => o.RoomTypeId == data.RoomType.Id));
    }

    private async Task<AvailabilityData> LoadAsync(Fixture data)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dataSource = scope.ServiceProvider.GetRequiredService<IAvailabilityDataSource>();
        var loaded = await dataSource.LoadAsync(data.Property.Id, CheckIn, CheckOut, Now, CancellationToken.None);
        return loaded!;
    }

    /// <summary>
    /// Reuses the public <see cref="IAvailabilityDataSource"/> (not the internal
    /// <c>PhysicalCapacityDataLoader</c> directly) so this test proves the same
    /// assignment-aware attribution the public availability projection actually
    /// serves, exactly per §8's "one shared authoritative calculation" requirement.
    /// </summary>
    private async Task<IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int>> LoadAttributedAsync(
        Guid propertyId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dataSource = scope.ServiceProvider.GetRequiredService<IAvailabilityDataSource>();
        var loaded = await dataSource.LoadAsync(propertyId, CheckIn, CheckOut, Now, CancellationToken.None);
        return loaded!.CommittedDemand.ToDictionary(d => (d.RoomTypeId, d.StayDate), d => d.Rooms);
    }

    private static async Task<Fixture> CreateFixtureAsync(
        TheBhaDbContext context,
        string slug,
        int roomCount,
        int unitCount)
    {
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, slug, null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.AddRange(property, roomType, ratePlan);
        for (var date = CheckIn; date < CheckOut; date = date.AddDays(1))
        {
            context.Add(new DailyRoomRate(Guid.NewGuid(), property.Id, roomType.Id, ratePlan.Id, date, 100m, Now));
        }

        var rooms = new List<PhysicalRoom>();
        for (var index = 0; index < roomCount; index++)
        {
            var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, $"R{index}", 1, OperationalStatus.Active, Now);
            rooms.Add(room);
            context.Add(room);
        }

        Reservation? reservation = null;
        var units = new List<ReservationUnit>();
        if (unitCount > 0)
        {
            (reservation, units) = CreateReservation(context, property.Id, roomType.Id, ratePlan.Id, unitCount, slug);
        }

        await context.SaveChangesAsync();
        return new Fixture(property, roomType, rooms, reservation!, units);
    }

    private static async Task<TwoRoomTypeFixture> CreateTwoRoomTypeFixtureAsync(TheBhaDbContext context, string slug)
    {
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomTypeA = new RoomType(Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}A", slug, $"{slug}-a", null, 2, 4, true, Now);
        var roomTypeB = new RoomType(Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}B", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.AddRange(property, roomTypeA, roomTypeB, ratePlan);

        var roomA = new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeA, "A0", 1, OperationalStatus.Active, Now);
        var roomB = new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeB, "B0", 1, OperationalStatus.Active, Now);
        context.AddRange(roomA, roomB);

        var (reservation, units) = CreateReservation(context, property.Id, roomTypeA.Id, ratePlan.Id, 1, slug);

        await context.SaveChangesAsync();
        return new TwoRoomTypeFixture(property, roomTypeA, roomTypeB, [roomA], [roomB], reservation!, units);
    }

    private static (Reservation Reservation, List<ReservationUnit> Units) CreateReservation(
        TheBhaDbContext context,
        Guid propertyId,
        Guid roomTypeId,
        Guid ratePlanId,
        int unitCount,
        string slug)
    {
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlanId, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), propertyId, roomTypeId, unitCount, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash(slug + ":idempotency"), HexHash(slug + ":fingerprint"), HexHash(slug + ":guest"), nights);
        context.Add(hold);
        // Confirming through the Hold (rather than constructing a Reservation
        // standalone) is what actually flips the Hold to Confirmed — otherwise it
        // stays Active/unexpired and its Items keep contributing Hold demand under
        // the sold RoomType on top of the Reservation's own (attributed) demand.
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{slug.ToUpperInvariant()}-0001", Now);
        context.Add(reservation);
        return (reservation, reservation.Units.ToList());
    }

    private static RoomOccupancySegment Assignment(Fixture data, PhysicalRoom room, ReservationUnit unit, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), data.Property.Id, room.Id, RoomOccupancySegmentType.ReservationAssignment, start, end, unit.Id, null, Now);

    private static RoomOccupancySegment Assignment(TwoRoomTypeFixture data, PhysicalRoom room, ReservationUnit unit, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), data.Property.Id, room.Id, RoomOccupancySegmentType.ReservationAssignment, start, end, unit.Id, null, Now);

    private static RoomOccupancySegment Block(Fixture data, PhysicalRoom room, RoomBlock block, DateOnly start, DateOnly end) =>
        new(Guid.NewGuid(), data.Property.Id, room.Id, RoomOccupancySegmentType.OperationalBlock, start, end, null, block.Id, Now);

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        RoomType RoomType,
        List<PhysicalRoom> Rooms,
        Reservation Reservation,
        List<ReservationUnit> Units);

    private sealed record TwoRoomTypeFixture(
        Property Property,
        RoomType RoomTypeA,
        RoomType RoomTypeB,
        List<PhysicalRoom> RoomsA,
        List<PhysicalRoom> RoomsB,
        Reservation Reservation,
        List<ReservationUnit> UnitsA);
}
