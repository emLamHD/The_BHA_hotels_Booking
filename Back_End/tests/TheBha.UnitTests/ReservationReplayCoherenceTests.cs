using TheBha.Domain.Bookings;

namespace TheBha.UnitTests;

public sealed class ReservationReplayCoherenceTests
{
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid RoomTypeId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly Guid RatePlanId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000001");
    private static readonly Guid OtherCustomerId = Guid.Parse("40000000-0000-0000-0000-000000000099");
    private static readonly DateOnly CheckIn = new(2026, 8, 1);
    private static readonly DateOnly CheckOut = new(2026, 8, 3);
    private static readonly DateTimeOffset CreatedAt = new(2026, 7, 23, 10, 0, 0, TimeSpan.Zero);
    private static readonly string GuestHash = new('a', BookingFieldLimits.Sha256Hash);
    private static readonly string OtherGuestHash = new('f', BookingFieldLimits.Sha256Hash);
    private static readonly string IdempotencyHash = new('b', BookingFieldLimits.Sha256Hash);
    private static readonly string Fingerprint = new('c', BookingFieldLimits.Sha256Hash);

    [Fact]
    public void Genuine_confirmation_output_is_coherent_with_its_own_source_hold()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0001", hold.ExpiresAtUtc.AddTicks(-1));

