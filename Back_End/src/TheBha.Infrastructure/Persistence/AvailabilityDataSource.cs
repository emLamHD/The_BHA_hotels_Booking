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
        var holdDemand = await dbContext.BookingHolds.AsNoTracking()
            .Where(hold =>
                hold.PropertyId == propertyId &&
                hold.Status == BookingHoldStatus.Active &&
                hold.ExpiresAtUtc > utcNow)
            .SelectMany(hold => hold.Nights, (hold, night) => new
            {
                hold.RoomTypeId,
                night.StayDate,
                night.Rooms
            })
            .Where(row => row.StayDate >= checkIn && row.StayDate < checkOut)
            .GroupBy(row => new { row.RoomTypeId, row.StayDate })
            .Select(group => new AvailabilityCommittedDemandData(
                group.Key.RoomTypeId,
                group.Key.StayDate,
                group.Sum(row => row.Rooms)))
            .ToListAsync(cancellationToken);
        var reservationDemand = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                reservation.PropertyId == propertyId &&
                reservation.Status == ReservationStatus.Confirmed)
            .SelectMany(reservation => reservation.Nights, (reservation, night) => new
            {
                reservation.RoomTypeId,
                night.StayDate,
                night.Rooms
            })
            .Where(row => row.StayDate >= checkIn && row.StayDate < checkOut)
            .GroupBy(row => new { row.RoomTypeId, row.StayDate })
            .Select(group => new AvailabilityCommittedDemandData(
                group.Key.RoomTypeId,
                group.Key.StayDate,
                group.Sum(row => row.Rooms)))
            .ToListAsync(cancellationToken);
        var demand = holdDemand.Concat(reservationDemand)
            .GroupBy(row => new { row.RoomTypeId, row.StayDate })
            .Select(group => new AvailabilityCommittedDemandData(
                group.Key.RoomTypeId,
                group.Key.StayDate,
                group.Sum(row => row.Rooms)))
            .ToList();
        return new AvailabilityData(
            property,
            roomTypes,
            plans,
            rates,
            activeCounts,
            controls,
            demand);
    }
}
