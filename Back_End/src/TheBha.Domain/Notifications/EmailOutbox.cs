using TheBha.Domain.Common;

namespace TheBha.Domain.Notifications;

/// <summary>Field limits of the transactional e-mail outbox (BHA-CHECKOUT-001-PR03).</summary>
public static class EmailOutboxLimits
{
    public const int EventType = 100;
    public const int PayloadBytes = 4096;
    public const int Purpose = 64;
    public const int RecipientKey = 128;
    public const int TemplateKey = 64;
    public const int Locale = 16;
    public const int Outcome = 48;
    public const int ProviderMessageId = 128;
    public const int From = 320;
    public const int Fingerprint = 64;
    /// <summary>A sanity bound on one fan-out, not a business rule: a handler that needs more must refuse the event (fail loudly) rather than drop a recipient.</summary>
    public const int DeliveriesPerEvent = 200;
}

/// <summary>
/// One business fact that may need e-mails (for example "a reservation was confirmed"), written in the caller's own transaction. It carries only a type, a version, the Property and a small JSON payload of ids:
/// no address and no text. Pending until a registered handler fans it out into <see cref="EmailOutboxDelivery"/> rows; Completed in the same transaction as those rows; Failed only when its handler kept throwing.
/// </summary>
public sealed class EmailOutboxEvent
{
    public const string StatusPending = "Pending";
    public const string StatusCompleted = "Completed";
    public const string StatusFailed = "Failed";

    private EmailOutboxEvent()
    {
    }

    public EmailOutboxEvent(Guid id, string eventType, int schemaVersion, Guid propertyId, string payloadJson, DateTimeOffset createdAtUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        EventType = DomainGuard.Required(eventType, nameof(eventType), EmailOutboxLimits.EventType);
        SchemaVersion = schemaVersion > 0 ? schemaVersion : throw new DomainException("schemaVersion must be positive.");
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        PayloadJson = DomainGuard.Required(payloadJson, nameof(payloadJson), EmailOutboxLimits.PayloadBytes);
        Status = StatusPending;
        NextAttemptAtUtc = createdAtUtc;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }
    public string EventType { get; private set; } = string.Empty;
    public int SchemaVersion { get; private set; }
    public Guid PropertyId { get; private set; }
    public string PayloadJson { get; private set; } = string.Empty;
    public string Status { get; private set; } = StatusPending;
    public int FanoutAttempts { get; private set; }
    public DateTimeOffset NextAttemptAtUtc { get; private set; }
    public string? LastOutcome { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset? CompletedAtUtc { get; private set; }
}

/// <summary>
/// One e-mail to one recipient for one purpose of an <see cref="EmailOutboxEvent"/>. Unique per (event, purpose, recipient key), so a replayed fan-out adds nothing. The recipient and the rendered message are stored
/// protected and never change after fan-out, so every attempt sends the same bytes. <see cref="StatusAccepted"/> means the provider took the message over: it does not mean the mail reached an inbox.
/// </summary>
public sealed class EmailOutboxDelivery
{
    public const string StatusPending = "Pending";
    public const string StatusSending = "Sending";
    public const string StatusAccepted = "Accepted";
    public const string StatusFailed = "Failed";
    public const string StatusNeedsReconciliation = "NeedsReconciliation";

    private EmailOutboxDelivery()
    {
    }

    public Guid Id { get; private set; }
    public Guid EventId { get; private set; }
    public Guid PropertyId { get; private set; }
    public string Purpose { get; private set; } = string.Empty;
    public string RecipientKey { get; private set; } = string.Empty;
    public string TemplateKey { get; private set; } = string.Empty;
    public string Locale { get; private set; } = string.Empty;
    public string? ProtectedRecipient { get; private set; }
    public string? ProtectedMessage { get; private set; }
    public string Status { get; private set; } = StatusPending;
    public int Attempts { get; private set; }
    public DateTimeOffset NextAttemptAtUtc { get; private set; }
    public DateTimeOffset? LeaseUntilUtc { get; private set; }
    public Guid? ClaimId { get; private set; }
    public DateTimeOffset? FirstAttemptAtUtc { get; private set; }
    public DateTimeOffset? LastAttemptAtUtc { get; private set; }
    public string? PinnedFingerprint { get; private set; }
    public string? PinnedFrom { get; private set; }
    public bool UncertainSend { get; private set; }
    public string? ProviderMessageId { get; private set; }
    public DateTimeOffset? AcceptedAtUtc { get; private set; }
    public string? LastOutcome { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
}
