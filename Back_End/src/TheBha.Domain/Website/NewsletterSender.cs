namespace TheBha.Domain.Website;

/// <summary>
/// BHA-NEWSLETTER-002: the one Gmail account the site sends newsletter mail from (a single row, <see cref="SingletonId"/>).
/// <see cref="ProtectedClientSecret"/> and <see cref="ProtectedRefreshToken"/> are ASP.NET Data Protection payloads: the plain
/// values are never stored, returned or logged. <see cref="SenderGeneration"/> goes up whenever a different Gmail address
/// is connected, so a request that has already been tried under the old identity cannot silently be sent under the new one.
/// </summary>
public sealed class NewsletterSenderSettings
{
    public const int SingletonId = 1;
    public const string StatusNotConnected = "NotConnected";
    public const string StatusConnected = "Connected";
    public const string StatusNeedsReconnect = "NeedsReconnect";

    public int Id { get; set; } = SingletonId;
    public string? ClientId { get; set; }
    public string? ProtectedClientSecret { get; set; }
    public string? ProtectedRefreshToken { get; set; }
    /// <summary>The Gmail address of the last connection (kept after a disconnect so reconnecting the same account is not a new identity).</summary>
    public string? ConnectedEmail { get; set; }
    public string? SenderName { get; set; }
    public string? ReplyTo { get; set; }
    public string Status { get; set; } = StatusNotConnected;
    public int SenderGeneration { get; set; }
    /// <summary>
    /// Goes up with EVERY connect and disconnect, the same Gmail address included. A worker notes it when it reads the credentials and can
    /// mark the sender "connect again" only while it is unchanged: a late failure of an old connection says nothing about the new one.
    /// </summary>
    public int ConnectionEpoch { get; set; }
    public DateTimeOffset? ConnectedAtUtc { get; set; }
    public Guid? ConnectedByStaffId { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

/// <summary>
/// One in-flight "Connect Gmail" (the OAuth <c>state</c>). Only the SHA-256 of the state is stored. It is used once, expires, is tied to
/// the Staff member who started it and carries the PKCE verifier and the client credentials to apply — all of it applied only after
/// the new connection has been proved, so a failed or cancelled attempt leaves the current connection as it was.
/// </summary>
public sealed class NewsletterOAuthState
{
    public Guid Id { get; set; }
    public string StateHash { get; set; } = string.Empty;
    public Guid StaffId { get; set; }
    public string ProtectedCodeVerifier { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ProtectedClientSecret { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset ExpiresAtUtc { get; set; }
    public DateTimeOffset? ConsumedAtUtc { get; set; }
}

/// <summary>
/// BHA-NEWSLETTER-002: one confirmation e-mail to send (an outbox row written in the same transaction as the subscription's
/// bookkeeping). The link's token exists only as its SHA-256 plus a protected copy that is kept until the mail has gone, so every
/// retry sends the same link. The sender identity is pinned at the first attempt.
/// </summary>
public sealed class NewsletterVerificationRequest
{
    public const string StatusPending = "Pending";
    public const string StatusSending = "Sending";
    public const string StatusSent = "Sent";
    public const string StatusFailed = "Failed";
    public const string StatusCancelled = "Cancelled";

    public Guid Id { get; set; }
    public Guid SubscriptionId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public string? ProtectedToken { get; set; }
    public string Language { get; set; } = "vi";
    public string Status { get; set; } = StatusPending;
    public int Attempts { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset ExpiresAtUtc { get; set; }
    public DateTimeOffset NextAttemptAtUtc { get; set; }
    public DateTimeOffset? LeaseUntilUtc { get; set; }
    /// <summary>Who holds the lease: set by the one statement that takes the request, required by every later write of that worker, so a worker whose lease ran out cannot touch what the next one holds.</summary>
    public Guid? ClaimId { get; set; }
    public DateTimeOffset? UsedAtUtc { get; set; }
    public DateTimeOffset? SentAtUtc { get; set; }
    /// <summary>A short machine code of the last failure or of the cancellation reason; never provider text.</summary>
    public string? LastOutcome { get; set; }
    public int? SenderGeneration { get; set; }
    public string? FromEmail { get; set; }
    public string? FromName { get; set; }
    public string? ReplyTo { get; set; }
}
