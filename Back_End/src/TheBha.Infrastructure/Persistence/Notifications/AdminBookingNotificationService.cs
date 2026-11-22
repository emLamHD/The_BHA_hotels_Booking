using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Notifications;
using TheBha.Application.Website;
using TheBha.Domain.Notifications;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR04: the Manager's side of the booking-notification preferences of ONE Property. Authorization (a Manager of the routed Property) is decided before this runs; the actor comes from that check.
/// Every write targets a Staff member who is active with a FrontDesk or Manager membership at THIS Property (404 otherwise), carries the version it was made from (0 = no row yet; a stale one is refused with 409
/// and nothing changes, including a lost first-save race) and, only when something really changes, saves the change and its audit row in ONE SaveChanges (one transaction). No address is written to the audit.
/// </summary>
internal sealed class AdminBookingNotificationService(TheBhaDbContext db, BookingNotificationChain chain, TimeProvider clock) : IAdminBookingNotifications
{
    public async Task<BookingNotificationRosterDto?> ReadAsync(Guid propertyId, CancellationToken cancellationToken)
    {
        if (!await db.Properties.AsNoTracking().AnyAsync(property => property.Id == propertyId, cancellationToken)) return null;

        var members = (await MembersQuery(propertyId).ToListAsync(cancellationToken)).OrderBy(member => member.LoginEmail, StringComparer.Ordinal).ThenBy(member => member.Id).ToList();
        var preferences = await db.StaffBookingNotificationPreferences.AsNoTracking()
            .Where(row => row.PropertyId == propertyId).ToDictionaryAsync(row => row.StaffAccountId, cancellationToken);
        var fallback = await db.BookingNotificationFallbacks.AsNoTracking().SingleOrDefaultAsync(row => row.PropertyId == propertyId, cancellationToken);

        return new BookingNotificationRosterDto(
            propertyId,
            members.Select(member => ToDto(member, preferences.GetValueOrDefault(member.Id))).ToList(),
            new BookingNotificationFallbackDto(fallback?.Email, fallback?.Version ?? 0));
    }

    public Task<WebsiteMutationResult<BookingNotificationStaffDto>> SetStaffEmailAsync(
        Guid propertyId, Guid staffAccountId, int expectedVersion, string? email, Guid actorStaffId, CancellationToken cancellationToken)
    {
        string? normalized = null;
        if (!string.IsNullOrWhiteSpace(email))
        {
            if (!BookingNotificationEmail.TryNormalize(email, out var value)) return Task.FromResult(InvalidEmail<BookingNotificationStaffDto>());
            normalized = value;
        }

        return ChangeStaffAsync(propertyId, staffAccountId, expectedVersion, actorStaffId, current =>
        {
            var next = (Email: normalized, current.IsEnabled);
            if (string.Equals(current.Email, next.Email, StringComparison.Ordinal)) return (next, null);
            return (next, normalized is null ? BookingNotificationAudit.EmailCleared : current.Email is null ? BookingNotificationAudit.EmailSet : BookingNotificationAudit.EmailChanged);
        }, cancellationToken);
    }

    public Task<WebsiteMutationResult<BookingNotificationStaffDto>> SetStaffEnabledAsync(
        Guid propertyId, Guid staffAccountId, int expectedVersion, bool enabled, Guid actorStaffId, CancellationToken cancellationToken) =>
        ChangeStaffAsync(propertyId, staffAccountId, expectedVersion, actorStaffId, current =>
            ((current.Email, enabled), current.IsEnabled == enabled ? null : enabled ? BookingNotificationAudit.Enabled : BookingNotificationAudit.Disabled), cancellationToken);

    public async Task<WebsiteMutationResult<BookingNotificationFallbackDto>> SetFallbackAsync(
        Guid propertyId, int expectedVersion, string? email, Guid actorStaffId, CancellationToken cancellationToken)
    {
        string? normalized = null;
        if (!string.IsNullOrWhiteSpace(email))
        {
            if (!BookingNotificationEmail.TryNormalize(email, out var value)) return InvalidEmail<BookingNotificationFallbackDto>();
            normalized = value;
        }

        var row = await db.BookingNotificationFallbacks.SingleOrDefaultAsync(item => item.PropertyId == propertyId, cancellationToken);
        if ((row?.Version ?? 0) != expectedVersion) return Stale<BookingNotificationFallbackDto>();
        if (string.Equals(row?.Email, normalized, StringComparison.Ordinal)) return WebsiteMutationResult<BookingNotificationFallbackDto>.Success(new(row?.Email, row?.Version ?? 0));

        var now = clock.GetUtcNow();
        var action = normalized is null ? BookingNotificationAudit.FallbackCleared : row?.Email is null ? BookingNotificationAudit.FallbackSet : BookingNotificationAudit.FallbackChanged;
        if (row is null) db.BookingNotificationFallbacks.Add(row = new BookingNotificationFallback(propertyId, normalized, now));
        else row.Change(normalized, now);
        db.BookingNotificationAudits.Add(new BookingNotificationAudit(propertyId, actorStaffId, null, action, now));
        return await SaveAsync(() => new BookingNotificationFallbackDto(row.Email, row.Version), cancellationToken);
    }

