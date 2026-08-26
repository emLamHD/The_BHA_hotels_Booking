using Microsoft.EntityFrameworkCore;
using TheBha.Application.Properties;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class AvailabilityDataSource(TheBhaDbContext dbContext) : IAvailabilityDataSource
{
    public async Task<AvailabilityData?> LoadAsync(
        Guid propertyId,
        DateOnly checkIn,
        DateOnly checkOut,
        DateTimeOffset utcNow,
        CancellationToken cancellationToken)
    {
        var property = await dbContext.Properties.AsNoTracking().Where(x => x.Id == propertyId && x.IsActive)
            .Select(x => new AvailabilityPropertyData(x.Id, x.TimeZone)).SingleOrDefaultAsync(cancellationToken);
        if (property is null) return null;
        var roomTypes = await dbContext.RoomTypes.AsNoTracking().Where(x => x.PropertyId == propertyId && x.IsActive)
            .OrderBy(x => x.Code).ThenBy(x => x.Id)
            .Select(x => new AvailabilityRoomTypeData(x.Id, x.PropertyId, x.Code, x.Name, x.Description, x.MaxOccupancy, Array.Empty<MediaDto>())).ToListAsync(cancellationToken);
        var roomTypeIds = roomTypes.Select(x => x.Id).ToList();
        var mediaRows = await dbContext.RoomTypeMedia.AsNoTracking().Where(x => roomTypeIds.Contains(x.RoomTypeId))
            .OrderBy(x => x.SortOrder).ThenBy(x => x.MediaId)
            .Select(x => new { x.RoomTypeId, Media = new MediaDto(x.Media.Id, x.Media.Url, x.Media.AltText, x.Media.MediaType, x.SortOrder, x.IsCover) }).ToListAsync(cancellationToken);
        var mediaByRoom = mediaRows.GroupBy(x => x.RoomTypeId).ToDictionary(group => group.Key, group => (IReadOnlyList<MediaDto>)group.Select(x => x.Media).ToList());
        roomTypes = roomTypes.Select(x => x with { Media = mediaByRoom.GetValueOrDefault(x.Id) ?? [] }).ToList();
        var plans = await dbContext.RatePlans.AsNoTracking().Where(x => x.PropertyId == propertyId && x.IsActive)
            .OrderBy(x => x.Code).ThenBy(x => x.Id).Select(x => new AvailabilityRatePlanData(x.Id, x.PropertyId, x.Code, x.Name, x.CurrencyCode)).ToListAsync(cancellationToken);
        var rates = await dbContext.DailyRoomRates.AsNoTracking().Where(x => x.PropertyId == propertyId && x.StayDate >= checkIn && x.StayDate < checkOut)
            .Select(x => new AvailabilityDailyRateData(x.RoomTypeId, x.RatePlanId, x.StayDate, x.Amount)).ToListAsync(cancellationToken);
        var activeCounts = await dbContext.PhysicalRooms.AsNoTracking().Where(x => x.PropertyId == propertyId && x.OperationalStatus == OperationalStatus.Active)
            .GroupBy(x => x.RoomTypeId).Select(group => new { RoomTypeId = group.Key, Count = group.Count() }).ToDictionaryAsync(x => x.RoomTypeId, x => x.Count, cancellationToken);
        var controls = await dbContext.DailyInventoryControls.AsNoTracking().Where(x => x.PropertyId == propertyId && x.StayDate >= checkIn && x.StayDate < checkOut)
            .Select(x => new AvailabilityInventoryControlData(x.RoomTypeId, x.StayDate, x.SellableLimit, x.IsStopSell)).ToListAsync(cancellationToken);
        var holdDemand = await dbContext.InventoryHolds.AsNoTracking()
            .Where(hold =>
                hold.PropertyId == propertyId &&
                hold.Status == BookingHoldStatus.Active &&
                hold.ExpiresAtUtc > utcNow)
            .SelectMany(hold => hold.Items)
            .SelectMany(item => item.Nights, (item, night) => new
            {
                item.RoomTypeId,
                night.StayDate
            })
            .Where(row => row.StayDate >= checkIn && row.StayDate < checkOut)
            .GroupBy(row => new { row.RoomTypeId, row.StayDate })
            .Select(group => new AvailabilityCommittedDemandData(
                group.Key.RoomTypeId,
                group.Key.StayDate,
                group.Count()))
            .ToListAsync(cancellationToken);

        // Assignment-aware reservation demand (blueprint §7 rules 1-7): loaded via the
        // one shared query design also used by Hold creation and, in Phase 4, by
        // assignment/block mutation final-state validation.
        var attributedReservationDemand = await PhysicalCapacityDataLoader.LoadAttributedReservationDemandAsync(
            dbContext,
            propertyId,
            checkIn,
            checkOut,
            cancellationToken);
        var blockedRoomCounts = await PhysicalCapacityDataLoader.LoadBlockedRoomCountsAsync(
            dbContext,
            propertyId,
            checkIn,
            checkOut,
            cancellationToken);

        var demand = holdDemand
            .Concat(attributedReservationDemand.Select(entry => new AvailabilityCommittedDemandData(
                entry.Key.RoomTypeId,
                entry.Key.StayDate,
                entry.Value)))
            .GroupBy(row => new { row.RoomTypeId, row.StayDate })
            .Select(group => new AvailabilityCommittedDemandData(
                group.Key.RoomTypeId,
                group.Key.StayDate,
                group.Sum(row => row.Rooms)))
            .ToList();
        var blockedRooms = blockedRoomCounts
            .Select(entry => new AvailabilityBlockedRoomData(entry.Key.RoomTypeId, entry.Key.StayDate, entry.Value))
            .ToList();
        return new AvailabilityData(
            property,
            roomTypes,
            plans,
            rates,
            activeCounts,
            controls,
            demand,
            blockedRooms);
    }
}
