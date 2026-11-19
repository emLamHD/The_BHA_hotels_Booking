using System.Globalization;

namespace TheBha.Application.Website;

/// <summary>
/// One subscription as Staff see it. <see cref="Version"/> is what an edit, an unsubscribe, an archive or a delete must present; <see cref="VerificationMail"/> is the
/// state of the newest confirmation mail (<c>Pending</c>, <c>Sending</c>, <c>Sent</c>, <c>Failed</c>, <c>Cancelled</c>), null when none was ever queued.
/// </summary>
public sealed record NewsletterSubscriptionDto(
    Guid Id, string Email, DateTimeOffset ReceivedAtUtc, string Source, string Status, DateTimeOffset? VerifiedAtUtc,
    string Language, int Version, DateTimeOffset? UnsubscribedAtUtc, DateTimeOffset? ArchivedAtUtc, string? VerificationMail);

public sealed record NewsletterSubscriptionPageDto(IReadOnlyList<NewsletterSubscriptionDto> Items, int Page, int PageSize, int Total);

/// <summary>What the public form is told. <see cref="EmailConfirmation"/> is a property of the SITE (is a sender connected), never of the address, so the answer is the same for a new and a known address.</summary>
public sealed record NewsletterSubscribeResult(bool EmailConfirmation);

public enum NewsletterConfirmOutcome { Verified, AlreadyVerified, Expired, Invalid }

/// <summary>What pressing the unsubscribe link did. A link that is not (or no longer) valid, including one of a deleted address, is <c>Invalid</c>.</summary>
public enum NewsletterUnsubscribeOutcome { Unsubscribed, AlreadyUnsubscribed, Invalid }

public enum NewsletterAdminStatus { Succeeded, Invalid, NotFound, Conflict }

/// <summary>
/// The answer of a Staff operation. <see cref="Code"/> names the refusal; for a duplicate address <see cref="ExistingId"/> is the row that already holds it
/// (and <see cref="ExistingArchived"/> says whether it is hidden), so the screen can take the Staff member to it.
/// </summary>
public sealed record NewsletterAdminResult<T>(NewsletterAdminStatus Status, string? Code, string? Field, T? Value, Guid? ExistingId = null, bool ExistingArchived = false)
{
    public static NewsletterAdminResult<T> Ok(T value) => new(NewsletterAdminStatus.Succeeded, null, null, value);
    public static NewsletterAdminResult<T> Refused(NewsletterAdminStatus status, string code, string? field = null) => new(status, code, field, default);
}

public enum NewsletterInviteOutcome { Queued, Cooldown, NotConnected }

/// <summary>The answer of "send a verification invitation". <see cref="RetryAfterSeconds"/> is set for <c>Cooldown</c>; the subscription is the row after the operation.</summary>
public sealed record NewsletterInviteResult(NewsletterInviteOutcome Outcome, int? RetryAfterSeconds, NewsletterSubscriptionDto Subscription);

/// <summary>The Staff view of the list. <c>Active</c> hides archived rows (the default), <c>Archived</c> shows only them, <c>All</c> both.</summary>
public static class NewsletterListScope
{
    public const string Active = "active";
    public const string Archived = "archived";
    public const string All = "all";
    public static bool IsKnown(string? value) => value is Active or Archived or All;
}

public interface INewsletterSubscriptions
{
    /// <summary>
    /// Records the request once per address (the first time is kept) and, when a sender is connected and the resend cooldown allows,
    /// queues one confirmation e-mail. Gmail not connected = V1 behaviour: the row is recorded and nothing is queued.
    /// </summary>
    Task<NewsletterSubscribeResult> SubscribeAsync(string normalizedEmail, string source, string language, CancellationToken cancellationToken);

    /// <summary>Marks the address verified for a valid, unused, unexpired token. A used token answers <c>AlreadyVerified</c> and changes nothing.</summary>
    Task<NewsletterConfirmOutcome> ConfirmAsync(string token, CancellationToken cancellationToken);

    /// <summary>
    /// Newest request first (ties by id), or by <paramref name="sort"/> = <see cref="NewsletterListSort.RecentActivity"/> (newest sign-up or verification first; null keeps the
    /// first order). <paramref name="search"/> is a case-insensitive part of the address, taken literally. <paramref name="status"/> (null = any) and
    /// <paramref name="scope"/> (<see cref="NewsletterListScope"/>) narrow the rows; both are decided by the server.
    /// </summary>
    Task<NewsletterSubscriptionPageDto> ListAsync(string? search, string? status, string scope, int page, int pageSize, CancellationToken cancellationToken, string? sort = null);

    /// <summary>
    /// The visitor pressed "unsubscribe" in a Welcome mail. Only a Welcome's token works (never a confirmation's), it needs no unexpired deadline, and a token
    /// whose address was changed or deleted is <c>Invalid</c>. Repeating it changes nothing.
    /// </summary>
    Task<NewsletterUnsubscribeOutcome> UnsubscribeAsync(string token, CancellationToken cancellationToken);
}

