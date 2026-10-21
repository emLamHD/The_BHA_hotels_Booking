using TheBha.Application.Promotions;
using TheBha.Domain.Promotions;

namespace TheBha.UnitTests;

public sealed class PromotionPricingTests
{
    private static readonly DateOnly Today = new(2026, 10, 21);
    private static readonly DateOnly CheckIn = new(2026, 11, 1);
    private static readonly Guid RoomType = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid OtherRoomType = Guid.Parse("30000000-0000-0000-0000-000000000002");

    private static IReadOnlyList<ListNight> Nights(int count, decimal amount = 1_000_000m) =>
        Enumerable.Range(0, count).Select(i => new ListNight(CheckIn.AddDays(i), amount)).ToList();

    private static PromotionPricingRule Rule(
        PromotionDiscountKind kind = PromotionDiscountKind.Percent,
        decimal value = 10m,
        string? currency = null,
        bool allRoomTypes = true,
        Guid[]? roomTypes = null,
        DateOnly? bookingFrom = null,
        DateOnly? bookingTo = null,
        DateOnly? stayFrom = null,
        DateOnly? stayTo = null,
        int minNights = 1,
        Guid? id = null,
        DateTimeOffset? createdAt = null) =>
        new(id ?? Guid.NewGuid(), 1, "promo", "Promo", kind, value, kind == PromotionDiscountKind.FixedAmount ? currency ?? "VND" : null,
            allRoomTypes, roomTypes ?? [], bookingFrom, bookingTo, stayFrom, stayTo, minNights, createdAt ?? DateTimeOffset.Parse("2026-10-01T00:00:00Z"));

    private static PricedStay Price(IReadOnlyList<ListNight> nights, int rooms, params PromotionPricingRule[] rules) =>
        PromotionPricing.Price(nights, rooms, "VND", RoomType, Today, rules);

    [Fact]
    public void Without_a_promotion_the_price_is_the_list_rate_and_nothing_is_discounted()
    {
        var priced = Price(Nights(3), 2);

        Assert.Null(priced.Promotion);
        Assert.Equal(6_000_000m, priced.ListTotal);
        Assert.Equal(0m, priced.DiscountTotal);
        Assert.Equal(6_000_000m, priced.FinalTotal);
        Assert.All(priced.Nights, night => Assert.Equal(0m, night.DiscountAmount));
    }

    [Fact]
    public void A_percentage_is_taken_per_night_per_room_and_the_list_rate_is_untouched()
    {
        var priced = Price(Nights(2), 3, Rule(value: 15m));

        Assert.Equal(150_000m, priced.Nights[0].DiscountAmount);
        Assert.Equal(1_000_000m, priced.Nights[0].ListAmount);
        Assert.Equal(850_000m, priced.Nights[0].FinalAmount);
        Assert.Equal(6_000_000m, priced.ListTotal);
        Assert.Equal(900_000m, priced.DiscountTotal);
        Assert.Equal(5_100_000m, priced.FinalTotal);
    }

    [Fact]
    public void A_fixed_amount_is_per_room_per_night()
    {
        var priced = Price(Nights(3), 2, Rule(PromotionDiscountKind.FixedAmount, 200_000m));

        Assert.Equal(3 * 2 * 200_000m, priced.DiscountTotal);
        Assert.Equal(6_000_000m - 1_200_000m, priced.FinalTotal);
    }

    [Theory]
    [InlineData(1_000_001, 12.5, 125_000)]   // 125,000.125 -> 125,000
    [InlineData(1_000_004, 12.5, 125_001)]   // 125,000.5   -> half away from zero -> 125,001
    [InlineData(999_999, 0.01, 100)]          // 99.9999 -> 100
    public void A_percentage_rounds_half_away_from_zero_to_whole_dong(decimal list, decimal percent, decimal expectedDiscount)
    {
        var priced = Price([new ListNight(CheckIn, list)], 1, Rule(value: percent));

        Assert.Equal(expectedDiscount, priced.Nights[0].DiscountAmount);
        Assert.Equal(list - expectedDiscount, priced.FinalTotal);
    }

    [Fact]
    public void A_two_decimal_currency_rounds_to_two_decimals()
    {
        var priced = PromotionPricing.Price([new ListNight(CheckIn, 99.99m)], 1, "USD", RoomType, Today,
            [Rule(value: 12.5m)]);

        Assert.Equal(12.50m, priced.Nights[0].DiscountAmount);   // 12.49875 -> 12.50
        Assert.Equal(87.49m, priced.FinalTotal);
    }

    [Fact]
    public void A_discount_that_would_leave_less_than_the_smallest_valid_amount_is_not_applicable_instead_of_being_trimmed()
    {
        var tooBig = Rule(PromotionDiscountKind.FixedAmount, 1_000_000m);   // would leave 0
        var priced = Price(Nights(2), 1, tooBig);

        Assert.Null(priced.Promotion);
        Assert.Equal(2_000_000m, priced.FinalTotal);

        var justFits = Price(Nights(1), 1, Rule(PromotionDiscountKind.FixedAmount, 999_999m));
        Assert.NotNull(justFits.Promotion);
        Assert.Equal(1m, justFits.FinalTotal);
    }

