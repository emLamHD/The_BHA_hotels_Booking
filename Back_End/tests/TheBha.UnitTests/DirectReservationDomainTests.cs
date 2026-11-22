using TheBha.Domain.Bookings;
using TheBha.Domain.Common;
using TheBha.Domain.Promotions;

namespace TheBha.UnitTests;

/// <summary>BHA-CHECKOUT-001-PR01 T-04: the Direct (no source Hold) Reservation aggregate and the promotion snapshot ids.</summary>
public sealed class DirectReservationDomainTests
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid RoomTypeId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly Guid RatePlanId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000001");
    private static readonly DateOnly CheckIn = new(2026, 8, 1);
    private static readonly DateOnly CheckOut = new(2026, 8, 3);
    private static readonly DateTimeOffset Now = new(2026, 7, 23, 10, 0, 0, TimeSpan.Zero);
    private static readonly string GuestHash = new('a', BookingFieldLimits.Sha256Hash);
    private static readonly string OtherHash = new('b', BookingFieldLimits.Sha256Hash);
    private static readonly AppliedPromotionSnapshot Promotion =
        new(Guid.NewGuid(), 3, "summer", "Summer", PromotionDiscountKind.Percent, 10m, null);

    [Fact]
    public void Direct_reservation_has_no_hold_no_source_items_and_the_total_of_its_saved_nights()
    {
        var reservation = Direct(guestHash: GuestHash, units: [Unit(100m), Unit(100m)]);

        Assert.Equal(ReservationSource.Direct, reservation.Source);
        Assert.Null(reservation.SourceHoldId);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.All(reservation.Units, unit => Assert.Null(unit.SourceInventoryHoldItemId));
        Assert.Equal(400m, reservation.TotalAmount);
        Assert.Null(reservation.PromotionApplication);
    }

    [Fact]
    public void Direct_reservation_rejects_a_unit_that_names_a_source_hold_item()
    {
        var unit = new ReservationUnitPlan(Guid.NewGuid(), RoomTypeId, Nights(100m));

        Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, units: [unit]));
    }

    [Fact]
    public void Direct_reservation_needs_exactly_one_owner()
    {
        Assert.Throws<DomainException>(() => Direct(customerId: CustomerId, guestHash: GuestHash, units: [Unit(100m)]));
        Assert.Throws<DomainException>(() => Direct(units: [Unit(100m)]));
        Assert.Equal(CustomerId, Direct(customerId: CustomerId, units: [Unit(100m)]).CustomerAccountId);
    }

    [Fact]
    public void Direct_reservation_keeps_the_shared_date_and_unit_guards()
    {
        Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, units: []));
        Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, checkOut: CheckIn, units: [Unit(100m)]));
        Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, units: [new ReservationUnitPlan(null, RoomTypeId, [new NightlyCommitmentSnapshot(CheckIn, RatePlanId, 100m)])]));
    }

    [Fact]
    public void A_discounted_night_without_the_promotion_that_priced_it_is_rejected()
    {
        var discounted = new ReservationUnitPlan(null, RoomTypeId, Nights(90m, 100m));

        var error = Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, units: [discounted]));
        Assert.Contains("promotion", error.Message);
    }

    [Fact]
    public void A_discounted_direct_reservation_saves_its_promotion_snapshot_against_the_saved_prices()
    {
        var reservation = Direct(guestHash: GuestHash, units: [new ReservationUnitPlan(null, RoomTypeId, Nights(90m, 100m))], promotion: Promotion);

        var saved = reservation.PromotionApplication!;
        Assert.NotEqual(Guid.Empty, saved.Id);
        Assert.Null(saved.HoldId);
        Assert.Equal(reservation.Id, saved.ReservationId);
        Assert.Equal(200m, saved.ListTotalAmount);
        Assert.Equal(20m, saved.DiscountTotalAmount);
        Assert.Equal(180m, reservation.TotalAmount);
        Assert.Equal(Promotion.PromotionVersion, saved.PromotionVersion);
    }

    [Fact]
    public void A_promotion_that_discounts_nothing_or_names_another_currency_is_rejected()
    {
        Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, units: [Unit(100m)], promotion: Promotion));
        var discounted = new ReservationUnitPlan(null, RoomTypeId, Nights(90m, 100m));
        var usd = Promotion with { Kind = PromotionDiscountKind.FixedAmount, CurrencyCode = "USD" };
        Assert.Throws<DomainException>(() => Direct(guestHash: GuestHash, units: [discounted], promotion: usd));
    }

    [Fact]
    public void A_hold_sourced_reservation_keeps_the_hold_and_a_confirmed_promotion_links_both_ids()
    {
        var hold = new InventoryHold(
            Guid.NewGuid(), PropertyId, RoomTypeId, 1, null, "Guest", "guest@example.com", "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            new string('c', 64), new string('d', 64), GuestHash, Nights(90m, 100m), Promotion);
        var holdPromotion = hold.PromotionApplication!;
        Assert.Equal(hold.Id, holdPromotion.HoldId);
        Assert.Null(holdPromotion.ReservationId);
        Assert.NotEqual(Guid.Empty, holdPromotion.Id);

        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-HOLD-0001", Now);

        Assert.Equal(ReservationSource.Hold, reservation.Source);
        Assert.Equal(hold.Id, reservation.SourceHoldId);
        Assert.Same(holdPromotion, reservation.PromotionApplication);
        Assert.Equal(hold.Id, holdPromotion.HoldId);
        Assert.Equal(reservation.Id, holdPromotion.ReservationId);
        Assert.True(hold.IsCoherentReservation(reservation));
    }

    [Fact]
    public void A_direct_reservation_is_never_a_coherent_confirmation_of_a_hold()
    {
        var hold = new InventoryHold(
            Guid.NewGuid(), PropertyId, RoomTypeId, 1, null, "Guest", "guest@example.com", "+84 900 000 000", CheckIn, CheckOut, 2, 0, "VND", Now,
            new string('c', 64), new string('d', 64), GuestHash, Nights(100m));
        hold.Confirm(Guid.NewGuid(), "BHA-HOLD-0002", Now);

        Assert.False(hold.IsCoherentReservation(Direct(guestHash: GuestHash, units: [Unit(100m)])));
    }

    private static ReservationUnitPlan Unit(decimal nightly) => new(null, RoomTypeId, Nights(nightly));

    private static NightlyCommitmentSnapshot[] Nights(decimal unitAmount, decimal? list = null) =>
    [
        new(CheckIn, RatePlanId, unitAmount, list),
        new(CheckIn.AddDays(1), RatePlanId, unitAmount, list)
    ];

    private static Reservation Direct(
        Guid? customerId = null,
        string? guestHash = null,
        DateOnly? checkOut = null,
        IEnumerable<ReservationUnitPlan>? units = null,
        AppliedPromotionSnapshot? promotion = null) =>
        Reservation.CreateDirect(
            Guid.NewGuid(), "BHA-DIRECT-0001", PropertyId, customerId, "Guest", "guest@example.com", "+84 900 000 000",
            CheckIn, checkOut ?? CheckOut, 2, 0, "VND", Now, guestHash, units ?? [Unit(100m)], promotion);
}
