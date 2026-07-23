namespace TheBha.Application.Properties;

public static class AvailabilitySearchLimits
{
    public const int MaxStayNights = 30;
    public const int MaxRequestedRooms = 10;
}

public sealed record AvailabilitySearchRequest(Guid PropertyId, DateOnly CheckIn, DateOnly CheckOut, int Adults, int Children, int Rooms);
public sealed record NightlyRateDto(DateOnly StayDate, decimal Amount);
public sealed record AvailabilityOfferDto(
    Guid PropertyId, Guid RoomTypeId, string RoomTypeCode, string RoomTypeName, string? RoomTypeDescription,
    IReadOnlyList<MediaDto> Media, Guid RatePlanId, string RatePlanCode, string RatePlanName, string CurrencyCode,
    DateOnly CheckIn, DateOnly CheckOut, int Nights, int RequestedRooms, int AvailableRooms,
    IReadOnlyList<NightlyRateDto> NightlyRates, decimal TotalAmount);

public enum AvailabilitySearchStatus { Success, Invalid, NotFound }
public sealed record AvailabilitySearchResult(AvailabilitySearchStatus Status, IReadOnlyList<AvailabilityOfferDto> Offers, string? Error)
{
    public static AvailabilitySearchResult Success(IReadOnlyList<AvailabilityOfferDto> offers) => new(AvailabilitySearchStatus.Success, offers, null);
    public static AvailabilitySearchResult Invalid(string error) => new(AvailabilitySearchStatus.Invalid, [], error);
    public static AvailabilitySearchResult NotFound() => new(AvailabilitySearchStatus.NotFound, [], null);
}

public sealed record AvailabilityPropertyData(Guid Id, string TimeZone);
public sealed record AvailabilityRoomTypeData(Guid Id, Guid PropertyId, string Code, string Name, string? Description, int MaxOccupancy, IReadOnlyList<MediaDto> Media);
public sealed record AvailabilityRatePlanData(Guid Id, Guid PropertyId, string Code, string Name, string CurrencyCode);
public sealed record AvailabilityDailyRateData(Guid RoomTypeId, Guid RatePlanId, DateOnly StayDate, decimal Amount);
public sealed record AvailabilityInventoryControlData(Guid RoomTypeId, DateOnly StayDate, int? SellableLimit, bool IsStopSell);
public sealed record AvailabilityCommittedDemandData(Guid RoomTypeId, DateOnly StayDate, int Rooms);
public sealed record AvailabilityData(
    AvailabilityPropertyData Property,
    IReadOnlyList<AvailabilityRoomTypeData> RoomTypes,
    IReadOnlyList<AvailabilityRatePlanData> RatePlans,
    IReadOnlyList<AvailabilityDailyRateData> DailyRates,
    IReadOnlyDictionary<Guid, int> ActiveRoomCounts,
    IReadOnlyList<AvailabilityInventoryControlData> InventoryControls,
    IReadOnlyList<AvailabilityCommittedDemandData> CommittedDemand);

public interface IAvailabilityDataSource
{
    Task<AvailabilityData?> LoadAsync(
        Guid propertyId,
        DateOnly checkIn,
        DateOnly checkOut,
        DateTimeOffset utcNow,
        CancellationToken cancellationToken);
}

public interface IAvailabilitySearch
{
    Task<AvailabilitySearchResult> SearchAsync(AvailabilitySearchRequest request, CancellationToken cancellationToken);
}

public sealed class AvailabilitySearch(IAvailabilityDataSource dataSource, TimeProvider timeProvider) : IAvailabilitySearch
{
    public async Task<AvailabilitySearchResult> SearchAsync(AvailabilitySearchRequest request, CancellationToken cancellationToken)
    {
        var basicError = ValidateBasic(request);
        if (basicError is not null) return AvailabilitySearchResult.Invalid(basicError);
        var utcNow = timeProvider.GetUtcNow();
        var data = await dataSource.LoadAsync(
            request.PropertyId,
            request.CheckIn,
            request.CheckOut,
            utcNow,
            cancellationToken);
        if (data is null) return AvailabilitySearchResult.NotFound();
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(data.Property.TimeZone);
        var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);
        if (request.CheckIn < localToday) return AvailabilitySearchResult.Invalid("checkIn cannot be earlier than the Property local date.");