    private async Task<WebsiteMutationResult<BookingNotificationStaffDto>> ChangeStaffAsync(
        Guid propertyId, Guid staffAccountId, int expectedVersion, Guid actorStaffId,
        Func<(string? Email, bool IsEnabled), ((string? Email, bool IsEnabled) Next, string? Action)> change, CancellationToken cancellationToken)
    {
        var member = await MembersQuery(propertyId, staffAccountId).SingleOrDefaultAsync(cancellationToken);
        if (member is null) return WebsiteMutationResult<BookingNotificationStaffDto>.NotFound("The staff member is not an active FrontDesk or Manager of this property.");

        var row = await db.StaffBookingNotificationPreferences.SingleOrDefaultAsync(item => item.PropertyId == propertyId && item.StaffAccountId == staffAccountId, cancellationToken);
        if ((row?.Version ?? 0) != expectedVersion) return Stale<BookingNotificationStaffDto>();

        var (next, action) = change((row?.NotificationEmail, row?.IsEnabled ?? true));
        if (action is null) return WebsiteMutationResult<BookingNotificationStaffDto>.Success(ToDto(member, row));

        var now = clock.GetUtcNow();
        if (row is null) db.StaffBookingNotificationPreferences.Add(row = new StaffBookingNotificationPreference(propertyId, staffAccountId, next.Email, next.IsEnabled, now));
        else row.Change(next.Email, next.IsEnabled, now);
        db.BookingNotificationAudits.Add(new BookingNotificationAudit(propertyId, actorStaffId, staffAccountId, action, now));
        return await SaveAsync(() => ToDto(member, row), cancellationToken);
    }

    /// <summary>One SaveChanges is one transaction: the change and its audit row exist together or not at all. A version that moved or a concurrent first save (unique key) is the same refusal as a stale quote; any other fault is not hidden.</summary>
    private async Task<WebsiteMutationResult<T>> SaveAsync<T>(Func<T> result, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return WebsiteMutationResult<T>.Success(result());
        }
        catch (Exception exception) when (exception is DbUpdateConcurrencyException || exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return Stale<T>();
        }
    }

    /// <summary>Active Staff with a FrontDesk or Manager membership at THIS Property (optionally just one of them). The filter comes before the projection: EF cannot translate a predicate over a constructed record.</summary>
    private IQueryable<Member> MembersQuery(Guid propertyId, Guid? staffAccountId = null) =>
        from membership in db.StaffPropertyMemberships.AsNoTracking()
        join staff in db.StaffAccounts.AsNoTracking() on membership.StaffAccountId equals staff.Id
        where membership.PropertyId == propertyId && staff.IsActive && (staffAccountId == null || staff.Id == staffAccountId) &&
              (membership.Role == StaffRole.FrontDesk || membership.Role == StaffRole.Manager)
        select new Member(staff.Id, staff.Email!, membership.Role);

    private BookingNotificationStaffDto ToDto(Member member, StaffBookingNotificationPreference? row)
    {
        var chainConfigured = member.Role == StaffRole.Manager && chain.Addresses.ContainsKey(member.Id);
        var enabled = row?.IsEnabled ?? true;
        var coverage = !enabled ? BookingNotificationCoverage.OptedOut
            : row?.NotificationEmail is not null ? BookingNotificationCoverage.Local
            : chainConfigured ? BookingNotificationCoverage.Chain
            : BookingNotificationCoverage.NotConfigured;
        return new BookingNotificationStaffDto(member.Id, AccountLabel(member.Id, member.LoginEmail), member.Role, row?.NotificationEmail, enabled, chainConfigured, coverage, row?.Version ?? 0);
    }

    /// <summary>Enough to tell colleagues apart, not enough to learn or use the login address: <c>d***@domain · #0f36aa6a</c>.</summary>
    internal static string AccountLabel(Guid id, string loginEmail)
    {
        var at = loginEmail.LastIndexOf('@');
        var first = loginEmail.Length > 0 && at != 0 ? loginEmail[0] : '?';
        return $"{first}***@{(at >= 0 ? loginEmail[(at + 1)..] : "")} · #{id.ToString("N")[..8]}";
    }

    private static WebsiteMutationResult<T> InvalidEmail<T>() =>
        WebsiteMutationResult<T>.Invalid("email", "Enter exactly one valid e-mail address (no list, no line break).");

    private static WebsiteMutationResult<T> Stale<T>() =>
        WebsiteMutationResult<T>.Conflict(WebsiteErrorCodes.StaleVersion, "This setting changed in another tab or by someone else. Read the server version before saving again.");

    private sealed record Member(Guid Id, string LoginEmail, string Role);
}
