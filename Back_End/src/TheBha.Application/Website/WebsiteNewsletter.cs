using System.Globalization;

namespace TheBha.Application.Website;

public sealed record NewsletterSubscriptionDto(Guid Id, string Email, DateTimeOffset ReceivedAtUtc, string Source, string Status, DateTimeOffset? VerifiedAtUtc);

public sealed record NewsletterSubscriptionPageDto(IReadOnlyList<NewsletterSubscriptionDto> Items, int Page, int PageSize, int Total);

/// <summary>What the public form is told. <see cref="EmailConfirmation"/> is a property of the SITE (is a sender connected), never of the address, so the answer is the same for a new and a known address.</summary>
public sealed record NewsletterSubscribeResult(bool EmailConfirmation);

public enum NewsletterConfirmOutcome { Verified, AlreadyVerified, Expired, Invalid }

public interface INewsletterSubscriptions
{
    /// <summary>
    /// Records the request once per address (the first time is kept) and, when a sender is connected and the resend cooldown allows,
    /// queues one confirmation e-mail. Gmail not connected = V1 behaviour: the row is recorded and nothing is queued.
    /// </summary>
    Task<NewsletterSubscribeResult> SubscribeAsync(string normalizedEmail, string source, string language, CancellationToken cancellationToken);

    /// <summary>Marks the address verified for a valid, unused, unexpired token. A used token answers <c>AlreadyVerified</c> and changes nothing.</summary>
    Task<NewsletterConfirmOutcome> ConfirmAsync(string token, CancellationToken cancellationToken);

    /// <summary>Newest first (ties by id). <paramref name="search"/> is a case-insensitive part of the address, taken literally.</summary>
    Task<NewsletterSubscriptionPageDto> ListAsync(string? search, int page, int pageSize, CancellationToken cancellationToken);
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
