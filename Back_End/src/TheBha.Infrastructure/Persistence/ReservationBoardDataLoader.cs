using System.Data;
using Microsoft.EntityFrameworkCore;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// PMS-CAL-001.1 Phase 1: bounded, <c>AsNoTracking</c>, property/range-scoped raw
/// loader for the Admin Reservation Board projection (contract details 11, 19).
/// Every query is scoped to one Property; candidate Units' nights and
/// assignments are loaded in full (never clipped to the window) so
/// <see cref="ReservationBoardQuery"/> can classify complete-Unit coverage
/// exactly (contract detail 10) — this remains bounded because it only loads
/// data for the specific Units that already have a night in the requested
/// window, never the Property's entire booking history.
///
/// <para>
/// Correction C4: the whole projection runs inside one explicit
/// <see cref="IsolationLevel.RepeatableRead"/> transaction. Under PostgreSQL's
/// default <c>READ COMMITTED</c> each statement takes its own snapshot, so a
/// Reservation cancellation committing part-way through this multi-query load
/// could be observed by some queries but not others — e.g. the candidate-Unit
/// query captures a still-<c>Committed</c> Unit, then the assignment query
/// (running after the commit) sees its segments as <c>Cancelled</c>, and the
/// board reports a cancelled stay as <c>FullyUnassigned</c>: a state that
/// never existed as one committed database state. RepeatableRead pins the
/// snapshot at the first statement below, so every query here observes the
/// same one. This is a read-only transaction — it takes no row or table locks
/// and never blocks a concurrent cancellation.
/// </para>
/// </summary>
internal sealed class ReservationBoardDataLoader(TheBhaDbContext dbContext) : IReservationBoardDataSource
{
    /// <summary>
    /// Stable EF query tag on the candidate-Unit query. Deliberately public-ish
    /// surface for one deterministic concurrency regression test
    /// (<c>AdminReservationBoardApiTests</c>), which intercepts this exact
    /// command to force a cancellation to commit mid-projection. Renaming it
    /// requires updating that test.
    /// </summary>
    internal const string CandidateUnitsQueryTag = "pms-cal-001.1-reservation-board-candidate-units";

