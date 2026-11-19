namespace TheBha.Domain.Website;

/// <summary>
/// One visitor's request to receive offers. It stays <see cref="StatusPendingVerification"/> until the visitor confirms the
/// address from the e-mail sent to it (BHA-NEWSLETTER-002), then it is <see cref="StatusVerified"/> and
/// <see cref="VerifiedAtUtc"/> is set. <see cref="Email"/> is the normalized address (trimmed, lower case) and is unique, so a
/// repeat or a concurrent request for the same address is one row and keeps the first <see cref="ReceivedAtUtc"/>.
/// </summary>
public sealed class NewsletterSubscription
{
    public const string StatusPendingVerification = "PendingVerification";
    public const string StatusVerified = "Verified";
    public const string SourceHomepage = "homepage";

    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Source { get; set; } = SourceHomepage;
    public string Status { get; set; } = StatusPendingVerification;
    public DateTimeOffset ReceivedAtUtc { get; set; }

    /// <summary>When the visitor confirmed the address; null while pending. Set once, together with <see cref="StatusVerified"/>.</summary>
    public DateTimeOffset? VerifiedAtUtc { get; set; }

    /// <summary>
    /// When a confirmation e-mail was last queued for this address. It is the resend cooldown's clock and is written only when a request
    /// is really queued (never while no sender is connected), so connecting the sender later does not make an earlier visitor wait.
    /// </summary>
    public DateTimeOffset? LastVerificationRequestedAtUtc { get; set; }
}
