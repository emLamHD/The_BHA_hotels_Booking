using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-BE-001.2 Phase 4 evidence for <see cref="IAssignmentMutationStore"/>: safe
/// internal assignment create/split/move/batch-swap/unassign mutation, cross-RoomType
/// authorization/capacity enforcement, optimistic concurrency, append-only audit
/// evidence, and exact <c>23P01</c>/deferred-trigger error mapping — all against real
/// PostgreSQL 17.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AssignmentMutationStoreTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 6); // 5 nights: 9/1-9/5

    [Fact]
    public async Task Same_room_type_assignment_creation_succeeds_without_authorization_evidence()
    {
        var data = await SeedAsync("same-type-create");
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        Assert.Single(result.Segments!);
        Assert.Equal(RoomOccupancySegmentType.ReservationAssignment.ToString(), result.Segments![0].Type);
    }

    [Fact]
    public async Task Authorized_cross_room_type_assignment_succeeds()
    {
        var data = await SeedAsync("cross-type-create");
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", "evidence:manager-approval-1234", "Guest requested upgrade"),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        Assert.Equal(data.RoomsB[0].Id, result.Segments![0].PhysicalRoomId);
    }

    [Fact]
    public async Task Missing_cross_room_type_authorization_evidence_is_rejected()
    {
        var data = await SeedAsync("cross-type-missing-evidence");
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Unauthorized, result.Status);
        Assert.Empty(await CountSegmentsAsync(data.Property.Id));
    }

    [Fact]
    public async Task Cross_property_assignment_destination_is_rejected()
    {
        var dataA = await SeedAsync("cross-property-a");
        var dataB = await SeedAsync("cross-property-b");
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                dataA.Property.Id, dataA.UnitsA[0].Id,
                new AssignmentDestination(dataB.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.NotFound, result.Status);
    }

    [Fact]
    public async Task Inactive_destination_is_rejected()
    {
        var data = await SeedAsync("inactive-destination");
        await using var context = factory.CreateDbContext();
        var inactiveRoom = new PhysicalRoom(
            Guid.NewGuid(), data.Property.Id, data.RoomTypeA, "INACTIVE", 1, OperationalStatus.Inactive, Now);
        context.Add(inactiveRoom);
        await context.SaveChangesAsync();
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(inactiveRoom.Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
    }

    [Fact]
    public async Task Assignment_into_a_cancelled_unit_is_rejected()
    {
        var data = await SeedAsync("cancelled-unit");
        await using var context = factory.CreateDbContext();
        var reservation = await context.Reservations.Include(r => r.Units).SingleAsync(r => r.Id == data.ReservationA.Id);
        reservation.Cancel("test", Now, CheckIn.AddDays(-1));
        await context.SaveChangesAsync();
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
    }

    [Fact]
    public async Task Assignment_outside_exact_booked_nights_is_rejected()
    {
        var data = await SeedAsync("outside-booked-nights");
        var store = CreateStore();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut.AddDays(2)),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        Assert.Empty(await CountSegmentsAsync(data.Property.Id));
    }

    [Fact]
    public async Task Split_preserves_commercial_nights_price_and_creates_two_successor_segments()
    {
        var data = await SeedAsync("split");
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var original = created.Segments![0];
        var midpoint = CheckIn.AddDays(2);

        var totalBefore = await UnitTotalAmountAsync(data.UnitsA[0].Id);

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [
                    new AssignmentSupersession(
                        original.Id, original.Version,
                        [
                            new AssignmentDestination(data.RoomsA[0].Id, CheckIn, midpoint),
                            new AssignmentDestination(data.RoomsA[1].Id, midpoint, CheckOut)
                        ])
                ],
                "actor:front-desk", null, "Room move for maintenance"),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        Assert.Equal(3, result.Segments!.Count); // 1 cancelled + 2 created
        var totalAfter = await UnitTotalAmountAsync(data.UnitsA[0].Id);
        Assert.Equal(totalBefore, totalAfter);

        await using var verify = factory.CreateDbContext();
        var oldReloaded = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == original.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Cancelled, oldReloaded.Status);
        var effective = await verify.RoomOccupancySegments
            .Where(s => s.ReservationUnitId == data.UnitsA[0].Id && s.Status == RoomOccupancySegmentStatus.Effective)
            .ToListAsync();
        Assert.Equal(2, effective.Count);
    }

    [Fact]
    public async Task Move_preserves_commercial_nights_and_price()
    {
        var data = await SeedAsync("move");
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var original = created.Segments![0];
        var totalBefore = await UnitTotalAmountAsync(data.UnitsA[0].Id);

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [
                    new AssignmentSupersession(
                        original.Id, original.Version,
                        [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)])
                ],
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        Assert.Equal(totalBefore, await UnitTotalAmountAsync(data.UnitsA[0].Id));

        await using var verify = factory.CreateDbContext();
        Assert.Equal(
            RoomOccupancySegmentStatus.Cancelled,
            (await verify.RoomOccupancySegments.SingleAsync(s => s.Id == original.Id)).Status);
        var newSegment = await verify.RoomOccupancySegments.SingleAsync(
            s => s.ReservationUnitId == data.UnitsA[0].Id && s.Status == RoomOccupancySegmentStatus.Effective);
        Assert.Equal(data.RoomsA[1].Id, newSegment.PhysicalRoomId);
    }

    [Fact]
    public async Task Audit_rows_are_appended_and_the_old_segment_is_never_overwritten()
    {
        var data = await SeedAsync("audit-append");
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var original = created.Segments![0];
        var originalStart = original.StartDate;
        var originalEnd = original.EndDate;
        var originalRoom = original.PhysicalRoomId;

        await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(original.Id, original.Version, [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)])],
                "actor:front-desk", null, null),
            CancellationToken.None);

        await using var verify = factory.CreateDbContext();
        var oldSegment = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == original.Id);
        Assert.Equal(originalStart, oldSegment.StartDate);
        Assert.Equal(originalEnd, oldSegment.EndDate);
        Assert.Equal(originalRoom, oldSegment.PhysicalRoomId);

        var audits = await verify.RoomOccupancySegmentAudits.Where(a => a.SegmentId == original.Id).ToListAsync();
        Assert.Equal(2, audits.Count); // Created (from CreateAsync) + Cancelled (from SupersedeAsync)
        Assert.Contains(audits, a => a.EventType == RoomOccupancySegmentAuditEventType.Created);
        Assert.Contains(audits, a => a.EventType == RoomOccupancySegmentAuditEventType.Cancelled);
    }

    [Fact]
    public async Task Optimistic_concurrency_conflict_leaves_state_unchanged()
    {
        var data = await SeedAsync("concurrency");
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var original = created.Segments![0];
        var staleVersion = original.Version + 1000; // guaranteed mismatch

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(original.Id, staleVersion, [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)])],
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        await using var verify = factory.CreateDbContext();
        var reloaded = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == original.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, reloaded.Status);
        Assert.Equal(data.RoomsA[0].Id, reloaded.PhysicalRoomId);
    }

    [Fact]
    public async Task Unsafe_cross_type_unassign_is_rejected_and_old_assignment_preserved()
    {
        // RoomTypeA has exactly as many active rooms as committed units sold under
        // it, so falling back a cross-type assignment to sold-type A has no headroom.
        var data = await SeedAsync("unsafe-unassign", roomsAPerType: 1, unitsA: 1);
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", "evidence:1", "upgrade"),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, created.Status);
        var effective = created.Segments![0];

        // Sell RoomTypeA's only physical room to another committed unit, consuming
        // the fallback headroom the unassign would need.
        await SellOutRoomTypeAAsync(data);

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(effective.Id, effective.Version, [])],
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        await using var verify = factory.CreateDbContext();
        var reloaded = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == effective.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, reloaded.Status);
        Assert.Equal(data.RoomsB[0].Id, reloaded.PhysicalRoomId);
    }

    [Fact]
    public async Task Unsafe_cross_type_reassign_is_rejected_and_old_assignment_preserved()
    {
        var data = await SeedAsync("unsafe-reassign", roomsBPerType: 1, unitsA: 2);
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", "evidence:1", "upgrade"),
            CancellationToken.None);
        var effective = created.Segments![0];

        // Only one RoomTypeB room exists and it is already occupied by this
        // assignment; block it out for a second unit so no OTHER RoomTypeB room
        // exists to reassign to (simulate no headroom by using a same-room target
        // that is impossible — instead, use an inactive alternative room).
        await using var context = factory.CreateDbContext();
        var noHeadroomRoom = new PhysicalRoom(
            Guid.NewGuid(), data.Property.Id, data.RoomTypeB, "B-FULL", 1, OperationalStatus.Active, Now);
        context.Add(noHeadroomRoom);
        await context.SaveChangesAsync();
        // Occupy the alternative room for the same dates with a different unit so
        // RoomTypeB has zero remaining headroom anywhere.
        var otherUnit = data.UnitsA.Count > 1 ? data.UnitsA[1] : null;
        Assert.NotNull(otherUnit);
        var storeForFill = CreateStore();
        var fill = await storeForFill.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, otherUnit!.Id,
                new AssignmentDestination(noHeadroomRoom.Id, CheckIn, CheckOut),
                "actor:front-desk", "evidence:1", "fill"),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, fill.Status);

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(effective.Id, effective.Version, [new AssignmentDestination(noHeadroomRoom.Id, CheckIn, CheckOut)])],
                "actor:front-desk", "evidence:1", "attempt"),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        await using var verify = factory.CreateDbContext();
        var reloaded = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == effective.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, reloaded.Status);
        Assert.Equal(data.RoomsB[0].Id, reloaded.PhysicalRoomId);
    }

    [Fact]
    public async Task Valid_cross_type_move_succeeds_with_correct_nightly_attribution()
    {
        var data = await SeedAsync("valid-cross-move", roomsBPerType: 2, unitsA: 1);
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", "evidence:1", "upgrade"),
            CancellationToken.None);
        var effective = created.Segments![0];

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(effective.Id, effective.Version, [new AssignmentDestination(data.RoomsB[1].Id, CheckIn, CheckOut)])],
                "actor:front-desk", "evidence:1", "second move"),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
        await using var scope = factory.Services.CreateAsyncScope();
        var dataSource = scope.ServiceProvider.GetRequiredService<TheBha.Application.Properties.IAvailabilityDataSource>();
        var loaded = await dataSource.LoadAsync(data.Property.Id, CheckIn, CheckIn.AddDays(1), Now, CancellationToken.None);
        var demand = loaded!.CommittedDemand.ToDictionary(d => (d.RoomTypeId, d.StayDate), d => d.Rooms);
        Assert.Equal(0, demand.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)));
        Assert.Equal(1, demand.GetValueOrDefault((data.RoomTypeB.Id, CheckIn)));
    }

    [Fact]
    public async Task Same_type_move_leaves_room_type_demand_unchanged()
    {
        var data = await SeedAsync("same-type-move");
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var effective = created.Segments![0];

        await using var scope1 = factory.Services.CreateAsyncScope();
        var dataSourceBefore = scope1.ServiceProvider.GetRequiredService<TheBha.Application.Properties.IAvailabilityDataSource>();
        var before = (await dataSourceBefore.LoadAsync(data.Property.Id, CheckIn, CheckIn.AddDays(1), Now, CancellationToken.None))!
            .CommittedDemand.ToDictionary(d => (d.RoomTypeId, d.StayDate), d => d.Rooms);

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(effective.Id, effective.Version, [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)])],
                "actor:front-desk", null, null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);

        await using var scope2 = factory.Services.CreateAsyncScope();
        var dataSourceAfter = scope2.ServiceProvider.GetRequiredService<TheBha.Application.Properties.IAvailabilityDataSource>();
        var after = (await dataSourceAfter.LoadAsync(data.Property.Id, CheckIn, CheckIn.AddDays(1), Now, CancellationToken.None))!
            .CommittedDemand.ToDictionary(d => (d.RoomTypeId, d.StayDate), d => d.Rooms);

        Assert.Equal(before.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)), after.GetValueOrDefault((data.RoomTypeA.Id, CheckIn)));
    }

    [Fact]
    public async Task Valid_atomic_two_unit_swap_succeeds_in_one_command_without_transient_conflict()
    {
        var data = await SeedAsync("atomic-swap", unitsA: 2);
        var store = CreateStore();
        var firstAssignment = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var secondAssignment = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[1].Id,
                new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var segment1 = firstAssignment.Segments![0];
        var segment2 = secondAssignment.Segments![0];

        var swap = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [
                    new AssignmentSupersession(segment1.Id, segment1.Version, [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)]),
                    new AssignmentSupersession(segment2.Id, segment2.Version, [new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut)])
                ],
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Succeeded, swap.Status);
        await using var verify = factory.CreateDbContext();
        var effective = await verify.RoomOccupancySegments
            .Where(s => s.Status == RoomOccupancySegmentStatus.Effective && s.ReservationUnitId != null &&
                        (s.ReservationUnitId == data.UnitsA[0].Id || s.ReservationUnitId == data.UnitsA[1].Id))
            .ToListAsync();
        Assert.Equal(2, effective.Count);
        Assert.Contains(effective, s => s.ReservationUnitId == data.UnitsA[0].Id && s.PhysicalRoomId == data.RoomsA[1].Id);
        Assert.Contains(effective, s => s.ReservationUnitId == data.UnitsA[1].Id && s.PhysicalRoomId == data.RoomsA[0].Id);
    }

    [Fact]
    public async Task Concurrent_assignment_mutation_and_hold_creation_cannot_oversell()
    {
        var data = await SeedAsync("concurrency-hold", roomsAPerType: 1, unitsA: 1);
        var store = CreateStore();
        // Assign the only RoomTypeA room's dates via cross-type assignment away,
        // freeing RoomTypeA back to sold-demand-only, then race a Hold creation for
        // the same single room against a reassignment that would consume it.
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", "evidence:1", "upgrade"),
            CancellationToken.None);
        var effective = created.Segments![0];

        await using var scope = factory.Services.CreateAsyncScope();
        var holdCreation = scope.ServiceProvider.GetRequiredService<TheBha.Application.Bookings.IBookingHoldCreationStore>();
        var holdRequest = new TheBha.Application.Bookings.PreparedBookingHoldRequest(
            data.Property.Id, data.RoomTypeA.Id, data.RatePlan.Id, CheckIn, CheckOut, 1, 0, 1,
            "Guest", "guest@example.com", "+84 900 000 111", null,
            HexHash("hold-race"), HexHash("hold-race-fp"));

        var unassignTask = store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(effective.Id, effective.Version, [])],
                "actor:front-desk", null, null),
            CancellationToken.None);
        var holdTask = holdCreation.CreateAsync(holdRequest, CancellationToken.None);
        await Task.WhenAll(unassignTask, holdTask);

        var unassignResult = await unassignTask;
        var holdResult = await holdTask;

        // Whichever committed first wins the single free room; the other observes
        // the resulting state honestly (Conflict) rather than both succeeding.
        var successes = new[] { unassignResult.Status == SegmentMutationStatus.Succeeded, holdResult.Status == TheBha.Application.Bookings.BookingHoldCreationStatus.Created }
            .Count(x => x);
        Assert.True(successes <= 1, "Both the reassignment-back-to-sold-type and the new Hold succeeded, which would oversell the single RoomTypeA room.");
    }

    [Fact]
    public async Task Concurrent_assignment_mutation_and_reservation_cancellation_produce_one_valid_final_state()
    {
        var data = await SeedAsync("concurrency-cancel");
        var store = CreateStore();
        var created = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        var effective = created.Segments![0];

        await using var scope = factory.Services.CreateAsyncScope();
        var cancellationStore = scope.ServiceProvider.GetRequiredService<TheBha.Application.Bookings.IReservationCancellationStore>();

        var moveTask = store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [new AssignmentSupersession(effective.Id, effective.Version, [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)])],
                "actor:front-desk", null, null),
            CancellationToken.None);
        var cancelTask = cancellationStore.CancelAsync(
            data.ReservationA.Id, null, data.ReservationA.GuestAccessTokenHash, "concurrent cancel", CancellationToken.None);
        await Task.WhenAll(moveTask, cancelTask);

        await using var verify = factory.CreateDbContext();
        var effectiveCount = await verify.RoomOccupancySegments
            .CountAsync(s => s.ReservationUnitId == data.UnitsA[0].Id && s.Status == RoomOccupancySegmentStatus.Effective);
        // Whichever operation committed last leaves exactly one valid final state:
        // either the moved assignment (if cancellation lost/no-oped) or zero
        // Effective assignments (if cancellation cleaned it up) — never both an
        // Effective segment AND a Cancelled unit's assignment left dangling.
        var unit = await verify.ReservationUnits.SingleAsync(u => u.Id == data.UnitsA[0].Id);
        if (unit.CommitmentStatus == CommitmentStatus.Cancelled)
        {
            Assert.Equal(0, effectiveCount);
        }
        else
        {
            Assert.Equal(1, effectiveCount);
        }
    }

    [Fact]
    public async Task Deterministic_lock_ordering_across_many_units_completes_without_deadlock()
    {
        var data = await SeedAsync("no-deadlock", roomsAPerType: 4, unitsA: 4);
        var store = CreateStore();
        var created = new List<RoomOccupancySegmentDto>();
        for (var i = 0; i < 4; i++)
        {
            var result = await store.CreateAsync(
                new CreateAssignmentCommand(
                    data.Property.Id, data.UnitsA[i].Id,
                    new AssignmentDestination(data.RoomsA[i].Id, CheckIn, CheckOut),
                    "actor:front-desk", null, null),
                CancellationToken.None);
            created.Add(result.Segments![0]);
        }

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        // Two overlapping-key swaps racing in opposite key order would deadlock a
        // naive per-operation lock order; the shared coordinator's single
        // deterministic order must prevent that here. Each concurrent call needs its
        // own store/DbContext instance — a single DbContext cannot run two
        // operations concurrently.
        var storeForAB = CreateStore();
        var storeForCD = CreateStore();
        var swapAB = storeForAB.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [
                    new AssignmentSupersession(created[0].Id, created[0].Version, [new AssignmentDestination(data.RoomsA[1].Id, CheckIn, CheckOut)]),
                    new AssignmentSupersession(created[1].Id, created[1].Version, [new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut)])
                ],
                "actor:front-desk", null, null),
            timeout.Token);
        var swapCD = storeForCD.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                data.Property.Id,
                [
                    new AssignmentSupersession(created[2].Id, created[2].Version, [new AssignmentDestination(data.RoomsA[3].Id, CheckIn, CheckOut)]),
                    new AssignmentSupersession(created[3].Id, created[3].Version, [new AssignmentDestination(data.RoomsA[2].Id, CheckIn, CheckOut)])
                ],
                "actor:front-desk", null, null),
            timeout.Token);

        await Task.WhenAll(swapAB, swapCD);
        Assert.Equal(SegmentMutationStatus.Succeeded, (await swapAB).Status);
        Assert.Equal(SegmentMutationStatus.Succeeded, (await swapCD).Status);
    }

    [Fact]
    public async Task Physical_room_overlap_maps_to_the_exact_exclusion_constraint_conflict()
    {
        var data = await SeedAsync("exact-error-mapping", unitsA: 2);
        var store = CreateStore();
        await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[1].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn.AddDays(1), CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);

        Assert.Equal(SegmentMutationStatus.Conflict, result.Status);
        Assert.Contains("PhysicalRoom", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("23P01", result.Error, StringComparison.Ordinal);
        Assert.DoesNotContain("Npgsql", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rejected_mutation_leaves_no_partial_segments_or_audit_records()
    {
        var data = await SeedAsync("no-partial-state");

        var store = CreateStore();
        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, data.UnitsA[0].Id,
                new AssignmentDestination(data.RoomsB[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null), // cross-type, no evidence -> Unauthorized
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Unauthorized, result.Status);

        await using var verify = factory.CreateDbContext();
        Assert.Empty(await verify.RoomOccupancySegments.Where(s => s.PropertyId == data.Property.Id).ToListAsync());
        Assert.Empty(await verify.RoomOccupancySegmentAudits.ToListAsync());
    }

    private IAssignmentMutationStore CreateStore()
    {
        var scope = factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<IAssignmentMutationStore>();
    }

    private async Task<decimal> UnitTotalAmountAsync(Guid unitId)
    {
        await using var context = factory.CreateDbContext();
        return await context.ReservationUnitNights.Where(n => n.ReservationUnitId == unitId).SumAsync(n => n.UnitAmount);
    }

    private async Task<List<RoomOccupancySegment>> CountSegmentsAsync(Guid propertyId)
    {
        await using var context = factory.CreateDbContext();
        return await context.RoomOccupancySegments.Where(s => s.PropertyId == propertyId).ToListAsync();
    }

    private async Task SellOutRoomTypeAAsync(Fixture data)
    {
        await using var context = factory.CreateDbContext();
        var hold = new InventoryHold(
            Guid.NewGuid(), data.Property.Id, data.RoomTypeA.Id, 1, null, "Fill Guest", "fill@example.com",
            "+84 900 000 222", CheckIn, CheckOut, 1, 0, "VND", Now,
            HexHash("fill:idempotency"), HexHash("fill:fingerprint"), HexHash("fill:guest"),
            Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
                .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), data.RatePlan.Id, 100m)));
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-FILL-0001", Now);
        context.Add(reservation);
        await context.SaveChangesAsync();
        // Assign it to the room so it consumes the only RoomTypeA physical room.
        var store = CreateStore();
        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                data.Property.Id, reservation.Units[0].Id,
                new AssignmentDestination(data.RoomsA[0].Id, CheckIn, CheckOut),
                "actor:front-desk", null, null),
            CancellationToken.None);
        Assert.Equal(SegmentMutationStatus.Succeeded, result.Status);
    }

    private async Task<Fixture> SeedAsync(
        string slug,
        int roomsAPerType = 3,
        int roomsBPerType = 3,
        int unitsA = 1)
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();

        var property = new Property(
            Guid.NewGuid(), $"Hotel {slug}", slug, null, "1 Hotel Street", "Da Nang", "Vietnam",
            "Asia/Ho_Chi_Minh", new TimeOnly(14, 0), new TimeOnly(12, 0), true, Now);
        var roomTypeA = new RoomType(Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}A", slug, $"{slug}-a", null, 2, 4, true, Now);
        var roomTypeB = new RoomType(Guid.NewGuid(), property.Id, $"{slug.ToUpperInvariant()}B", slug, $"{slug}-b", null, 2, 4, true, Now);
        var ratePlan = new RatePlan(Guid.NewGuid(), property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.AddRange(property, roomTypeA, roomTypeB, ratePlan);

        var roomsA = new List<PhysicalRoom>();
        for (var i = 0; i < roomsAPerType; i++)
        {
            var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeA, $"A{i}", 1, OperationalStatus.Active, Now);
            roomsA.Add(room);
            context.Add(room);
        }

        var roomsB = new List<PhysicalRoom>();
        for (var i = 0; i < roomsBPerType; i++)
        {
            var room = new PhysicalRoom(Guid.NewGuid(), property.Id, roomTypeB, $"B{i}", 1, OperationalStatus.Active, Now);
            roomsB.Add(room);
            context.Add(room);
        }

        var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
            .Select(o => new NightlyCommitmentSnapshot(CheckIn.AddDays(o), ratePlan.Id, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), property.Id, roomTypeA.Id, unitsA, null, "Fixture Guest", "fixture@example.com",
            "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            HexHash(slug + ":idempotency"), HexHash(slug + ":fingerprint"), HexHash(slug + ":guest"), nights);
        context.Add(hold);
        var reservation = hold.Confirm(Guid.NewGuid(), $"BHA-{HexHash(slug)[..8].ToUpperInvariant()}", Now);
        context.Add(reservation);

        await context.SaveChangesAsync();
        return new Fixture(property, roomTypeA, roomTypeB, roomsA, roomsB, ratePlan, reservation, reservation.Units.ToList());
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        RoomType RoomTypeA,
        RoomType RoomTypeB,
        List<PhysicalRoom> RoomsA,
        List<PhysicalRoom> RoomsB,
        RatePlan RatePlan,
        Reservation ReservationA,
        List<ReservationUnit> UnitsA);
}
