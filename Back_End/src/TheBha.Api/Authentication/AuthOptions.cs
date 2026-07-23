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
}
