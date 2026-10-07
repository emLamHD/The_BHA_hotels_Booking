using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>
/// Commercial hold aggregate root (ADR 0005). Owns identity, lifecycle,
/// ownership, and expiry; every held room is a persisted
/// <see cref="InventoryHoldItem"/> — the aggregate itself carries no
/// RoomTypeId/RatePlanId/Rooms, since this work item's public request still
/// accepts exactly one RoomType/RatePlan line, normalized atomically into
/// <c>quantity</c> independent items at construction time.
/// </summary>
public sealed class InventoryHold
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);
    private readonly List<InventoryHoldItem> _items = [];

    private InventoryHold()
    {
    }

    public InventoryHold(
        Guid id,
        Guid propertyId,
        Guid roomTypeId,
        int quantity,
        Guid? customerAccountId,
        string fullName,
        string email,
        string phone,
        DateOnly checkIn,
        DateOnly checkOut,
        int adults,
        int children,
        string currencyCode,
        DateTimeOffset createdAtUtc,
        string idempotencyKeyHash,
        string requestFingerprint,
        string? guestAccessTokenHash,
        IEnumerable<NightlyCommitmentSnapshot> itemNightPlan)
    {
        BookingGuard.ValidateHoldHeader(
            id,
            propertyId,
            roomTypeId,
            checkIn,
            checkOut,
            adults,
            children,
            quantity);
        var contact = BookingGuard.NormalizeContact(fullName, email, phone);
        var orderedPlan = BookingGuard.ValidateNightlySnapshots(checkIn, checkOut, itemNightPlan);

        Id = id;
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
        Status = BookingHoldStatus.Active;
        CreatedAtUtc = BookingGuard.RequireUtc(createdAtUtc, nameof(createdAtUtc));
        try
        {
            ExpiresAtUtc = CreatedAtUtc.Add(Lifetime);
        }
        catch (ArgumentOutOfRangeException)
        {
            throw new DomainException("createdAtUtc cannot produce the fixed hold expiry.");
        }

        IdempotencyKeyHash = BookingGuard.NormalizeHash(
            idempotencyKeyHash,
            nameof(idempotencyKeyHash));
        RequestFingerprint = BookingGuard.NormalizeHash(
            requestFingerprint,
            nameof(requestFingerprint));
        GuestAccessTokenHash = BookingGuard.ValidateOwnership(
            customerAccountId,
            guestAccessTokenHash);

        for (var ordinal = 0; ordinal < quantity; ordinal++)
        {
            _items.Add(new InventoryHoldItem(
                Guid.NewGuid(),
                Id,
                propertyId,
                roomTypeId,
                checkIn,
                checkOut,
                orderedPlan));
        }

        TotalAmount = _items.SelectMany(item => item.Nights).Sum(night => night.UnitAmount);
        if (TotalAmount <= 0)
        {
            throw new DomainException("totalAmount must be greater than zero.");
        }
    }

    public Guid Id { get; private set; }
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
    public BookingHoldStatus Status { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset ExpiresAtUtc { get; private set; }
    public string IdempotencyKeyHash { get; private set; } = string.Empty;
    public string RequestFingerprint { get; private set; } = string.Empty;
    public string? GuestAccessTokenHash { get; private set; }
    public IReadOnlyList<InventoryHoldItem> Items => _items.AsReadOnly();

    public bool IsExpiredAt(DateTimeOffset utcNow)
    {
        BookingGuard.RequireUtc(utcNow, nameof(utcNow));
        return Status == BookingHoldStatus.Active && utcNow >= ExpiresAtUtc;
    }

    /// <summary>
    /// Atomically validates the confirmation transition, transitions this Hold to
    /// <see cref="BookingHoldStatus.Confirmed"/>, and returns the immutable Reservation
    /// aggregate with one <see cref="ReservationUnit"/> per Item, mapped 1:1 (ADR 0005
    /// item 2). Throws <see cref="DomainException"/> for any invalid transition (not
    /// Active, or expired at <paramref name="utcNow"/>); callers must not have already
    /// found an existing Reservation for this Hold before calling this method.
    /// </summary>
    public Reservation Confirm(
        Guid reservationId,
        string confirmationNumber,
        DateTimeOffset utcNow)
    {
        BookingGuard.RequireUtc(utcNow, nameof(utcNow));
        if (Status != BookingHoldStatus.Active)
        {
            throw new DomainException("Only an Active Hold can be confirmed.");
        }

        if (utcNow >= ExpiresAtUtc)
        {
            throw new DomainException("The Hold has expired and cannot be confirmed.");
        }

        var reservation = new Reservation(
            reservationId,
            confirmationNumber,
            Id,
            PropertyId,
            CustomerAccountId,
            FullName,
            Email,
            Phone,
            CheckIn,
            CheckOut,
            Adults,
            Children,
            CurrencyCode,
            ReservationStatus.Confirmed,
            utcNow,
            null,
            null,
            GuestAccessTokenHash,
            Items.Select(item => new ReservationUnitPlan(
                item.Id,
                item.RoomTypeId,
                item.Nights.Select(night => new NightlyCommitmentSnapshot(
                    night.StayDate,
                    night.RatePlanId,
                    night.UnitAmount)))));

        Status = BookingHoldStatus.Confirmed;
        return reservation;
    }

    /// <summary>
    /// Transitions this Hold from <see cref="BookingHoldStatus.Active"/> to
    /// <see cref="BookingHoldStatus.Cancelled"/>. Already-<see cref="BookingHoldStatus.Cancelled"/>
    /// is treated as an idempotent no-op. A <see cref="BookingHoldStatus.Confirmed"/> Hold cannot
    /// be cancelled because commitment now belongs to its Reservation. This transition does not
    /// evaluate expiry: an Active Hold may be explicitly cancelled even at or after
    /// <see cref="ExpiresAtUtc"/>, since expiry has already released logical demand and
    /// cancellation merely records the terminal lifecycle state.
    /// </summary>
    public void Cancel()
    {
        if (Status == BookingHoldStatus.Cancelled)
        {
            return;
        }

        if (Status != BookingHoldStatus.Active)
        {
            throw new DomainException("Only an Active Hold can be cancelled.");
        }

        Status = BookingHoldStatus.Cancelled;
    }

    /// <summary>
    /// True only if <paramref name="reservation"/> is exactly the immutable Item→Unit,
    /// ItemNight→UnitNight snapshot copy this Hold's own <see cref="Confirm"/> call would
    /// have produced: same source, same Confirmed-terminal Hold state, same ownership,
    /// same business fields, and every Item mapped to exactly one Unit with matching
    /// nights. Confirmation replay must never disclose an existing Reservation to a
    /// caller without first proving this.
    /// </summary>
    public bool IsCoherentReservation(Reservation reservation)
    {
        ArgumentNullException.ThrowIfNull(reservation);

        if (reservation.SourceHoldId != Id || Status != BookingHoldStatus.Confirmed)
        {
            return false;
        }

        if (reservation.CustomerAccountId != CustomerAccountId ||
            reservation.GuestAccessTokenHash != GuestAccessTokenHash)
        {
            return false;
        }

        if (reservation.PropertyId != PropertyId ||
            reservation.CheckIn != CheckIn ||
            reservation.CheckOut != CheckOut)
        {
            return false;
        }

        if (reservation.FullName != FullName ||
            reservation.Email != Email ||
            reservation.Phone != Phone)
        {
            return false;
        }

        if (reservation.Adults != Adults || reservation.Children != Children)
        {
            return false;
        }

        if (reservation.CurrencyCode != CurrencyCode ||
            reservation.TotalAmount != TotalAmount)
        {
            return false;
        }

        if (reservation.Units.Count != Items.Count)
        {
            return false;
        }

        var unitsBySourceItem = reservation.Units
            .Where(unit => unit.SourceInventoryHoldItemId.HasValue)
            .ToDictionary(unit => unit.SourceInventoryHoldItemId!.Value);
        if (unitsBySourceItem.Count != Items.Count)
        {
            return false;
        }

        foreach (var item in Items)
        {
            if (!unitsBySourceItem.TryGetValue(item.Id, out var unit))
            {
                return false;
            }

            if (unit.RoomTypeId != item.RoomTypeId)
            {
                return false;
            }

            var expectedNights = item.Nights
                .OrderBy(night => night.StayDate)
                .Select(night => (night.StayDate, night.RatePlanId, night.UnitAmount))
                .ToArray();
            var actualNights = unit.Nights
                .OrderBy(night => night.StayDate)
                .Select(night => (night.StayDate, night.RatePlanId, night.UnitAmount))
                .ToArray();
            if (!expectedNights.SequenceEqual(actualNights))
            {
                return false;
            }
        }

        return true;
    }
}
