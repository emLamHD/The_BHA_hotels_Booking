using TheBha.Domain.Common;

namespace TheBha.Domain.Notifications;

/// <summary>Field limits of the booking-notification preferences (BHA-CHECKOUT-001-PR04).</summary>
public static class BookingNotificationLimits
{
    public const int Email = 254;
    public const int Action = 32;
}

/// <summary>
/// One Staff member's booking-notification choice at ONE Property: a separate notification address (never the login address) and an enabled flag. It is keyed by (Property, Staff) and says nothing about
/// membership: the resolver reads the live membership, so a revoked or downgraded person simply stops qualifying while this row stays (and keeps an explicit opt-out). A row with no address and the flag on is the
/// same as no row. <see cref="IsEnabled"/> = false is an explicit local opt-out: it blocks the person's chain address too.
/// </summary>
public sealed class StaffBookingNotificationPreference
{
    private StaffBookingNotificationPreference()
    {
    }

    public StaffBookingNotificationPreference(Guid propertyId, Guid staffAccountId, string? notificationEmail, bool isEnabled, DateTimeOffset nowUtc)
    {
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        StaffAccountId = DomainGuard.RequiredId(staffAccountId, nameof(staffAccountId));
        NotificationEmail = DomainGuard.Optional(notificationEmail, nameof(notificationEmail), BookingNotificationLimits.Email);
        IsEnabled = isEnabled;
        Version = 1;
        CreatedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    public Guid PropertyId { get; private set; }
    public Guid StaffAccountId { get; private set; }
    public string? NotificationEmail { get; private set; }
    public bool IsEnabled { get; private set; }

    /// <summary>Optimistic concurrency: a write quotes the version it was made from (0 = no row yet); a stale one is refused.</summary>
    public int Version { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public void Change(string? notificationEmail, bool isEnabled, DateTimeOffset nowUtc)
    {
        NotificationEmail = DomainGuard.Optional(notificationEmail, nameof(notificationEmail), BookingNotificationLimits.Email);
        IsEnabled = isEnabled;
        Version++;
        UpdatedAtUtc = nowUtc;
    }
}

/// <summary>
/// The Property's front-desk fallback address: used by the resolver only when no valid Staff or chain recipient remains. It is not a Staff identity and grants no permission. The row stays when the address is
/// cleared so the version keeps counting.
/// </summary>
public sealed class BookingNotificationFallback
{
    private BookingNotificationFallback()
    {
    }

    public BookingNotificationFallback(Guid propertyId, string? email, DateTimeOffset nowUtc)
    {
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        Email = DomainGuard.Optional(email, nameof(email), BookingNotificationLimits.Email);
        Version = 1;
        UpdatedAtUtc = nowUtc;
    }

    public Guid PropertyId { get; private set; }
    public string? Email { get; private set; }
    public int Version { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public void Change(string? email, DateTimeOffset nowUtc)
    {
        Email = DomainGuard.Optional(email, nameof(email), BookingNotificationLimits.Email);
        Version++;
        UpdatedAtUtc = nowUtc;
    }
}

/// <summary>One real change, written in the same transaction as the change. It names who, where, whom and what, and never an address (old or new).</summary>
public sealed class BookingNotificationAudit
{
    public const string EmailSet = "email-set";
    public const string EmailChanged = "email-changed";
    public const string EmailCleared = "email-cleared";
    public const string Enabled = "enabled";
    public const string Disabled = "disabled";
    public const string FallbackSet = "fallback-set";
    public const string FallbackChanged = "fallback-changed";
    public const string FallbackCleared = "fallback-cleared";

    private BookingNotificationAudit()
    {
    }

    public BookingNotificationAudit(Guid propertyId, Guid actorStaffId, Guid? targetStaffId, string action, DateTimeOffset atUtc)
    {
        Id = Guid.NewGuid();
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        ActorStaffId = DomainGuard.RequiredId(actorStaffId, nameof(actorStaffId));
        TargetStaffId = targetStaffId;
        Action = DomainGuard.Required(action, nameof(action), BookingNotificationLimits.Action);
        AtUtc = atUtc;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid ActorStaffId { get; private set; }

    /// <summary>The Staff member whose preference changed; null for the Property fallback.</summary>
    public Guid? TargetStaffId { get; private set; }

    public string Action { get; private set; } = string.Empty;
    public DateTimeOffset AtUtc { get; private set; }
}
