using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;

namespace TheBha.Api.Authentication;

/// <summary>
/// BHA-NEWSLETTER-LIVE-001: how the one Admin SignalR endpoint is opened and guarded. The Hub is not an MVC action, so none of the
/// resource filters of <see cref="StaffWebsitePermissionAttribute"/> can protect it; it carries instead
/// <list type="bullet">
/// <item><see cref="StaffLiveHubEndpointMetadata"/> + an authorization policy that names the Staff scheme, requires a signed-in Staff member and re-reads
/// <see cref="StaffGlobalPermission.WebsiteSettingsManage"/> from the database: <see cref="StaffCalendarModeGuard"/> opens the endpoint only when BOTH are present (so it
/// cannot be open without being enforced), and it is mapped in Staff mode only, so LocalGate has no such route at all;</item>
/// <item>an <c>Origin</c> check on every non-preflight request to it (the negotiate POST and the WebSocket handshake), because CORS does not apply to a WebSocket;</item>
/// <item>its own CORS policy: HTTPS Admin origins, <c>POST</c> (the negotiate call) and the two headers the client sends, with credentials.</item>
/// </list>
/// </summary>
public static class StaffNewsletterLiveAccess
{
    public const string PolicyName = "staff-newsletter-live";
    public const string CorsPolicy = "admin-staff-newsletter-live";
    public const string Path = "/api/admin/v1/website/newsletter-live";

    /// <summary>The headers the SignalR browser client adds to the cross-origin negotiate call (in addition to Content-Type).</summary>
    public static readonly string[] RequestHeaders = ["Content-Type", "X-Requested-With", "X-SignalR-User-Agent"];

    public static void AddPolicy(AuthorizationOptions options) =>
        options.AddPolicy(PolicyName, policy => policy
            .AddAuthenticationSchemes(StaffAuthentication.Scheme)
            .RequireAuthenticatedUser()
            .AddRequirements(new StaffNewsletterLiveRequirement()));

    /// <summary>
    /// Runs after the mode guard and before CORS and authentication. Anything that is not a CORS preflight must carry exactly one <c>Origin</c> that is,
    /// character for character, one of the configured Admin origins; otherwise 403, nothing negotiated and no socket accepted.
    /// </summary>
    public static IApplicationBuilder UseStaffNewsletterLiveOriginGuard(this IApplicationBuilder app, IReadOnlyCollection<string> adminOrigins) =>
        app.Use(async (context, next) =>
        {
            if (context.GetEndpoint()?.Metadata.GetMetadata<StaffLiveHubEndpointMetadata>() is not null)
            {
                // The negotiate answer carries a connection token: nothing of this endpoint is cached.
                context.Response.Headers.CacheControl = "no-store";
                if (!HttpMethods.IsOptions(context.Request.Method) &&
                    !(context.Request.Headers.Origin is { Count: 1 } origin && adminOrigins.Contains(origin[0]!, StringComparer.Ordinal)))
                {
                    await Results.Problem(statusCode: StatusCodes.Status403Forbidden).ExecuteAsync(context);
                    return;
                }
            }

            await next(context);
        });

    /// <summary>True for an endpoint that is the Newsletter live Hub AND is enforced by <see cref="PolicyName"/>.</summary>
    public static bool IsEnforcedHub(Endpoint? endpoint) =>
        endpoint?.Metadata.GetMetadata<StaffLiveHubEndpointMetadata>() is not null &&
        endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Any(data => data.Policy == PolicyName);
}

/// <summary>Marks the endpoints of the Newsletter live Hub (the connect endpoint and its negotiate).</summary>
public sealed class StaffLiveHubEndpointMetadata;

public sealed class StaffNewsletterLiveRequirement : IAuthorizationRequirement;

/// <summary>The permission is read from the database now, like every other website route: a revoke or a disable closes the door for the next connection.</summary>
public sealed class StaffNewsletterLiveHandler(IStaffAccessEvaluator evaluator) : AuthorizationHandler<StaffNewsletterLiveRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, StaffNewsletterLiveRequirement requirement)
    {
        var aborted = (context.Resource as HttpContext)?.RequestAborted ?? CancellationToken.None;
        if (StaffAuthentication.GetStaffId(context.User) is { } staffId &&
            await evaluator.HasGlobalPermissionAsync(staffId, StaffGlobalPermission.WebsiteSettingsManage, aborted))
        {
            context.Succeed(requirement);
        }
    }
}