/// <summary>
/// BHA-NEWSLETTER-003: what Staff can do to a subscription. Every operation that changes a row takes the version the screen holds and checks it in the same
/// statement that writes, locks the subscription before its mails, withdraws the mails that no longer apply, and records who did it (never the address).
/// </summary>
public interface INewsletterSubscriptionAdmin
{
    /// <summary>Adds an address as <c>Pending</c> from <c>admin</c>. A known address (archived or not) is a conflict that names the existing row. Nothing is sent.</summary>
    Task<NewsletterAdminResult<NewsletterSubscriptionDto>> CreateAsync(Guid actorStaffId, string? email, string? language, CancellationToken cancellationToken);

    /// <summary>
    /// Changes the address and/or the language. A new language keeps the status. A new address returns to <c>Pending</c>, voids every link and withdraws every
    /// mail of the old address; the unique address is enforced by the database and answered as a conflict.
    /// </summary>
    Task<NewsletterAdminResult<NewsletterSubscriptionDto>> UpdateAsync(Guid actorStaffId, Guid id, int expectedVersion, string? email, string? language, CancellationToken cancellationToken);

    /// <summary>Queues one verification mail for a pending address, through the same cooldown as the public form. A verified, unsubscribed or archived address is a conflict.</summary>
    Task<NewsletterAdminResult<NewsletterInviteResult>> InviteAsync(Guid actorStaffId, Guid id, int expectedVersion, CancellationToken cancellationToken);

    /// <summary>Stops the mail for the address and withdraws the mails still waiting. The address starts again only by the visitor's own request and confirmation.</summary>
    Task<NewsletterAdminResult<NewsletterSubscriptionDto>> UnsubscribeAsync(Guid actorStaffId, Guid id, int expectedVersion, CancellationToken cancellationToken);

    /// <summary>Hides the row from the default list (and withdraws its waiting mails), or brings it back. It changes no consent.</summary>
    Task<NewsletterAdminResult<NewsletterSubscriptionDto>> SetArchivedAsync(Guid actorStaffId, Guid id, int expectedVersion, bool archived, CancellationToken cancellationToken);

    /// <summary>Removes the row, its tokens and its waiting mails for good. The audit row stays, without the address.</summary>
    Task<NewsletterAdminResult<bool>> DeleteAsync(Guid actorStaffId, Guid id, int expectedVersion, CancellationToken cancellationToken);
}

public static class NewsletterRules
{
    public const int MaxEmailLength = 254;
    public const int MaxSearchLength = 254;
    public const int MaxPageSize = 100;
    public const int DefaultPageSize = 20;
    public const int MaxTokenLength = 64;
    public static readonly IReadOnlyList<string> Languages = ["vi", "en", "fr"];
    public const string DefaultLanguage = "vi";

    /// <summary>The language of the confirmation e-mail: one of <see cref="Languages"/>, anything else (or nothing) is the site default.</summary>
    public static string NormalizeLanguage(string? raw) =>
        Languages.FirstOrDefault(l => string.Equals(l, raw?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? DefaultLanguage;

    /// <summary>
    /// The same shape the Customer form checks (one @, a dot-separated domain of at least two labels, an alphabetic
    /// top-level domain), enforced here because the browser is not a boundary. The result is trimmed and lower case.
    /// </summary>
    public static bool TryNormalizeEmail(string? raw, out string email)
    {
        email = string.Empty;
        var value = raw?.Trim();
        if (string.IsNullOrEmpty(value) || value.Length > MaxEmailLength) return false;
        var at = value.IndexOf('@');
        if (at <= 0 || at != value.LastIndexOf('@')) return false;
        var local = value[..at];
        var labels = value[(at + 1)..].Split('.');
        if (local.Length > 64 || local[0] == '.' || local[^1] == '.' || local.Contains("..", StringComparison.Ordinal) || !local.All(IsLocalChar)) return false;
        if (labels.Length < 2 || !labels.All(IsDomainLabel)) return false;
        if (labels[^1].Length < 2 || !labels[^1].All(char.IsAsciiLetter)) return false;
        email = value.ToLower(CultureInfo.InvariantCulture);
        return true;
    }

    private static bool IsLocalChar(char c) => char.IsAsciiLetterOrDigit(c) || ".!#$%&'*+/=?^_`{|}~-".Contains(c, StringComparison.Ordinal);

    private static bool IsDomainLabel(string label) =>
        label.Length is >= 1 and <= 63 && char.IsAsciiLetterOrDigit(label[0]) && char.IsAsciiLetterOrDigit(label[^1]) &&
        label.All(c => char.IsAsciiLetterOrDigit(c) || c == '-');
}
