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
/// </summary>
public sealed class StaffAuthOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(StaffAuthController))
        {
            return;
        }

        if (operation.Security is { Count: > 0 })
        {
            operation.Security =
            [
                new OpenApiSecurityRequirement
                {
                    [new OpenApiSecurityScheme
                    {
                        Reference = new OpenApiReference
                        {
                            Type = ReferenceType.SecurityScheme,
                            Id = "StaffCookie"
                        }
                    }] = []
                }
            ];
        }

        if (operation.RequestBody?.Content is { } content &&
            content.TryGetValue(AdminRequestBoundary.JsonMediaType, out var json))
        {
            content.Clear();
            content[AdminRequestBoundary.JsonMediaType] = json;
        }
    }
}
