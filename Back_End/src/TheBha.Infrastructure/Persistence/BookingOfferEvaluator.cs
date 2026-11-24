using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;
using TheBha.Application.Promotions;
using TheBha.Application.Properties;
using TheBha.Domain.Bookings;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed record BookingOfferRequest(
    Guid PropertyId,
    Guid RoomTypeId,
    Guid RatePlanId,
    DateOnly CheckIn,
    DateOnly CheckOut,
    int Adults,
    int Children,
    int Rooms,
    Guid? CustomerAccountId);

internal enum BookingOfferFailure
{
    Unauthorized,
    NotFound,
    Invalid,
    Conflict
}

/// <summary>What the guest would pay now: the priced stay, the rate plan's currency, and the per-night snapshot the commitment stores.</summary>
internal sealed record BookingOffer(PricedStay Priced, string CurrencyCode, NightlyCommitmentSnapshot[] NightPlan)
{
    public PriceQuoteDto ToQuote() => new(
        CurrencyCode,
        Priced.FinalTotal,
        Priced.ListTotal,
        Priced.DiscountTotal,
        Priced.Nights.Select(night => new NightlyRateDto(night.StayDate, night.FinalAmount, night.ListAmount, night.DiscountAmount)).ToList(),
        Priced.ToDto());
}

internal sealed record BookingOfferResult(BookingOfferFailure? Failure, string? Error, BookingOffer? Offer)
{
    public static BookingOfferResult Fail(BookingOfferFailure failure, string error) => new(failure, error, null);

    public static BookingOfferResult Of(BookingOffer offer) => new(null, null, offer);
}

/// <summary>
/// The one place a booking offer is checked and priced: active Property, RoomType and RatePlan, the Property-local date, occupancy, the nightly rates, the effective inventory of every night (physical capacity, blocks,
/// sellable limit, stop-sell, committed Reservation demand and Active Hold demand) and the price with the best Active promotion. Both the Hold and the Direct Reservation call it, after taking the same locks from
/// <see cref="BuildLockPlan"/>, so there is no second formula. The detail strings are the ones <c>PublicProblemCodes</c> resolves a code from: do not reword them.
/// </summary>
internal static class BookingOfferEvaluator
{
    public static DateOnly[] StayDates(DateOnly checkIn, DateOnly checkOut) =>
        Enumerable
            .Range(0, checkOut.DayNumber - checkIn.DayNumber)
            .Select(checkIn.AddDays)
            .Order()
            .ToArray();

    /// <summary>RoomType scope, then one key per night, sorted: the order every demand writer uses.</summary>
    public static LockPlan BuildLockPlan(Guid propertyId, Guid roomTypeId, DateOnly checkIn, DateOnly checkOut) =>
        new LockPlanBuilder()
            .WithRoomTypeScope(propertyId, roomTypeId)
            .WithInventory(propertyId, roomTypeId, StayDates(checkIn, checkOut))
            .Build();

