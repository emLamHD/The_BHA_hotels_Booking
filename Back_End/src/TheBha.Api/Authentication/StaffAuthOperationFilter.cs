using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using TheBha.Api.Controllers;

namespace TheBha.Api.Authentication;

/// <summary>
/// PMS-ADMIN-AUTH-001-CP03: documents the Staff session routes. A route that requires a Staff
/// session names the <c>StaffCookie</c> scheme, replacing the <c>CustomerCookie</c>
/// requirement <see cref="AuthOperationFilter"/> gives every <c>[Authorize]</c> action, and a
/// request body is published only as <c>application/json</c>, the one type
/// <see cref="StaffRequestBoundaryFilter"/> accepts. Runs after <see cref="AuthOperationFilter"/>.
///
/// <para>
/// PMS-ADMIN-AUTH-001-CP04: a Calendar action carrying <see cref="StaffCalendarPermissionAttribute"/>
/// is documented for the access mode this host started in — <c>StaffCookie</c> and the permission
/// in Staff mode, no security requirement in LocalGate — and its 401/403 say they are Staff-mode
/// answers.
/// </para>
/// </summary>
public sealed class StaffAuthOperationFilter(AdminCalendarAccess access) : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.ApiDescription.ActionDescriptor.EndpointMetadata
                .OfType<StaffCalendarPermissionAttribute>()
                .FirstOrDefault() is { } calendar)
        {
            DocumentCalendarAccess(operation, calendar.Permission);
            return;
        }

        if (context.MethodInfo.DeclaringType != typeof(StaffAuthController))
        {
            return;
        }

        if (operation.Security is { Count: > 0 })
        {
            operation.Security = [StaffCookieRequirement()];
        }

        if (operation.RequestBody?.Content is { } content &&
            content.TryGetValue(AdminRequestBoundary.JsonMediaType, out var json))
        {
            content.Clear();
            content[AdminRequestBoundary.JsonMediaType] = json;
        }
    }

    private void DocumentCalendarAccess(OpenApiOperation operation, StaffPermission permission)
    {
        var staffRule =
            $"AccessMode=Staff: requires the {StaffAuthentication.CookieName} Staff session and the {permission} " +
            "permission at {propertyId}, read from the Staff member's membership on every request; " +
            "401 without a valid Staff session, 403 without that permission. " +
            "AccessMode=LocalGate: the local Development gate (HTTPS, loopback, the opt-in flag) instead, " +
            "no session, and 404 when it is closed.";
        if (access.Mode == AdminCalendarAccessMode.Staff)
        {
            operation.Security = [StaffCookieRequirement()];
            operation.Description = $"This host runs AccessMode=Staff. {staffRule}";
        }
        else
        {
            operation.Security = [];
            operation.Description = $"This host runs AccessMode=LocalGate. {staffRule}";
        }

        if (operation.Responses.TryGetValue("401", out var unauthorized))
        {
            unauthorized.Description = "AccessMode=Staff only: no valid Staff session.";
        }

        if (operation.Responses.TryGetValue("403", out var forbidden))
        {
            forbidden.Description = $"AccessMode=Staff only: the Staff session lacks {permission} at this Property.";
        }
    }

    private static OpenApiSecurityRequirement StaffCookieRequirement() => new()
    {
        [new OpenApiSecurityScheme
        {
            Reference = new OpenApiReference
            {
                Type = ReferenceType.SecurityScheme,
                Id = "StaffCookie"
            }
        }] = []
    };
}
