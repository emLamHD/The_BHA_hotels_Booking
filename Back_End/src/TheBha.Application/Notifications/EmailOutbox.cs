using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TheBha.Application.Notifications;

/// <summary>An event to queue. <see cref="PayloadJson"/> is a JSON object of ids and small facts (never an address or a text); the same <see cref="EventId"/> with the same content is a no-op.</summary>
public sealed record EmailOutboxEventRequest(Guid EventId, string EventType, int SchemaVersion, Guid PropertyId, string PayloadJson);

public enum EmailOutboxEnqueueStatus
{
    Enqueued,

    /// <summary>The event id was already queued with exactly this content; nothing was written.</summary>
    Duplicate,

    /// <summary>The event id exists with different content; the stored event is unchanged.</summary>
    Conflict
}

/// <summary>
/// Queues an event in the CALLER's transaction. The caller must already have one open on the same <c>TheBhaDbContext</c> (an exception otherwise): the enqueue neither commits nor rolls back, so the event exists exactly
/// when the caller's own rows do. Nothing is sent from here.
/// </summary>
public interface IEmailOutbox
{
    Task<EmailOutboxEnqueueStatus> EnqueueAsync(EmailOutboxEventRequest request, CancellationToken cancellationToken);
}

public sealed record EmailOutboxEventContext(Guid EventId, string EventType, int SchemaVersion, Guid PropertyId, JsonElement Payload);

/// <summary>What a handler wants sent. (<see cref="Purpose"/>, <see cref="RecipientKey"/>) is stable for the event, so a replay never creates a second delivery; the address itself may be anything the handler reads.</summary>
public sealed record EmailDeliveryDraft(string Purpose, string RecipientKey, string RecipientEmail, string Locale, string TemplateKey, IReadOnlyDictionary<string, string> Model);

/// <summary>
/// Turns one (event type, schema version) into deliveries. Registered in DI by the feature that owns the mail (PR07); an event whose pair has no handler is never claimed and costs no attempt. The handler runs INSIDE
/// the fan-out transaction on the dispatcher's own <c>TheBhaDbContext</c>: it may read the database and must not call out to anything else. It never decides who is eligible beyond what it returns, and it never sends.
/// </summary>
public interface IEmailOutboxEventHandler
{
    string EventType { get; }

    int SchemaVersion { get; }

    Task<IReadOnlyList<EmailDeliveryDraft>> HandleAsync(EmailOutboxEventContext context, CancellationToken cancellationToken);
}

public sealed record EmailOutboxBatchResult(int EventsFannedOut, int DeliveriesProcessed);

/// <summary>One pass of the dispatcher: fans out due events that have a handler, then sends due deliveries. Nothing is claimed while dispatch is off or the provider is not configured.</summary>
public interface IEmailOutboxDispatcher
{
    Task<EmailOutboxBatchResult> ProcessBatchAsync(CancellationToken cancellationToken);
}

/// <summary>A backend-only row for diagnosing the queue: ids, states and outcome codes. No address, no text, no secret.</summary>
public sealed record EmailOutboxFailure(
    string Kind, Guid Id, Guid EventId, string? Purpose, string Status, int Attempts, string? LastOutcome, DateTimeOffset CreatedAtUtc, DateTimeOffset? LastAttemptAtUtc, string? ProviderMessageId);

public interface IEmailOutboxFailures
{
    /// <summary>The Property's Failed and NeedsReconciliation deliveries and Failed events, newest first. <paramref name="limit"/> is clamped to 1..200.</summary>
    Task<IReadOnlyList<EmailOutboxFailure>> ListAsync(Guid propertyId, int limit, CancellationToken cancellationToken);
}

public enum EmailSendOutcome
{
    /// <summary>The provider took the message over. Not a promise about the inbox.</summary>
    Accepted,

    /// <summary>The provider answered that it did not process the request (rate or quota limit): retry later.</summary>
    RateLimited,

    /// <summary>The provider refused the credentials or the account: nothing was sent, and the operator must fix it. The attempt is given back.</summary>
    AuthRejected,

    /// <summary>The provider refused this message and would refuse it again.</summary>
    Permanent,

    /// <summary>No usable answer (timeout, connection lost, 5xx, an answer that cannot be read): the provider may or may not have the message.</summary>
    Unknown,

    /// <summary>The provider holds this idempotency key for a different payload: what it sent cannot be established.</summary>
    KeyConflict
}

public sealed record EmailSendRequest(string IdempotencyKey, string From, string To, string Subject, string Html, string Text);

