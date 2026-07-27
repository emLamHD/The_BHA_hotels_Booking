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
            hold: activeHold,
            id: reservation.Id,
            confirmationNumber: reservation.ConfirmationNumber,
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
    [InlineData("roomTypeId")]
    [InlineData("ratePlanId")]
    [InlineData("fullName")]
    [InlineData("email")]
    [InlineData("phone")]
    [InlineData("adults")]
    [InlineData("children")]
    [InlineData("currency")]
    public void Mismatched_business_field_is_incoherent(string field)
    {
        // checkIn/checkOut and totalAmount are cross-validated against the night
        // list by Reservation's own constructor, so an incoherent value there can
        // only be reached by a self-consistent-but-wrong Reservation (see the
        // dedicated stay-period and night-amount tests below), not a bare field swap.
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0007", hold.ExpiresAtUtc.AddTicks(-1));

        var mutated = CreateMutatedReservation(
            hold,
            reservation.Id,
            reservation.ConfirmationNumber,
            sourceHoldId: hold.Id,
            customerAccountId: hold.CustomerAccountId,
            guestAccessTokenHash: hold.GuestAccessTokenHash,
            propertyId: field == "propertyId" ? Guid.NewGuid() : hold.PropertyId,
            roomTypeId: field == "roomTypeId" ? Guid.NewGuid() : hold.RoomTypeId,
            ratePlanId: field == "ratePlanId" ? Guid.NewGuid() : hold.RatePlanId,
            fullName: field == "fullName" ? "Someone Else" : hold.FullName,
            email: field == "email" ? "someone-else@example.com" : hold.Email,
            phone: field == "phone" ? "+84 000 000 000" : hold.Phone,
            adults: field == "adults" ? hold.Adults + 1 : hold.Adults,
            children: field == "children" ? hold.Children + 1 : hold.Children,
            currencyCode: field == "currency" ? "USD" : hold.CurrencyCode);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Mismatched_rooms_and_matching_night_rooms_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0010", hold.ExpiresAtUtc.AddTicks(-1));
        var inflatedRooms = hold.Rooms + 1;
        var nights = hold.Nights
            .OrderBy(night => night.StayDate)
            .Select(night => new BookingNightSnapshot(
                night.StayDate,
                inflatedRooms,
                night.UnitAmount,
                night.UnitAmount * inflatedRooms));
        var mutated = new Reservation(
            reservation.Id,
            reservation.ConfirmationNumber,
            hold.Id,
            hold.PropertyId,
            hold.RoomTypeId,
            hold.RatePlanId,
            hold.CustomerAccountId,
            hold.FullName,
            hold.Email,
            hold.Phone,
            hold.CheckIn,
            hold.CheckOut,
            hold.Adults,
            hold.Children,
            inflatedRooms,
            hold.CurrencyCode,
            nights.Sum(night => night.NightTotal),
            ReservationStatus.Confirmed,
            reservation.ConfirmedAtUtc,
            null,
            null,
            hold.GuestAccessTokenHash,
            nights);

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
        var shiftedCheckIn = hold.CheckIn.AddDays(1);
        var shiftedCheckOut = hold.CheckOut.AddDays(1);
        var shiftedNights = hold.Nights
            .OrderBy(night => night.StayDate)
            .Select(night => new BookingNightSnapshot(
                night.StayDate.AddDays(1),
                night.Rooms,
                night.UnitAmount,
                night.NightTotal));
        var mutated = new Reservation(
            reservation.Id,
            reservation.ConfirmationNumber,
            hold.Id,
            hold.PropertyId,
            hold.RoomTypeId,
            hold.RatePlanId,
            hold.CustomerAccountId,
            hold.FullName,
            hold.Email,
            hold.Phone,
            shiftedCheckIn,
            shiftedCheckOut,
            hold.Adults,
            hold.Children,
            hold.Rooms,
            hold.CurrencyCode,
            hold.TotalAmount,
            ReservationStatus.Confirmed,
            reservation.ConfirmedAtUtc,
            null,
            null,
            hold.GuestAccessTokenHash,
            shiftedNights);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Self_consistent_but_wrong_total_amount_is_incoherent()
    {
        // totalAmount must equal the sum of the night snapshots for Reservation's
        // own constructor to accept it, so a coordinated, self-consistent overprice
        // is the only reachable way to prove this incoherence.
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0011", hold.ExpiresAtUtc.AddTicks(-1));
        var inflatedUnitAmount = hold.Nights.First().UnitAmount + 1m;
        var inflatedNights = hold.Nights
            .OrderBy(night => night.StayDate)
            .Select(night => new BookingNightSnapshot(
                night.StayDate,
                night.Rooms,
                inflatedUnitAmount,
                inflatedUnitAmount * night.Rooms));
        var mutated = new Reservation(
            reservation.Id,
            reservation.ConfirmationNumber,
            hold.Id,
            hold.PropertyId,
            hold.RoomTypeId,
            hold.RatePlanId,
            hold.CustomerAccountId,
            hold.FullName,
            hold.Email,
            hold.Phone,
            hold.CheckIn,
            hold.CheckOut,
            hold.Adults,
            hold.Children,
            hold.Rooms,
            hold.CurrencyCode,
            inflatedNights.Sum(night => night.NightTotal),
            ReservationStatus.Confirmed,
            reservation.ConfirmedAtUtc,
            null,
            null,
            hold.GuestAccessTokenHash,
            inflatedNights);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    [Fact]
    public void Mismatched_night_amount_is_incoherent()
    {
        var hold = CreateGuestHold();
        var reservation = hold.Confirm(Guid.NewGuid(), "BHA-COHERENT-0009", hold.ExpiresAtUtc.AddTicks(-1));
        var orderedHoldNights = hold.Nights.OrderBy(night => night.StayDate).ToArray();
        var inflatedNights = orderedHoldNights.Select((night, index) => index == 0
            ? new BookingNightSnapshot(night.StayDate, night.Rooms, night.UnitAmount + 1m, night.NightTotal + night.Rooms)
            : new BookingNightSnapshot(night.StayDate, night.Rooms, night.UnitAmount, night.NightTotal));
        var mutated = new Reservation(
            reservation.Id,
            reservation.ConfirmationNumber,
            hold.Id,
            hold.PropertyId,
            hold.RoomTypeId,
            hold.RatePlanId,
            hold.CustomerAccountId,
            hold.FullName,
            hold.Email,
            hold.Phone,
            hold.CheckIn,
            hold.CheckOut,
            hold.Adults,
            hold.Children,
            hold.Rooms,
            hold.CurrencyCode,
            hold.TotalAmount + hold.Rooms,
            ReservationStatus.Confirmed,
            reservation.ConfirmedAtUtc,
            null,
            null,
            hold.GuestAccessTokenHash,
            inflatedNights);

        Assert.False(hold.IsCoherentReservation(mutated));
    }

    private static BookingHold CreateGuestHold() =>
        new(
            Guid.NewGuid(),
            PropertyId,
            RoomTypeId,
            RatePlanId,
            null,
            "Guest Customer",
            "guest@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            2,
            "VND",
            401.00m,
            CreatedAt,
            IdempotencyHash,
            Fingerprint,
            GuestHash,
            ValidNights());

    private static BookingHold CreateAuthenticatedHold() =>
        new(
            Guid.NewGuid(),
            PropertyId,
            RoomTypeId,
            RatePlanId,
            CustomerId,
            "Customer Owner",
            "owner@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            2,
            "VND",
            401.00m,
            CreatedAt,
            IdempotencyHash,
            Fingerprint,
            null,
            ValidNights());

    private static Reservation CreateMutatedReservation(
        BookingHold hold,
        Guid id,
        string confirmationNumber,
        Guid sourceHoldId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        Guid? propertyId = null,
        Guid? roomTypeId = null,
        Guid? ratePlanId = null,
        string? fullName = null,
        string? email = null,
        string? phone = null,
        int? adults = null,
        int? children = null,
        string? currencyCode = null)
    {
        var nights = hold.Nights
            .OrderBy(night => night.StayDate)
            .Select(night => new BookingNightSnapshot(
                night.StayDate,
                night.Rooms,
                night.UnitAmount,
                night.NightTotal));

        return new Reservation(
            id,
            confirmationNumber,
            sourceHoldId,
            propertyId ?? hold.PropertyId,
            roomTypeId ?? hold.RoomTypeId,
            ratePlanId ?? hold.RatePlanId,
            customerAccountId,
            fullName ?? hold.FullName,
            email ?? hold.Email,
            phone ?? hold.Phone,
            hold.CheckIn,
            hold.CheckOut,
            adults ?? hold.Adults,
            children ?? hold.Children,
            hold.Rooms,
            currencyCode ?? hold.CurrencyCode,
            hold.TotalAmount,
            ReservationStatus.Confirmed,
            hold.ExpiresAtUtc.AddTicks(-1),
            null,
            null,
            guestAccessTokenHash,
            nights);
    }

    private static List<BookingNightSnapshot> ValidNights() =>
    [
        new(CheckIn, 2, 100.25m, 200.50m),
        new(CheckIn.AddDays(1), 2, 100.25m, 200.50m)
    ];
}