        Assert.True(hold.IsCoherentReservation(reservation));
    }

    [Fact]
    public void A_hold_that_never_reached_confirmed_is_never_coherent()
    {
        var activeHold = CreateGuestHold();
        var confirmingHold = CreateGuestHold();
        var reservation = confirmingHold.Confirm(
            Guid.NewGuid(),
            "BHA-COHERENT-0002",
            confirmingHold.ExpiresAtUtc.AddTicks(-1));
        var claimingActiveHold = CreateMutatedReservation(
            activeHold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: activeHold.Id,
            customerAccountId: activeHold.CustomerAccountId,
            guestAccessTokenHash: activeHold.GuestAccessTokenHash);

        Assert.False(activeHold.IsCoherentReservation(claimingActiveHold));
    }

    [Fact]
    public void Wrong_source_hold_id_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0003", hold.ExpiresAtUtc.AddTicks(-1));
        var mismatched = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: Guid.NewGuid(),
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash);

        Assert.False(hold.IsCoherentReservation(mismatched));
    }

    [Fact]
    public void Guest_hold_rejects_a_reservation_claimed_by_a_customer_account()
    {
        var hold = CreateGuestHold();
        hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0004", hold.ExpiresAtUtc.AddTicks(-1));
        var claimedByAccount = CreateMutatedReservation(
            hold,
            Guid.NewGuid(),
            "BHA-COHERENT-0004",
            sourceHoldId: hold.Id,
            customerAccountId: CustomerId,
            guestAccessTokenHash: null);

        Assert.False(hold.IsCoherentReservation(claimedByAccount));
    }

    [Fact]
    public void Authenticated_hold_rejects_a_reservation_owned_by_a_different_account()
    {
        var hold = CreateAuthenticatedHold();
        hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0005", hold.ExpiresAtUtc.AddTicks(-1));
        var wrongAccount = CreateMutatedReservation(
            hold,
            Guid.NewGuid(),
            "BHA-COHERENT-0005",
            sourceHoldId: hold.Id,
            customerAccountId: OtherCustomerId,
            guestAccessTokenHash: null);

        Assert.False(hold.IsCoherentReservation(wrongAccount));
    }

    [Fact]
    public void Guest_hold_rejects_a_reservation_with_a_different_guest_hash()
    {
        var hold = CreateGuestHold();
        hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0006", hold.ExpiresAtUtc.AddTicks(-1));
        var wrongGuestHash = CreateMutatedReservation(
            hold,
            Guid.NewGuid(),
            "BHA-COHERENT-0006",
            sourceHoldId: hold.Id,
            customerAccountId: null,
            guestAccessTokenHash: OtherGuestHash);

        Assert.False(hold.IsCoherentReservation(wrongGuestHash));
    }

    [Theory]
    [InlineData("propertyId")]
    [InlineData("fullName")]
    [InlineData("email")]
    [InlineData("phone")]
    [InlineData("adults")]
    [InlineData("children")]
    [InlineData("currency")]
    public void Mismatched_business_field_is_incoherent(string field)
    {
        // checkIn/checkOut, unit RoomTypeId/RatePlanId/UnitAmount, and unit count are
        // cross-validated by Reservation's/ReservationUnit's own constructors against
        // the Item graph, so an incoherent value there can only be reached by a
        // self-consistent-but-wrong Reservation — see the dedicated Unit/night/stay
        // tests below, not a bare header field swap.
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0007", hold.ExpiresAtUtc.AddTicks(-1));

        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            propertyId: field == "propertyId" ? Guid.NewGuid() : null,
            fullName: field == "fullName" ? "Someone Else" : null,
            email: field == "email" ? "someone-else@example.com" : null,
            phone: field == "phone" ? "+84 000 000 000" : null,
            adults: field == "adults" ? hold.Adults + 1 : null,
            children: field == "children" ? hold.Children + 1 : null,
            currencyCode: field == "currency" ? "USD" : null);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Mismatched_unit_room_type_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0010", hold.ExpiresAtUtc.AddTicks(-1));
        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            unitRoomTypeIdOverride: Guid.NewGuid());

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Missing_unit_for_an_item_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0011", hold.ExpiresAtUtc.AddTicks(-1));
        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            itemCountOverride: 1);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Unit_sourced_from_a_foreign_item_id_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0012", hold.ExpiresAtUtc.AddTicks(-1));
        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            foreignSourceItemId: Guid.NewGuid());

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Self_consistent_but_shifted_stay_period_is_incoherent()
    {
        // checkIn/checkOut/nights must remain mutually consistent for Reservation's
        // own constructor to accept them, so the incoherence proven here is a
        // Reservation describing an entirely different (but internally valid) stay
        // period than the one its source Hold actually holds.
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0008", hold.ExpiresAtUtc.AddTicks(-1));
        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            checkInOverride: hold.CheckIn.AddDays(1),
            checkOutOverride: hold.CheckOut.AddDays(1),
            stayShiftDays: 1);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Mismatched_night_rateplan_is_incoherent()
    {
        // RatePlanId must be a valid, present guid for ReservationUnit's own
        // constructor to accept a night, so the incoherence proven here is a
        // self-consistent Reservation naming a different (but still valid) RatePlan
        // than the one its source Item actually priced (two RatePlans may quote the
        // same amount, ADR 0005 item 1 — only RatePlanId distinguishes them).
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0013", hold.ExpiresAtUtc.AddTicks(-1));
        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            firstNightRatePlanOverride: Guid.NewGuid());

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Mismatched_night_amount_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0009", hold.ExpiresAtUtc.AddTicks(-1));
        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            firstNightAmountOverride: hold.Items[0].Nights[0].UnitAmount + 1m);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    private static InventoryHold CreateGuestHold(int quantity = 2) =>
        new(
            Guid.NewGuid(),
            PropertyId,
            RoomTypeId,
            quantity,
            null,
            "Guest Customer",
            "guest@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            "VND",
            CreatedAt,
            IdempotencyHash,
            Fingerprint,
            GuestHash,
            ValidNightPlan());

    private static InventoryHold CreateAuthenticatedHold() =>
        new(
            Guid.NewGuid(),
            PropertyId,
            RoomTypeId,
            2,
            CustomerId,
            "Customer Owner",
            "owner@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            "VND",
            CreatedAt,
            IdempotencyHash,
            Fingerprint,
            null,
            ValidNightPlan());

    private static Reservation CreateMutatedReservation(
        InventoryHold hold,
        Guid id,
        string confirmationNumber,
        Guid sourceHoldId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        Guid? propertyId = null,
        string? fullName = null,
        string? email = null,
        string? phone = null,
        int? adults = null,
        int? children = null,
        string? currencyCode = null,
        DateOnly? checkInOverride = null,
        DateOnly? checkOutOverride = null,
        int stayShiftDays = 0,
        Guid? unitRoomTypeIdOverride = null,
        int? itemCountOverride = null,
        Guid? foreignSourceItemId = null,
        Guid? firstNightRatePlanOverride = null,
        decimal? firstNightAmountOverride = null)
    {
        var items = itemCountOverride is { } count
            ? hold.Items.Take(count).ToArray()
            : hold.Items.ToArray();
        var checkIn = checkInOverride ?? hold.CheckIn;
        var checkOut = checkOutOverride ?? hold.CheckOut;

        var unitPlans = items.Select((item, itemIndex) => new ReservationUnitPlan(
            foreignSourceItemId is { } foreignId && itemIndex == 0 ? foreignId : item.Id,
            unitRoomTypeIdOverride ?? item.RoomTypeId,
            item.Nights
                .OrderBy(night => night.StayDate)
                .Select((night, nightIndex) => new NightlyCommitmentSnapshot(
                    night.StayDate.AddDays(stayShiftDays),
                    firstNightRatePlanOverride is { } ratePlan && itemIndex == 0 && nightIndex == 0
                        ? ratePlan
                        : night.RatePlanId,
                    firstNightAmountOverride is { } amount && itemIndex == 0 && nightIndex == 0
                        ? amount
                        : night.UnitAmount))));

        return new Reservation(
            id,
            confirmationNumber,
            sourceHoldId,
            propertyId ?? hold.PropertyId,
            customerAccountId,
            fullName ?? hold.FullName,
            email ?? hold.Email,
            phone ?? hold.Phone,
            checkIn,
            checkOut,
            adults ?? hold.Adults,
            children ?? hold.Children,
            currencyCode ?? hold.CurrencyCode,
            ReservationStatus.Confirmed,
            hold.ExpiresAtUtc.AddTicks(-1),
            null,
            null,
            guestAccessTokenHash,
            unitPlans);
    }

    private static NightlyCommitmentSnapshot[] ValidNightPlan() =>
    [
        new(CheckIn, RatePlanId, 100.25m),
        new(CheckIn.AddDays(1), RatePlanId, 100.25m)
    ];
}
