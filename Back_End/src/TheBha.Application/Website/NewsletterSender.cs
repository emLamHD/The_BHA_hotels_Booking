namespace TheBha.Application.Website;

/// <summary>What the Admin reads of the sender: metadata only. The client secret and the tokens are never part of it.</summary>
public sealed record NewsletterSenderDto(
    string Status,
    string? ClientId,
    bool HasClientSecret,
    string? ConnectedEmail,
    string? SenderName,
    string? ReplyTo,
    DateTimeOffset? ConnectedAtUtc,
    string? RedirectUri,
    IReadOnlyList<string> Scopes,
    bool CustomerOriginReady,
    int Version,
    int PendingRequests);

public enum NewsletterSenderStatus { NotConnected, Connected, NeedsReconnect }

public sealed record NewsletterSenderProfileResult(bool Succeeded, string? Code, NewsletterSenderDto? Value);

public sealed record NewsletterConnectStart(string? AuthorizationUrl, string? Code, string? Field);

/// <summary>The end of a connect attempt. <see cref="Code"/> is a stable machine code the Admin turns into words.</summary>
public sealed record NewsletterConnectResult(bool Connected, string? Code, NewsletterSenderDto? Value);

public interface INewsletterSender
{
    Task<NewsletterSenderDto> GetAsync(CancellationToken cancellationToken);
    Task<NewsletterSenderProfileResult> SaveProfileAsync(string? senderName, string? replyTo, int expectedVersion, CancellationToken cancellationToken);
    /// <summary>Starts a connection: stores one single-use state for <paramref name="staffId"/> and returns the Google address to send the browser to. Changes nothing about the current connection.</summary>
    Task<NewsletterConnectStart> BeginConnectAsync(Guid staffId, string? clientId, string? clientSecret, bool switchAccount, CancellationToken cancellationToken);
    /// <summary>Finishes it. Only a fully proved new connection replaces the current one; every other end leaves it untouched.</summary>
    Task<NewsletterConnectResult> CompleteConnectAsync(Guid staffId, string? state, string? code, string? providerError, CancellationToken cancellationToken);
    Task<NewsletterSenderDto> DisconnectAsync(CancellationToken cancellationToken);
}

public static class NewsletterSenderRules
{
    public const int MaxClientIdLength = 256;
    public const int MaxClientSecretLength = 256;
    public const int MaxSenderNameLength = 100;
    public const string CallbackPath = "/website/newsletter/sender/callback";
    public const string GmailSendScope = "https://www.googleapis.com/auth/gmail.send";
    public static readonly IReadOnlyList<string> Scopes = ["openid", "email", GmailSendScope];
}
