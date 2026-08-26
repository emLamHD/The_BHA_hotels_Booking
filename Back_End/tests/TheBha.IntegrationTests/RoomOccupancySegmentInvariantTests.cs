using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;
using TheBha.Infrastructure.Persistence;

namespace TheBha.IntegrationTests;

/// <summary>
/// PMS-BE-001.2 Phase 2 database-integrity evidence: the two PostgreSQL exclusion
/// invariants (ADR 0006 Decision item 6), the booked-night coverage deferrable
/// constraint trigger (Decision item 9), the unit-commitment consistency deferrable
/// constraint trigger (Decision item 3's third rule, blueprint §7 rule 28), the
/// type/reference CHECK constraint, and same-Property composite-FK rejection — all
/// exercised directly against real PostgreSQL 17, never EF InMemory/SQLite.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class RoomOccupancySegmentInvariantTests(PostgreSqlWebApplicationFactory factory)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-07-22T00:00:00Z");

    // Half-open [CheckIn, CheckOut) = 4 booked nights: 9/1, 9/2, 9/3, 9/4.
    private static readonly DateOnly CheckIn = new(2026, 9, 1);
    private static readonly DateOnly CheckOut = new(2026, 9, 5);

    [Fact]
    public async Task Overlapping_effective_assignments_on_one_physical_room_are_rejected()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "room-overlap", roomCount: 1, unitCount: 2);

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(2)));
        await context.SaveChangesAsync();

        context.Add(Assignment(data, data.Rooms[0], data.Units[1], CheckIn.AddDays(1), CheckIn.AddDays(3)));
        await AssertExclusionViolationAsync(
            () => context.SaveChangesAsync(),
            "EX_RoomOccupancySegments_EffectiveRoomOverlap");
    }

    [Fact]
    public async Task Assignment_versus_operational_block_overlap_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "assignment-vs-block", roomCount: 1, unitCount: 1);

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(2)));
        await context.SaveChangesAsync();

        var block = new RoomBlock(Guid.NewGuid(), data.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(block);
        context.Add(Block(data, data.Rooms[0], block, CheckIn.AddDays(1), CheckIn.AddDays(3)));
        await AssertExclusionViolationAsync(
            () => context.SaveChangesAsync(),
            "EX_RoomOccupancySegments_EffectiveRoomOverlap");
    }

    [Fact]
    public async Task Overlapping_operational_blocks_are_rejected()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "block-overlap", roomCount: 1, unitCount: 0);

        var block = new RoomBlock(Guid.NewGuid(), data.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(block);
        context.Add(Block(data, data.Rooms[0], block, CheckIn, CheckIn.AddDays(2)));
        await context.SaveChangesAsync();

        context.Add(Block(data, data.Rooms[0], block, CheckIn.AddDays(1), CheckIn.AddDays(3)));
        await AssertExclusionViolationAsync(
            () => context.SaveChangesAsync(),
            "EX_RoomOccupancySegments_EffectiveRoomOverlap");
    }

    [Fact]
    public async Task One_unit_cannot_be_effective_assigned_to_two_rooms_for_the_same_date()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "unit-overlap", roomCount: 2, unitCount: 1);

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(2)));
        await context.SaveChangesAsync();

        context.Add(Assignment(data, data.Rooms[1], data.Units[0], CheckIn.AddDays(1), CheckIn.AddDays(3)));
        await AssertExclusionViolationAsync(
            () => context.SaveChangesAsync(),
            "EX_RoomOccupancySegments_EffectiveUnitOverlap");
    }

    [Fact]
    public async Task Adjacent_half_open_segments_on_the_same_room_are_allowed()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "adjacent", roomCount: 1, unitCount: 2);

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(2)));
        await context.SaveChangesAsync();

        context.Add(Assignment(data, data.Rooms[0], data.Units[1], CheckIn.AddDays(2), CheckOut));
        await context.SaveChangesAsync();

        Assert.Equal(2, await context.RoomOccupancySegments.CountAsync());
    }

    [Fact]
    public async Task Cancelled_segment_does_not_block_the_schedule()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "cancelled-frees-room", roomCount: 1, unitCount: 2);

        var first = Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(2));
        context.Add(first);
        await context.SaveChangesAsync();

        first.Cancel();
        await context.SaveChangesAsync();

        context.Add(Assignment(data, data.Rooms[0], data.Units[1], CheckIn, CheckIn.AddDays(2)));
        await context.SaveChangesAsync();

        Assert.Equal(
            RoomOccupancySegmentStatus.Cancelled,
            (await context.RoomOccupancySegments.SingleAsync(s => s.Id == first.Id)).Status);
    }

    [Fact]
    public async Task Wrong_type_reference_combination_is_rejected_by_postgres()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "type-reference", roomCount: 1, unitCount: 1);

        var action = () => context.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO "RoomOccupancySegments"
                 ("Id","PropertyId","PhysicalRoomId","Type","Status","StartDate","EndDate",
                  "ReservationUnitId","RoomBlockId","CreatedAtUtc")
             VALUES
                 ({Guid.NewGuid()},{data.Property.Id},{data.Rooms[0].Id},'ReservationAssignment','Effective',
                  {CheckIn},{CheckIn.AddDays(1)},NULL,{Guid.NewGuid()},{Now});
             """);
        await AssertPostgresErrorAsync(action, PostgresErrorCodes.CheckViolation);
    }

    [Fact]
    public async Task Cross_property_physical_room_reference_is_rejected_by_postgres()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var dataA = await CreateFixtureAsync(context, "cross-property-a", roomCount: 1, unitCount: 1);
        var dataB = await CreateFixtureAsync(context, "cross-property-b", roomCount: 1, unitCount: 1);

        context.Add(Assignment(dataA, dataB.Rooms[0], dataA.Units[0], CheckIn, CheckIn.AddDays(1)));
        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Cross_property_reservation_unit_reference_is_rejected_by_postgres()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var dataA = await CreateFixtureAsync(context, "cross-unit-a", roomCount: 1, unitCount: 1);
        var dataB = await CreateFixtureAsync(context, "cross-unit-b", roomCount: 1, unitCount: 1);

        context.Add(Assignment(dataA, dataA.Rooms[0], dataB.Units[0], CheckIn, CheckIn.AddDays(1)));
        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Cross_property_room_block_reference_is_rejected_by_postgres()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var dataA = await CreateFixtureAsync(context, "cross-block-a", roomCount: 1, unitCount: 0);
        var dataB = await CreateFixtureAsync(context, "cross-block-b", roomCount: 1, unitCount: 0);

        var blockB = new RoomBlock(Guid.NewGuid(), dataB.Property.Id, "Maintenance", "actor:qa", Now);
        context.Add(blockB);
        await context.SaveChangesAsync();

        context.Add(Block(dataA, dataA.Rooms[0], blockB, CheckIn, CheckIn.AddDays(1)));
        await AssertDatabaseErrorAsync(
            () => context.SaveChangesAsync(),
            PostgresErrorCodes.ForeignKeyViolation);
    }

    [Fact]
    public async Task Assignment_outside_exact_booked_nights_is_rejected_at_committed_transaction_state()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "coverage-overrun", roomCount: 1, unitCount: 1);

        // CheckOut (exclusive) is the day after the last booked night; extending one day
        // past it makes the segment cover an unsold date.
        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckOut.AddDays(1)));
        await AssertDatabaseErrorAsync(() => context.SaveChangesAsync(), "XBHA1");
    }

    [Fact]
    public async Task Reservation_unit_night_ownership_transfer_is_rejected_and_original_state_preserved()
    {
        // PMS-BE-001.2-C2: ReservationUnitNight.ReservationUnitId is immutable
        // commercial evidence — no approved operation transfers a booked night
        // between ReservationUnits. Before this correction, an UPDATE moving a
        // night to another Unit only re-validated the *new* Unit's coverage
        // (COALESCE picked NEW.ReservationUnitId only), so the *old* Unit's
        // now-uncovered Effective assignment silently escaped the trigger.
        //
        // The destination Unit belongs to a second Reservation on a
        // non-overlapping date window in the same Property, so the transferred
        // night has no pre-existing (ReservationUnitId, StayDate) row there —
        // isolating the ownership-immutability rejection from an incidental
        // primary-key collision.
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "night-owner-xfer", roomCount: 1, unitCount: 1);
        var oldUnit = data.Units[0];
        var newUnit = await CreateSecondUnitAsync(context, data, "night-owner-xfer-2", CheckIn.AddDays(30));

        var assignment = Assignment(data, data.Rooms[0], oldUnit, CheckIn, CheckIn.AddDays(1));
        context.Add(assignment);
        await context.SaveChangesAsync();

        await AssertDatabaseErrorAsync(
            () => context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "ReservationUnitNights" SET "ReservationUnitId" = {newUnit.Id}
                WHERE "ReservationUnitId" = {oldUnit.Id} AND "StayDate" = {CheckIn}
                """),
            "XBHA1");

        await using var verify = factory.CreateDbContext();
        var night = await verify.ReservationUnitNights.SingleAsync(
            n => n.ReservationUnitId == oldUnit.Id && n.StayDate == CheckIn);
        Assert.Equal(oldUnit.Id, night.ReservationUnitId);
        Assert.Empty(await verify.ReservationUnitNights
            .Where(n => n.ReservationUnitId == newUnit.Id && n.StayDate == CheckIn)
            .ToListAsync());
        var reloadedAssignment = await verify.RoomOccupancySegments.SingleAsync(s => s.Id == assignment.Id);
        Assert.Equal(RoomOccupancySegmentStatus.Effective, reloadedAssignment.Status);
        Assert.Equal(oldUnit.Id, reloadedAssignment.ReservationUnitId);
    }

    [Fact]
    public async Task Reservation_unit_night_update_that_preserves_ownership_is_not_rejected()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "night-owner-safe", roomCount: 1, unitCount: 1);
        var unit = data.Units[0];

        await context.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "ReservationUnitNights" SET "UnitAmount" = 999.00
            WHERE "ReservationUnitId" = {unit.Id} AND "StayDate" = {CheckIn}
            """);

        await using var verify = factory.CreateDbContext();
        var night = await verify.ReservationUnitNights.SingleAsync(
            n => n.ReservationUnitId == unit.Id && n.StayDate == CheckIn);
        Assert.Equal(999.00m, night.UnitAmount);
    }

    [Fact]
    public async Task Assignment_into_a_cancelled_unit_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "cancelled-unit", roomCount: 1, unitCount: 1);

        var reservation = await context.Reservations
            .Include(r => r.Units)
            .SingleAsync(r => r.Id == data.Reservation.Id);
        reservation.Cancel("test cancellation", Now, CheckIn.AddDays(-1));
        await context.SaveChangesAsync();

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(1)));
        await AssertDatabaseErrorAsync(() => context.SaveChangesAsync(), "XBHA2");
    }

    [Fact]
    public async Task Unit_cancellation_cannot_commit_while_an_effective_assignment_still_references_it()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "cancel-with-assignment", roomCount: 1, unitCount: 1);

        context.Add(Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(1)));
        await context.SaveChangesAsync();

        // Simulates an incomplete cancellation path that forgets to cancel the Effective
        // assignment in the same transaction (Phase 4's real cancellation store always
        // does both together) — the trigger must reject this inconsistent final state.
        var reservation = await context.Reservations
            .Include(r => r.Units)
            .SingleAsync(r => r.Id == data.Reservation.Id);
        reservation.Cancel("test cancellation", Now, CheckIn.AddDays(-1));
        await AssertDatabaseErrorAsync(() => context.SaveChangesAsync(), "XBHA2");
    }

    [Fact]
    public async Task Deferred_exclusion_constraints_allow_an_atomic_two_room_swap_in_one_transaction()
    {
        await factory.ResetDatabaseAsync();
        await using var context = factory.CreateDbContext();
        var data = await CreateFixtureAsync(context, "atomic-swap", roomCount: 2, unitCount: 2);

        var segmentOnRoom0 = Assignment(data, data.Rooms[0], data.Units[0], CheckIn, CheckIn.AddDays(2));
        var segmentOnRoom1 = Assignment(data, data.Rooms[1], data.Units[1], CheckIn, CheckIn.AddDays(2));
        context.AddRange(segmentOnRoom0, segmentOnRoom1);
        await context.SaveChangesAsync();

        // Swap: Unit0 moves to Room1, Unit1 moves to Room0. Cancel-then-insert is
        // interleaved (not grouped by room) specifically to prove the exclusion
        // constraints are deferred to commit time rather than checked per-statement —
        // segmentOnRoom0.Cancel() + insert(Room1, Unit0) alone would momentarily collide
        // with segmentOnRoom1 (still Effective on Room1) if checked immediately.
        segmentOnRoom0.Cancel();
        context.Add(Assignment(data, data.Rooms[1], data.Units[0], CheckIn, CheckIn.AddDays(2)));
        segmentOnRoom1.Cancel();
        context.Add(Assignment(data, data.Rooms[0], data.Units[1], CheckIn, CheckIn.AddDays(2)));

        await context.SaveChangesAsync();

        var effective = await context.RoomOccupancySegments
            .Where(s => s.Status == RoomOccupancySegmentStatus.Effective)
            .ToListAsync();
        Assert.Equal(2, effective.Count);
        Assert.Contains(effective, s => s.PhysicalRoomId == data.Rooms[1].Id && s.ReservationUnitId == data.Units[0].Id);
        Assert.Contains(effective, s => s.PhysicalRoomId == data.Rooms[0].Id && s.ReservationUnitId == data.Units[1].Id);
    }

    private static async Task<Fixture> CreateFixtureAsync(
        TheBhaDbContext context,
        string slug,
        int roomCount,
        int unitCount)
    {
        var property = new Property(
            Guid.NewGuid(),
            $"Hotel {slug}",
            slug,
            null,
            "1 Hotel Street",
            "Da Nang",
            "Vietnam",
            "Asia/Ho_Chi_Minh",
            new TimeOnly(14, 0),
            new TimeOnly(12, 0),
            true,
            Now);
        var roomType = new RoomType(
            Guid.NewGuid(),
            property.Id,
            slug.ToUpperInvariant(),
            slug,
            slug,
            null,
            2,
            4,
            true,
            Now);
        var ratePlan = new RatePlan(
            Guid.NewGuid(),
            property.Id,
            slug.ToUpperInvariant(),
            slug,
            null,
            "VND",
            true,
            Now);
        context.AddRange(property, roomType, ratePlan);

        var rooms = new List<PhysicalRoom>();
        for (var index = 0; index < roomCount; index++)
        {
            var room = new PhysicalRoom(
                Guid.NewGuid(),
                property.Id,
                roomType,
                $"R{index}",
                1,
                OperationalStatus.Active,
                Now);
            rooms.Add(room);
            context.Add(room);
        }

        Reservation? reservation = null;
        var units = new List<ReservationUnit>();
        if (unitCount > 0)
        {
            var nights = Enumerable.Range(0, CheckOut.DayNumber - CheckIn.DayNumber)
                .Select(offset => new NightlyCommitmentSnapshot(CheckIn.AddDays(offset), ratePlan.Id, 100m))
                .ToArray();
            var hold = new InventoryHold(
                Guid.NewGuid(),
                property.Id,
                roomType.Id,
                unitCount,
                null,
                "Fixture Guest",
                "fixture@example.com",
                "+84 900 000 000",
                CheckIn,
                CheckOut,
                2,
                0,
                "VND",
                Now,
                HexHash(slug + ":idempotency"),
                HexHash(slug + ":fingerprint"),
                HexHash(slug + ":guest"),
                nights);
            context.Add(hold);
            var unitPlans = hold.Items
                .Select(item => new ReservationUnitPlan(item.Id, roomType.Id, nights))
                .ToArray();
            reservation = new Reservation(
                Guid.NewGuid(),
                $"BHA-{slug.ToUpperInvariant()}-0001",
                hold.Id,
                property.Id,
                null,
                "Fixture Guest",
                "fixture@example.com",
                "+84 900 000 000",
                CheckIn,
                CheckOut,
                2,
                0,
                "VND",
                ReservationStatus.Confirmed,
                Now,
                null,
                null,
                HexHash(slug + ":guest"),
                unitPlans);
            context.Add(reservation);
            units.AddRange(reservation.Units);
        }

        await context.SaveChangesAsync();
        return new Fixture(property, roomType, rooms, reservation!, units);
    }

    /// <summary>
    /// A second, independent Reservation/Unit in <paramref name="data"/>'s Property, on
    /// a 4-night window starting at <paramref name="checkIn"/> (own RatePlan, own Hold)
    /// — used only to obtain a ReservationUnit whose ReservationUnitNight rows do not
    /// collide on the primary key with <paramref name="data"/>'s own Unit's nights.
    /// </summary>
    private static async Task<ReservationUnit> CreateSecondUnitAsync(
        TheBhaDbContext context,
        Fixture data,
        string slug,
        DateOnly checkIn)
    {
        var checkOut = checkIn.AddDays(4);
        var ratePlan = new RatePlan(
            Guid.NewGuid(), data.Property.Id, slug.ToUpperInvariant(), slug, null, "VND", true, Now);
        context.Add(ratePlan);

        var nights = Enumerable.Range(0, checkOut.DayNumber - checkIn.DayNumber)
            .Select(offset => new NightlyCommitmentSnapshot(checkIn.AddDays(offset), ratePlan.Id, 100m))
            .ToArray();
        var hold = new InventoryHold(
            Guid.NewGuid(), data.Property.Id, data.RoomType.Id, 1, null, "Second Guest",
            "second@example.com", "+84 900 000 001", checkIn, checkOut, 2, 0, "VND", Now,
            HexHash(slug + ":idempotency"), HexHash(slug + ":fingerprint"), HexHash(slug + ":guest"), nights);
        context.Add(hold);
        var reservation = new Reservation(
            Guid.NewGuid(), $"BHA-{slug.ToUpperInvariant()}", hold.Id, data.Property.Id, null,
            "Second Guest", "second@example.com", "+84 900 000 001", checkIn, checkOut, 2, 0, "VND",
            ReservationStatus.Confirmed, Now, null, null, HexHash(slug + ":guest"),
            hold.Items.Select(item => new ReservationUnitPlan(item.Id, data.RoomType.Id, nights)));
        context.Add(reservation);
        await context.SaveChangesAsync();
        return reservation.Units.Single();
    }

    private static RoomOccupancySegment Assignment(
        Fixture data,
        PhysicalRoom room,
        ReservationUnit unit,
        DateOnly startDate,
        DateOnly endDate) =>
        new(
            Guid.NewGuid(),
            data.Property.Id,
            room.Id,
            RoomOccupancySegmentType.ReservationAssignment,
            startDate,
            endDate,
            unit.Id,
            null,
            Now);

    private static RoomOccupancySegment Block(
        Fixture data,
        PhysicalRoom room,
        RoomBlock block,
        DateOnly startDate,
        DateOnly endDate) =>
        new(
            Guid.NewGuid(),
            data.Property.Id,
            room.Id,
            RoomOccupancySegmentType.OperationalBlock,
            startDate,
            endDate,
            null,
            block.Id,
            Now);

    private static async Task AssertExclusionViolationAsync(Func<Task> action, string constraintName)
    {
        var postgresException = await CapturePostgresExceptionAsync(action);
        Assert.Equal(PostgresErrorCodes.ExclusionViolation, postgresException.SqlState);
        Assert.Equal(constraintName, postgresException.ConstraintName);
    }

    private static async Task AssertDatabaseErrorAsync(Func<Task> action, string state)
    {
        var postgresException = await CapturePostgresExceptionAsync(action);
        Assert.Equal(state, postgresException.SqlState);
    }

    private static async Task AssertPostgresErrorAsync(Func<Task> action, string state) =>
        await AssertDatabaseErrorAsync(action, state);

    /// <summary>
    /// A deferrable exclusion/constraint-trigger violation fires at COMMIT time
    /// (<c>NpgsqlTransaction.Commit</c>), not while executing the triggering DML
    /// statement — depending on how many statements <see cref="DbContext.SaveChangesAsync()"/>
    /// batches together, EF Core's exception translation either wraps it in
    /// <see cref="DbUpdateException"/> (violation observed while still reading a
    /// batched command's result) or lets the raw <see cref="PostgresException"/>
    /// propagate directly (violation observed only once <c>COMMIT</c> is sent as its
    /// own round trip) — so tests must accept either shape.
    /// </summary>
    private static async Task<PostgresException> CapturePostgresExceptionAsync(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (PostgresException postgresException)
        {
            return postgresException;
        }
        catch (DbUpdateException dbUpdateException) when (dbUpdateException.InnerException is PostgresException inner)
        {
            return inner;
        }

        throw new Xunit.Sdk.XunitException(
            "Expected a PostgresException (optionally wrapped in DbUpdateException), but none was thrown.");
    }

    private static string HexHash(string seed) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();

    private sealed record Fixture(
        Property Property,
        RoomType RoomType,
        List<PhysicalRoom> Rooms,
        Reservation Reservation,
        List<ReservationUnit> Units);
}
