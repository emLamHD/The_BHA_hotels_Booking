using System.Collections.ObjectModel;
using System.Reflection;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;

namespace TheBha.UnitTests;

public sealed class BookingDomainTests
{
    private const string UseDefaultGuestHash = "__default_guest_hash__";
    private static readonly Guid PropertyId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid RoomTypeId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly Guid RatePlanId = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly Guid CustomerId = Guid.Parse("40000000-0000-0000-0000-000000000001");
    private static readonly DateOnly CheckIn = new(2026, 8, 1);
    private static readonly DateOnly CheckOut = new(2026, 8, 3);
    private static readonly DateTimeOffset CreatedAt = new(
        2026,
        7,
        23,
        10,
        0,
        0,
        TimeSpan.Zero);
    private static readonly string GuestHash = new('a', BookingFieldLimits.Sha256Hash);
    private static readonly string IdempotencyHash = new('b', BookingFieldLimits.Sha256Hash);
    private static readonly string Fingerprint = new('c', BookingFieldLimits.Sha256Hash);

    [Fact]
    public void Valid_guest_hold_has_fixed_snapshot_and_stable_item_and_night_shape()
    {
        var input = ValidNightPlan().AsEnumerable().Reverse().ToList();

        var hold = CreateHold(nightPlan: input);
        input.Clear();

        Assert.Null(hold.CustomerAccountId);
        Assert.Equal(GuestHash, hold.GuestAccessTokenHash);
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
        Assert.Equal(CreatedAt.AddMinutes(15), hold.ExpiresAtUtc);
        Assert.Equal(2, hold.Items.Count);
        Assert.All(hold.Items, item => Assert.Equal(RoomTypeId, item.RoomTypeId));
        Assert.All(
            hold.Items,
            item => Assert.Equal(
                [CheckIn, CheckIn.AddDays(1)],
                item.Nights.Select(night => night.StayDate)));
        Assert.Equal(401.00m, hold.TotalAmount);
        Assert.Equal("VND", hold.CurrencyCode);
        Assert.Equal("Guest Customer", hold.FullName);
        Assert.Equal("guest@example.com", hold.Email);
        Assert.Equal("+84 912 345 678", hold.Phone);
    }

    [Fact]
    public void Valid_authenticated_hold_has_customer_ownership_only()
    {
        var hold = CreateHold(customerAccountId: CustomerId, guestHash: null);

        Assert.Equal(CustomerId, hold.CustomerAccountId);
        Assert.Null(hold.GuestAccessTokenHash);
    }

    [Fact]
    public void Hold_expiry_boundary_is_deterministic()
    {
        var hold = CreateHold();

        Assert.False(hold.IsExpiredAt(hold.ExpiresAtUtc.AddTicks(-1)));
        Assert.True(hold.IsExpiredAt(hold.ExpiresAtUtc));
        Assert.True(hold.IsExpiredAt(hold.ExpiresAtUtc.AddTicks(1)));
        Assert.Throws<DomainException>(() =>
            hold.IsExpiredAt(hold.ExpiresAtUtc.ToOffset(TimeSpan.FromHours(7))));
    }

    [Theory]
    [InlineData("id")]
    [InlineData("property")]
    [InlineData("room")]
    public void Hold_rejects_empty_required_ids(string invalidPart)
    {
        Assert.Throws<DomainException>(() => CreateHold(
            id: invalidPart == "id" ? Guid.Empty : Guid.NewGuid(),
            propertyId: invalidPart == "property" ? Guid.Empty : PropertyId,
            roomTypeId: invalidPart == "room" ? Guid.Empty : RoomTypeId));
    }

    [Fact]
    public void Hold_rejects_non_utc_creation_time()
    {
        Assert.Throws<DomainException>(() => CreateHold(
            createdAtUtc: CreatedAt.ToOffset(TimeSpan.FromHours(7))));
    }

    [Theory]
    [InlineData(0, 0, 1)]
    [InlineData(-1, 0, 1)]
    [InlineData(1, -1, 1)]
    [InlineData(1, 0, 0)]
    [InlineData(1, 0, -1)]
    public void Hold_rejects_invalid_occupancy(int adults, int children, int quantity)
    {
        Assert.Throws<DomainException>(() =>
            CreateHold(adults: adults, children: children, quantity: quantity));
    }

