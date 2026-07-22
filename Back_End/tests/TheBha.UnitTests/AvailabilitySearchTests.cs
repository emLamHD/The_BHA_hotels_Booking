using TheBha.Application.Properties;

namespace TheBha.UnitTests;

public sealed class AvailabilitySearchTests
{
    private static readonly DateTimeOffset FixedUtc = DateTimeOffset.Parse("2026-07-22T18:30:00Z");
    private static readonly DateOnly LocalToday = new(2026, 7, 23);
    private readonly Guid propertyId = Guid.NewGuid();

    [Theory]
    [InlineData("equal")]
    [InlineData("reversed")]
    [InlineData("adults-zero")]
    [InlineData("adults-negative")]
    [InlineData("children")]
    [InlineData("rooms-zero")]
    [InlineData("rooms-negative")]
    [InlineData("stay-limit")]
    [InlineData("room-limit")]
    [InlineData("property")]
    public async Task Rejects_invalid_basic_requests_without_loading_data(string invalid)
    {
        var source = new DataSource { Data = BuildData() };
        var request = Request();
        request = invalid switch
        {
            "equal" => request with { CheckOut = request.CheckIn },
            "reversed" => request with { CheckOut = request.CheckIn.AddDays(-1) },
            "adults-zero" => request with { Adults = 0 },
            "adults-negative" => request with { Adults = -1 },
            "children" => request with { Children = -1 },
            "rooms-zero" => request with { Rooms = 0 },
            "rooms-negative" => request with { Rooms = -1 },
            "stay-limit" => request with { CheckOut = request.CheckIn.AddDays(AvailabilitySearchLimits.MaxStayNights + 1) },
            "room-limit" => request with { Rooms = AvailabilitySearchLimits.MaxRequestedRooms + 1 },
            _ => request with { PropertyId = Guid.Empty }
        };
        var result = await Service(source).SearchAsync(request, CancellationToken.None);
        Assert.Equal(AvailabilitySearchStatus.Invalid, result.Status); Assert.False(source.Loaded);
    }

    [Fact]
    public async Task Uses_property_timezone_for_past_date_and_allows_local_today()
    {
        var source = new DataSource { Data = BuildData() }; var service = Service(source);
        var past = await service.SearchAsync(Request() with { CheckIn = LocalToday.AddDays(-1), CheckOut = LocalToday }, CancellationToken.None);
        var today = await service.SearchAsync(Request(), CancellationToken.None);
        Assert.Equal(AvailabilitySearchStatus.Invalid, past.Status); Assert.Equal(AvailabilitySearchStatus.Success, today.Status);
    }

    [Fact]
    public async Task Calculates_occupancy_complete_pricing_decimal_total_currency_and_inventory()
    {
        var data = BuildData(twoCompletePlans: true, includeIncompletePlan: true);
        var result = await Service(new DataSource { Data = data }).SearchAsync(
            Request() with { Adults = 2, Children = 2, Rooms = 2 },
            CancellationToken.None);
        Assert.Equal(AvailabilitySearchStatus.Success, result.Status); Assert.Equal(2, result.Offers.Count);
        Assert.Equal(["FLEXIBLE", "STANDARD"], result.Offers.Select(offer => offer.RatePlanCode));
        var offer = result.Offers.Single(item => item.RatePlanCode == "STANDARD");
        Assert.Equal(2, offer.AvailableRooms); Assert.Equal(2, offer.Nights); Assert.Equal(2, offer.RequestedRooms);
        Assert.Equal([LocalToday, LocalToday.AddDays(1)], offer.NightlyRates.Select(item => item.StayDate));
        Assert.Equal([100.11m, 200.22m], offer.NightlyRates.Select(item => item.Amount));
        Assert.Equal(600.66m, offer.TotalAmount); Assert.Equal("VND", offer.CurrencyCode);
        Assert.DoesNotContain(result.Offers, item => item.RatePlanCode == "INCOMPLETE");
    }

