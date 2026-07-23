using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

public sealed class Reservation
{
    private readonly List<ReservationNight> _nights = [];

    private Reservation()
    {
    }

    public Reservation(
        Guid id,
        string confirmationNumber,
        Guid sourceHoldId,
        Guid propertyId,
        Guid roomTypeId,
        Guid ratePlanId,
        Guid? customerAccountId,
        string fullName,
        string email,
        string phone,
        DateOnly checkIn,
        DateOnly checkOut,
        int adults,
        int children,
        int rooms,
        string currencyCode,
        decimal totalAmount,
        ReservationStatus status,
        DateTimeOffset confirmedAtUtc,
        DateTimeOffset? cancelledAtUtc,
        string? cancellationReason,
        string? guestAccessTokenHash,
        IEnumerable<BookingNightSnapshot> nights)
    {
        BookingGuard.ValidateHeader(
            id,
            propertyId,
            roomTypeId,
            ratePlanId,
            checkIn,
            checkOut,
            adults,
            children,
            rooms,
            totalAmount);
        DomainGuard.RequiredId(sourceHoldId, nameof(sourceHoldId));
        var contact = BookingGuard.NormalizeContact(fullName, email, phone);
        var orderedNights = BookingGuard.ValidateNights(
            checkIn,
            checkOut,
            rooms,
            totalAmount,
            nights);
        var confirmedAt = BookingGuard.RequireUtc(
            confirmedAtUtc,
            nameof(confirmedAtUtc));

        Id = id;
        ConfirmationNumber = BookingGuard.NormalizeConfirmationNumber(confirmationNumber);
        SourceHoldId = sourceHoldId;
        PropertyId = propertyId;
        RoomTypeId = roomTypeId;
        RatePlanId = ratePlanId;
        CustomerAccountId = customerAccountId;
        FullName = contact.FullName;
        Email = contact.Email;
        Phone = contact.Phone;
        CheckIn = checkIn;
        CheckOut = checkOut;
        Adults = adults;
        Children = children;
        Rooms = rooms;
        CurrencyCode = BookingGuard.NormalizeCurrency(currencyCode);
        TotalAmount = totalAmount;
        Status = status;
        ConfirmedAtUtc = confirmedAt;
        CancelledAtUtc = cancelledAtUtc;
        CancellationReason = BookingGuard.ValidateCancellation(
            status,
            confirmedAt,
            cancelledAtUtc,
            cancellationReason);
        GuestAccessTokenHash = BookingGuard.ValidateOwnership(
            customerAccountId,
            guestAccessTokenHash);
        _nights.AddRange(orderedNights.Select(snapshot => new ReservationNight(Id, snapshot)));
    }

    public Guid Id { get; private set; }
    public string ConfirmationNumber { get; private set; } = string.Empty;
    public Guid SourceHoldId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid RoomTypeId { get; private set; }
    public Guid RatePlanId { get; private set; }
    public Guid? CustomerAccountId { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string Phone { get; private set; } = string.Empty;
    public DateOnly CheckIn { get; private set; }
    public DateOnly CheckOut { get; private set; }
    public int Adults { get; private set; }
    public int Children { get; private set; }
    public int Rooms { get; private set; }
    public string CurrencyCode { get; private set; } = string.Empty;
    public decimal TotalAmount { get; private set; }
    public ReservationStatus Status { get; private set; }
    public DateTimeOffset ConfirmedAtUtc { get; private set; }
    public DateTimeOffset? CancelledAtUtc { get; private set; }
    public string? CancellationReason { get; private set; }
    public string? GuestAccessTokenHash { get; private set; }
    public IReadOnlyList<ReservationNight> Nights => _nights.AsReadOnly();
}