    [Fact]
    public void Hold_rejects_invalid_stay_interval()
    {
        Assert.Throws<DomainException>(() =>
            CreateHold(checkIn: CheckOut, checkOut: CheckIn));
        Assert.Throws<DomainException>(() =>
            CreateHold(checkIn: CheckIn, checkOut: CheckIn));
    }

    [Theory]
    [InlineData("", "guest@example.com", "+84 912 345 678")]
    [InlineData("Guest", "not-an-email", "+84 912 345 678")]
    [InlineData("Guest", "guest@example.com", "phone")]
    [InlineData("Guest", "guest@example.com", "  ")]
    public void Hold_rejects_invalid_contact(string name, string email, string phone)
    {
        Assert.Throws<DomainException>(() =>
            CreateHold(fullName: name, email: email, phone: phone));
    }

    [Theory]
    [InlineData("")]
    [InlineData("VN")]
    [InlineData("VN1")]
    [InlineData("VNDX")]
    public void Hold_rejects_invalid_currency(string currency)
    {
        Assert.Throws<DomainException>(() => CreateHold(currencyCode: currency));
    }

    [Fact]
    public void Hold_normalizes_lowercase_currency()
    {
        Assert.Equal("USD", CreateHold(currencyCode: "usd").CurrencyCode);
    }

    [Fact]
    public void Hold_rejects_ambiguous_or_missing_ownership()
    {
        Assert.Throws<DomainException>(() => CreateHold(guestHash: null));
        Assert.Throws<DomainException>(() =>
            CreateHold(customerAccountId: CustomerId, guestHash: GuestHash));
        Assert.Throws<DomainException>(() =>
            CreateHold(customerAccountId: Guid.Empty, guestHash: null));
    }