    [Fact]
    public async Task Excludes_over_capacity_insufficient_inventory_stop_sell_and_missing_rate_without_fallback()
    {
        var overCapacity = await Service(new DataSource { Data = BuildData() }).SearchAsync(Request() with { Adults = 5, Rooms = 2 }, CancellationToken.None);
        var insufficient = await Service(new DataSource { Data = BuildData(limit: 1) }).SearchAsync(Request() with { Rooms = 2 }, CancellationToken.None);
        var zeroLimit = await Service(new DataSource { Data = BuildData(limit: 0) }).SearchAsync(Request(), CancellationToken.None);
        var stopped = await Service(new DataSource { Data = BuildData(stopSell: true) }).SearchAsync(Request(), CancellationToken.None);
        var incomplete = await Service(new DataSource { Data = BuildData(completeStandard: false) }).SearchAsync(Request(), CancellationToken.None);
        Assert.Empty(overCapacity.Offers); Assert.Empty(insufficient.Offers); Assert.Empty(zeroLimit.Offers); Assert.Empty(stopped.Offers); Assert.Empty(incomplete.Offers);
    }

    [Fact]
    public async Task Missing_or_inactive_property_maps_to_not_found_and_cancellation_propagates()
    {
        var missing = await Service(new DataSource { Data = null }).SearchAsync(Request(), CancellationToken.None);
        Assert.Equal(AvailabilitySearchStatus.NotFound, missing.Status);
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); var source = new DataSource { Data = BuildData() };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Service(source).SearchAsync(Request(), cancellation.Token));
        Assert.Equal(cancellation.Token, source.Token);
    }

    private AvailabilitySearch Service(DataSource source) => new(source, new FixedTimeProvider(FixedUtc));
    private AvailabilitySearchRequest Request() => new(propertyId, LocalToday, LocalToday.AddDays(2), 2, 0, 1);

    private AvailabilityData BuildData(int? limit = 2, bool stopSell = false, bool completeStandard = true, bool twoCompletePlans = false, bool includeIncompletePlan = false)
    {
        var roomId = Guid.NewGuid(); var standardId = Guid.NewGuid(); var flexibleId = Guid.NewGuid(); var incompleteId = Guid.NewGuid();
        var plans = new List<AvailabilityRatePlanData> { new(standardId, propertyId, "STANDARD", "Standard", "VND") };
        if (twoCompletePlans) plans.Add(new(flexibleId, propertyId, "FLEXIBLE", "Flexible", "VND"));
        if (includeIncompletePlan) plans.Add(new(incompleteId, propertyId, "INCOMPLETE", "Incomplete", "VND"));
        var rates = new List<AvailabilityDailyRateData> { new(roomId, standardId, LocalToday, 100.11m) };
        if (completeStandard) rates.Add(new(roomId, standardId, LocalToday.AddDays(1), 200.22m));
        if (twoCompletePlans) { rates.Add(new(roomId, flexibleId, LocalToday, 110m)); rates.Add(new(roomId, flexibleId, LocalToday.AddDays(1), 210m)); }
        if (includeIncompletePlan) rates.Add(new(roomId, incompleteId, LocalToday, 90m));
        return new AvailabilityData(new AvailabilityPropertyData(propertyId, "Asia/Ho_Chi_Minh"),
            [new AvailabilityRoomTypeData(roomId, propertyId, "DLX", "Deluxe", "Room", 2, [])], plans, rates,
            new Dictionary<Guid, int> { [roomId] = 3 },
            [new AvailabilityInventoryControlData(roomId, LocalToday.AddDays(1), limit, stopSell)]);
    }

    private sealed class DataSource : IAvailabilityDataSource
    {
        public AvailabilityData? Data { get; init; }
        public bool Loaded { get; private set; }
        public CancellationToken Token { get; private set; }
        public Task<AvailabilityData?> LoadAsync(Guid propertyId, DateOnly checkIn, DateOnly checkOut, CancellationToken token) { Loaded = true; Token = token; token.ThrowIfCancellationRequested(); return Task.FromResult(Data); }
    }
    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider { public override DateTimeOffset GetUtcNow() => value; }
}
