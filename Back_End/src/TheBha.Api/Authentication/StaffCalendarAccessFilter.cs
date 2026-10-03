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
/// events, no redirect); then the role is read from the database at the route's
/// <c>propertyId</c>, and a role that does not grant the permission is forbidden (403
/// ProblemDetails). The local gates and their flags are not consulted in this mode.
/// </para>
///
/// <para>
/// PMS-ADMIN-AUTH-001-CP05: then, for a write, the CP03 Staff boundary
/// (<see cref="StaffRequestBoundaryFilter"/>: exactly one approved <c>Origin</c> → else 403, UTF-8
/// JSON → else 415), still before model binding; a GET passes it unchanged. Last, the verified
/// Staff id, Property and role are stored as <see cref="StaffCalendarWriteContext"/> for the
/// action, which builds the audit actor and any cross-RoomType evidence from them and from nothing
/// the client sent.
/// </para>
/// </summary>
public sealed class StaffCalendarAccessFilter(
    StaffPermission permission,
    IStaffAccessEvaluator evaluator,
    StaffRequestBoundaryFilter boundary) : IAsyncResourceFilter
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

        var role = await evaluator.GetRoleAsync(staffId, propertyId, httpContext.RequestAborted);
        if (!StaffPermissions.RoleGrants(role, permission))
        {
            context.Result = new ForbidResult(StaffAuthentication.Scheme);
            return;
        }

        boundary.OnResourceExecuting(context);
        if (context.Result is not null)
        {
            return;
        }

        httpContext.Features.Set(new StaffCalendarWriteContext(staffId, propertyId, role!));
        await next();
    }
}
