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
    public void Valid_guest_hold_has_fixed_snapshot_and_stable_night_order()
    {
        var input = ValidNights().AsEnumerable().Reverse().ToList();

        var hold = CreateHold(nights: input);
        input.Clear();

        Assert.Null(hold.CustomerAccountId);
        Assert.Equal(GuestHash, hold.GuestAccessTokenHash);
        Assert.Equal(BookingHoldStatus.Active, hold.Status);
        Assert.Equal(CreatedAt.AddMinutes(15), hold.ExpiresAtUtc);
        Assert.Equal([CheckIn, CheckIn.AddDays(1)], hold.Nights.Select(night => night.StayDate));
        Assert.Equal(401.00m, hold.TotalAmount);
        Assert.Equal(2, hold.Rooms);
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
    [InlineData("rate")]
    public void Hold_rejects_empty_required_ids(string invalidPart)
    {
        Assert.Throws<DomainException>(() => CreateHold(
            id: invalidPart == "id" ? Guid.Empty : Guid.NewGuid(),
            propertyId: invalidPart == "property" ? Guid.Empty : PropertyId,
            roomTypeId: invalidPart == "room" ? Guid.Empty : RoomTypeId,
            ratePlanId: invalidPart == "rate" ? Guid.Empty : RatePlanId));
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
    public void Hold_rejects_invalid_occupancy(int adults, int children, int rooms)
    {
        Assert.Throws<DomainException>(() =>
            CreateHold(adults: adults, children: children, rooms: rooms));
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
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn),
            Night(CheckIn)
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn)
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn),
            Night(CheckIn.AddDays(1)),
            Night(CheckOut)
        ]));
        Assert.Throws<DomainException>(() => CreateHold(
            checkOut: CheckIn.AddDays(3),
            totalAmount: 601.50m,
            nights:
            [
                Night(CheckIn),
                Night(CheckIn.AddDays(2)),
                Night(CheckIn.AddDays(3))
            ]));
    }

    [Fact]
    public void Hold_rejects_room_amount_and_total_mismatches()
    {
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn, rooms: 1, unit: 100.25m, total: 100.25m),
            Night(CheckIn.AddDays(1))
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn, unit: 100.25m, total: 199.00m),
            Night(CheckIn.AddDays(1))
        ]));
        Assert.Throws<DomainException>(() => CreateHold(totalAmount: 400.99m));
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn, unit: 0m, total: 0m),
            Night(CheckIn.AddDays(1))
        ]));
        Assert.Throws<DomainException>(() => CreateHold(nights:
        [
            Night(CheckIn, unit: 1.001m, total: 2.002m),
            Night(CheckIn.AddDays(1))
        ]));
    }

    [Fact]
    public void Night_and_aggregate_totals_use_exact_decimal_arithmetic()
    {
        var hold = CreateHold(
            totalAmount: 0.60m,
            nights:
            [
                Night(CheckIn, unit: 0.10m, total: 0.20m),
                Night(CheckIn.AddDays(1), unit: 0.20m, total: 0.40m)
            ]);

        Assert.Equal(0.60m, hold.TotalAmount);
        Assert.Equal([0.20m, 0.40m], hold.Nights.Select(night => night.NightTotal));
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
        Assert.Equal(guest.Nights.Select(night => night.StayDate), authenticated.Nights.Select(night => night.StayDate));
    }

    [Fact]
    public void Valid_cancelled_reservation_requires_coherent_cancellation_snapshot()
    {
        var cancelledAt = CreatedAt.AddHours(2);
        var reservation = CreateReservation(
            status: ReservationStatus.Cancelled,
            cancelledAtUtc: cancelledAt,
            cancellationReason: "Guest requested cancellation.");

        Assert.Equal(ReservationStatus.Cancelled, reservation.Status);
        Assert.Equal(cancelledAt, reservation.CancelledAtUtc);
        Assert.Equal("Guest requested cancellation.", reservation.CancellationReason);
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
        Assert.Throws<DomainException>(() => CreateReservation(nights:
        [
            Night(CheckIn),
            Night(CheckIn)
        ]));
        Assert.Throws<DomainException>(() => CreateReservation(nights:
        [
            Night(CheckIn, total: 199m),
            Night(CheckIn.AddDays(1))
        ]));
        Assert.Throws<DomainException>(() => CreateReservation(
            customerAccountId: CustomerId,
            guestHash: GuestHash));
    }

    [Fact]
    public void Aggregates_expose_no_mutable_nights_or_raw_material_properties()
    {
        var hold = CreateHold();
        var reservation = CreateReservation();

        Assert.IsType<ReadOnlyCollection<BookingHoldNight>>(hold.Nights);
        Assert.IsType<ReadOnlyCollection<ReservationNight>>(reservation.Nights);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<BookingHoldNight>)hold.Nights).Clear());
        Assert.Throws<NotSupportedException>(() =>
            ((IList<ReservationNight>)reservation.Nights).Clear());

        Assert.DoesNotContain(
            typeof(BookingHold).GetProperties(BindingFlags.Instance | BindingFlags.Public),
            property => property.Name is "GuestAccessToken" or "IdempotencyKey");
        Assert.DoesNotContain(
            typeof(Reservation).GetProperties(BindingFlags.Instance | BindingFlags.Public),
            property => property.Name == "GuestAccessToken");
        Assert.All(
            typeof(BookingHold).GetProperties(),
            property => Assert.False(property.SetMethod?.IsPublic == true));
        Assert.All(
            typeof(Reservation).GetProperties(),
            property => Assert.False(property.SetMethod?.IsPublic == true));
    }

    private static BookingHold CreateHold(
        Guid? id = null,
        Guid? propertyId = null,
        Guid? roomTypeId = null,
        Guid? ratePlanId = null,
        Guid? customerAccountId = null,
        string? fullName = "Guest Customer",
        string? email = "guest@example.com",
        string? phone = "+84 912 345 678",
        DateOnly? checkIn = null,
        DateOnly? checkOut = null,
        int adults = 2,
        int children = 1,
        int rooms = 2,
        string? currencyCode = "VND",
        decimal totalAmount = 401.00m,
        DateTimeOffset? createdAtUtc = null,
        string? idempotencyHash = null,
        string? fingerprint = null,
        string? guestHash = UseDefaultGuestHash,
        IEnumerable<BookingNightSnapshot>? nights = null)
    {
        return new BookingHold(
            id ?? Guid.NewGuid(),
            propertyId ?? PropertyId,
            roomTypeId ?? RoomTypeId,
            ratePlanId ?? RatePlanId,
            customerAccountId,
            fullName!,
            email!,
            phone!,
            checkIn ?? CheckIn,
            checkOut ?? CheckOut,
            adults,
            children,
            rooms,
            currencyCode!,
            totalAmount,
            createdAtUtc ?? CreatedAt,
            idempotencyHash ?? IdempotencyHash,
            fingerprint ?? Fingerprint,
            guestHash == UseDefaultGuestHash
                ? customerAccountId.HasValue ? null : GuestHash
                : guestHash,
            nights ?? ValidNights(rooms));
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
        IEnumerable<BookingNightSnapshot>? nights = null)
    {
        return new Reservation(
            id ?? Guid.NewGuid(),
            confirmationNumber!,
            sourceHoldId ?? Guid.NewGuid(),
            PropertyId,
            RoomTypeId,
            RatePlanId,
            customerAccountId,
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
            status,
            confirmedAtUtc ?? CreatedAt,
            cancelledAtUtc,
            cancellationReason,
            guestHash == UseDefaultGuestHash
                ? customerAccountId.HasValue ? null : GuestHash
                : guestHash,
            nights ?? ValidNights());
    }

    private static List<BookingNightSnapshot> ValidNights(int rooms = 2) =>
    [
        Night(CheckIn, rooms, 100.25m, 100.25m * rooms),
        Night(CheckIn.AddDays(1), rooms, 100.25m, 100.25m * rooms)
    ];

    private static BookingNightSnapshot Night(
        DateOnly date,
        int rooms = 2,
        decimal unit = 100.25m,
        decimal total = 200.50m) =>
        new(date, rooms, unit, total);
}