    public static async Task<BookingOfferResult> EvaluateAsync(
        TheBhaDbContext dbContext,
        BookingOfferRequest request,
        DateTimeOffset utcNow,
        CancellationToken cancellationToken)
    {
        var stayDates = StayDates(request.CheckIn, request.CheckOut);

        if (request.CustomerAccountId is { } customerAccountId &&
            !await dbContext.CustomerAccounts
                .AsNoTracking()
                .AnyAsync(
                    account => account.Id == customerAccountId,
                    cancellationToken))
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.Unauthorized,
                "A valid customer session is required.");
        }

        var property = await dbContext.Properties
            .AsNoTracking()
            .Where(item => item.Id == request.PropertyId && item.IsActive)
            .Select(item => new { item.Id, item.TimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (property is null)
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.NotFound,
                "The requested active property does not exist.");
        }

        var roomType = await dbContext.RoomTypes
            .AsNoTracking()
            .Where(item =>
                item.Id == request.RoomTypeId &&
                item.PropertyId == request.PropertyId &&
                item.IsActive)
            .Select(item => new { item.Id, item.MaxOccupancy })
            .SingleOrDefaultAsync(cancellationToken);
        if (roomType is null)
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.NotFound,
                "The requested active room type does not exist in this property.");
        }

        var ratePlan = await dbContext.RatePlans
            .AsNoTracking()
            .Where(item =>
                item.Id == request.RatePlanId &&
                item.PropertyId == request.PropertyId &&
                item.IsActive)
            .Select(item => new { item.Id, item.CurrencyCode })
            .SingleOrDefaultAsync(cancellationToken);
        if (ratePlan is null)
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.NotFound,
                "The requested active rate plan does not exist in this property.");
        }

        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(property.TimeZone);
        var localToday = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);
        if (request.CheckIn < localToday)
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.Invalid,
                "checkIn cannot be earlier than the Property local date.");
        }

        var people = (long)request.Adults + request.Children;
        if (people > (long)roomType.MaxOccupancy * request.Rooms)
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.Invalid,
                "The requested occupancy exceeds the room type capacity.");
        }

        var rates = await dbContext.DailyRoomRates
            .AsNoTracking()
            .Where(item =>
                item.PropertyId == request.PropertyId &&
                item.RoomTypeId == request.RoomTypeId &&
                item.RatePlanId == request.RatePlanId &&
                item.StayDate >= request.CheckIn &&
                item.StayDate < request.CheckOut)
            .OrderBy(item => item.StayDate)
            .Select(item => new { item.StayDate, item.Amount })
            .ToListAsync(cancellationToken);
        if (rates.Count != stayDates.Length ||
            !rates.Select(rate => rate.StayDate).SequenceEqual(stayDates))
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.Conflict,
                "Current pricing is unavailable for one or more stay dates.");
        }

        var activeRooms = await dbContext.PhysicalRooms
            .AsNoTracking()
            .CountAsync(
                room =>
                    room.PropertyId == request.PropertyId &&
                    room.RoomTypeId == request.RoomTypeId &&
                    room.OperationalStatus == OperationalStatus.Active,
                cancellationToken);
        var controls = await dbContext.DailyInventoryControls
            .AsNoTracking()
            .Where(control =>
                control.PropertyId == request.PropertyId &&
                control.RoomTypeId == request.RoomTypeId &&
                control.StayDate >= request.CheckIn &&
                control.StayDate < request.CheckOut)
            .Select(control => new
            {
                control.StayDate,
                control.SellableLimit,
                control.IsStopSell
            })
            .ToDictionaryAsync(control => control.StayDate, cancellationToken);
        var blockedRoomCounts = await PhysicalCapacityDataLoader.LoadBlockedRoomCountsAsync(
            dbContext,
            request.PropertyId,
            request.CheckIn,
            request.CheckOut,
            cancellationToken);
        var committedDemand = await LoadCommittedDemandAsync(
            dbContext,
            request.PropertyId,
            request.RoomTypeId,
            request.CheckIn,
            request.CheckOut,
            utcNow,
            cancellationToken);

        foreach (var stayDate in stayDates)
        {
            controls.TryGetValue(stayDate, out var control);
            var usablePhysicalCapacity = PhysicalCapacityFormula.UsablePhysicalCapacity(
                activeRooms,
                blockedRoomCounts.GetValueOrDefault((request.RoomTypeId, stayDate)));
            var controlledInventory = PhysicalCapacityFormula.ControlledCapacity(
                usablePhysicalCapacity,
                control?.SellableLimit,
                control?.IsStopSell == true);
            var remainingRooms = controlledInventory -
                committedDemand.GetValueOrDefault(stayDate);
            if (remainingRooms < request.Rooms)
            {
                return BookingOfferResult.Fail(
                    BookingOfferFailure.Conflict,
                    "The selected rooms are no longer available for the complete stay.");
            }
        }

        // The one pricing function the quote also uses: the list rate, then the best Active promotion, if any.
        var promotionRules = await PromotionPricingRuleLoader.LoadActiveAsync(
            dbContext,
            request.PropertyId,
            cancellationToken);
        try
        {
            var priced = PromotionPricing.Price(
                rates.Select(rate => new ListNight(rate.StayDate, rate.Amount)).ToList(),
                request.Rooms,
                ratePlan.CurrencyCode,
                request.RoomTypeId,
                localToday,
                promotionRules);
            var nightPlan = priced.Nights.Select(night => new NightlyCommitmentSnapshot(
                    night.StayDate,
                    request.RatePlanId,
                    night.FinalAmount,
                    night.ListAmount))
                .ToArray();
            return BookingOfferResult.Of(new BookingOffer(priced, ratePlan.CurrencyCode, nightPlan));
        }
        catch (OverflowException)
        {
            return BookingOfferResult.Fail(
                BookingOfferFailure.Conflict,
                "Current pricing exceeds the supported amount range.");
        }
    }

    private static async Task<Dictionary<DateOnly, int>> LoadCommittedDemandAsync(
        TheBhaDbContext dbContext,
        Guid propertyId,
        Guid roomTypeId,
        DateOnly checkIn,
        DateOnly checkOut,
        DateTimeOffset utcNow,
        CancellationToken cancellationToken)
    {
        // Active, unexpired Hold demand, via the one shared query design also used by
        // the public availability projection and, in Phase 4, by assignment/block
        // mutation final-state validation (PMS-BE-001.2-C1).
        var activeHoldDemand = await PhysicalCapacityDataLoader.LoadActiveHoldDemandAsync(
            dbContext,
            propertyId,
            checkIn,
            checkOut,
            utcNow,
            cancellationToken);
        var holdDemand = activeHoldDemand
            .Where(entry => entry.Key.RoomTypeId == roomTypeId)
            .Select(entry => new { StayDate = entry.Key.StayDate, Rooms = entry.Value });

        // Assignment-aware reservation demand (blueprint §7 rules 1-7), via the one
        // shared query design also used by the public availability projection — a
        // cross-RoomType assignment can move a night's attribution into this RoomType
        // even though it was sold under a different one, or out of it even though it
        // was sold under this one.
        var attributedReservationDemand = await PhysicalCapacityDataLoader.LoadAttributedReservationDemandAsync(
            dbContext,
            propertyId,
            checkIn,
            checkOut,
            cancellationToken);
        var reservationDemand = attributedReservationDemand
            .Where(entry => entry.Key.RoomTypeId == roomTypeId)
            .Select(entry => new { StayDate = entry.Key.StayDate, Rooms = entry.Value });

        return holdDemand.Concat(reservationDemand)
            .GroupBy(row => row.StayDate)
            .ToDictionary(group => group.Key, group => group.Sum(row => row.Rooms));
    }
}
