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

    /// <summary>
    /// Transitions this Reservation from <see cref="ReservationStatus.Confirmed"/> to
    /// <see cref="ReservationStatus.Cancelled"/>, enforced strictly before the Property-local
    /// <paramref name="propertyLocalDate"/> reaches <see cref="CheckIn"/>. Already-<see
    /// cref="ReservationStatus.Cancelled"/> is an idempotent no-op that preserves the original
    /// <see cref="CancelledAtUtc"/> and <see cref="CancellationReason"/> even if called again at
    /// or after the check-in cutoff. <paramref name="utcNow"/> and <paramref
    /// name="propertyLocalDate"/> must be server-derived; this method never accepts client time.
    /// </summary>
    public void Cancel(string reason, DateTimeOffset utcNow, DateOnly propertyLocalDate)
    {
        if (Status == ReservationStatus.Cancelled)
        {
            return;
        }

        if (Status != ReservationStatus.Confirmed)
        {
            throw new DomainException("Only a Confirmed Reservation can be cancelled.");
        }

        BookingGuard.RequireUtc(utcNow, nameof(utcNow));
        if (utcNow < ConfirmedAtUtc)
        {
            throw new DomainException("cancelledAtUtc cannot be earlier than confirmedAtUtc.");
        }

        if (propertyLocalDate >= CheckIn)
        {
            throw new DomainException(
                "The Reservation cannot be cancelled on or after the Property-local check-in date.");
        }

        var normalizedReason = DomainGuard.Required(
            reason,
            nameof(reason),
            BookingFieldLimits.CancellationReason);

        Status = ReservationStatus.Cancelled;
        CancelledAtUtc = utcNow;
        CancellationReason = normalizedReason;
    }
}
