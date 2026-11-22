using Microsoft.EntityFrameworkCore;
using TheBha.Application.Notifications;
using TheBha.Infrastructure.Identity;

namespace TheBha.Infrastructure.Persistence.Notifications;

/// <summary>
/// BHA-CHECKOUT-001-PR04: loads the CURRENT facts of one Property (active Staff with a FrontDesk or Manager membership here, their local rows, the fallback) and hands them to
/// <see cref="BookingRecipientPolicy"/>. Nothing is cached, nothing is written, no transaction is opened: it may run inside the outbox fan-out transaction. Only the routed Property is queried, so no other
/// Property's data can enter the answer. The chain addresses come from the operator's settings, loaded once at start-up.
/// </summary>
internal sealed class BookingNotificationRecipientResolver(TheBhaDbContext db, BookingNotificationChain chain) : IBookingNotificationRecipients
{
    public async Task<BookingNotificationRecipientSet> ResolveAsync(Guid propertyId, CancellationToken cancellationToken)
    {
        var members = await (
            from membership in db.StaffPropertyMemberships.AsNoTracking()
            join staff in db.StaffAccounts.AsNoTracking() on membership.StaffAccountId equals staff.Id
            where membership.PropertyId == propertyId && staff.IsActive &&
                  (membership.Role == StaffRole.FrontDesk || membership.Role == StaffRole.Manager)
            select new { staff.Id, membership.Role }).ToListAsync(cancellationToken);
        var preferences = await db.StaffBookingNotificationPreferences.AsNoTracking()
            .Where(row => row.PropertyId == propertyId).ToDictionaryAsync(row => row.StaffAccountId, cancellationToken);
        var fallback = await db.BookingNotificationFallbacks.AsNoTracking()
            .Where(row => row.PropertyId == propertyId).Select(row => row.Email).SingleOrDefaultAsync(cancellationToken);

        var candidates = members.Select(member =>
        {
            preferences.TryGetValue(member.Id, out var row);
            return new BookingStaffCandidate(member.Id, member.Role == StaffRole.Manager, row is not null, row?.NotificationEmail, row?.IsEnabled ?? true);
        });
        return BookingRecipientPolicy.Resolve(propertyId, candidates, chain.Addresses, fallback);
    }

    public async Task<bool> IsStillRecipientAsync(Guid propertyId, string recipientEmail, CancellationToken cancellationToken) =>
        (await ResolveAsync(propertyId, cancellationToken)).Recipients.Any(recipient => BookingRecipientPolicy.SameAddress(recipient.Email, recipientEmail));
}

/// <summary>The validated, normalised chain-Manager addresses of <c>BookingNotifications:ChainManagers</c> (Staff id → address). Empty by default.</summary>
internal sealed record BookingNotificationChain(IReadOnlyDictionary<Guid, string> Addresses);
