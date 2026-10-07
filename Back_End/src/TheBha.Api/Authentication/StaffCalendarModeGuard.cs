using Microsoft.AspNetCore.Mvc.Controllers;
using TheBha.Api.Controllers;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP04 (D7): in <see cref="AdminCalendarAccessMode.Staff"/>, an Admin request
/// reaches an endpoint only if that endpoint enforces a Staff permission
/// (<see cref="StaffCalendarPermissionAttribute"/>) or is one of the three CP03 session actions.
/// Everything else under <c>/api/admin</c> — any route that is open only because of
/// <c>[Authorize]</c>, <c>[AllowAnonymous]</c> or a local gate — answers 404 with <c>no-store</c> here, before CORS, authentication, model binding, the action
/// and its store. Decided on the selected endpoint's metadata after routing, not on a URL list.
/// Registered only in Staff mode; LocalGate's pipeline does not contain it.
/// </summary>
public static class StaffCalendarModeGuard
{
    /// <summary>The credentialed GET-only CORS policy of Staff-authorized Calendar reads (Staff mode only).</summary>
    public const string ReadCorsPolicy = "admin-staff-calendar-read";

    /// <summary>PMS-ADMIN-AUTH-001-CP05: the credentialed POST-only CORS policy of Staff-authorized Calendar writes (Staff mode only).</summary>
    public const string WriteCorsPolicy = "admin-staff-calendar-write";

    private const string AdminPrefix = "/api/admin";

    private static readonly string[] SessionActions =
        [nameof(StaffAuthController.Login), nameof(StaffAuthController.Logout), nameof(StaffAuthController.Me)];

    public static IApplicationBuilder UseStaffCalendarModeGuard(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var endpoint = context.GetEndpoint();
            if (IsAdmin(context.Request.Path, endpoint) && !IsOpenInStaffMode(endpoint))
            {
                context.Response.Headers.CacheControl = "no-store";
                await Results.Problem(statusCode: StatusCodes.Status404NotFound).ExecuteAsync(context);
                return;
            }

            await next(context);
        });

    public static bool IsOpenInStaffMode(Endpoint? endpoint) =>
        endpoint?.Metadata.GetMetadata<StaffCalendarPermissionAttribute>() is not null ||
        (endpoint?.Metadata.GetMetadata<ControllerActionDescriptor>() is { } action &&
         action.ControllerTypeInfo.AsType() == typeof(StaffAuthController) &&
         SessionActions.Contains(action.ActionName, StringComparer.Ordinal));

    private static bool IsAdmin(PathString path, Endpoint? endpoint) =>
        path.StartsWithSegments(AdminPrefix, StringComparison.OrdinalIgnoreCase) ||
        (endpoint is RouteEndpoint route &&
         new PathString("/" + route.RoutePattern.RawText?.TrimStart('/'))
             .StartsWithSegments(AdminPrefix, StringComparison.OrdinalIgnoreCase));
}
