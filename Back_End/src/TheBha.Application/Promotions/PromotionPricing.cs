using TheBha.Domain.Promotions;

namespace TheBha.Application.Promotions;

/// <summary>An Active promotion, reduced to what pricing needs. The dates are the Property's local dates.</summary>
public sealed record PromotionPricingRule(
    Guid Id,
    int Version,
    string Slug,
    string Title,
    PromotionDiscountKind Kind,
    decimal Value,
    string? CurrencyCode,
    bool AllRoomTypes,
    IReadOnlyCollection<Guid> RoomTypeIds,
    DateOnly? BookingFrom,
    DateOnly? BookingTo,
    DateOnly? StayFrom,
    DateOnly? StayTo,
    int MinNights,
    DateTimeOffset CreatedAtUtc);

/// <summary>The promotion a quote, a Hold or a Reservation carries. <see cref="Kind"/> is <c>Percent</c> or <c>FixedAmount</c>.</summary>
public sealed record AppliedPromotionDto(Guid Id, string Slug, string Title, string Kind, decimal Value, string? CurrencyCode);

public sealed record ListNight(DateOnly StayDate, decimal Amount);

/// <summary>One night of one room: the list rate, the discount and what is paid.</summary>
public sealed record PricedNight(DateOnly StayDate, decimal ListAmount, decimal DiscountAmount)
{
    public decimal FinalAmount => ListAmount - DiscountAmount;
}

public sealed record PricedStay(
    IReadOnlyList<PricedNight> Nights,
    int Rooms,
    decimal ListTotal,
    decimal DiscountTotal,
    decimal FinalTotal,
    PromotionPricingRule? Promotion)
{
    public AppliedPromotionDto? ToDto() => Promotion is null
        ? null
        : new(Promotion.Id, Promotion.Slug, Promotion.Title, Promotion.Kind.ToString(), Promotion.Value, Promotion.CurrencyCode);
}

/// <summary>
/// The one place a booking discount is computed. A quote (availability) and a Hold both call it, so they cannot disagree. The
/// list rate (<c>DailyRoomRate</c>) is an input and is never changed.
/// <list type="number">
/// <item>A promotion is a candidate when it covers the room type, today (the Property's local date) is inside its booking window,
/// the whole booking has at least its minimum nights, a fixed amount is in the offer's currency, and at least one night is inside
/// its stay window.</item>
/// <item>Per eligible night and room: a percentage is rounded half away from zero to the currency's unit (see
/// <see cref="PromotionMoney"/>); a fixed amount is taken as is. A promotion that would take any eligible night below the smallest
/// valid amount, or that discounts nothing, is not applicable — it is never silently trimmed.</item>
/// <item>The candidate with the highest total discount wins; a tie goes to the older one, then the lower id. One promotion per
/// booking, never mixed per night, never stacked.</item>
/// </list>
/// </summary>
public static class PromotionPricing
{
    public static PricedStay Price(
        IReadOnlyList<ListNight> listNights,
        int rooms,
        string currencyCode,
        Guid roomTypeId,
        DateOnly propertyLocalToday,
        IEnumerable<PromotionPricingRule> rules)
    {
        ArgumentNullException.ThrowIfNull(listNights);
        ArgumentNullException.ThrowIfNull(rules);
        if (rooms < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(rooms));
        }

        var best = rules
            .Select(rule => Evaluate(rule, listNights, rooms, currencyCode, roomTypeId, propertyLocalToday))
            .Where(candidate => candidate is not null)
            .OrderByDescending(candidate => candidate!.Value.Total)
            .ThenBy(candidate => candidate!.Value.Rule.CreatedAtUtc)
            .ThenBy(candidate => candidate!.Value.Rule.Id)
            .FirstOrDefault();

        var nights = best?.Nights ?? listNights.Select(night => new PricedNight(night.StayDate, night.Amount, 0m)).ToList();
        var listTotal = nights.Sum(night => night.ListAmount) * rooms;
        var discountTotal = nights.Sum(night => night.DiscountAmount) * rooms;
        return new PricedStay(nights, rooms, listTotal, discountTotal, listTotal - discountTotal, best?.Rule);
    }

    private static (PromotionPricingRule Rule, IReadOnlyList<PricedNight> Nights, decimal Total)? Evaluate(
        PromotionPricingRule rule,
        IReadOnlyList<ListNight> listNights,
        int rooms,
        string currencyCode,
        Guid roomTypeId,
        DateOnly today)
    {
        if (rule.Kind == PromotionDiscountKind.FixedAmount && !string.Equals(rule.CurrencyCode, currencyCode, StringComparison.Ordinal)) return null;
        if (!rule.AllRoomTypes && !rule.RoomTypeIds.Contains(roomTypeId)) return null;
        if (rule.BookingFrom is { } bookingFrom && today < bookingFrom) return null;
        if (rule.BookingTo is { } bookingTo && today > bookingTo) return null;
        if (listNights.Count < rule.MinNights) return null;

        var minimum = PromotionMoney.MinimumUnit(currencyCode);
        var nights = new List<PricedNight>(listNights.Count);
        var eligible = 0;
        foreach (var night in listNights)
        {
            var inStayWindow = (rule.StayFrom is null || night.StayDate >= rule.StayFrom) && (rule.StayTo is null || night.StayDate <= rule.StayTo);
            if (!inStayWindow)
            {
                nights.Add(new PricedNight(night.StayDate, night.Amount, 0m));
                continue;
            }

            var discount = rule.Kind == PromotionDiscountKind.Percent
                ? PromotionMoney.Round(night.Amount * rule.Value / 100m, currencyCode)
                : rule.Value;
            if (night.Amount - discount < minimum) return null;
            eligible++;
            nights.Add(new PricedNight(night.StayDate, night.Amount, discount));
        }

        var total = nights.Sum(night => night.DiscountAmount) * rooms;
        return eligible == 0 || total <= 0 ? null : (rule, nights, total);
    }
}
