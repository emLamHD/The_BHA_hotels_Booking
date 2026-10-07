using Microsoft.AspNetCore.Mvc;
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
///
/// <para>
/// PMS-ADMIN-AUTH-001-CP05: a converted write is documented for the running mode too. In Staff
/// mode it gets <c>StaffCookie</c>, its base permission, the conditional
/// <c>AssignmentCrossRoomType</c> when its body can confirm a cross-RoomType placement, a 401 and a
/// 403 that also covers permission and Origin. In LocalGate its responses are left exactly as the
/// actions declare them — a LocalGate 403 (Origin, store) is not a Staff-only answer.
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
            if (HttpMethods.IsGet(context.ApiDescription.HttpMethod ?? string.Empty))
            {
                DocumentCalendarAccess(operation, calendar.Permission);
            }
            else
            {
                DocumentCalendarWrite(operation, context, calendar.Permission);
            }

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

    private void DocumentCalendarWrite(OpenApiOperation operation, OperationFilterContext context, StaffPermission permission)
    {
        var confirmable = context.MethodInfo.GetParameters().Any(parameter =>
            parameter.ParameterType.GetProperty("ConfirmCrossRoomType") is not null);
        var cross = confirmable
            ? $"; confirmCrossRoomType=true additionally requires {nameof(StaffPermission.AssignmentCrossRoomType)} from the same role, else 403 before the store"
            : string.Empty;
        var rule =
            $"AccessMode=Staff: requires the {StaffAuthentication.CookieName} Staff session and the {permission} " +
            $"permission at {{propertyId}}{cross}; then exactly one approved Origin (403) and UTF-8 JSON (415), " +
            "before the body is read. The audit actor is staff:{StaffAccountId}, taken from the session, never " +
            "from the request. AccessMode=LocalGate: the local Development write gate instead (HTTPS, loopback, " +
            "the opt-in flag, then Origin and JSON), no session, and 404 when it is closed.";
        if (access.Mode != AdminCalendarAccessMode.Staff)
        {
            operation.Description = $"This host runs AccessMode=LocalGate. {rule}";
            return;
        }

        operation.Security = [StaffCookieRequirement()];
        operation.Description = $"This host runs AccessMode=Staff. {rule}";
        var problem = context.SchemaGenerator.GenerateSchema(typeof(ProblemDetails), context.SchemaRepository);
        operation.Responses["401"] = ProblemResponse(problem, "No valid Staff session (AccessMode=Staff).");
        operation.Responses["403"] = ProblemResponse(
            problem,
            $"The Staff session lacks {permission} at this Property" +
            (confirmable ? $", or {nameof(StaffPermission.AssignmentCrossRoomType)} for a confirmed cross-RoomType request" : string.Empty) +
            "; the Origin is not exactly one approved Admin origin" +
            (confirmable ? "; or the store refuses an unconfirmed or reasonless cross-RoomType placement." : "."));
    }

    private static OpenApiResponse ProblemResponse(OpenApiSchema schema, string description) => new()
    {
        Description = description,
        Content = { ["application/problem+json"] = new OpenApiMediaType { Schema = schema } }
    };

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
