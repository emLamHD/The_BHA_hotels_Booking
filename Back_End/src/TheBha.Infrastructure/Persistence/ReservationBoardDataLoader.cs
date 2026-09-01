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
/// </summary>
internal sealed class ReservationBoardDataLoader(TheBhaDbContext dbContext) : IReservationBoardDataSource
{
    public async Task<ReservationBoardRawData?> LoadAsync(
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
