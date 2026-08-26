using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Bookings;
using TheBha.Application.Scheduling;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-BE-001.2 Phase 4 evidence for <see cref="IOperationalBlockMutationStore"/>:
/// multi-room same-Property RoomBlock creation, cross-Property rejection,
/// split/move/cancel, capacity-safe block creation, and concurrency safety against
/// Hold creation — all against real PostgreSQL 17.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class OperationalBlockMutationStoreTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights

    [Fact]
    public async Task Multi_room_same_property_room_block_creation_succeeds()
    {
        var data = await SeedAsync("multi-room-block", roomCount: 3);
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Deep clean", "actor:housekeeping",
                [
                    new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut),
                    new BlockSegmentSpec(data.Rooms[1].Id, CheckIn, CheckOut)
                ]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        Assert.Equal(2, result.Segments!.Count);
        Assert.All(result.Segments!, s => Assert.Equal(result.Block!.Id, s.RoomBlockId));
    }

    [Fact]
    public async Task Cross_property_room_block_composition_is_rejected()
    {
        var dataA = await SeedAsync("cross-block-a");
        var dataB = await SeedAsync("cross-block-b");
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                dataA.Property.Id, "Cross property attempt", "actor:housekeeping",
                [new BlockSegmentSpec(dataB.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.NotFound, result.Status);
    }

    [Fact]
    public async Task Split_move_and_cancel_preserve_header_and_audit_history()
    {
        var data = await SeedAsync("block-lifecycle", roomCount: 2);
        var store = CreateStore();
        var created = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);
        var original = created.Segments![0];
        var midpoint = CheckIn.AddDays(2);

        // Split.
        var split = await store.SupersedeSegmentsAsync(
            new SupersedeBlockSegmentsCommand(
                data.Property.Id,
                [
                    new BlockSegmentSupersession(
                        original.Id, original.Version,
                        [
                            new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, midpoint),
                            new BlockSegmentSpec(data.Rooms[1].Id, midpoint, CheckOut)
                        ])
                ],
                "actor:housekeeping", "split for partial availability"),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, split.Status);
        var afterSplit = split.Segments!.Where(s => s.Status == RoomOccupancySegmentStatus.Effective.ToString()).ToArray();
        Assert.Equal(2, afterSplit.Length);

        // Move one of the successor segments.
        var toMove = afterSplit.First(s => s.PhysicalRoomId == data.Rooms[0].Id);
        var move = await store.SupersedeSegmentsAsync(
            new SupersedeBlockSegmentsCommand(
                data.Property.Id,
                [new BlockSegmentSupersession(toMove.Id, toMove.Version, [new BlockSegmentSpec(data.Rooms[1].Id, CheckIn, midpoint)])],
                "actor:housekeeping", "move"),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, move.Status);

        // The two segments still Effective after the move: the one just moved, and
        // the split's other successor that was never touched by the move.
        var movedSegment = move.Segments!.Single(s => s.Status == RoomOccupancySegmentStatus.Effective.ToString());
        var untouchedSegment = afterSplit.Single(s => s.Id != toMove.Id);
        foreach (var segment in new[] { movedSegment, untouchedSegment })
        {
            var cancel = await store.SupersedeSegmentsAsync(
                new SupersedeBlockSegmentsCommand(
                    data.Property.Id,
                    [new BlockSegmentSupersession(segment.Id, segment.Version, [])],
                    "actor:housekeeping", "cancel"),
                CancellationToken.None);
            Assert.Equal(SegmentMutationStatus.Succeeded, cancel.Status);
        }

        await using var verify2 = factory.CreateDbContext();
        Assert.Equal(1, await verify2.RoomBlocks.CountAsync(b => b.Id == created.Block!.Id));
        Assert.Empty(await verify2.RoomOccupancySegments
            .Where(s => s.RoomBlockId == created.Block!.Id && s.Status == RoomOccupancySegmentStatus.Effective)
            .ToListAsync());
        var totalAudits = await verify2.RoomOccupancySegmentAudits
            .CountAsync(a => verify2.RoomOccupancySegments.Any(s => s.RoomBlockId == created.Block!.Id && s.Id == a.SegmentId));
        Assert.True(totalAudits >= 4, "Expected at least one Created and one Cancelled audit row per segment across the split/move/cancel lifecycle.");
    }

    [Fact]
    public async Task Block_creation_that_would_leave_final_demand_above_usable_capacity_is_rejected()
    {
        var data = await SeedAsync("block-oversell", roomCount: 1);
        await SellRoomTypeAsync(data);
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        await using var verify = factory.CreateDbContext();
        Assert.Empty(await verify.RoomOccupancySegments.Where(s => s.PropertyId == data.Property.Id).ToListAsync());
    }

    [Fact]
    public async Task Active_unexpired_hold_plus_existing_committed_demand_causes_block_creation_to_be_rejected()
    {
        // PMS-BE-001.2-C1: two rooms of one RoomType; one is already sold via a
        // committed Reservation, the other is only held (Active, unexpired) — not
        // yet committed. Before this correction, final-capacity validation omitted
        // Hold demand entirely, so blocking the held room would have wrongly
        // succeeded even though a live Hold already occupies it.
        var data = await SeedAsync("hold-plus-committed-block", roomCount: 2);
        await SellRoomTypeAsync(data);
        var fixedNow = Now.AddDays(60);
        await PlaceActiveHoldAsync(data, fixedNow.AddMinutes(-1));
        factory.Clock.UtcNow = fixedNow;
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[1].Id, CheckIn, CheckOut)]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        await using var verify = factory.CreateDbContext();
        Assert.Empty(await verify.RoomOccupancySegments.Where(s => s.PropertyId == data.Property.Id).ToListAsync());
        Assert.Empty(await verify.RoomOccupancySegmentAudits.ToListAsync());
    }

    [Fact]
    public async Task Expired_hold_does_not_block_a_safe_block_creation()
    {
        // Same setup as above, but the Hold's 15-minute lifetime has already
        // elapsed relative to "now" — it must not count against capacity, so the
        // block (targeting the room that is only held, not committed) succeeds.
        var data = await SeedAsync("expired-hold-safe-block", roomCount: 1);
        var fixedNow = Now.AddDays(60);
        await PlaceActiveHoldAsync(data, fixedNow.AddMinutes(-30));
        factory.Clock.UtcNow = fixedNow;
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
    }

    [Fact]
    public async Task Hold_expiring_at_exactly_utcNow_does_not_count_against_capacity()
    {
        var data = await SeedAsync("hold-expires-exactly-now-block", roomCount: 1);
        var fixedNow = Now.AddDays(60);
        // ExpiresAtUtc == fixedNow exactly: the store's utcNow > ExpiresAtUtc
        // predicate is strict, so this Hold must not count.
        await PlaceActiveHoldAsync(data, fixedNow - TheBha.Domain.Bookings.InventoryHold.Lifetime);
        factory.Clock.UtcNow = fixedNow;
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
    }

    [Fact]
    public async Task Multi_night_hold_demand_is_evaluated_against_one_shared_utc_instant()
    {
        // The Hold and the block both span the full 5-night CheckIn..CheckOut
        // range. Final-capacity validation reads one utcNow instant for the whole
        // multi-night evaluation, so the outcome is all-or-nothing across every
        // affected night — never a partial per-night split from re-reading "now"
        // mid-evaluation.
        var data = await SeedAsync("hold-multi-night-one-instant", roomCount: 1);
        var fixedNow = Now.AddDays(60);
        await PlaceActiveHoldAsync(data, fixedNow.AddMinutes(-1));
        factory.Clock.UtcNow = fixedNow;
        var store = CreateStore();

        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        await using var verify = factory.CreateDbContext();
        Assert.Empty(await verify.RoomOccupancySegments.Where(s => s.PropertyId == data.Property.Id).ToListAsync());
    }

    [Fact]
    public async Task Concurrent_block_creation_and_hold_creation_cannot_oversell()
    {
        var data = await SeedAsync("block-vs-hold", roomCount: 1);
        var store = CreateStore();

        await using var scope = factory.Services.CreateAsyncScope();
        var holdCreation = scope.ServiceProvider.GetRequiredService<IBookingHoldCreationStore>();
        var holdRequest = new PreparedBookingHoldRequest(
            data.Property.Id, data.RoomType.Id, data.RatePlan.Id, CheckIn, CheckOut, 1, 0, 1,
            "Guest", "guest@example.com", "+84 900 000 333", null,
            HexHash("block-race"), HexHash("block-race-fp"));

        var blockTask = store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                data.Property.Id, "Maintenance", "actor:housekeeping",
                [new BlockSegmentSpec(data.Rooms[0].Id, CheckIn, CheckOut)]),
            CancellationToken.None);
        var holdTask = holdCreation.CreateAsync(holdRequest, CancellationToken.None);
        await Task.WhenAll(blockTask, holdTask);

        var blockResult = await blockTask;
        var holdResult = await holdTask;

        var successes = new[]
        {
            blockResult.Status == SegmentMutationStatus.Succeeded,
            holdResult.Status == BookingHoldCreationStatus.Created
        }.Count(x => x);
        Assert.True(successes <= 1, "Both the block and the Hold succeeded, which would oversell the single PhysicalRoom.");
    }

    private IOperationalBlockMutationStore CreateStore()
    {
        var scope = factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<IOperationalBlockMutationStore>();
    }

    private async Task SellRoomTypeAsync(Fixture data)
    {
        await using var context = factory.CreateDbContext();
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new TheBha.Domain.Bookings.NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m))
            .ToArray();
        var hold = new TheBha.Domain.Bookings.InventoryHold(
            Guid.NewGuid(), data.Property.Id, data.RoomType.Id, 1, null, "Fill Guest", "fill@example.com",
            "+84 900 000 444", CheckIn, CheckOut, 1, 0, "VND", Now,
            HexHash("sell:idempotency"), HexHash("sell:fingerprint"), HexHash("sell:guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash("sell")[..8].ToUpperInvariant()}", Now);
        context.Add(reservation);
        await context.SaveChangesAsync();
    }

    private async Task PlaceActiveHoldAsync(Fixture data, DateTimeOffset createdAtUtc, int quantity = 1)
    {
        await using var context = factory.CreateDbContext();
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new TheBha.Domain.Bookings.NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m))
            .ToArray();
        var hold = new TheBha.Domain.Bookings.InventoryHold(
            Guid.NewGuid(), data.Property.Id, data.RoomType.Id, quantity, null, "Hold Guest", "hold@example.com",
            "+84 900 000 555", CheckIn, CheckOut, 1, 0, "VND", createdAtUtc,
            HexHash("hold:idempotency"), HexHash("hold:fingerprint"), HexHash("hold:guest"), nights);
        context.Add(hold);
        await context.SaveChangesAsync();
    }

    private async Task<Fixture> SeedAsync(string slug, int roomCount = 3)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomType = new RoomType(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, slug, null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.AddRange(property, roomType, ratePlan);

        var rooms = new List<PhysicalRoom>();
        for (var i = 0; i < roomCount; i++)
        {
            var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomType, $"R{i}", 1, OperationalStatus.Active, Now);
            rooms.Add(room);
            context.Add(room);
        }

        await context.SaveChangesAsync();
        return new Fixture(property, roomType, rooms, ratePlan);
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(Property Property, RoomType RoomType, List<PhysicalRoom> Rooms, RatePlan RatePlan);
}