        var nights = request.CheckOut.DayNumber - request.CheckIn.DayNumber;
        var people = (long)request.Adults + request.Children;
        var controls = data.InventoryControls.GroupBy(x => x.RoomTypeId).ToDictionary(group => group.Key, group => group.ToDictionary(x => x.StayDate));
        var demand = data.CommittedDemand.ToDictionary(x => (x.RoomTypeId, x.StayDate), x => x.Rooms);
        var rates = data.DailyRates.GroupBy(x => (x.RoomTypeId, x.RatePlanId)).ToDictionary(group => group.Key, group => group.OrderBy(x => x.StayDate).ToList());
        var offers = new List<AvailabilityOfferDto>();
        foreach (var roomType in data.RoomTypes.Where(x => people <= (long)x.MaxOccupancy * request.Rooms))
        {
            var baseInventory = data.ActiveRoomCounts.GetValueOrDefault(roomType.Id);
            var availableRooms = Enumerable.Range(0, nights).Select(offset => request.CheckIn.AddDays(offset)).Select(date =>
            {
                AvailabilityInventoryControlData? control = null;
                if (controls.TryGetValue(roomType.Id, out var roomControls)) roomControls.TryGetValue(date, out control);
                var controlledInventory = control?.IsStopSell == true
                    ? 0
                    : Math.Min(baseInventory, control?.SellableLimit ?? baseInventory);
                return Math.Max(
                    0,
                    controlledInventory - demand.GetValueOrDefault((roomType.Id, date)));
            }).Min();
            if (availableRooms < request.Rooms) continue;
            foreach (var plan in data.RatePlans)
            {
                if (!rates.TryGetValue((roomType.Id, plan.Id), out var nightlyData) || nightlyData.Count != nights) continue;
                var expectedDates = Enumerable.Range(0, nights).Select(offset => request.CheckIn.AddDays(offset));
                if (!nightlyData.Select(x => x.StayDate).SequenceEqual(expectedDates)) continue;
                var nightly = nightlyData.Select(x => new NightlyRateDto(x.StayDate, x.Amount)).ToList();
                offers.Add(new AvailabilityOfferDto(data.Property.Id, roomType.Id, roomType.Code, roomType.Name, roomType.Description,
                    roomType.Media, plan.Id, plan.Code, plan.Name, plan.CurrencyCode, request.CheckIn, request.CheckOut,
                    nights, request.Rooms, availableRooms, nightly, nightly.Sum(x => x.Amount) * request.Rooms));
            }
        }
        return AvailabilitySearchResult.Success(offers.OrderBy(x => x.RoomTypeCode).ThenBy(x => x.RatePlanCode).ThenBy(x => x.RoomTypeId).ThenBy(x => x.RatePlanId).ToList());
    }

    private static string? ValidateBasic(AvailabilitySearchRequest request)
    {
        if (request.PropertyId == Guid.Empty) return "propertyId is required.";
        if (request.CheckIn >= request.CheckOut) return "checkIn must be earlier than checkOut.";
        if (request.CheckOut.DayNumber - request.CheckIn.DayNumber > AvailabilitySearchLimits.MaxStayNights) return $"Stay cannot exceed {AvailabilitySearchLimits.MaxStayNights} nights.";
        if (request.Adults <= 0) return "adults must be greater than zero.";
        if (request.Children < 0) return "children cannot be negative.";
        if (request.Rooms <= 0) return "rooms must be greater than zero.";
        if (request.Rooms > AvailabilitySearchLimits.MaxRequestedRooms) return $"rooms cannot exceed {AvailabilitySearchLimits.MaxRequestedRooms}.";
        return null;
    }
}
