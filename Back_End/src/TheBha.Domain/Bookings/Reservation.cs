using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>
/// Reservation aggregate root (ADR 0005). Owns identity, confirmation/cancellation
/// lifecycle, and ownership; every commercially sold room is a persisted
/// <see cref="ReservationUnit"/>. The aggregate itself carries no RoomTypeId/
/// RatePlanId/Rooms — those live at the Unit/UnitNight level.
/// </summary>
public sealed class Reservation
{
    private readonly List<ReservationUnit> _units = [];

    private Reservation()
    {
    }

    /// <summary>Creates a Reservation sourced from a confirmed Hold (<see cref="ReservationSource.Hold"/>). Direct creation goes through <see cref="CreateDirect"/>.</summary>
    public Reservation(
        Guid id,
        string confirmationNumber,
        Guid sourceHoldId,
        Guid propertyId,
        Guid? customerAccountId,
        string fullName,
        string email,
        string phone,
        DateOnly checkIn,
        DateOnly checkOut,
        int adults,
        int children,
        string currencyCode,
        ReservationStatus status,
        DateTimeOffset confirmedAtUtc,
        DateTimeOffset? cancelledAtUtc,
        string? cancellationReason,
        string? guestAccessTokenHash,
        IEnumerable<ReservationUnitPlan> units)
        : this(
            ReservationSource.Hold,
            DomainGuard.RequiredId(sourceHoldId, nameof(sourceHoldId)),
            id, confirmationNumber, propertyId, customerAccountId, fullName, email, phone, checkIn, checkOut,
            adults, children, currencyCode, status, confirmedAtUtc, cancelledAtUtc, cancellationReason,
            guestAccessTokenHash, units)
    {
    }

    private Reservation(
        ReservationSource source,
        Guid? sourceHoldId,
        Guid id,
        string confirmationNumber,
        Guid propertyId,
        Guid? customerAccountId,
        string fullName,
        string email,
        string phone,
        DateOnly checkIn,
        DateOnly checkOut,
        int adults,
        int children,
        string currencyCode,
        ReservationStatus status,
        DateTimeOffset confirmedAtUtc,
        DateTimeOffset? cancelledAtUtc,
        string? cancellationReason,
        string? guestAccessTokenHash,
        IEnumerable<ReservationUnitPlan> units)
    {
        BookingGuard.ValidateReservationHeader(id, propertyId, checkIn, checkOut, adults, children);
        var contact = BookingGuard.NormalizeContact(fullName, email, phone);
        var confirmedAt = BookingGuard.RequireUtc(confirmedAtUtc, nameof(confirmedAtUtc));
        ArgumentNullException.ThrowIfNull(units);
        var unitPlans = units.ToArray();
        if (unitPlans.Length < 1)
        {
            throw new DomainException("A Reservation must contain at least one Unit.");
        }

        Id = id;
        ConfirmationNumber = BookingGuard.NormalizeConfirmationNumber(confirmationNumber);
        Source = source;
        SourceHoldId = sourceHoldId;
        PropertyId = propertyId;
        CustomerAccountId = customerAccountId;
        FullName = contact.FullName;
        Email = contact.Email;
        Phone = contact.Phone;
        CheckIn = checkIn;
        CheckOut = checkOut;
        Adults = adults;
        Children = children;
        CurrencyCode = BookingGuard.NormalizeCurrency(currencyCode);
        Status = status;
        ConfirmedAtUtc = confirmedAt;
        CancelledAtUtc = cancelledAtUtc;
        GuestAccessTokenHash = BookingGuard.ValidateOwnership(customerAccountId, guestAccessTokenHash);

        foreach (var plan in unitPlans)
        {
            _units.Add(new ReservationUnit(
                Guid.NewGuid(),
                Id,
                propertyId,
                plan.RoomTypeId,
                plan.SourceInventoryHoldItemId,
                checkIn,
                checkOut,
                plan.Nights));
        }

        if (status == ReservationStatus.Cancelled)
        {
            foreach (var unit in _units)
            {
                unit.Cancel();
            }
        }

        TotalAmount = _units.SelectMany(unit => unit.Nights).Sum(night => night.UnitAmount);
        if (TotalAmount <= 0)
        {
            throw new DomainException("totalAmount must be greater than zero.");
        }

        CancellationReason = BookingGuard.ValidateCancellation(
            status,
            confirmedAt,
            cancelledAtUtc,
            cancellationReason);
    }

    public Guid Id { get; private set; }
    public string ConfirmationNumber { get; private set; } = string.Empty;
    public ReservationSource Source { get; private set; }

