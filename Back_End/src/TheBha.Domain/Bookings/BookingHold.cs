using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

public sealed class BookingHold
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);
    private readonly List<BookingHoldNight> _nights = [];

    private BookingHold()
    {
    }

    public BookingHold(
        Guid id,
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
        DateTimeOffset createdAtUtc,
        string idempotencyKeyHash,
        string requestFingerprint,
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
        var contact = BookingGuard.NormalizeContact(fullName, email, phone);
        var orderedNights = BookingGuard.ValidateNights(
            checkIn,
            checkOut,
            rooms,
            totalAmount,
            nights);

        Id = id;
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
        _nights.AddRange(orderedNights.Select(snapshot => new BookingHoldNight(Id, snapshot)));
    }

    public Guid Id { get; private set; }
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
    public BookingHoldStatus Status { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset ExpiresAtUtc { get; private set; }
    public string IdempotencyKeyHash { get; private set; } = string.Empty;
    public string RequestFingerprint { get; private set; } = string.Empty;
    public string? GuestAccessTokenHash { get; private set; }
    public IReadOnlyList<BookingHoldNight> Nights => _nights.AsReadOnly();

    public bool IsExpiredAt(DateTimeOffset utcNow)
    {
        BookingGuard.RequireUtc(utcNow, nameof(utcNow));
        return Status == BookingHoldStatus.Active && utcNow >= ExpiresAtUtc;
    }
}
