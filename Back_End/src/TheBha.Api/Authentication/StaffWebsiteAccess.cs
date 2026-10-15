using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TheBha.Api.Authentication;

/// <summary>The verified Staff member of a website-settings request: the audit actor, from the session and nothing else.</summary>
public sealed record StaffWebsiteContext(Guid StaffId);

/// <summary>
/// CUST-WEB-HEADER-001-CP02 (ADR 0008): marks an Admin website-settings action and is itself the filter that
/// enforces the global <see cref="StaffGlobalPermission"/>, so the metadata cannot be present without the check.
/// In <see cref="AdminCalendarAccessMode.Staff"/> it requires a Staff session and the permission in the database;
/// in <see cref="AdminCalendarAccessMode.LocalGate"/> it closes the action (404): the website settings have no
/// anonymous or local-gate path. <see cref="StaffCalendarModeGuard"/> opens an Admin route in Staff mode because
/// of this attribute alone; applied per action, never per controller.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class StaffWebsitePermissionAttribute(StaffGlobalPermission permission) : Attribute, IFilterFactory
{
    public StaffGlobalPermission Permission { get; } = permission;

    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        serviceProvider.GetRequiredService<AdminCalendarAccess>().Mode == AdminCalendarAccessMode.Staff
            ? new StaffWebsiteAccessFilter(
                Permission,
                serviceProvider.GetRequiredService<IStaffAccessEvaluator>(),
                serviceProvider.GetRequiredService<StaffRequestBoundaryFilter>())
            : new WebsiteClosedInLocalGateFilter();
}

/// <summary>
/// A resource filter, so it runs before model binding: HTTPS (else 404), a valid Staff session (else 401), the
/// permission read from the database now (else 403), then the Staff request boundary for a write — exactly one
/// approved Origin (403) and UTF-8 JSON (415). The account must exist, be active and hold the flag on every
/// request, so a revoke or a disable takes effect on the next request even with a cookie that is still valid.
/// </summary>
public sealed class StaffWebsiteAccessFilter(
    StaffGlobalPermission permission,
    IStaffAccessEvaluator evaluator,
    StaffRequestBoundaryFilter boundary) : IAsyncResourceFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var httpContext = context.HttpContext;
        httpContext.Response.Headers.CacheControl = "no-store";

        if (!httpContext.Request.IsHttps)
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

        if (!await evaluator.HasGlobalPermissionAsync(staffId, permission, httpContext.RequestAborted))
        {
            context.Result = new ForbidResult(StaffAuthentication.Scheme);
            return;
        }

        boundary.OnResourceExecuting(context);
        if (context.Result is not null)
        {
            return;
        }

        httpContext.Features.Set(new StaffWebsiteContext(staffId));
        await next();
    }
}

/// <summary>The LocalGate answer for every website-settings action: the route does not exist there.</summary>
public sealed class WebsiteClosedInLocalGateFilter : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        context.HttpContext.Response.Headers.CacheControl = "no-store";
        context.Result = new NotFoundResult();
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
