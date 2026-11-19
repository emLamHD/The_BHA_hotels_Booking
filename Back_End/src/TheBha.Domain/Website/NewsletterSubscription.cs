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
    /// <summary>The visitor (their link) or Staff stopped the mail. A new request for the address starts again at <see cref="StatusPendingVerification"/> (double opt-in).</summary>
    public const string StatusUnsubscribed = "Unsubscribed";
    public const string SourceHomepage = "homepage";
    /// <summary>Added by Staff in Admin. It starts pending: only the owner of the mailbox can verify it.</summary>
    public const string SourceAdmin = "admin";

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

    /// <summary>
    /// BHA-NEWSLETTER-003. Goes up by one with every change Staff can see (address, language, status, archive), written in the same statement that
    /// checks it, so of two edits that read one version a single one is applied and the other is told it is stale.
    /// </summary>
    public int Version { get; set; } = 1;

    /// <summary>The language of the mail sent to this address (<c>vi</c>, <c>en</c>, <c>fr</c>).</summary>
    public string Language { get; set; } = "vi";

    /// <summary>The Staff member who added the address in Admin; null for an address that came from the public form.</summary>
    public Guid? CreatedByStaffId { get; set; }

    /// <summary>When the mail was stopped; set exactly while <see cref="Status"/> is <see cref="StatusUnsubscribed"/>.</summary>
    public DateTimeOffset? UnsubscribedAtUtc { get; set; }

    /// <summary>Hidden from the default Admin list while set. It is not consent: a visitor's own request or confirmation clears it.</summary>
    public DateTimeOffset? ArchivedAtUtc { get; set; }
}

/// <summary>
/// BHA-NEWSLETTER-003: what Staff did to a subscription, kept after the row is gone. It deliberately holds no e-mail address and no
/// foreign key (a permanent delete must succeed and must not leave personal data behind): the id, the action, who and when.
/// </summary>
public sealed class NewsletterSubscriptionAudit
{
    public Guid Id { get; set; }
    public Guid SubscriptionId { get; set; }
    /// <summary><c>created</c>, <c>edited</c>, <c>invited</c>, <c>unsubscribed</c>, <c>archived</c>, <c>restored</c> or <c>deleted</c>.</summary>
    public string Action { get; set; } = string.Empty;
    public Guid ActorStaffId { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
    /// <summary>Names of what changed (for example <c>email,language</c>), never the values.</summary>
    public string? Detail { get; set; }
}
