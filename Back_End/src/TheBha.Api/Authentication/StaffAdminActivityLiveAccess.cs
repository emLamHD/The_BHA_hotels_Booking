using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using TheBha.Application.Activity;

namespace TheBha.Api.Authentication;

/// <summary>
/// BHA-ADMIN-BADGE-001-PR03 (ADR 0011 §E): how the shared activity-hint Hub is opened. Same shape as <see cref="StaffNewsletterLiveAccess"/> (it reuses its
/// <see cref="StaffLiveHubEndpointMetadata"/> marker, Origin guard and negotiate CORS policy): an endpoint policy that names the Staff scheme and requires an active Staff account that may read
/// at least one menu, read from the database now. <see cref="StaffCalendarModeGuard"/> opens the endpoint only when the marker AND this policy are both present. Which menu a connection
/// may hear about is judged again for every recipient at every send; connecting grants nothing by itself.
/// </summary>
public static class StaffAdminActivityLiveAccess
{
    public const string PolicyName = "staff-admin-activity-live";
    public const string Path = "/api/admin/v1/menu-unseen-live";

    public static void AddPolicy(AuthorizationOptions options) =>
        options.AddPolicy(PolicyName, policy => policy
            .AddAuthenticationSchemes(StaffAuthentication.Scheme)
            .RequireAuthenticatedUser()
            .AddRequirements(new StaffAdminActivityLiveRequirement()));

    public static bool IsEnforcedHub(Endpoint? endpoint) =>
        endpoint?.Metadata.GetMetadata<StaffLiveHubEndpointMetadata>() is not null &&
        endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Any(data => data.Policy == PolicyName);
}

public sealed class StaffAdminActivityLiveRequirement : IAuthorizationRequirement;

public sealed class StaffAdminActivityLiveHandler(IAdminMenuAccess access) : AuthorizationHandler<StaffAdminActivityLiveRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, StaffAdminActivityLiveRequirement requirement)
    {
        var aborted = (context.Resource as HttpContext)?.RequestAborted ?? CancellationToken.None;
        if (StaffAuthentication.GetStaffId(context.User) is { } staffId && await access.CanReadAnyAsync(staffId, aborted))
        {
            context.Succeed(requirement);
        }
    }
}