    [Fact]
    public void A_discount_that_rounds_to_nothing_is_not_applicable()
    {
        var priced = Price([new ListNight(CheckIn, 40m)], 1, Rule(value: 0.01m));   // 0.004 -> 0

        Assert.Null(priced.Promotion);
    }

    [Fact]
    public void The_final_price_is_never_negative_for_any_valid_percentage()
    {
        foreach (var percent in new[] { 0.01m, 50m, 99m, 99.99m })
        {
            var priced = Price(Nights(2, 1_000m), 1, Rule(value: percent));
            Assert.All(priced.Nights, night => Assert.True(night.FinalAmount >= 1m));
            Assert.True(priced.FinalTotal > 0);
        }
    }

    [Theory]
    [InlineData("2026-10-21", true)]    // booking window starts today: inclusive
    [InlineData("2026-10-22", false)]   // starts tomorrow
    public void The_booking_window_start_is_inclusive_in_the_property_local_date(string from, bool applies)
    {
        var priced = Price(Nights(1), 1, Rule(bookingFrom: DateOnly.Parse(from)));

        Assert.Equal(applies, priced.Promotion is not null);
    }

    [Theory]
    [InlineData("2026-10-21", true)]    // ends today: inclusive
    [InlineData("2026-10-20", false)]   // ended yesterday
    public void The_booking_window_end_is_inclusive(string to, bool applies)
    {
        var priced = Price(Nights(1), 1, Rule(bookingTo: DateOnly.Parse(to)));

        Assert.Equal(applies, priced.Promotion is not null);
    }

    [Fact]
    public void Only_nights_inside_the_stay_window_are_discounted_and_the_checkout_date_is_not_a_night()
    {
        // 4 nights: Nov 1,2,3,4 (check-out Nov 5). The window is Nov 3 - Nov 5: nights 3 and 4 qualify; Nov 5 is the check-out day.
        var priced = Price(Nights(4), 1, Rule(stayFrom: new DateOnly(2026, 11, 3), stayTo: new DateOnly(2026, 11, 5)));

        Assert.Equal([0m, 0m, 100_000m, 100_000m], priced.Nights.Select(n => n.DiscountAmount).ToArray());
        Assert.Equal(4_000_000m - 200_000m, priced.FinalTotal);
    }

    [Fact]
    public void A_stay_window_that_ends_on_the_last_night_includes_it_but_not_the_checkout_day()
    {
        var priced = Price(Nights(3), 1, Rule(stayTo: new DateOnly(2026, 11, 2)));   // nights Nov 1, 2 qualify; Nov 3 does not

        Assert.Equal([100_000m, 100_000m, 0m], priced.Nights.Select(n => n.DiscountAmount).ToArray());
    }

    [Fact]
    public void A_booking_with_no_night_inside_the_stay_window_gets_no_promotion()
    {
        var priced = Price(Nights(2), 1, Rule(stayFrom: new DateOnly(2026, 12, 1)));

        Assert.Null(priced.Promotion);
    }

    [Fact]
    public void Minimum_nights_counts_every_night_of_the_booking_not_only_the_discounted_ones()
    {
        var rule = Rule(minNights: 3, stayFrom: new DateOnly(2026, 11, 3));   // only the 3rd night is in the stay window

        Assert.NotNull(Price(Nights(3), 1, rule).Promotion);
        Assert.Null(Price(Nights(2), 1, rule).Promotion);
    }

    [Fact]
    public void A_promotion_for_other_room_types_does_not_apply()
    {
        var scoped = Rule(allRoomTypes: false, roomTypes: [OtherRoomType]);
        var matching = Rule(allRoomTypes: false, roomTypes: [RoomType]);

        Assert.Null(Price(Nights(1), 1, scoped).Promotion);
        Assert.NotNull(Price(Nights(1), 1, matching).Promotion);
    }

    [Fact]
    public void A_fixed_amount_in_another_currency_does_not_apply()
    {
        var usd = Rule(PromotionDiscountKind.FixedAmount, 10m, currency: "USD");

        Assert.Null(Price(Nights(1), 1, usd).Promotion);
    }

    [Fact]
    public void The_promotion_with_the_highest_total_discount_wins_and_they_are_never_stacked()
    {
        var small = Rule(value: 10m, id: Guid.Parse("00000000-0000-0000-0000-000000000001"));
        var large = Rule(PromotionDiscountKind.FixedAmount, 300_000m, id: Guid.Parse("00000000-0000-0000-0000-000000000002"));

        var priced = Price(Nights(2), 1, small, large);

        Assert.Equal(large.Id, priced.Promotion!.Id);
        Assert.Equal(600_000m, priced.DiscountTotal);
        Assert.Equal(1_400_000m, priced.FinalTotal);
    }

