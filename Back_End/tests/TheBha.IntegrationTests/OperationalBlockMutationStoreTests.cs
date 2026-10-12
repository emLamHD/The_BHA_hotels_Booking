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

    // ---------------------------------------------------------------
    // PMS-CAL-003-CP01: MoveAsync — a narrow adapter over the unchanged supersession engine
    // ---------------------------------------------------------------

    [Fact]
    public async Task Move_over_the_full_range_returns_source_cancelled_and_one_effective_successor_and_keeps_header_siblings_and_history()
    {
        var data = await SeedMoveAsync("move-happy");
        var (header, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Burst pipe");
        // A sibling segment of the same header and an unrelated block must not be touched.
        var sibling = (await CreateStore().SupersedeSegmentsAsync(new SupersedeBlockSegmentsCommand(
            data.Property.Id, [new BlockSegmentSupersession(source.Id, source.Version, [
                new BlockSegmentSpec(data.RoomsA[0].Id, CheckIn, CheckIn.AddDays(2)),
                new BlockSegmentSpec(data.RoomsA[1].Id, CheckIn.AddDays(2), CheckOut)])], "actor:setup", null), CancellationToken.None)).Segments!;
        var wholeSource = sibling.Single(item => item.PhysicalRoomId == data.RoomsA[0].Id && item.Status == "Effective");
        var untouched = sibling.Single(item => item.PhysicalRoomId == data.RoomsA[1].Id && item.Status == "Effective");
        var (_, otherBlock) = await CreateBlockAsync(data, data.RoomsA[2], CheckIn, CheckOut, "Other closure");
        var before = await StateAsync();

        var result = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, wholeSource.Id, wholeSource.Version, data.RoomsB[0].Id, "actor:mover", "Move closure to room B"),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        var segments = result.Segments!;
        Assert.Equal(["Cancelled", "Effective"], segments.Select(item => item.Status).ToArray());
        Assert.Equal((wholeSource.Id, data.RoomsA[0].Id, CheckIn, CheckIn.AddDays(2)), (segments[0].Id, segments[0].PhysicalRoomId, segments[0].StartDate, segments[0].EndDate));
        Assert.Equal((data.RoomsB[0].Id, CheckIn, CheckIn.AddDays(2)), (segments[1].PhysicalRoomId, segments[1].StartDate, segments[1].EndDate));
        Assert.All(segments, item => Assert.Equal(header.Id, item.RoomBlockId));
        Assert.All(segments, item => Assert.Null(item.ReservationUnitId));

        await using var verify = factory.CreateDbContext();
        foreach (var dto in segments)
        {
            Assert.Equal(dto.Version, verify.Entry(await verify.RoomOccupancySegments.SingleAsync(row => row.Id == dto.Id)).Property<uint>("xmin").CurrentValue);
        }

        // The header, the sibling, the unrelated block and every earlier audit row are exactly as they were.
        var headerAfter = await verify.RoomBlocks.AsNoTracking().SingleAsync(row => row.Id == header.Id);
        Assert.Equal(("Burst pipe", "actor:housekeeping"), (headerAfter.Reason, headerAfter.CreatedByActorReference));
        var afterState = await StateAsync();
        foreach (var kept in new[] { untouched.Id, otherBlock.Id })
        {
            Assert.Contains(StateLine(before, kept), afterState);
        }

        // Exactly two new audit rows, one mutation group, the caller's actor, no evidence, the move reason.
        var newAudits = await verify.RoomOccupancySegmentAudits.AsNoTracking().Where(a => segments.Select(x => x.Id).Contains(a.SegmentId)).ToListAsync();
        var group = newAudits.Where(a => a.Reason == "Move closure to room B").ToList();
        Assert.Equal(2, group.Count);
        Assert.Single(group.Select(a => a.MutationGroupId).Distinct());
        Assert.All(group, a => Assert.Equal(("actor:mover", (string?)null), (a.ActorReference, a.AuthorizationEvidence)));
        Assert.Equal(["Cancelled", "Created"], group.Select(a => a.EventType.ToString()).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(await CommercialAsync(), CommercialPart(before));
    }

    [Fact]
    public async Task A_one_night_block_moves_and_its_reason_may_be_absent()
    {
        var data = await SeedMoveAsync("move-one-night");
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckIn.AddDays(1), "One night");

        var result = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsA[1].Id, "actor:mover", null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        Assert.Equal((data.RoomsA[1].Id, CheckIn, CheckIn.AddDays(1)), (result.Segments![1].PhysicalRoomId, result.Segments[1].StartDate, result.Segments[1].EndDate));
        await using var verify = factory.CreateDbContext();
        Assert.All(await verify.RoomOccupancySegmentAudits.AsNoTracking().Where(a => a.ActorReference == "actor:mover").ToListAsync(), a => Assert.Null(a.Reason));
    }

    [Fact]
    public async Task Moving_to_a_different_room_type_needs_no_confirmation_evidence_or_extra_permission_when_capacity_allows()
    {
        var data = await SeedMoveAsync("move-cross-type");
        await SellAsync(data, data.TypeB, 1);
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");

        var result = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsB[0].Id, "actor:mover", null),
            CancellationToken.None);

        // B has two rooms and one sold unit, so one blocked room still leaves one usable.
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        await using var verify = factory.CreateDbContext();
        Assert.DoesNotContain(await verify.RoomOccupancySegmentAudits.AsNoTracking().ToListAsync(), a => a.AuthorizationEvidence is not null);
    }

    [Fact]
    public async Task A_move_into_a_room_type_whose_final_capacity_cannot_hold_its_committed_demand_is_a_conflict_that_changes_nothing()
    {
        var data = await SeedMoveAsync("move-capacity");
        await SellAsync(data, data.TypeB, 2);
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");
        var before = await StateAsync();

        var result = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsB[0].Id, "actor:mover", null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        Assert.Equal(before, await StateAsync());
    }

    [Fact]
    public async Task An_active_hold_counts_against_the_destination_capacity_and_an_expired_one_does_not()
    {
        var data = await SeedMoveAsync("move-hold");
        var fixedNow = Now.AddDays(60);
        await PlaceHoldAsync(data, data.TypeB, 2, fixedNow.AddMinutes(-1));
        factory.Clock.UtcNow = fixedNow;
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");
        var before = await StateAsync();

        var refused = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsB[0].Id, "actor:mover", null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Conflict, refused.Status);
        Assert.Equal(before, await StateAsync());

        // Once the hold has lapsed relative to "now" it no longer counts.
        factory.Clock.UtcNow = fixedNow.AddHours(1);
        var allowed = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsB[0].Id, "actor:mover", null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, allowed.Status);
    }

    [Fact]
    public async Task A_same_type_move_changes_no_capacity_so_it_succeeds_even_when_the_type_is_fully_committed()
    {
        var data = await SeedMoveAsync("move-same-type-delta", roomsA: 2);
        await SellAsync(data, data.TypeA, 1);
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");

        var result = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsA[1].Id, "actor:mover", null),
            CancellationToken.None);

        // One blocked room before and after: usable capacity is one throughout, so the sold unit still fits.
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
    }

    [Fact]
    public async Task Every_refusal_writes_nothing_and_leaves_segments_versions_header_audits_and_commercial_state_as_they_were()
    {
        var data = await SeedMoveAsync("move-refusals");
        await SellAsync(data, data.TypeA, 1);
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");
        var assignment = await CreateAssignmentAsync(data, data.RoomsA[2]);
        var (_, cancelled) = await CreateBlockAsync(data, data.RoomsA[1], CheckIn, CheckOut, "Lifted");
        await CreateStore().SupersedeSegmentsAsync(new SupersedeBlockSegmentsCommand(
            data.Property.Id, [new BlockSegmentSupersession(cancelled.Id, cancelled.Version, [])], "actor:setup", null), CancellationToken.None);
        var cancelledNow = await ReadSegmentAsync(cancelled.Id);
        var other = await SeedForeignAsync();
        var foreignBlock = (await CreateStore().CreateBlockAsync(
            new CreateRoomBlockCommand(other.Property.Id, "Foreign closure", "actor:housekeeping", [new BlockSegmentSpec(other.Room.Id, CheckIn, CheckOut)]),
            CancellationToken.None)).Segments![0];
        var before = await StateAsync();

        MoveOperationalBlockCommand Command(Guid? segment = null, uint? version = null, Guid? destination = null, Guid? property = null, string actor = "actor:mover", string? reason = null) =>
            new(property ?? data.Property.Id, segment ?? source.Id, version ?? source.Version, destination ?? data.RoomsB[0].Id, actor, reason);

        var cases = new (string Name, MoveOperationalBlockCommand Command, SegmentMutationStatus Expected)[]
        {
            ("same room", Command(destination: data.RoomsA[0].Id), SegmentMutationStatus.Invalid),
            ("blank actor", Command(actor: " "), SegmentMutationStatus.Invalid),
            ("reason over the limit", Command(reason: new string('x', SchedulingFieldLimits.Reason + 1)), SegmentMutationStatus.Invalid),
            ("source missing", Command(segment: Guid.NewGuid()), SegmentMutationStatus.NotFound),
            ("source of another property", Command(property: other.Property.Id), SegmentMutationStatus.NotFound),
            // Same-room is decided from the pre-read, so a source the pre-read must not see has to be NotFound first.
            ("another property's block, destination its own room", Command(segment: foreignBlock.Id, version: foreignBlock.Version, destination: other.Room.Id), SegmentMutationStatus.NotFound),
            ("source is an assignment", Command(segment: assignment.Id, version: assignment.Version), SegmentMutationStatus.NotFound),
            ("an assignment, destination its own room", Command(segment: assignment.Id, version: assignment.Version, destination: assignment.PhysicalRoomId), SegmentMutationStatus.NotFound),
            ("source already cancelled", Command(segment: cancelledNow.Id, version: cancelledNow.Version), SegmentMutationStatus.Conflict),
            ("stale version", Command(version: source.Version + 1), SegmentMutationStatus.Conflict),
            ("zero version", Command(version: 0), SegmentMutationStatus.Conflict),
            ("destination missing", Command(destination: Guid.NewGuid()), SegmentMutationStatus.NotFound),
            ("destination of another property", Command(destination: other.Room.Id), SegmentMutationStatus.NotFound),
            ("destination not Active", Command(destination: data.InactiveA.Id), SegmentMutationStatus.Conflict),
        };

        foreach (var (name, command, expected) in cases)
        {
            var result = await CreateStore().MoveAsync(command, CancellationToken.None);
            Assert.True(expected == result.Status, $"{name}: expected {expected}, got {result.Status} ({result.Error})");
            Assert.True(before == await StateAsync(), $"{name}: state changed");
        }

        // The same command, made valid, then succeeds — the refusals were about the inputs, not the fixture.
        Assert.Equal(SegmentMutationStatus.Succeeded, (await CreateStore().MoveAsync(Command(), CancellationToken.None)).Status);
    }

    [Fact]
    public async Task A_destination_occupied_by_an_assignment_or_another_block_is_a_conflict_and_an_adjacent_range_is_allowed()
    {
        var data = await SeedMoveAsync("move-overlap");
        var (_, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");
        await CreateAssignmentAsync(data, data.RoomsA[1], CheckIn.AddDays(3), CheckOut);
        await CreateBlockAsync(data, data.RoomsA[2], CheckIn.AddDays(-3), CheckIn.AddDays(1), "Overlaps the start");
        var before = await StateAsync();

        // The assignment in room 1 starts on the source's last night; the block in room 2 ends one night into it.
        foreach (var destination in new[] { data.RoomsA[1].Id, data.RoomsA[2].Id })
        {
            var result = await CreateStore().MoveAsync(
                new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, destination, "actor:mover", null), CancellationToken.None);
            Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
            Assert.Equal(before, await StateAsync());
        }

        // A block that ends exactly where the source starts, and one that starts exactly where it ends, do not overlap.
        await CreateBlockAsync(data, data.RoomsB[0], CheckIn.AddDays(-2), CheckIn, "Ends at the start");
        await CreateBlockAsync(data, data.RoomsB[0], CheckOut, CheckOut.AddDays(2), "Starts at the end");
        var adjacent = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsB[0].Id, "actor:mover", null), CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, adjacent.Status);
    }

    [Fact]
    public async Task A_block_of_366_nights_moves_and_one_of_367_is_refused_before_the_engine_enumerates_it()
    {
        var data = await SeedMoveAsync("move-span", roomsA: 3);
        var (_, long366) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckIn.AddDays(366), "A full leap year");
        var (_, long367) = await CreateBlockAsync(data, data.RoomsA[1], CheckIn, CheckIn.AddDays(367), "One night too many");
        var before = await StateAsync();

        var refused = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, long367.Id, long367.Version, data.RoomsA[2].Id, "actor:mover", null), CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Invalid, refused.Status);
        Assert.Equal(before, await StateAsync());

        var moved = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, long366.Id, long366.Version, data.RoomsA[2].Id, "actor:mover", null), CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, moved.Status);
        Assert.Equal((CheckIn, CheckIn.AddDays(366)), (moved.Segments![1].StartDate, moved.Segments[1].EndDate));
    }

    [Fact]
    public async Task An_extreme_source_range_is_refused_from_two_dates_alone_without_work_proportional_to_its_span()
    {
        // A long source can only be planted directly (the HTTP block create is bounded, the internal one is not
        // bounded to this extent); it exists only in this scratch database.
        var data = await SeedMoveAsync("move-extreme");
        var blockId = Guid.NewGuid();
        var segmentId = Guid.NewGuid();
        await using (var context = factory.CreateDbContext())
        {
            context.Add(new RoomBlock(blockId, data.Property.Id, "Forever", "actor:setup", Now));
            context.Add(new RoomOccupancySegment(segmentId, data.Property.Id, data.RoomsA[0].Id, RoomOccupancySegmentType.OperationalBlock,
                new DateOnly(2026, 1, 1), DateOnly.MaxValue, null, blockId, Now));
            await context.SaveChangesAsync();
        }

        var segment = await ReadSegmentAsync(segmentId);
        var before = await StateAsync();
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = await CreateStore().MoveAsync(
            new MoveOperationalBlockCommand(data.Property.Id, segmentId, segment.Version, data.RoomsA[1].Id, "actor:mover", null), CancellationToken.None);
        stopwatch.Stop();

        Assert.Equal(SegmentMutationStatus.Invalid, result.Status);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5), $"refused after {stopwatch.Elapsed}");
        Assert.Equal(before, await StateAsync());
    }

    [Fact]
    public async Task Two_moves_of_the_same_block_version_have_one_winner_and_one_conflict_with_no_partial_write()
    {
        for (var round = 0; round < 6; round++)
        {
            var data = await SeedMoveAsync($"move-race-{round}", roomsA: 3);
            var (header, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");
            var storeOne = CreateStore();
            var storeTwo = CreateStore();
            using var start = new SemaphoreSlim(0, 2);

            async Task<SegmentMutationResult> Run(IOperationalBlockMutationStore store, Guid destination)
            {
                await start.WaitAsync();
                return await store.MoveAsync(new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, destination, "actor:mover", null), CancellationToken.None);
            }

            var first = Run(storeOne, data.RoomsA[1].Id);
            var second = Run(storeTwo, data.RoomsA[2].Id);
            start.Release(2);
            var results = await Task.WhenAll(first, second);

            Assert.Equal(["Conflict", "Succeeded"], results.Select(r => r.Status.ToString()).Order(StringComparer.Ordinal).ToArray());
            await AssertSingleSuccessorAsync(header.Id, source.Id, expectedAudits: 3);
        }
    }

    [Fact]
    public async Task A_move_and_a_cancel_of_the_same_block_version_have_one_winner()
    {
        for (var round = 0; round < 6; round++)
        {
            var data = await SeedMoveAsync($"move-cancel-race-{round}", roomsA: 2);
            var (header, source) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "Leak");
            using var start = new SemaphoreSlim(0, 2);

            async Task<SegmentMutationResult> Move()
            {
                await start.WaitAsync();
                return await CreateStore().MoveAsync(new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsA[1].Id, "actor:mover", null), CancellationToken.None);
            }

            async Task<SegmentMutationResult> Cancel()
            {
                await start.WaitAsync();
                return await CreateStore().SupersedeSegmentsAsync(new SupersedeBlockSegmentsCommand(
                    data.Property.Id, [new BlockSegmentSupersession(source.Id, source.Version, [])], "actor:canceller", null), CancellationToken.None);
            }

            var tasks = new[] { Move(), Cancel() };
            start.Release(2);
            var results = await Task.WhenAll(tasks);

            Assert.Equal(["Conflict", "Succeeded"], results.Select(r => r.Status.ToString()).Order(StringComparer.Ordinal).ToArray());
            await using var verify = factory.CreateDbContext();
            var rows = await verify.RoomOccupancySegments.AsNoTracking().Where(s => s.RoomBlockId == header.Id).ToListAsync();
            Assert.Equal(RoomOccupancySegmentStatus.Cancelled, rows.Single(s => s.Id == source.Id).Status);
            // Either the cancel won (no Effective segment) or the move did (exactly one, in the destination).
            Assert.True(rows.Count(s => s.Status == RoomOccupancySegmentStatus.Effective) <= 1);
            var audits = await verify.RoomOccupancySegmentAudits.AsNoTracking().Where(a => rows.Select(r => r.Id).Contains(a.SegmentId)).CountAsync();
            Assert.Equal(rows.Count == 1 ? 2 : 3, audits);
        }
    }

    [Fact]
    public async Task Two_blocks_racing_for_one_destination_room_and_nights_have_one_winner()
    {
        for (var round = 0; round < 6; round++)
        {
            var data = await SeedMoveAsync($"move-destination-race-{round}", roomsA: 3);
            var (_, one) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "One");
            var (_, two) = await CreateBlockAsync(data, data.RoomsA[1], CheckIn.AddDays(2), CheckOut.AddDays(2), "Two");
            using var start = new SemaphoreSlim(0, 2);

            async Task<SegmentMutationResult> Run(RoomOccupancySegmentDto source)
            {
                await start.WaitAsync();
                return await CreateStore().MoveAsync(new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, data.RoomsA[2].Id, "actor:mover", null), CancellationToken.None);
            }

            var tasks = new[] { Run(one), Run(two) };
            start.Release(2);
            var results = await Task.WhenAll(tasks);

            Assert.Equal(["Conflict", "Succeeded"], results.Select(r => r.Status.ToString()).Order(StringComparer.Ordinal).ToArray());
            await using var verify = factory.CreateDbContext();
            Assert.Equal(1, await verify.RoomOccupancySegments.CountAsync(s => s.PhysicalRoomId == data.RoomsA[2].Id && s.Status == RoomOccupancySegmentStatus.Effective));
            Assert.Equal(2, await verify.RoomOccupancySegments.CountAsync(s => s.Status == RoomOccupancySegmentStatus.Effective && s.Type == RoomOccupancySegmentType.OperationalBlock));
        }
    }

    [Fact]
    public async Task Two_moves_that_together_would_exceed_the_destination_room_types_capacity_have_one_winner()
    {
        for (var round = 0; round < 6; round++)
        {
            // B has two rooms and two sold units: blocking even one B room is already a shortfall, so the
            // winner must be refused outright; with one sold unit exactly one of two blocks fits.
            var data = await SeedMoveAsync($"move-capacity-race-{round}");
            await SellAsync(data, data.TypeB, 1);
            var (_, one) = await CreateBlockAsync(data, data.RoomsA[0], CheckIn, CheckOut, "One");
            var (_, two) = await CreateBlockAsync(data, data.RoomsA[1], CheckIn, CheckOut, "Two");
            using var start = new SemaphoreSlim(0, 2);

            async Task<SegmentMutationResult> Run(RoomOccupancySegmentDto source, PhysicalRoom destination)
            {
                await start.WaitAsync();
                return await CreateStore().MoveAsync(new MoveOperationalBlockCommand(data.Property.Id, source.Id, source.Version, destination.Id, "actor:mover", null), CancellationToken.None);
            }

            var tasks = new[] { Run(one, data.RoomsB[0]), Run(two, data.RoomsB[1]) };
            start.Release(2);
            var results = await Task.WhenAll(tasks);

            Assert.Equal(["Conflict", "Succeeded"], results.Select(r => r.Status.ToString()).Order(StringComparer.Ordinal).ToArray());
            await using var verify = factory.CreateDbContext();
            Assert.Equal(1, await verify.RoomOccupancySegments.CountAsync(s => s.Status == RoomOccupancySegmentStatus.Effective && s.PhysicalRoomId != data.RoomsA[0].Id && s.PhysicalRoomId != data.RoomsA[1].Id));
        }
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

    // ---------------------------------------------------------------
    // PMS-CAL-003-CP01 helpers
    // ---------------------------------------------------------------

    private sealed record MoveFixture(
        Property Property, RoomType TypeA, RoomType TypeB, RatePlan RatePlan,
        List<PhysicalRoom> RoomsA, List<PhysicalRoom> RoomsB, PhysicalRoom InactiveA);

    private async Task<MoveFixture> SeedMoveAsync(string slug, int roomsA = 3, int roomsB = 2)
    {
        await factory.ResetDatabaseAsync();
        factory.Clock.UtcNow = Now;
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var typeA = new RoomType(Guid.NewGuid(), property.Id, "MVA", slug, $"{slug}-a", null, 2, 4, true, Now);
        var typeB = new RoomType(Guid.NewGuid(), property.Id, "MVB", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, "MV", slug, null, "VND", true, Now);
        context.AddRange(property, typeA, typeB, ratePlan);
        var listA = Enumerable.Range(0, roomsA).Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, typeA, $"A{i}", 1, OperationalStatus.Active, Now)).ToList();
        var listB = Enumerable.Range(0, roomsB).Select(i => new PhysicalRoom(Guid.NewGuid(), property.Id, typeB, $"B{i}", 1, OperationalStatus.Active, Now)).ToList();
        var inactive = new PhysicalRoom(Guid.NewGuid(), property.Id, typeA, "A-inactive", 1, OperationalStatus.OutOfService, Now);
        context.AddRange(listA.Concat(listB).Append(inactive));
        await context.SaveChangesAsync();
        return new MoveFixture(property, typeA, typeB, ratePlan, listA, listB, inactive);
    }

    private async Task<(Property Property, PhysicalRoom Room)> SeedForeignAsync()
    {
        await using var context = factory.CreateDbContext();
        var property = new Property(
            Guid.NewGuid(), "Hotel foreign", $"foreign-{Guid.NewGuid():N}", null, "2 Hotel Street", "Hue", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var type = new RoomType(Guid.NewGuid(), property.Id, "FOR", "foreign", $"foreign-{Guid.NewGuid():N}", null, 2, 4, true, Now);
        var room = new PhysicalRoom(Guid.NewGuid(), property.Id, type, "F0", 1, OperationalStatus.Active, Now);
        context.AddRange(property, type, room);
        await context.SaveChangesAsync();
        return (property, room);
    }

    private async Task<(RoomBlockDto Header, RoomOccupancySegmentDto Segment)> CreateBlockAsync(
        MoveFixture data, PhysicalRoom room, DateOnly start, DateOnly end, string reason)
    {
        var created = await CreateStore().CreateBlockAsync(
            new CreateRoomBlockCommand(data.Property.Id, reason, "actor:housekeeping", [new BlockSegmentSpec(room.Id, start, end)]),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, created.Status);
        return (created.Block!, created.Segments![0]);
    }

    private async Task SellAsync(MoveFixture data, RoomType type, int units)
    {
        await using var context = factory.CreateDbContext();
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new TheBha.Domain.Bookings.NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m)).ToArray();
        var seed = $"sell-{type.Id}-{units}";
        var hold = new TheBha.Domain.Bookings.InventoryHold(
            Guid.NewGuid(), data.Property.Id, type.Id, units, null, "Fill Guest", "fill@example.com",
            "+84 900 000 444", CheckIn, CheckOut, 1, 0, "VND", Now,
            HexHash($"{seed}:idempotency"), HexHash($"{seed}:fingerprint"), HexHash($"{seed}:guest"), nights);
        context.Add(hold);
        context.Add(hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(seed)[..8].ToUpperInvariant()}", Now));
        await context.SaveChangesAsync();
    }

    private async Task PlaceHoldAsync(MoveFixture data, RoomType type, int quantity, DateTimeOffset createdAtUtc)
    {
        await using var context = factory.CreateDbContext();
        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new TheBha.Domain.Bookings.NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m)).ToArray();
        context.Add(new TheBha.Domain.Bookings.InventoryHold(
            Guid.NewGuid(), data.Property.Id, type.Id, quantity, null, "Hold Guest", "hold@example.com",
            "+84 900 000 555", CheckIn, CheckOut, 1, 0, "VND", createdAtUtc,
            HexHash("move-hold:idempotency"), HexHash("move-hold:fingerprint"), HexHash("move-hold:guest"), nights));
        await context.SaveChangesAsync();
    }

    /// <summary>An Effective reservation assignment in <paramref name="room"/>, over a unit sold for the whole stay.</summary>
    private async Task<RoomOccupancySegmentDto> CreateAssignmentAsync(MoveFixture data, PhysicalRoom room, DateOnly? start = null, DateOnly? end = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        await using var context = factory.CreateDbContext();
        if (!await context.ReservationUnits.AnyAsync(u => u.PropertyId == data.Property.Id && u.RoomTypeId == data.TypeA.Id))
        {
            await SellAsync(data, data.TypeA, 1);
        }

        var unit = await context.ReservationUnits.AsNoTracking()
            .Where(u => u.PropertyId == data.Property.Id && u.RoomTypeId == data.TypeA.Id)
            .OrderBy(u => u.Id)
            .FirstAsync();
        var store = scope.ServiceProvider.GetRequiredService<IAssignmentMutationStore>();
        var result = await store.CreateAsync(
            new CreateAssignmentCommand(data.Property.Id, unit.Id, new AssignmentDestination(room.Id, start ?? CheckIn, end ?? CheckOut), "actor:front-desk", null, null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        return result.Segments![0];
    }

    private sealed record SegmentRef(Guid Id, uint Version);

    /// <summary>The segment's id and committed version (xmin), whatever its status.</summary>
    private async Task<SegmentRef> ReadSegmentAsync(Guid segmentId)
    {
        await using var context = factory.CreateDbContext();
        var row = await context.RoomOccupancySegments.SingleAsync(s => s.Id == segmentId);
        return new SegmentRef(row.Id, context.Entry(row).Property<uint>("xmin").CurrentValue);
    }

    /// <summary>
    /// Every segment (with its committed xmin), header, audit row and the commercial snapshot of every Unit:
    /// a refusal must change none of it. Lines are keyed by segment id so a test can look one up.
    /// </summary>
    private async Task<string> StateAsync()
    {
        await using var context = factory.CreateDbContext();
        var segments = (await context.RoomOccupancySegments.ToListAsync()).OrderBy(s => s.Id)
            .Select(s => $"S|{s.Id}|{s.Type}|{s.Status}|{s.PhysicalRoomId}|{s.StartDate:yyyy-MM-dd}|{s.EndDate:yyyy-MM-dd}|{s.RoomBlockId}|{context.Entry(s).Property<uint>("xmin").CurrentValue}");
        var blocks = (await context.RoomBlocks.AsNoTracking().ToListAsync()).OrderBy(b => b.Id)
            .Select(b => $"B|{b.Id}|{b.Reason}|{b.CreatedByActorReference}|{b.CreatedAtUtc:O}");
        var audits = (await context.RoomOccupancySegmentAudits.AsNoTracking().ToListAsync()).OrderBy(a => a.Id)
            .Select(a => $"A|{a.Id}|{a.SegmentId}|{a.MutationGroupId}|{a.EventType}|{a.ActorReference}|{a.AuthorizationEvidence}|{a.Reason}");
        return string.Join("\n", segments.Concat(blocks).Concat(audits)) + "\n--\n" + await CommercialAsync();
    }

    private static string StateLine(string state, Guid segmentId) =>
        state.Split('\n').Single(line => line.StartsWith($"S|{segmentId}|", StringComparison.Ordinal));

    private static string CommercialPart(string state) => state[(state.IndexOf("\n--\n", StringComparison.Ordinal) + 4)..];

    private async Task<string> CommercialAsync()
    {
        await using var context = factory.CreateDbContext();
        var units = await context.ReservationUnits.AsNoTracking().Include(u => u.Nights).OrderBy(u => u.Id).ToListAsync();
        return string.Join("\n", units.Select(u =>
            $"{u.Id}|{u.RoomTypeId}|{u.CommitmentStatus}|{string.Join(",", u.Nights.OrderBy(n => n.StayDate).Select(n => $"{n.StayDate:yyyy-MM-dd}/{n.RatePlanId}/{n.UnitAmount:0.00}"))}"));
    }

    private async Task AssertSingleSuccessorAsync(Guid headerId, Guid sourceId, int expectedAudits)
    {
        await using var verify = factory.CreateDbContext();
        var rows = await verify.RoomOccupancySegments.AsNoTracking().Where(s => s.RoomBlockId == headerId).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled, rows.Single(s => s.Id == sourceId).Status);
        Assert.Equal(1, rows.Count(s => s.Status == RoomOccupancySegmentStatus.Effective));
        Assert.Equal(expectedAudits, await verify.RoomOccupancySegmentAudits.CountAsync(a => rows.Select(r => r.Id).Contains(a.SegmentId)));
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(Property Property, RoomType RoomType, List<PhysicalRoom> Rooms, RatePlan RatePlan);
}