public sealed record EmailSendResult(EmailSendOutcome Outcome, string Code, string? ProviderMessageId = null, TimeSpan? RetryAfter = null);

/// <summary>Who the transport sends as: <see cref="Fingerprint"/> names the account (provider, endpoint and a hash of the credential, never the credential) and <see cref="From"/> is the sender it would use now.</summary>
public sealed record EmailTransportIdentity(string Fingerprint, string From);

public interface IEmailTransport
{
    /// <summary>Null while the transport is not configured (it must then not be called).</summary>
    EmailTransportIdentity? Identity { get; }

    /// <summary>Sends exactly one message. Never throws for a provider or network failure (that is <see cref="EmailSendOutcome.Unknown"/>); throws <see cref="OperationCanceledException"/> only when <paramref name="cancellationToken"/> is cancelled.</summary>
    Task<EmailSendResult> SendAsync(EmailSendRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// Settings of the outbox, bound from <c>Email:Outbox</c>. Everything is off by default: <see cref="DispatchEnabled"/> lets a pass claim and send, <see cref="WorkerEnabled"/> starts the host's timer. The provider secret comes from
/// the environment (<c>Email__Outbox__Resend__ApiKey</c>) and never appears in a log or in the database.
/// </summary>
public sealed class EmailOutboxOptions
{
    public const string SectionName = "Email:Outbox";

    public bool DispatchEnabled { get; set; }
    public bool WorkerEnabled { get; set; }
    public int WorkerPollSeconds { get; set; } = 5;
    public int BatchSize { get; set; } = 20;
    public int MaxAttempts { get; set; } = 6;
    public int FanoutMaxAttempts { get; set; } = 5;
    public int LeaseSeconds { get; set; } = 90;
    public int HttpTimeoutSeconds { get; set; } = 20;
    public int RetryBaseSeconds { get; set; } = 30;
    public int RetryMaxSeconds { get; set; } = 1800;
    public int RetryAfterMaxSeconds { get; set; } = 3600;

    /// <summary>How long after the FIRST attempt the same idempotency key is still trusted: the provider keeps a key for 24 hours, and this keeps a buffer below that. Past it the delivery needs reconciliation.</summary>
    public int IdempotencyWindowMinutes { get; set; } = 22 * 60;

    public ResendOptions Resend { get; set; } = new();

    /// <summary>Throws when a value cannot work; called at start-up so a bad setting fails loudly instead of silently never sending.</summary>
    public void Validate()
    {
        if (WorkerPollSeconds <= 0 || BatchSize is <= 0 or > 500 || MaxAttempts <= 0 || FanoutMaxAttempts <= 0 || RetryBaseSeconds <= 0 || RetryMaxSeconds < RetryBaseSeconds || RetryAfterMaxSeconds < RetryBaseSeconds)
        {
            throw new InvalidOperationException("Email:Outbox values must be positive, BatchSize at most 500, and the retry maxima at least RetryBaseSeconds.");
        }

        if (HttpTimeoutSeconds <= 0 || LeaseSeconds < HttpTimeoutSeconds + 15)
        {
            throw new InvalidOperationException("Email:Outbox:LeaseSeconds must exceed HttpTimeoutSeconds by at least 15 seconds, so a lease never runs out during a provider call.");
        }

        if (IdempotencyWindowMinutes <= 0 || IdempotencyWindowMinutes > 23 * 60)
        {
            throw new InvalidOperationException("Email:Outbox:IdempotencyWindowMinutes must be between 1 and 1380: the provider keeps an idempotency key for 24 hours and a buffer is required.");
        }

        Resend.Validate();
    }
}

public sealed class ResendOptions
{
    public const string DefaultBaseUrl = "https://api.resend.com";

    public string? ApiKey { get; set; }
    public string? FromAddress { get; set; }
    public string? FromName { get; set; }

    /// <summary>Overridable only in Development (the host refuses it elsewhere) and only to https or a loopback http stub: the API key is sent to this address.</summary>
    public string BaseUrl { get; set; } = DefaultBaseUrl;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(FromAddress);

    public void Validate()
    {
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri) || !(uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)))
        {
            throw new InvalidOperationException("Email:Outbox:Resend:BaseUrl must be an https URL (http only for a loopback stub).");
        }

        if (!string.IsNullOrWhiteSpace(FromAddress) && (!EmailText.IsAddress(FromAddress) || (FromName is not null && FromName.Any(char.IsControl))))
        {
            throw new InvalidOperationException("Email:Outbox:Resend:FromAddress must be one e-mail address, and FromName must not contain control characters.");
        }
    }
}

