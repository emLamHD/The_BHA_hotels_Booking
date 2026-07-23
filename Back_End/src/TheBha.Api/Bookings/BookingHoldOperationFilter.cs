using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using TheBha.Api.Controllers;

namespace TheBha.Api.Bookings;

public sealed class BookingHoldOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(BookingHoldsController) ||
            context.ApiDescription.HttpMethod != "POST")
        {
            return;
        }

        operation.Summary = "Create or idempotently replay an atomic booking Hold";
        operation.Description =
            "Creates a server-priced 15-minute Hold after PostgreSQL-locked inventory " +
            "revalidation. Anonymous guests receive a one-time opaque access token only on " +
            "the initial 201 response; it cannot be recovered on replay. A customer cookie is " +
            "optional. Obtain the antiforgery cookie/request token from GET /api/v1/auth/csrf.";
        operation.Parameters ??= [];
        var idempotencyHeader = operation.Parameters.SingleOrDefault(
            parameter =>
                parameter.In == ParameterLocation.Header &&
                parameter.Name == "Idempotency-Key");
        if (idempotencyHeader is null)
        {
            idempotencyHeader = new OpenApiParameter
            {
                Name = "Idempotency-Key",
                In = ParameterLocation.Header,
                Schema = new OpenApiSchema { Type = "string" }
            };
            operation.Parameters.Add(idempotencyHeader);
        }

        idempotencyHeader.Required = true;
        idempotencyHeader.Description =
            "Opaque, case-sensitive request identity; maximum 256 UTF-8 bytes. " +
            "The raw value is never persisted.";
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = "X-CSRF-TOKEN",
            In = ParameterLocation.Header,
            Required = true,
            Description = "Request token returned by GET /api/v1/auth/csrf.",
            Schema = new OpenApiSchema { Type = "string" }
        });
        operation.Security =
        [
            new OpenApiSecurityRequirement(),
            new OpenApiSecurityRequirement
            {
                [new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference
                    {
                        Type = ReferenceType.SecurityScheme,
                        Id = "CustomerCookie"
                    }
                }] = []
            }
        ];
    }
}
