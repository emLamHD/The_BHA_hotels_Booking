namespace TheBha.Domain.Website;

/// <summary>
/// BHA-NEWSLETTER-001: one visitor's request to receive offers. V1 only records the request: there is no e-mail
/// provider, so a row stays <see cref="StatusPendingVerification"/> until a later work item verifies the address.
/// <see cref="Email"/> is the normalized address (trimmed, lower case) and is unique, so a repeat or a concurrent
/// request for the same address is one row and keeps the first <see cref="ReceivedAtUtc"/>.
/// </summary>
public sealed class NewsletterSubscription
{
    public const string StatusPendingVerification = "PendingVerification";
    public const string SourceHomepage = "homepage";

    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Source { get; set; } = SourceHomepage;
    public string Status { get; set; } = StatusPendingVerification;
    public DateTimeOffset ReceivedAtUtc { get; set; }
}
