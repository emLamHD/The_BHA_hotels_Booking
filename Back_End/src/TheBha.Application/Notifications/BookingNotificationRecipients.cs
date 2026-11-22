using TheBha.Application.Website;

namespace TheBha.Application.Notifications;

/// <summary>Where a recipient comes from. <see cref="Fallback"/> is an address of the Property, not a person.</summary>
public enum BookingRecipientKind
{
    /// <summary>A Staff member's own notification address for this Property.</summary>
    Staff,

    /// <summary>An operator-declared work address of a chain Manager who is currently a Manager of this Property.</summary>
    ChainManager,

    /// <summary>The Property's front-desk fallback address, used only when no Staff or chain recipient remains.</summary>
    Fallback
}

/// <summary>
/// One person or address that should receive a booking notification of one Property. <see cref="Key"/> is the stable, opaque, e-mail-free recipient key for the PR03 outbox
/// (<c>EmailDeliveryDraft.RecipientKey</c>): <c>staff:{id:N}</c> for a Staff member or chain Manager, <c>fallback:{propertyId:N}</c> for the fallback. It names WHO (the slot), not WHICH address:
/// the same person keeps the key when the address changes, and two people sharing one address collapse to the first by priority.
/// </summary>
public sealed record BookingNotificationRecipient(string Key, string Email, BookingRecipientKind Kind, Guid? StaffAccountId);

/// <summary>The recipients of one Property right now. Empty means nobody is eligible and no fallback exists: the caller sends nothing and must not look at another Property.</summary>
public sealed record BookingNotificationRecipientSet(IReadOnlyList<BookingNotificationRecipient> Recipients)
{
    public bool IsEmpty => Recipients.Count == 0;
}

/// <summary>
/// The internal resolver PR07's handler calls (never an HTTP route). It reads the CURRENT state on every call (active Staff, live membership, preferences, fallback), opens no transaction and writes
/// nothing, so it is safe inside the outbox fan-out transaction. After fan-out the address is frozen in the delivery: before sending, PR07 asks <see cref="IsStillRecipientAsync"/> and drops the delivery when
/// the answer is false (the person was disabled or lost the membership, opted out, or changed the address).
/// </summary>
public interface IBookingNotificationRecipients
{
    Task<BookingNotificationRecipientSet> ResolveAsync(Guid propertyId, CancellationToken cancellationToken);

    /// <summary>Whether <paramref name="recipientEmail"/> (compared case-insensitively after trimming) is in the Property's CURRENT recipient set.</summary>
    Task<bool> IsStillRecipientAsync(Guid propertyId, string recipientEmail, CancellationToken cancellationToken);
}

/// <summary>One operator-declared chain Manager: a Staff id and the work address where that person receives booking notifications at every Property where they are a Manager.</summary>
public sealed class ChainManagerEntry
{
    public Guid StaffId { get; set; }
    public string Email { get; set; } = string.Empty;
}

/// <summary>
/// <c>BookingNotifications</c> settings (environment form <c>BookingNotifications__ChainManagers__0__StaffId</c> / <c>__Email</c>). Empty by default; declared by the operator only, never over HTTP.
/// Validated at start-up; addresses are normalised once here.
/// </summary>
public sealed class BookingNotificationOptions
{
    public const string SectionName = "BookingNotifications";

    public List<ChainManagerEntry> ChainManagers { get; set; } = [];

    /// <summary>Throws when an entry cannot work, so a bad value fails loudly at start-up instead of silently notifying nobody. Normalises the addresses in place.</summary>
    public IReadOnlyDictionary<Guid, string> Validate()
    {
        var map = new Dictionary<Guid, string>();
        foreach (var entry in ChainManagers)
        {
            if (entry.StaffId == Guid.Empty)
            {
                throw new InvalidOperationException("BookingNotifications:ChainManagers entries need a non-empty StaffId.");
            }

            if (!BookingNotificationEmail.TryNormalize(entry.Email, out var email))
            {
                throw new InvalidOperationException($"BookingNotifications:ChainManagers entry {entry.StaffId:D} has no valid single e-mail address.");
            }

            if (!map.TryAdd(entry.StaffId, email))
            {
                throw new InvalidOperationException($"BookingNotifications:ChainManagers lists Staff {entry.StaffId:D} more than once.");
            }
        }

        return map;
    }
}

public static class BookingNotificationEmail
{
    /// <summary>
    /// One address, trimmed and lower-cased (dots, plus tags and provider aliases are kept: two spellings are the same only when they differ by case or surrounding blanks). Anything with a control character
    /// (CR/LF included) anywhere is refused BEFORE the shared newsletter shape check, which trims, so a trailing line break cannot pass; a list (comma, semicolon, space) fails the shape check.
    /// </summary>
    public static bool TryNormalize(string? raw, out string email)
    {
        email = string.Empty;
        if (raw is null || raw.Any(char.IsControl)) return false;
        return NewsletterRules.TryNormalizeEmail(raw, out email);
    }
}