/// <summary>The one place that decides what an address and a header value may look like.</summary>
public static partial class EmailText
{
    [GeneratedRegex(@"^[^\s@<>,;""]+@[^\s@<>,;""]+\.[^\s@<>,;""]+$")]
    private static partial Regex AddressShape();

    public static bool IsAddress(string? value) => value is { Length: > 3 and <= 256 } && AddressShape().IsMatch(value);

    public static string Header(string value) => value.Replace('\r', ' ').Replace('\n', ' ').Trim();
}

/// <summary>When to try again: doubling from a base up to a cap, never less than the base, and never sooner than a Retry-After the provider sent (itself capped).</summary>
public static class EmailRetryPolicy
{
    public static TimeSpan Delay(int attemptsUsed, TimeSpan? retryAfter, EmailOutboxOptions options)
    {
        var exponent = Math.Clamp(attemptsUsed - 1, 0, 20);
        var seconds = Math.Min(options.RetryMaxSeconds, options.RetryBaseSeconds * Math.Pow(2, exponent));
        var delay = TimeSpan.FromSeconds(Math.Max(options.RetryBaseSeconds, seconds));
        if (retryAfter is { } asked)
        {
            var capped = TimeSpan.FromSeconds(Math.Min(options.RetryAfterMaxSeconds, Math.Max(0, asked.TotalSeconds)));
            if (capped > delay) delay = capped;
        }

        return delay;
    }
}

public sealed class EmailTemplateException(string message) : Exception(message);

public sealed record EmailTemplateText(string Subject, string Text, string Html);

/// <summary>A template with one text per locale. Placeholders are <c>{{name}}</c>; <see cref="DefaultLocale"/> must be one of <see cref="Locales"/>.</summary>
public interface IEmailTemplate
{
    string Key { get; }

    string DefaultLocale { get; }

    IReadOnlyDictionary<string, EmailTemplateText> Locales { get; }
}

public sealed record RenderedEmail(string ResolvedLocale, string Subject, string Text, string Html);

/// <summary>
/// Renders a template for a locale, deterministically: the exact locale, else its language (<c>fr-CA</c> → <c>fr</c>), else the template's default. Values are HTML-encoded in the HTML part and stripped of line breaks in the
/// subject; a placeholder with no value is an error, never an empty hole in a mail. No real template exists yet: the booking mails belong to PR07.
/// </summary>
public sealed partial class EmailTemplateRenderer
{
    [GeneratedRegex(@"\{\{([A-Za-z][A-Za-z0-9_]*)\}\}")]
    private static partial Regex Placeholder();

    private readonly Dictionary<string, IEmailTemplate> _templates;

    public EmailTemplateRenderer(IEnumerable<IEmailTemplate> templates)
    {
        _templates = new Dictionary<string, IEmailTemplate>(StringComparer.Ordinal);
        foreach (var template in templates)
        {
            if (!template.Locales.ContainsKey(template.DefaultLocale)) throw new InvalidOperationException($"Template '{template.Key}' has no text for its default locale.");
            if (!_templates.TryAdd(template.Key, template)) throw new InvalidOperationException($"Template '{template.Key}' is registered twice.");
        }
    }

    public int Count => _templates.Count;

    public bool Has(string key) => _templates.ContainsKey(key);

    public static string ResolveLocale(IEmailTemplate template, string? requested)
    {
        var normalized = (requested ?? string.Empty).Trim().Replace('_', '-').ToLowerInvariant();
        if (template.Locales.ContainsKey(normalized)) return normalized;
        var dash = normalized.IndexOf('-');
        if (dash > 0 && template.Locales.ContainsKey(normalized[..dash])) return normalized[..dash];
        return template.DefaultLocale;
    }

    public RenderedEmail Render(string key, string? locale, IReadOnlyDictionary<string, string> model)
    {
        if (!_templates.TryGetValue(key, out var template)) throw new EmailTemplateException($"No template '{key}'.");
        var resolved = ResolveLocale(template, locale);
        var text = template.Locales[resolved];
        return new RenderedEmail(
            resolved,
            EmailText.Header(Fill(text.Subject, model, value => value)),
            Fill(text.Text, model, value => value),
            Fill(text.Html, model, WebUtility.HtmlEncode));
    }

    private static string Fill(string source, IReadOnlyDictionary<string, string> model, Func<string, string> escape) =>
        Placeholder().Replace(source, match => model.TryGetValue(match.Groups[1].Value, out var value) ? escape(value) : throw new EmailTemplateException($"No value for placeholder '{match.Groups[1].Value}'."));
}
