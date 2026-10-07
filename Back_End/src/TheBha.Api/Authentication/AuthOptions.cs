namespace TheBha.Api.Authentication;

public sealed class AuthRateLimitOptions
{
    public const string SectionName = "Authentication:RateLimiting";
    public int RegisterPermitLimit { get; init; } = 5;
    public int LoginPermitLimit { get; init; } = 10;
    public int WindowSeconds { get; init; } = 60;
}

public sealed class CookieSessionOptions
{
    public const string SectionName = "Authentication:Cookie";
    public string SameSite { get; init; } = "Lax";
}

public sealed class CorsOptions
{
    public const string SectionName = "Cors";
    public string[] AllowedOrigins { get; init; } = [];

    /// <summary>
    /// PMS-CAL-001.1: explicit HTTPS origin(s) for the Admin Reservation Board's
    /// unauthenticated read endpoint (see <see cref="TheBha.Api.AdminCalendarOptions"/>).
    /// Kept separate from <see cref="AllowedOrigins"/> so the Admin origin is
    /// never silently granted the customer-web policy's credentialed access.
    /// </summary>
    public string[] AdminOrigins { get; init; } = [];
}