    [Fact]
    public void A_tie_goes_to_the_older_promotion_then_the_lower_id()
    {
        var older = Rule(value: 10m, id: Guid.Parse("00000000-0000-0000-0000-0000000000ff"), createdAt: DateTimeOffset.Parse("2026-09-01T00:00:00Z"));
        var newerLowId = Rule(value: 10m, id: Guid.Parse("00000000-0000-0000-0000-000000000001"), createdAt: DateTimeOffset.Parse("2026-10-01T00:00:00Z"));
        Assert.Equal(older.Id, Price(Nights(1), 1, newerLowId, older).Promotion!.Id);

        var sameTimeLowId = Rule(value: 10m, id: Guid.Parse("00000000-0000-0000-0000-000000000001"), createdAt: older.CreatedAtUtc);
        Assert.Equal(sameTimeLowId.Id, Price(Nights(1), 1, older, sameTimeLowId).Promotion!.Id);
    }

    [Fact]
    public void Pricing_is_deterministic_whatever_order_the_rules_arrive_in()
    {
        var a = Rule(value: 10m);
        var b = Rule(PromotionDiscountKind.FixedAmount, 150_000m);

        Assert.Equal(Price(Nights(2), 1, a, b).Promotion!.Id, Price(Nights(2), 1, b, a).Promotion!.Id);
    }
}

public sealed class PromotionRulesTests
{
    private static PromotionDetails Valid(
        PromotionDiscountKind kind = PromotionDiscountKind.Percent, decimal value = 10m, string? currency = null) =>
        new("dat-som", "Đặt sớm", "Giảm khi đặt sớm", ["Điều kiện áp dụng."], null, null, kind, value, currency, true, [],
            null, null, null, null, 1, false, 0, null, null);

    [Theory]
    [InlineData(0, false)]
    [InlineData(-5, false)]
    [InlineData(100, false)]        // a free booking is not supported
    [InlineData(100.01, false)]
    [InlineData(0.01, true)]
    [InlineData(99.99, true)]
    [InlineData(12.345, false)]     // more than two decimals
    public void A_percentage_is_above_zero_and_below_one_hundred_with_two_decimals(double value, bool valid)
    {
        var error = PromotionRules.Validate(Valid(value: (decimal)value));

        Assert.Equal(valid, error is null);
        if (!valid) Assert.Equal("value", error!.Field);
    }

    [Fact]
    public void A_percentage_has_no_currency_and_a_fixed_amount_needs_one()
    {
        Assert.Equal("currencyCode", PromotionRules.Validate(Valid(currency: "VND"))!.Field);
        Assert.Equal("currencyCode", PromotionRules.Validate(Valid(PromotionDiscountKind.FixedAmount, 100_000m))!.Field);
        Assert.Null(PromotionRules.Validate(Valid(PromotionDiscountKind.FixedAmount, 100_000m, "VND")));
    }

    [Fact]
    public void A_vnd_amount_is_a_whole_number_and_another_currency_has_two_decimals()
    {
        Assert.Equal("value", PromotionRules.Validate(Valid(PromotionDiscountKind.FixedAmount, 100_000.5m, "VND"))!.Field);
        Assert.Null(PromotionRules.Validate(Valid(PromotionDiscountKind.FixedAmount, 10.25m, "USD")));
        Assert.Equal("value", PromotionRules.Validate(Valid(PromotionDiscountKind.FixedAmount, 10.255m, "USD"))!.Field);
    }

    [Fact]
    public void Windows_content_and_scope_are_validated()
    {
        var baseDetails = Valid();
        Assert.Equal("bookingTo", PromotionRules.Validate(baseDetails with { BookingFrom = new(2026, 11, 2), BookingTo = new(2026, 11, 1) })!.Field);
        Assert.Equal("stayTo", PromotionRules.Validate(baseDetails with { StayFrom = new(2026, 11, 2), StayTo = new(2026, 11, 1) })!.Field);
        Assert.Equal("displayTo", PromotionRules.Validate(baseDetails with { DisplayFrom = new(2026, 11, 2), DisplayTo = new(2026, 11, 1) })!.Field);
        Assert.Equal("minNights", PromotionRules.Validate(baseDetails with { MinNights = 0 })!.Field);
        Assert.Equal("roomTypeIds", PromotionRules.Validate(baseDetails with { AllRoomTypes = false })!.Field);
        Assert.Equal("showOnHomepage", PromotionRules.Validate(baseDetails with { ShowOnHomepage = true })!.Field);
        Assert.Equal("slug", PromotionRules.Validate(baseDetails with { Slug = "Not A Slug" })!.Field);
        Assert.Equal("title", PromotionRules.Validate(baseDetails with { Title = "<b>x</b>" })!.Field);
        Assert.Equal("body", PromotionRules.Validate(baseDetails with { BodyParagraphs = Enumerable.Repeat("x", 9).ToList() })!.Field);
        Assert.Equal("body1", PromotionRules.Validate(baseDetails with { BodyParagraphs = ["line one\nline two"] })!.Field);
    }
}