    [Theory]
    [InlineData("short", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "UPPERCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "raw-token")]
    public void Hold_rejects_invalid_hash_representations(
        string idempotencyHash,
        string fingerprint,
        string guestHash)
    {
        Assert.Throws<DomainException>(() => CreateHold(
            idempotencyHash: idempotencyHash,
            fingerprint: fingerprint,
            guestHash: guestHash));
    }

    [Fact]
    public void Hold_rejects_duplicate_missing_extra_and_non_contiguous_nights()
    {
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn),
            Night(CheckIn)
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn)
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn),
            Night(CheckIn.AddDays(1)),
            Night(CheckOut)
        ]));
        Assert.Throws<DomainException>(() => CreateHold(
            checkOut: CheckIn.AddDays(3),
            nightPlan:
            [
                Night(CheckIn),
                Night(CheckIn.AddDays(2)),
                Night(CheckIn.AddDays(3))
            ]));
    }

    [Fact]
    public void Hold_rejects_empty_rateplan_in_night()
    {
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn, ratePlanId: Guid.Empty),
            Night(CheckIn.AddDays(1))
        ]));
    }

    [Fact]
    public void Hold_rejects_invalid_night_amounts()
    {
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn, unit: 0m),
            Night(CheckIn.AddDays(1))
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn, unit: -1m),
            Night(CheckIn.AddDays(1))
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nightPlan:
        [
            Night(CheckIn, unit: 1.001m),
            Night(CheckIn.AddDays(1))
        ]));
    }

    [Fact]
    public void Item_and_aggregate_totals_use_exact_decimal_arithmetic()
    {
        var hold = CreateHold(
            quantity: 2,
            nightPlan:
            [
                Night(CheckIn, unit: 0.10m),
                Night(CheckIn.AddDays(1), unit: 0.20m)
            ]);

        // 2 items x (0.10 + 0.20) per item = 0.60 total.
        Assert.Equal(0.60m, hold.TotalAmount);
        Assert.All(
            hold.Items,
            item => Assert.Equal([0.10m, 0.20m], item.Nights.Select(night => night.UnitAmount)));
    }

    [Fact]
    public void Hold_normalizes_a_multi_room_request_into_independent_items()
    {
        var hold = CreateHold(quantity: 3);

        Assert.Equal(3, hold.Items.Count);
        Assert.Equal(3, hold.Items.Select(item => item.Id).Distinct().Count());
        Assert.All(hold.Items, item => Assert.Equal(2, item.Nights.Count));
        Assert.Equal(6, hold.Items.SelectMany(item => item.Nights).Count());
    }

    [Fact]
    public void Valid_guest_and_authenticated_reservations_copy_snapshot_ownership()
    {
        var guest = CreateReservation();
        var authenticated = CreateReservation(
            customerAccountId: CustomerId,
            guestHash: null,
            confirmationNumber: "bha-auth-0001");

        Assert.Equal(ReservationStatus.Confirmed, guest.Status);
        Assert.Null(guest.CustomerAccountId);
        Assert.Equal(GuestHash, guest.GuestAccessTokenHash);
        Assert.Equal("BHA-GUEST-0001", guest.ConfirmationNumber);
        Assert.Equal(CustomerId, authenticated.CustomerAccountId);
        Assert.Null(authenticated.GuestAccessTokenHash);
        Assert.Equal("BHA-AUTH-0001", authenticated.ConfirmationNumber);
        Assert.Equal(
            guest.Units.SelectMany(unit => unit.Nights).Select(night => night.StayDate).Distinct().Order(),
            authenticated.Units.SelectMany(unit => unit.Nights).Select(night => night.StayDate).Distinct().Order());
    }

    [Fact]
    public void Valid_cancelled_reservation_cancels_every_unit_and_requires_coherent_cancellation_snapshot()
    {
        var cancelledAt = CreatedAt.AddHours(2);
        var reservation = CreateReservation(
            status: ReservationStatus.Cancelled,
            cancelledAtUtc: cancelledAt,
            cancellationReason: "Guest requested cancellation.");

        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
        Assert.Equal(cancelledAt, reservation.CancelledAtUtc);
        Assert.Equal("Guest requested cancellation.", reservation.CancellationReason);
        Assert.All(
            reservation.Units,
            unit => Assert.Equal(CommitmentStatus.Cancelled, unit.CommitmentStatus));
    }

    [Fact]
    public void Reservation_rejects_missing_source_and_confirmation_number()
    {
        Assert.Throws<DomainException>(() =>
            CreateReservation(sourceHoldId: Guid.Empty));
        Assert.Throws<DomainException>(() =>
            CreateReservation(confirmationNumber: " "));
        Assert.Throws<DomainException>(() =>
            CreateReservation(confirmationNumber: "invalid/value"));
    }

    [Fact]
    public void Reservation_rejects_empty_unit_list()
    {
        Assert.Throws<DomainException>(() => CreateReservation(unitPlans: []));
    }

    [Fact]
    public void Reservation_rejects_invalid_confirmation_and_cancellation_state()
    {
        Assert.Throws<DomainException>(() => CreateReservation(
            status: ReservationStatus.Confirmed,
            cancelledAtUtc: CreatedAt.AddHours(1),
            cancellationReason: "Impossible"));
        Assert.Throws<DomainException>(() => CreateReservation(
            status: ReservationStatus.Cancelled,
            cancelledAtUtc: null,
            cancellationReason: "Missing timestamp"));
        Assert.Throws<DomainException>(() => CreateReservation(
            status: ReservationStatus.Cancelled,
            cancelledAtUtc: CreatedAt.AddMinutes(-1),
            cancellationReason: "Before confirmation"));
        Assert.Throws<DomainException>(() => CreateReservation(
            status: ReservationStatus.Cancelled,
            cancelledAtUtc: CreatedAt.AddMinutes(1),
            cancellationReason: " "));
        Assert.Throws<DomainException>(() => CreateReservation(
            status: (ReservationStatus)999));
    }

    [Fact]
    public void Reservation_rejects_non_utc_confirmation_or_cancellation()
    {
        Assert.Throws<DomainException>(() => CreateReservation(
            confirmedAtUtc: CreatedAt.ToOffset(TimeSpan.FromHours(7))));
        Assert.Throws<DomainException>(() => CreateReservation(
            status: ReservationStatus.Cancelled,
            cancelledAtUtc: CreatedAt.AddMinutes(1).ToOffset(TimeSpan.FromHours(7)),
            cancellationReason: "Invalid offset"));
    }

    [Fact]
    public void Reservation_reuses_strong_night_and_ownership_invariants()
    {
        Assert.Throws<DomainException>(() => CreateReservation(nightPlan:
        [
            Night(CheckIn),
            Night(CheckIn)
        ]));
        Assert.Throws<DomainException>(() => CreateReservation(
            customerAccountId: CustomerId,
            guestHash: GuestHash));
    }

    [Fact]
    public void Confirm_before_expiry_transitions_status_and_copies_exact_snapshot()
    {
        var hold = CreateHold();
        var reservationId = Guid.NewGuid();

        var reservation = hold.Confirm(
            reservationId,
            "BHA-TEST-0001",
            hold.ExpiresAtUtc.AddTicks(-1));

        Assert.Equal(BookingHoldStatus.Confirmed, hold.Status);
        Assert.Equal(reservationId, reservation.Id);
        Assert.Equal("BHA-TEST-0001", reservation.ConfirmationNumber);
        Assert.Equal(hold.Id, reservation.SourceHoldId);
        Assert.Equal(hold.PropertyId, reservation.PropertyId);
        Assert.Equal(hold.CustomerAccountId, reservation.CustomerAccountId);
        Assert.Equal(hold.GuestAccessTokenHash, reservation.GuestAccessTokenHash);
        Assert.Equal(hold.FullName, reservation.FullName);
        Assert.Equal(hold.Email, reservation.Email);
        Assert.Equal(hold.Phone, reservation.Phone);
        Assert.Equal(hold.CheckIn, reservation.CheckIn);
        Assert.Equal(hold.CheckOut, reservation.CheckOut);
        Assert.Equal(hold.Adults, reservation.Adults);
        Assert.Equal(hold.Children, reservation.Children);
        Assert.Equal(hold.Items.Count, reservation.Units.Count);
        Assert.Equal(hold.CurrencyCode, reservation.CurrencyCode);
        Assert.Equal(hold.TotalAmount, reservation.TotalAmount);
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.Null(reservation.CancelledAtUtc);
        Assert.Null(reservation.CancellationReason);

        var unitsBySourceItem = reservation.Units.ToDictionary(unit => unit.SourceInventoryHoldItemId!.Value);
        foreach (var item in hold.Items)
        {
            Assert.True(unitsBySourceItem.TryGetValue(item.Id, out var unit));
            Assert.Equal(item.RoomTypeId, unit!.RoomTypeId);
            Assert.Equal(CommitmentStatus.Committed, unit.CommitmentStatus);
            Assert.Equal(
                item.Nights.OrderBy(night => night.StayDate)
                    .Select(night => (night.StayDate, night.RatePlanId, night.UnitAmount)),
                unit.Nights.OrderBy(night => night.StayDate)
                    .Select(night => (night.StayDate, night.RatePlanId, night.UnitAmount)));
        }
    }

    [Fact]
    public void Confirm_at_exact_expiry_boundary_conflicts()
    {
        var hold = CreateHold();

        Assert.Throws<DomainException>(() =>
            hold.Confirm(Guid.NewGuid(), "BHA-TEST-0002", hold.ExpiresAtUtc));
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public void Confirm_after_expiry_conflicts()
    {
        var hold = CreateHold();

        Assert.Throws<DomainException>(() =>
            hold.Confirm(Guid.NewGuid(), "BHA-TEST-0003", hold.ExpiresAtUtc.AddTicks(1)));
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public void Confirm_rejects_non_utc_time()
    {
        var hold = CreateHold();

        Assert.Throws<DomainException>(() =>
            hold.Confirm(
                Guid.NewGuid(),
                "BHA-TEST-0004",
                hold.ExpiresAtUtc.AddTicks(-1).ToOffset(TimeSpan.FromHours(7))));
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
    }

    [Fact]
    public void Confirm_is_terminal_and_cannot_be_repeated_or_reversed()
    {
        var hold = CreateHold();
        hold.Confirm(Guid.NewGuid(), "BHA-TEST-0005", hold.ExpiresAtUtc.AddTicks(-1));

        Assert.Throws<DomainException>(() =>
            hold.Confirm(Guid.NewGuid(), "BHA-TEST-0006", hold.ExpiresAtUtc.AddTicks(-1)));
        Assert.Equal(BookingHoldStatus.Confirmed, hold.Status);
    }

    [Fact]
    public void Cancelled_hold_cannot_confirm()
    {
        var hold = CreateHold();
        typeof(InventoryHold)
            .GetProperty(nameof(InventoryHold.Status))!
            .SetValue(hold, BookingHoldStatus.Cancelled);

        Assert.Throws<DomainException>(() =>
            hold.Confirm(Guid.NewGuid(), "BHA-TEST-0007", hold.ExpiresAtUtc.AddTicks(-1)));
    }

    [Fact]
    public void Hold_cancel_transitions_active_to_cancelled()
    {
        var hold = CreateHold();

        hold.Cancel();

        Assert.Equal(BookingHoldStatus.Cancelled, hold.Status);
    }

    [Fact]
    public void Hold_cancel_is_idempotent_when_already_cancelled()
    {
        var hold = CreateHold();
        hold.Cancel();

        hold.Cancel();

        Assert.Equal(BookingHoldStatus.Cancelled, hold.Status);
    }

    [Fact]
    public void Hold_cancel_rejects_confirmed()
    {
        var hold = CreateHold();
        hold.Confirm(Guid.NewGuid(), "BHA-TEST-0008", hold.ExpiresAtUtc.AddTicks(-1));

        Assert.Throws<DomainException>(() => hold.Cancel());
        Assert.Equal(BookingHoldStatus.Confirmed, hold.Status);
    }

    [Fact]
    public void Hold_cancel_succeeds_even_after_expiry_boundary()
    {
        var hold = CreateHold();
        Assert.True(hold.IsExpiredAt(hold.ExpiresAtUtc));

        hold.Cancel();

        Assert.Equal(BookingHoldStatus.Cancelled, hold.Status);
    }

    [Fact]
    public void Hold_cancel_leaves_immutable_fields_and_items_unchanged()
    {
        var hold = CreateHold();
        var originalItemIds = hold.Items.Select(item => item.Id).ToArray();
        var originalNights = hold.Items
            .SelectMany(item => item.Nights)
            .Select(night => (night.InventoryHoldItemId, night.StayDate, night.RatePlanId, night.UnitAmount))
            .ToArray();

        hold.Cancel();

        Assert.Equal(PropertyId, hold.PropertyId);
        Assert.Equal(CreatedAt, hold.CreatedAtUtc);
        Assert.Equal(CreatedAt.AddMinutes(15), hold.ExpiresAtUtc);
        Assert.Equal(GuestHash, hold.GuestAccessTokenHash);
        Assert.Equal(originalItemIds, hold.Items.Select(item => item.Id));
        Assert.Equal(
            originalNights,
            hold.Items.SelectMany(item => item.Nights)
                .Select(night => (night.InventoryHoldItemId, night.StayDate, night.RatePlanId, night.UnitAmount)));
    }

    [Fact]
    public void Reservation_cancel_transitions_confirmed_to_cancelled_before_checkin()
    {
        var reservation = CreateReservation();
        var utcNow = CreatedAt.AddHours(1);
        var localDateBeforeCheckIn = CheckIn.AddDays(-1);

        reservation.Cancel("Guest requested cancellation.", utcNow, localDateBeforeCheckIn);

        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
        Assert.Equal(utcNow, reservation.CancelledAtUtc);
        Assert.Equal("Guest requested cancellation.", reservation.CancellationReason);
        Assert.All(
            reservation.Units,
            unit => Assert.Equal(CommitmentStatus.Cancelled, unit.CommitmentStatus));
    }

    [Fact]
    public void Reservation_cancel_trims_reason()
    {
        var reservation = CreateReservation();

        reservation.Cancel("  Trimmed reason.  ", CreatedAt.AddHours(1), CheckIn.AddDays(-1));

        Assert.Equal("Trimmed reason.", reservation.CancellationReason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Reservation_cancel_rejects_missing_reason(string? reason)
    {
        var reservation = CreateReservation();

        Assert.Throws<DomainException>(() =>
            reservation.Cancel(reason!, CreatedAt.AddHours(1), CheckIn.AddDays(-1)));
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
        Assert.All(
            reservation.Units,
            unit => Assert.Equal(CommitmentStatus.Committed, unit.CommitmentStatus));
    }

    [Fact]
    public void Reservation_cancel_rejects_reason_over_limit()
    {
        var reservation = CreateReservation();
        var overLimit = new string('x', BookingFieldLimits.CancellationReason + 1);

        Assert.Throws<DomainException>(() =>
            reservation.Cancel(overLimit, CreatedAt.AddHours(1), CheckIn.AddDays(-1)));
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public void Reservation_cancel_accepts_reason_at_exact_limit()
    {
        var reservation = CreateReservation();
        var atLimit = new string('x', BookingFieldLimits.CancellationReason);

        reservation.Cancel(atLimit, CreatedAt.AddHours(1), CheckIn.AddDays(-1));

        Assert.Equal(atLimit, reservation.CancellationReason);
    }

    [Fact]
    public void Reservation_cancel_rejects_non_utc_time()
    {
        var reservation = CreateReservation();

        Assert.Throws<DomainException>(() => reservation.Cancel(
            "Reason",
            CreatedAt.AddHours(1).ToOffset(TimeSpan.FromHours(7)),
            CheckIn.AddDays(-1)));
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public void Reservation_cancel_rejects_time_earlier_than_confirmation()
    {
        var reservation = CreateReservation();

        Assert.Throws<DomainException>(() => reservation.Cancel(
            "Reason",
            CreatedAt.AddMinutes(-1),
            CheckIn.AddDays(-1)));
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public void Reservation_cancel_rejects_at_exact_local_checkin_boundary()
    {
        var reservation = CreateReservation();

        Assert.Throws<DomainException>(() =>
            reservation.Cancel("Reason", CreatedAt.AddHours(1), CheckIn));
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public void Reservation_cancel_rejects_after_local_checkin_date()
    {
        var reservation = CreateReservation();

        Assert.Throws<DomainException>(() =>
            reservation.Cancel("Reason", CreatedAt.AddHours(1), CheckIn.AddDays(1)));
        Assert.Equal(ReservationStatus.Confirmed, reservation.Status);
    }

    [Fact]
    public void Reservation_cancel_is_idempotent_and_preserves_original_timestamp_and_reason()
    {
        var reservation = CreateReservation();
        var firstCancelAt = CreatedAt.AddHours(1);
        reservation.Cancel("Original reason.", firstCancelAt, CheckIn.AddDays(-1));

        reservation.Cancel("A different, later reason.", CreatedAt.AddHours(2), CheckIn.AddDays(1));

        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
        Assert.Equal(firstCancelAt, reservation.CancelledAtUtc);
        Assert.Equal("Original reason.", reservation.CancellationReason);
    }

    [Fact]
    public void Reservation_cancel_leaves_immutable_fields_and_unit_nights_unchanged()
    {
        var reservation = CreateReservation();
        var originalNights = reservation.Units
            .SelectMany(unit => unit.Nights)
            .Select(night => (night.ReservationUnitId, night.StayDate, night.RatePlanId, night.UnitAmount))
            .ToArray();

        reservation.Cancel("Reason", CreatedAt.AddHours(1), CheckIn.AddDays(-1));

        Assert.Equal(PropertyId, reservation.PropertyId);
        Assert.Equal("BHA-GUEST-0001", reservation.ConfirmationNumber);
        Assert.Equal(GuestHash, reservation.GuestAccessTokenHash);
        Assert.Equal(CreatedAt, reservation.ConfirmedAtUtc);
        Assert.Equal(
            originalNights,
            reservation.Units.SelectMany(unit => unit.Nights)
                .Select(night => (night.ReservationUnitId, night.StayDate, night.RatePlanId, night.UnitAmount)));
    }

    [Fact]
    public void Aggregates_expose_no_mutable_collections_or_raw_material_properties()
    {
        var hold = CreateHold();
        var reservation = CreateReservation();

        Assert.IsType<ReadOnlyCollection<InventoryHoldItem>>(hold.Items);
        Assert.IsType<ReadOnlyCollection<ReservationUnit>>(reservation.Units);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<InventoryHoldItem>)hold.Items).Clear());
        Assert.Throws<NotSupportedException>(() =>
            ((IList<ReservationUnit>)reservation.Units).Clear());

        Assert.DoesNotContain(
            typeof(InventoryHold).GetProperties(BindingFlags.Instance | BindingFlags.Public),
            property => property.Name is "GuestAccessToken" or "IdempotencyKey");
        Assert.DoesNotContain(
            typeof(Reservation).GetProperties(BindingFlags.Instance | BindingFlags.Public),
            property => property.Name == "GuestAccessToken");
        Assert.All(
            typeof(InventoryHold).GetProperties(),
            property => Assert.False(property.SetMethod?.IsPublic == true));
        Assert.All(
            typeof(Reservation).GetProperties(),
            property => Assert.False(property.SetMethod?.IsPublic == true));
    }

    private static InventoryHold CreateHold(
        Guid? id = null,
        Guid? propertyId = null,
        Guid? roomTypeId = null,
        Guid? customerAccountId = null,
        string? fullName = "Guest Customer",
        string? email = "guest@example.com",
        string? phone = "+84 912 345 678",
        DateOnly? checkIn = null,
        DateOnly? checkOut = null,
        int adults = 2,
        int children = 1,
        int quantity = 2,
        string? currencyCode = "VND",
        DateTimeOffset? createdAtUtc = null,
        string? idempotencyHash = null,
        string? fingerprint = null,
        string? guestHash = UseDefaultGuestHash,
        IEnumerable<NightlyCommitmentSnapshot>? nightPlan = null)
    {
        return new InventoryHold(
            id ?? Guid.NewGuid(),
            propertyId ?? PropertyId,
            roomTypeId ?? RoomTypeId,
            quantity,
            customerAccountId,
            fullName!,
            email!,
            phone!,
            checkIn ?? CheckIn,
            checkOut ?? CheckOut,
            adults,
            children,
            currencyCode!,
            createdAtUtc ?? CreatedAt,
            idempotencyHash ?? IdempotencyHash,
            fingerprint ?? Fingerprint,
            guestHash == UseDefaultGuestHash
                ? customerAccountId.HasValue ? null : GuestHash
                : guestHash,
            nightPlan ?? ValidNightPlan());
    }

    private static Reservation CreateReservation(
        Guid? id = null,
        string? confirmationNumber = "bha-guest-0001",
        Guid? sourceHoldId = null,
        Guid? customerAccountId = null,
        ReservationStatus status = ReservationStatus.Confirmed,
        DateTimeOffset? confirmedAtUtc = null,
        DateTimeOffset? cancelledAtUtc = null,
        string? cancellationReason = null,
        string? guestHash = UseDefaultGuestHash,
        IEnumerable<NightlyCommitmentSnapshot>? nightPlan = null,
        IEnumerable<ReservationUnitPlan>? unitPlans = null)
    {
        var plans = unitPlans ?? DefaultUnitPlans(nightPlan ?? ValidNightPlan());
        return new Reservation(
            id ?? Guid.NewGuid(),
            confirmationNumber!,
            sourceHoldId ?? Guid.NewGuid(),
            PropertyId,
            customerAccountId,
            "Guest Customer",
            "guest@example.com",
            "+84 912 345 678",
            CheckIn,
            CheckOut,
            2,
            1,
            "VND",
            status,
            confirmedAtUtc ?? CreatedAt,
            cancelledAtUtc,
            cancellationReason,
            guestHash == UseDefaultGuestHash
                ? customerAccountId.HasValue ? null : GuestHash
                : guestHash,
            plans);
    }

    private static List<ReservationUnitPlan> DefaultUnitPlans(
        IEnumerable<NightlyCommitmentSnapshot> nightPlan)
    {
        var nights = nightPlan.ToArray();
        return
        [
            new ReservationUnitPlan(Guid.NewGuid(), RoomTypeId, nights),
            new ReservationUnitPlan(Guid.NewGuid(), RoomTypeId, nights)
        ];
    }

    private static List<NightlyCommitmentSnapshot> ValidNightPlan() =>
    [
        Night(CheckIn),
        Night(CheckIn.AddDays(1))
    ];

    private static NightlyCommitmentSnapshot Night(
        DateOnly date,
        Guid? ratePlanId = null,
        decimal unit = 100.25m) =>
        new(date, ratePlanId ?? RatePlanId, unit);
}
