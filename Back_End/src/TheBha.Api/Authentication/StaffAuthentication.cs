using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP03 (D3): the Staff cookie session, a scheme of its own beside the
/// Customer one, which stays the default authenticate/challenge/sign-in scheme. Staff
/// endpoints name this scheme explicitly, so a Customer cookie never satisfies them and a
/// Staff cookie never satisfies a Customer route.
///
/// <para>
/// The principal carries only the Staff id and security stamp. It is built here rather than
/// by <c>UserClaimsPrincipalFactory&lt;StaffAccount&gt;</c>, which reads the
/// Customer-keyed <c>AspNetUserClaims</c> table. Roles and Property ids are never in it:
/// memberships are read from the database on every request that needs them.
/// </para>
/// </summary>
public static class StaffAuthentication
{
    public const string Scheme = "TheBha.Staff";
    public const string CookieName = ".TheBha.Staff";
    public const string CookiePath = "/api/admin";
    public const string CorsPolicy = "admin-staff";
    public const string LoginRateLimitPolicy = "staff-login";
    public const string StaffIdClaimType = ClaimTypes.NameIdentifier;
    public const string SecurityStampClaimType = "thebha:staff:security-stamp";

    /// <summary>Absolute session lifetime (Owner decision); never slid or extended.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(8);

    public static AuthenticationBuilder AddStaffCookie(
        this AuthenticationBuilder authentication,
        bool isDevelopment)
    {
        authentication.AddCookie(Scheme, options =>
        {
            options.Cookie.Name = CookieName;
            options.Cookie.HttpOnly = true;
            options.Cookie.Path = CookiePath;
            options.Cookie.SameSite = SameSiteMode.Strict;
            // Same rule as the Customer cookie; Staff routes are HTTPS-only in every environment.
            options.Cookie.SecurePolicy = isDevelopment
                ? CookieSecurePolicy.SameAsRequest
                : CookieSecurePolicy.Always;
            options.ExpireTimeSpan = Lifetime;
            options.SlidingExpiration = false;
            options.Events = new CookieAuthenticationEvents
            {
                OnValidatePrincipal = ValidatePrincipalAsync,
                OnRedirectToLogin = context => WriteProblemAsync(
                    context.HttpContext,
                    StatusCodes.Status401Unauthorized,
                    "Authentication required",
                    "A valid staff session is required."),
                OnRedirectToAccessDenied = context => WriteProblemAsync(
                    context.HttpContext,
                    StatusCodes.Status403Forbidden,
                    "Access denied",
                    "The staff session is not authorized for this operation.")
            };
        });

        // The handler's clock is the application's TimeProvider, the same one login stamps
        // the ticket with, so expiry is judged against one source of time.
        authentication.Services
            .AddOptions<CookieAuthenticationOptions>(Scheme)
            .Configure<TimeProvider>((options, timeProvider) => options.TimeProvider = timeProvider);
        return authentication;
    }

    public static ClaimsPrincipal CreatePrincipal(Guid staffId, string securityStamp) =>
        new(new ClaimsIdentity(
            [
                new Claim(StaffIdClaimType, staffId.ToString()),
                new Claim(SecurityStampClaimType, securityStamp)
            ],
            Scheme));

    public static AuthenticationProperties CreateProperties(DateTimeOffset now) => new()
    {
        IsPersistent = false,
        AllowRefresh = false,
        IssuedUtc = now,
        ExpiresUtc = now.Add(Lifetime)
    };

    public static Guid? GetStaffId(ClaimsPrincipal principal) =>
        principal.Identity is { IsAuthenticated: true, AuthenticationType: Scheme } &&
        principal.FindAll(StaffIdClaimType).ToArray() is [var claim] &&
        Guid.TryParse(claim.Value, out var id) &&
        id != Guid.Empty
            ? id
            : null;

    /// <summary>The Staff routes that must never be served or redirected over cleartext.</summary>
    public static bool IsSessionPath(PathString path) =>
        path.StartsWithSegments("/api/admin/v1/auth", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/api/admin/v1/me", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Runs on every authenticated Staff request, with no cache or validation interval: the
    /// Staff row is reloaded, and a missing or malformed claim, an expired ticket, a missing or
    /// disabled Staff account or a rotated security stamp rejects the principal and clears the
    /// Staff cookie only. A locked-out account keeps its session: lockout guards password
    /// guessing, and honouring it here would let anyone end a staff session by failing logins.
    /// </summary>
    private static async Task ValidatePrincipalAsync(CookieValidatePrincipalContext context)
    {
        if (await IsValidAsync(context))
        {
            return;
        }

        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(Scheme);
    }

    private static async Task<bool> IsValidAsync(CookieValidatePrincipalContext context)
    {
        // The handler accepts a ticket until ExpiresUtc has passed; the session ends at it.
        var now = (context.Options.TimeProvider ?? TimeProvider.System).GetUtcNow();
        if (context.Properties.IssuedUtc is not { } issued ||
            context.Properties.ExpiresUtc is not { } expires ||
            expires - issued > Lifetime ||
            now >= expires)
        {
            return false;
        }

        if (context.Principal is not { } principal ||
            GetStaffId(principal) is not { } staffId ||
            principal.FindAll(SecurityStampClaimType).ToArray() is not [var stampClaim] ||
            string.IsNullOrEmpty(stampClaim.Value))
        {
            return false;
        }

        var database = context.HttpContext.RequestServices.GetRequiredService<TheBhaDbContext>();
        var staff = await database.StaffAccounts
            .AsNoTracking()
            .Where(account => account.Id == staffId)
            .Select(account => new { account.IsActive, account.SecurityStamp })
            .SingleOrDefaultAsync(context.HttpContext.RequestAborted);
        return staff is { IsActive: true } &&
            string.Equals(staff.SecurityStamp, stampClaim.Value, StringComparison.Ordinal);
    }

    internal static Task WriteProblemAsync(HttpContext httpContext, int status, string title, string detail)
    {
        httpContext.Response.Headers.CacheControl = "no-store";
        return Results.Problem(statusCode: status, title: title, detail: detail)
            .ExecuteAsync(httpContext);
    }
}

/// <summary>The <c>staff-login</c> limiter, separate from the Customer <c>auth-login</c> one.</summary>
public sealed class StaffLoginRateLimitOptions
{
    public const string SectionName = "StaffAuthentication:LoginRateLimiting";
    public int PermitLimit { get; init; } = 10;
    public int WindowSeconds { get; init; } = 60;
}
