using Microsoft.EntityFrameworkCore;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// The one shared query design (PMS-BE-001.2 §8) for block-adjusted usable capacity
/// and assignment-aware reservation demand attribution, reused by the public
/// availability projection (<see cref="AvailabilityDataSource"/>), Hold creation
/// (<see cref="BookingHoldCreationStore"/>), and assignment/block mutation final-state
/// validation (Phase 4) — never a materially different duplicated formula per caller.
/// Both methods are read-only (<c>AsNoTracking</c>) and safe to call either outside a
/// transaction (read-only projection) or inside one, under whatever locks the caller
/// has already acquired.
/// </summary>
internal static class PhysicalCapacityDataLoader
{
    /// <summary>
    /// Distinct Active PhysicalRooms carrying an Effective OperationalBlock segment,
    /// per (RoomTypeId, StayDate), for the half-open <c>[checkIn, checkOut)</c> range
    /// (blueprint §7 rules 10-12). Each distinct blocked PhysicalRoom is counted at
    /// most once per date; a PhysicalRoom already excluded from BaseInventory
    /// (Inactive/OutOfService) is never counted here either.
    /// </summary>
    public static async Task<IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int>> LoadBlockedRoomCountsAsync(
        TheBhaDbContext dbContext,
        Guid propertyId,
        DateOnly checkIn,
        DateOnly checkOut,
        CancellationToken cancellationToken)
    {
        var blockedRoomSpans = await dbContext.RoomOccupancySegments
            .AsNoTracking()
            .Where(segment =>
                segment.PropertyId == propertyId &&
                segment.Type == RoomOccupancySegmentType.OperationalBlock &&
                segment.Status == RoomOccupancySegmentStatus.Effective &&
                segment.StartDate < checkOut &&
                segment.EndDate > checkIn)
            .Join(
                dbContext.PhysicalRooms.AsNoTracking().Where(room =>
                    room.PropertyId == propertyId &&
                    room.OperationalStatus == OperationalStatus.Active),
                segment => segment.PhysicalRoomId,
                room => room.Id,
                (segment, room) => new
                {
                    room.Id,
                    room.RoomTypeId,
                    segment.StartDate,
                    segment.EndDate
                })
            .ToListAsync(cancellationToken);

        var blockedRoomsByKey = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), HashSet<Guid>>();
        foreach (var span in blockedRoomSpans)
        {
            var start = span.StartDate > checkIn ? span.StartDate : checkIn;
            var end = span.EndDate < checkOut ? span.EndDate : checkOut;
            for (var date = start; date < end; date = date.AddDays(1))
            {
                var key = (span.RoomTypeId, date);
                if (!blockedRoomsByKey.TryGetValue(key, out var roomIds))
                {
                    roomIds = [];
                    blockedRoomsByKey[key] = roomIds;
                }

                roomIds.Add(span.Id);
            }
        }

        return blockedRoomsByKey.ToDictionary(entry => entry.Key, entry => entry.Value.Count);
    }

    /// <summary>
    /// Every Committed ReservationUnit's nightly demand for the half-open
    /// <c>[checkIn, checkOut)</c> range, attributed to exactly one RoomType per
    /// room-night (blueprint §7 rules 1-7): the sold RoomType when no Effective
    /// ReservationAssignment covers that night, or the assigned PhysicalRoom's actual
    /// RoomType when one does. Loaded property-wide (not pre-filtered to one RoomType)
    /// because a cross-RoomType assignment can move a night's attribution into or out
    /// of any RoomType. Does not include Hold demand, which has no assignment path and
    /// always attributes to its held RoomType (loaded separately by each caller,
    /// unchanged from existing behavior).
    /// </summary>
    public static async Task<IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int>> LoadAttributedReservationDemandAsync(
        TheBhaDbContext dbContext,
        Guid propertyId,
        DateOnly checkIn,
        DateOnly checkOut,
        CancellationToken cancellationToken)
    {
        var nights = await dbContext.ReservationUnits
            .AsNoTracking()
            .Where(unit =>
                unit.PropertyId == propertyId &&
                unit.CommitmentStatus == CommitmentStatus.Committed)
            .SelectMany(
                unit => unit.Nights,
                (unit, night) => new
                {
                    ReservationUnitId = unit.Id,
                    SoldRoomTypeId = unit.RoomTypeId,
                    night.StayDate
                })
            .Where(row => row.StayDate >= checkIn && row.StayDate < checkOut)
            .ToListAsync(cancellationToken);

        var assignmentSpans = await dbContext.RoomOccupancySegments
            .AsNoTracking()
            .Where(segment =>
                segment.PropertyId == propertyId &&
                segment.Type == RoomOccupancySegmentType.ReservationAssignment &&
                segment.Status == RoomOccupancySegmentStatus.Effective &&
                segment.StartDate < checkOut &&
                segment.EndDate > checkIn)
            .Join(
                dbContext.PhysicalRooms.AsNoTracking().Where(room => room.PropertyId == propertyId),
                segment => segment.PhysicalRoomId,
                room => room.Id,
                (segment, room) => new
                {
                    ReservationUnitId = segment.ReservationUnitId!.Value,
                    segment.StartDate,
                    segment.EndDate,
                    ActualRoomTypeId = room.RoomTypeId
                })
            .ToListAsync(cancellationToken);

        var spansByUnit = assignmentSpans
            .GroupBy(span => span.ReservationUnitId)
            .ToDictionary(group => group.Key, group => group.ToList());

        var demandByKey = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), int>();
        foreach (var night in nights)
        {
            var attributedRoomTypeId = night.SoldRoomTypeId;
            if (spansByUnit.TryGetValue(night.ReservationUnitId, out var unitSpans))
            {
                var covering = unitSpans.Find(span =>
                    night.StayDate >= span.StartDate && night.StayDate < span.EndDate);
                if (covering is not null)
                {
                    attributedRoomTypeId = covering.ActualRoomTypeId;
                }
            }

            var key = (attributedRoomTypeId, night.StayDate);
            demandByKey[key] = demandByKey.GetValueOrDefault(key) + 1;
        }

        return demandByKey;
    }
}