    public async Task<ReservationBoardRawData?> LoadAsync(
        Guid propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        // A caller-owned ambient transaction already provides one snapshot for
        // everything below; opening another here would be an unsupported nested
        // transaction. Nothing in the current read path does this, but reusing
        // rather than assuming keeps the loader safe if that ever changes.
        if (dbContext.Database.CurrentTransaction is not null)
        {
            return await LoadFromCurrentSnapshotAsync(propertyId, from, to, cancellationToken);
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.RepeatableRead,
            cancellationToken);

        // Any throw or cancellation below disposes the transaction (rolling the
        // read back) without committing; the Property-not-found path still
        // commits so the snapshot is released promptly.
        var data = await LoadFromCurrentSnapshotAsync(propertyId, from, to, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return data;
    }

    private async Task<ReservationBoardRawData?> LoadFromCurrentSnapshotAsync(
        Guid propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        var property = await dbContext.Properties
            .AsNoTracking()
            .Where(p => p.Id == propertyId && p.IsActive)
            .Select(p => new ReservationBoardPropertyData(p.Id, p.Name, p.TimeZone, p.CheckInTime, p.CheckOutTime))
            .SingleOrDefaultAsync(cancellationToken);
        if (property is null)
        {
            return null;
        }

        var physicalRooms = await dbContext.PhysicalRooms
            .AsNoTracking()
            .Where(room => room.PropertyId == propertyId && room.OperationalStatus == OperationalStatus.Active)
            .Select(room => new ReservationBoardPhysicalRoomData(room.Id, room.RoomTypeId, room.RoomNumber, room.Floor))
            .ToListAsync(cancellationToken);

        // Candidate Units: Committed Units under this Property with at least one
        // booked night in the requested window. Bounds every subsequent query.
        var candidateUnitIds = await dbContext.ReservationUnits
            .AsNoTracking()
            .TagWith(CandidateUnitsQueryTag)
            .Where(unit =>
                unit.PropertyId == propertyId &&
                unit.CommitmentStatus == CommitmentStatus.Committed &&
                unit.Nights.Any(night => night.StayDate >= from && night.StayDate < to))
            .Select(unit => unit.Id)
            .ToListAsync(cancellationToken);

        var units = await dbContext.ReservationUnits
            .AsNoTracking()
            .Where(unit => candidateUnitIds.Contains(unit.Id))
            .Join(
                dbContext.Reservations.AsNoTracking(),
                unit => unit.ReservationId,
                reservation => reservation.Id,
                (unit, reservation) => new ReservationBoardUnitData(
                    reservation.Id,
                    unit.Id,
                    reservation.ConfirmationNumber,
                    reservation.FullName,
                    unit.RoomTypeId))
            .ToListAsync(cancellationToken);

        // Full, un-clipped booked-night set for every candidate Unit.
        var unitNights = await dbContext.ReservationUnitNights
            .AsNoTracking()
            .Where(night => candidateUnitIds.Contains(night.ReservationUnitId))
            .Select(night => new ReservationBoardUnitNightData(night.ReservationUnitId, night.StayDate))
            .ToListAsync(cancellationToken);

        // Full, un-clipped Effective ReservationAssignment segments for every
        // candidate Unit — booked-night coverage (ADR 0006 item 9) guarantees
        // these already lie within that Unit's booked nights.
        var assignments = await dbContext.RoomOccupancySegments
            .AsNoTracking()
            .Where(segment =>
                segment.PropertyId == propertyId &&
                segment.Type == RoomOccupancySegmentType.ReservationAssignment &&
                segment.Status == RoomOccupancySegmentStatus.Effective &&
                segment.ReservationUnitId != null &&
                candidateUnitIds.Contains(segment.ReservationUnitId!.Value))
            .Join(
                dbContext.PhysicalRooms.AsNoTracking().Where(room => room.PropertyId == propertyId),
                segment => segment.PhysicalRoomId,
                room => room.Id,
                (segment, room) => new ReservationBoardAssignmentData(
                    segment.Id,
                    EF.Property<uint>(segment, "xmin"),
                    segment.ReservationUnitId!.Value,
                    segment.PhysicalRoomId,
                    room.RoomTypeId,
                    segment.StartDate,
                    segment.EndDate))
            .ToListAsync(cancellationToken);

        // Effective OperationalBlock segments overlapping the requested window
        // (contract detail 7's overlap predicate), un-clipped (contract detail 8).
        var operationalBlocks = await dbContext.RoomOccupancySegments
            .AsNoTracking()
            .Where(segment =>
                segment.PropertyId == propertyId &&
                segment.Type == RoomOccupancySegmentType.OperationalBlock &&
                segment.Status == RoomOccupancySegmentStatus.Effective &&
                segment.StartDate < to &&
                segment.EndDate > from &&
                segment.RoomBlockId != null)
            .Join(
                dbContext.RoomBlocks.AsNoTracking().Where(block => block.PropertyId == propertyId),
                segment => segment.RoomBlockId,
                block => block.Id,
                (segment, block) => new ReservationBoardOperationalBlockData(
                    segment.Id,
                    EF.Property<uint>(segment, "xmin"),
                    block.Id,
                    segment.PhysicalRoomId,
                    segment.StartDate,
                    segment.EndDate,
                    block.Reason))
            .ToListAsync(cancellationToken);

        // roomTypes must cover active PhysicalRooms, sold RoomTypes of returned
        // stays, and actually-assigned RoomTypes (contract detail 14) — even a
        // since-deactivated RoomType, distinguished by isActive.
        var referencedRoomTypeIds = physicalRooms.Select(room => room.RoomTypeId)
            .Concat(units.Select(unit => unit.SoldRoomTypeId))
            .Concat(assignments.Select(assignment => assignment.ActualRoomTypeId))
            .Distinct()
            .ToList();
        var roomTypes = await dbContext.RoomTypes
            .AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId && referencedRoomTypeIds.Contains(roomType.Id))
            .Select(roomType => new ReservationBoardRoomTypeData(
                roomType.Id, roomType.Code, roomType.Name, roomType.IsActive))
            .ToListAsync(cancellationToken);

        return new ReservationBoardRawData(
            property, physicalRooms, roomTypes, units, unitNights, assignments, operationalBlocks);
    }
}
