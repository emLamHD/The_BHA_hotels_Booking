using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04: Staff-mode authorization of one converted Admin Calendar action,
/// created by <see cref="StaffCalendarPermissionAttribute"/>. A resource filter, so it runs before
/// model binding and validation: an unauthorized request never reaches the action or its query,
/// whatever its query string or body looks like.
///
/// <para>
/// Order: <c>no-store</c>; cleartext → 404 (the middleware guard already refuses it; this is
/// defence in depth); the <c>TheBha.Staff</c> scheme is authenticated explicitly — never the
/// default Customer principal in <c>HttpContext.User</c> — and a missing, invalid, expired,
/// disabled or stamp-rotated session is challenged (401 ProblemDetails from the Staff cookie
/// events, no redirect); then the evaluator checks the permission at the route's
/// <c>propertyId</c>, and anything short of it is forbidden (403 ProblemDetails). The local gates
/// and their flags are not consulted in this mode.
/// </para>
/// </summary>
public sealed class StaffCalendarAccessFilter(
    StaffPermission permission,
    IStaffAccessEvaluator evaluator) : IAsyncResourceFilter
{
    public const string PropertyIdRouteKey = "propertyId";

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var httpContext = context.HttpContext;
        httpContext.Response.Headers.CacheControl = "no-store";

        if (!httpContext.Request.IsHttps ||
            !Guid.TryParse(context.RouteData.Values[PropertyIdRouteKey]?.ToString(), out var propertyId))
        {
            context.Result = new NotFoundResult();
            return;
        }

        var authentication = await httpContext.AuthenticateAsync(StaffAuthentication.Scheme);
        if (!authentication.Succeeded ||
            StaffAuthentication.GetStaffId(authentication.Principal) is not { } staffId)
        {
            context.Result = new ChallengeResult(StaffAuthentication.Scheme);
            return;
        }

        if (!await evaluator.HasPermissionAsync(staffId, propertyId, permission, httpContext.RequestAborted))
        {
            context.Result = new ForbidResult(StaffAuthentication.Scheme);
            return;
        }

        await next();
    }
}