    /// <summary>The Hold this Reservation confirmed; <c>null</c> exactly when <see cref="Source"/> is <see cref="ReservationSource.Direct"/> (<c>CK_Reservations_Source</c>).</summary>
    public Guid? SourceHoldId { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid? CustomerAccountId { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string Phone { get; private set; } = string.Empty;
    public DateOnly CheckIn { get; private set; }
    public DateOnly CheckOut { get; private set; }
    public int Adults { get; private set; }
    public int Children { get; private set; }
    public string CurrencyCode { get; private set; } = string.Empty;
    public decimal TotalAmount { get; private set; }
    public ReservationStatus Status { get; private set; }
    public DateTimeOffset ConfirmedAtUtc { get; private set; }
    public DateTimeOffset? CancelledAtUtc { get; private set; }
    public string? CancellationReason { get; private set; }
    public string? GuestAccessTokenHash { get; private set; }
    public IReadOnlyList<ReservationUnit> Units => _units.AsReadOnly();

    /// <summary>The promotion snapshot: copied from the source Hold, or (Direct) saved with the Reservation's own prices; <c>null</c> when no promotion applied.</summary>
    public BookingPromotionApplication? PromotionApplication { get; private set; }

    /// <summary>
    /// Creates a Confirmed Reservation with no source Hold (BHA-CHECKOUT-001-PR01). Same ownership, date and price guards as the Hold-sourced
    /// constructor; every Unit must have no source Hold item, and a night sold below its list price needs the promotion snapshot that priced it
    /// (the snapshot is saved as given, never recalculated). No public route calls this yet.
    /// </summary>
    public static Reservation CreateDirect(
        Guid id,
        string confirmationNumber,
        Guid propertyId,
        Guid? customerAccountId,
        string fullName,
        string email,
        string phone,
        DateOnly checkIn,
        DateOnly checkOut,
        int adults,
        int children,
        string currencyCode,
        DateTimeOffset confirmedAtUtc,
        string? guestAccessTokenHash,
        IEnumerable<ReservationUnitPlan> units,
        AppliedPromotionSnapshot? promotion = null)
    {
        ArgumentNullException.ThrowIfNull(units);
        var unitPlans = units.ToArray();
        if (unitPlans.Any(plan => plan.SourceInventoryHoldItemId is not null))
        {
            throw new DomainException("A Direct Reservation cannot reference a source Hold item.");
        }

        var reservation = new Reservation(
            ReservationSource.Direct, null, id, confirmationNumber, propertyId, customerAccountId, fullName, email,
            phone, checkIn, checkOut, adults, children, currencyCode, ReservationStatus.Confirmed, confirmedAtUtc,
            null, null, guestAccessTokenHash, unitPlans);

        var nights = reservation.Units.SelectMany(unit => unit.Nights).ToList();
        var listTotal = nights.Sum(night => night.ListUnitAmount);
        var discountTotal = listTotal - reservation.TotalAmount;
        if (promotion is null)
        {
            if (discountTotal != 0)
            {
                throw new DomainException("A discounted night needs the promotion that priced it.");
            }
        }
        else
        {
            if (promotion.CurrencyCode is not null && promotion.CurrencyCode != reservation.CurrencyCode)
            {
                throw new DomainException("The promotion currency must match the Reservation currency.");
            }

            reservation.PromotionApplication = BookingPromotionApplication.ForReservation(id, promotion, listTotal, discountTotal);
        }

        return reservation;
    }

    internal void AttachPromotionApplication(BookingPromotionApplication application)
    {
        PromotionApplication = application;
    }

    /// <summary>
    /// Transitions this Reservation from <see cref="ReservationStatus.Confirmed"/> to
    /// <see cref="ReservationStatus.Cancelled"/>, enforced strictly before the Property-local
    /// <paramref name="propertyLocalDate"/> reaches <see cref="CheckIn"/>. Atomically transitions
    /// every still-<see cref="CommitmentStatus.Committed"/> <see cref="ReservationUnit"/> to
    /// <see cref="CommitmentStatus.Cancelled"/> (ADR 0005 item 7, blueprint §15.10 rule 30) —
    /// this work item exposes only whole-Reservation cancellation, never an independent
    /// per-Unit endpoint. Already-<see cref="ReservationStatus.Cancelled"/> is an idempotent
    /// no-op that preserves the original <see cref="CancelledAtUtc"/> and
    /// <see cref="CancellationReason"/> even if called again at or after the check-in cutoff.
    /// <paramref name="utcNow"/> and <paramref name="propertyLocalDate"/> must be
    /// server-derived; this method never accepts client time.
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

        foreach (var unit in _units)
        {
            unit.Cancel();
        }

        Status = ReservationStatus.Cancelled;
        CancelledAtUtc = utcNow;
        CancellationReason = normalizedReason;
    }
}
