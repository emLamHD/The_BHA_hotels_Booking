using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using TheBha.Api.Authentication;
using TheBha.Infrastructure.Identity;
using TheBha.Infrastructure.Persistence;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP03: Staff login, logout and <c>me</c>. Login uses
/// <see cref="UserManager{TUser}"/> for <see cref="StaffAccount"/> directly — there is no
/// Staff sign-in manager — and signs in to <see cref="StaffAuthentication.Scheme"/> only.
/// Every route is behind <see cref="StaffRequestBoundaryFilter"/> (HTTPS, Origin, JSON),
/// which is why the global Customer antiforgery check is skipped here and nowhere else.
/// Grants no access to the Admin Calendar: those routes keep their local gates.
/// </summary>
[ApiController]
[Route("api/admin/v1")]
[EnableCors(StaffAuthentication.CorsPolicy)]
[IgnoreAntiforgeryToken]
[ServiceFilter(typeof(StaffRequestBoundaryFilter))]
public sealed class StaffAuthController(
    UserManager<StaffAccount> users,
    TheBhaDbContext database,
    TimeProvider timeProvider) : ControllerBase
{
    private static string? s_unusedPasswordHash;

    [HttpPost("auth/login")]
    [AllowAnonymous]
    [EnableRateLimiting(StaffAuthentication.LoginRateLimitPolicy)]
    [ProducesResponseType(typeof(StaffSessionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<StaffSessionResponse>> Login(StaffLoginRequest request)
    {
        var account = await users.FindByEmailAsync(request.Email.Trim());
        if (account is null || !account.IsActive || await users.IsLockedOutAsync(account))
        {
            // Hash anyway, so an unknown, disabled or locked-out account answers in about the
            // time a wrong password does, with the same body.
            var hasher = users.PasswordHasher;
            s_unusedPasswordHash ??= hasher.HashPassword(new StaffAccount(), Guid.NewGuid().ToString("N"));
            hasher.VerifyHashedPassword(new StaffAccount(), s_unusedPasswordHash, request.Password);
            return AuthenticationFailed();
        }

        if (!await users.CheckPasswordAsync(account, request.Password))
        {
            // Counts toward lockout (5 failures / 15 minutes, IdentityOptions).
            await users.AccessFailedAsync(account);
            return AuthenticationFailed();
        }

        // The reset is an update guarded by the concurrency stamp. It fails when another request
        // changed the account after this one loaded it — for example a fifth failed login that has
        // just locked it — and then no session is issued.
        if (!(await users.ResetAccessFailedCountAsync(account)).Succeeded)
        {
            return AuthenticationFailed();
        }

        await HttpContext.SignInAsync(
            StaffAuthentication.Scheme,
            StaffAuthentication.CreatePrincipal(account.Id, await users.GetSecurityStampAsync(account)),
            StaffAuthentication.CreateProperties(timeProvider.GetUtcNow()));
        return Ok(await ReadSessionAsync(account.Id));
    }

    [HttpPost("auth/logout")]
    [Authorize(AuthenticationSchemes = StaffAuthentication.Scheme)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status415UnsupportedMediaType)]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(StaffAuthentication.Scheme);
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize(AuthenticationSchemes = StaffAuthentication.Scheme)]
    [ProducesResponseType(typeof(StaffSessionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<StaffSessionResponse>> Me()
    {
        var session = StaffAuthentication.GetStaffId(User) is { } staffId
            ? await ReadSessionAsync(staffId)
            : null;
        return session is null
            ? Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Authentication required",
                detail: "A valid staff session is required.")
            : Ok(session);
    }

    private async Task<StaffSessionResponse?> ReadSessionAsync(Guid staffId)
    {
        var email = await database.StaffAccounts
            .AsNoTracking()
            .Where(account => account.Id == staffId)
            .Select(account => account.Email)
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        if (email is null)
        {
            return null;
        }

        var memberships = await (
                from membership in database.StaffPropertyMemberships.AsNoTracking()
                join property in database.Properties.AsNoTracking()
                    on membership.PropertyId equals property.Id
                where membership.StaffAccountId == staffId
                select new StaffMembershipResponse(property.Id, property.Name, property.TimeZone, membership.Role))
            .ToListAsync(HttpContext.RequestAborted);
        return new StaffSessionResponse(
            staffId,
            email,
            memberships
                .OrderBy(membership => membership.PropertyName, StringComparer.Ordinal)
                .ThenBy(membership => membership.PropertyId)
                .ToArray());
    }

    private ObjectResult AuthenticationFailed() =>
        Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Authentication failed",
            detail: "The supplied credentials are invalid.");
}
