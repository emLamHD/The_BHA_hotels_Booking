using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

/// <summary>
/// BHA-CHECKOUT-001-PR06: the fixed numbers of guest reservation management. A link is how a guest first proves they hold a Direct reservation (single use, short); the session it is exchanged for is how they keep
/// managing it (one reservation, 24 hours). Every instant is whole microseconds, because that is what PostgreSQL keeps: a boundary stored and a boundary compared must be the same value.
/// </summary>
public static class ReservationManagementRules
{
    public static readonly TimeSpan DefaultLinkTtl = TimeSpan.FromHours(72);
    public static readonly TimeSpan MaxLinkTtl = TimeSpan.FromDays(30);
    public static readonly TimeSpan SessionTtl = TimeSpan.FromHours(24);

    public static DateTimeOffset TruncateToMicroseconds(DateTimeOffset value) =>
        new(value.UtcTicks - (value.UtcTicks % 10), TimeSpan.Zero);

    /// <summary>A secret is usable strictly before its expiry instant: at exactly the expiry it is already expired.</summary>
    public static bool IsLive(DateTimeOffset expiresAtUtc, DateTimeOffset nowUtc) => nowUtc < expiresAtUtc;
}

/// <summary>
/// One single-use secret, issued for a guest-owned Direct reservation and sent to the guest by a later work item. Only the hash of the secret is kept. <see cref="ConsumedAtUtc"/> is written by exactly one
/// statement (the exchange), never by this type, so that two concurrent exchanges cannot both win.
/// </summary>
public sealed class ReservationManagementLink
{
    private ReservationManagementLink()
    {
    }

    public ReservationManagementLink(Guid id, Guid propertyId, Guid reservationId, string tokenHash, DateTimeOffset createdAtUtc, DateTimeOffset expiresAtUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        ReservationId = DomainGuard.RequiredId(reservationId, nameof(reservationId));
        TokenHash = BookingGuard.NormalizeHash(tokenHash, nameof(tokenHash));
        CreatedAtUtc = BookingGuard.RequireUtc(createdAtUtc, nameof(createdAtUtc));
        ExpiresAtUtc = BookingGuard.RequireUtc(expiresAtUtc, nameof(expiresAtUtc));
        if (ExpiresAtUtc <= CreatedAtUtc)
        {
            throw new DomainException("expiresAtUtc must be later than createdAtUtc.");
        }
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid ReservationId { get; private set; }

    /// <summary>SHA-256 (lower-case hex) of the domain-separated secret; the secret itself is never stored.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset ExpiresAtUtc { get; private set; }
    public DateTimeOffset? ConsumedAtUtc { get; private set; }
}

/// <summary>What a consumed link became: a 24-hour session for one reservation. One link makes at most one session (unique <see cref="LinkId"/>). Only the hash of the session secret is kept.</summary>
public sealed class ReservationManagementSession
{
    private ReservationManagementSession()
    {
    }

    public ReservationManagementSession(Guid id, Guid propertyId, Guid reservationId, Guid linkId, string sessionHash, DateTimeOffset createdAtUtc, DateTimeOffset expiresAtUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        ReservationId = DomainGuard.RequiredId(reservationId, nameof(reservationId));
        LinkId = DomainGuard.RequiredId(linkId, nameof(linkId));
        SessionHash = BookingGuard.NormalizeHash(sessionHash, nameof(sessionHash));
        CreatedAtUtc = BookingGuard.RequireUtc(createdAtUtc, nameof(createdAtUtc));
        ExpiresAtUtc = BookingGuard.RequireUtc(expiresAtUtc, nameof(expiresAtUtc));
        if (ExpiresAtUtc <= CreatedAtUtc)
        {
            throw new DomainException("expiresAtUtc must be later than createdAtUtc.");
        }
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid ReservationId { get; private set; }
    public Guid LinkId { get; private set; }
    public string SessionHash { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset ExpiresAtUtc { get; private set; }
}

/// <summary>
/// The guest's estimated arrival, informational only: a wall-clock date and time in the Property's own time zone, stored with that zone's id and never converted to an instant (so there is no offset to guess
/// across a daylight-saving change). One row per reservation, replaced by each update.
/// </summary>
public sealed class ReservationArrivalEstimate
{
    private ReservationArrivalEstimate()
    {
    }

    public ReservationArrivalEstimate(Guid propertyId, Guid reservationId, DateOnly arrivalDate, TimeOnly arrivalTime, string timeZoneId, DateTimeOffset updatedAtUtc)
    {
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        ReservationId = DomainGuard.RequiredId(reservationId, nameof(reservationId));
        ArrivalDate = arrivalDate;
        ArrivalTime = Whole(arrivalTime);
        TimeZoneId = DomainGuard.Required(timeZoneId, nameof(timeZoneId), 100);
        UpdatedAtUtc = BookingGuard.RequireUtc(updatedAtUtc, nameof(updatedAtUtc));
    }

    public Guid PropertyId { get; private set; }
    public Guid ReservationId { get; private set; }
    public DateOnly ArrivalDate { get; private set; }
    public TimeOnly ArrivalTime { get; private set; }
    public string TimeZoneId { get; private set; } = string.Empty;
    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public void Replace(DateOnly arrivalDate, TimeOnly arrivalTime, string timeZoneId, DateTimeOffset updatedAtUtc)
    {
        ArrivalDate = arrivalDate;
        ArrivalTime = Whole(arrivalTime);
        TimeZoneId = DomainGuard.Required(timeZoneId, nameof(timeZoneId), 100);
        UpdatedAtUtc = BookingGuard.RequireUtc(updatedAtUtc, nameof(updatedAtUtc));
    }

    private static TimeOnly Whole(TimeOnly time) =>
        time.Second == 0 && time.Millisecond == 0 && time.Microsecond == 0
            ? time
            : throw new DomainException("arrivalTime must be a whole minute.");
}
