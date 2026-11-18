namespace TheBha.Application.Website;

public enum GoogleFailure { None, InvalidGrant, Transient, Rejected }

public sealed record GoogleTokens(string? AccessToken, string? RefreshToken, string? Scope, GoogleFailure Failure);

public sealed record GoogleAccessToken(string? AccessToken, GoogleFailure Failure);

public sealed record GoogleUserInfo(string? Email, bool EmailVerified, GoogleFailure Failure);

public enum GoogleSendOutcome
{
    Sent,
    /// <summary>Google refused this message for good (a 4xx that a retry cannot change).</summary>
    Rejected,
    /// <summary>The token or the permission is no longer valid: the sender must be connected again.</summary>
    AuthRevoked,
    /// <summary>No usable answer (timeout, network, 429, 5xx): the mail may or may not have been accepted.</summary>
    Unknown
}

/// <summary>The only place that talks to Google. Every method answers with an outcome, never an exception, and never with provider text.</summary>
public interface IGoogleMailGateway
{
    string BuildAuthorizationUrl(string clientId, string redirectUri, string state, string codeChallenge, bool switchAccount);
    Task<GoogleTokens> ExchangeCodeAsync(string clientId, string clientSecret, string code, string codeVerifier, string redirectUri, CancellationToken cancellationToken);
    Task<GoogleAccessToken> RefreshAccessTokenAsync(string clientId, string clientSecret, string refreshToken, CancellationToken cancellationToken);
    Task<GoogleUserInfo> GetUserInfoAsync(string accessToken, CancellationToken cancellationToken);
    Task<GoogleSendOutcome> SendAsync(string accessToken, string rawMessageBase64Url, CancellationToken cancellationToken);
    Task RevokeAsync(string token, CancellationToken cancellationToken);
}

/// <summary>Runs the outbox: sends the confirmation e-mails that are due. One call = one pass; the host's worker calls it on a timer, tests call it directly.</summary>
public interface INewsletterVerificationDispatcher
{
    Task<int> ProcessBatchAsync(int maxMessages, CancellationToken cancellationToken);
}

/// <summary>The settings of the newsletter feature (bound from <c>Website:Newsletter</c>); the origins are resolved by the host.</summary>
public sealed class NewsletterOptions
{
    public const string SectionName = "Website:Newsletter";
    public int ResendCooldownSeconds { get; set; } = 300;
    public int TokenLifetimeHours { get; set; } = 48;
    /// <summary>A Welcome that has not gone out this long after the verification is dropped: a stale greeting is worse than none.</summary>
    public int WelcomeLifetimeHours { get; set; } = 168;
    public int MaxAttempts { get; set; } = 6;
    public int LeaseSeconds { get; set; } = 120;
    public int WorkerPollSeconds { get; set; } = 5;
    public bool WorkerEnabled { get; set; } = true;
    /// <summary>The Customer site's https origin the confirmation link points at; empty = the first <c>Cors:AllowedOrigins</c> entry.</summary>
    public string? CustomerOrigin { get; set; }
    /// <summary>The Admin site's https origin (the OAuth redirect lands on one of its pages); empty = the first <c>Cors:AdminOrigins</c> entry.</summary>
    public string? AdminOrigin { get; set; }
    /// <summary>Google endpoints. Overridable ONLY in Development (the local stub); the secret and the tokens are posted to them.</summary>
    public GoogleEndpointOptions Google { get; set; } = new();
}

public sealed class GoogleEndpointOptions
{
    public string AuthorizationEndpoint { get; set; } = "https://accounts.google.com/o/oauth2/v2/auth";
    public string TokenEndpoint { get; set; } = "https://oauth2.googleapis.com/token";
    public string UserInfoEndpoint { get; set; } = "https://openidconnect.googleapis.com/v1/userinfo";
    public string SendEndpoint { get; set; } = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    public string RevokeEndpoint { get; set; } = "https://oauth2.googleapis.com/revoke";
}