/// <summary>A Staff member who is active with a FrontDesk or Manager membership at the Property, with their local preference (if any).</summary>
public sealed record BookingStaffCandidate(Guid StaffAccountId, bool IsManager, bool HasPreference, string? PreferenceEmail, bool PreferenceEnabled);

/// <summary>
/// The one recipient policy (BHA-CHECKOUT-001-PR04), pure so it can be tested without a database.
/// <list type="number">
/// <item>A Staff member with a local row that is switched off is out, and stays out of the chain tier too (explicit opt-out).</item>
/// <item>Otherwise a local address wins (tier 0). A local row with no address does not override: a chain Manager (currently Manager here) then receives at the chain address (tier 1).</item>
/// <item>Order is (tier, address, Staff id) ordinal; the same address (case-insensitive, after trimming) keeps its first entry, so local beats chain.</item>
/// <item>The Property fallback is added only when that set is empty.</item>
/// </list>
/// </summary>
public static class BookingRecipientPolicy
{
    public static string StaffKey(Guid staffAccountId) => $"staff:{staffAccountId:N}";

    public static string FallbackKey(Guid propertyId) => $"fallback:{propertyId:N}";

    public static BookingNotificationRecipientSet Resolve(
        Guid propertyId,
        IEnumerable<BookingStaffCandidate> staff,
        IReadOnlyDictionary<Guid, string> chainManagers,
        string? fallbackEmail)
    {
        var entries = new List<(int Tier, string Email, Guid Id, BookingRecipientKind Kind)>();
        foreach (var member in staff)
        {
            if (member.HasPreference && !member.PreferenceEnabled) continue;
            if (member.HasPreference && BookingNotificationEmail.TryNormalize(member.PreferenceEmail, out var own))
            {
                entries.Add((0, own, member.StaffAccountId, BookingRecipientKind.Staff));
            }
            else if (member.IsManager && chainManagers.TryGetValue(member.StaffAccountId, out var chain))
            {
                entries.Add((1, chain, member.StaffAccountId, BookingRecipientKind.ChainManager));
            }
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var recipients = entries
            .OrderBy(entry => entry.Tier)
            .ThenBy(entry => entry.Email, StringComparer.Ordinal)
            .ThenBy(entry => entry.Id)
            .Where(entry => seen.Add(entry.Email))
            .Select(entry => new BookingNotificationRecipient(StaffKey(entry.Id), entry.Email, entry.Kind, entry.Id))
            .ToList();

        if (recipients.Count == 0 && BookingNotificationEmail.TryNormalize(fallbackEmail, out var fallback))
        {
            recipients.Add(new BookingNotificationRecipient(FallbackKey(propertyId), fallback, BookingRecipientKind.Fallback, null));
        }

        return new BookingNotificationRecipientSet(recipients);
    }

    /// <summary>The same comparison <see cref="Resolve"/> deduplicates with.</summary>
    public static bool SameAddress(string? left, string? right) =>
        string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);
}

// ---- Admin (Manager of the routed Property) ----

/// <summary>How a Staff member is covered at this Property, for display: <c>Local</c> (own address on), <c>Chain</c> (the operator's work address), <c>OptedOut</c> (local switch off) or <c>NotConfigured</c>.</summary>
public static class BookingNotificationCoverage
{
    public const string Local = "Local";
    public const string Chain = "Chain";
    public const string OptedOut = "OptedOut";
    public const string NotConfigured = "NotConfigured";
}

/// <summary>
/// One roster row. <see cref="LoginEmail"/> is the Staff login identifier, shown only so a Manager can tell colleagues apart (Staff have no display name); it is never used as a recipient.
/// The chain address is never serialised, only <see cref="ChainConfigured"/>. <see cref="Version"/> is 0 until a row exists.
/// </summary>
public sealed record BookingNotificationStaffDto(
    Guid StaffAccountId, string LoginEmail, string Role, string? NotificationEmail, bool IsEnabled, bool ChainConfigured, string Coverage, int Version);

public sealed record BookingNotificationFallbackDto(string? Email, int Version);

public sealed record BookingNotificationRosterDto(Guid PropertyId, IReadOnlyList<BookingNotificationStaffDto> Staff, BookingNotificationFallbackDto Fallback);

public interface IAdminBookingNotifications
{
    Task<BookingNotificationRosterDto?> ReadAsync(Guid propertyId, CancellationToken cancellationToken);

    /// <summary>Saves (or, with null/blank, clears) one Staff member's notification address. 404 when the target is not an active FrontDesk/Manager of the Property.</summary>
    Task<WebsiteMutationResult<BookingNotificationStaffDto>> SetStaffEmailAsync(
        Guid propertyId, Guid staffAccountId, int expectedVersion, string? email, Guid actorStaffId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BookingNotificationStaffDto>> SetStaffEnabledAsync(
        Guid propertyId, Guid staffAccountId, int expectedVersion, bool enabled, Guid actorStaffId, CancellationToken cancellationToken);

    Task<WebsiteMutationResult<BookingNotificationFallbackDto>> SetFallbackAsync(
        Guid propertyId, int expectedVersion, string? email, Guid actorStaffId, CancellationToken cancellationToken);
}
