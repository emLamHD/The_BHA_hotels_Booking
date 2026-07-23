using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace TheBha.Api.Authentication;

public sealed class AuthOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var metadata = context.ApiDescription.ActionDescriptor.EndpointMetadata;
        var isAnonymous = metadata.OfType<IAllowAnonymous>().Any();
        var isAuthorized = metadata.OfType<IAuthorizeData>().Any() && !isAnonymous;

        if (isAuthorized)
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
                            Id = "CustomerCookie"
                        }
                    }] = []
                }
            ];
        }

        var method = context.ApiDescription.HttpMethod;
        var ignoresAntiforgery = metadata.OfType<IgnoreAntiforgeryTokenAttribute>().Any();
        if (isAuthorized &&
            !ignoresAntiforgery &&
            method is "POST" or "PUT" or "PATCH" or "DELETE")
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "X-CSRF-TOKEN",
                In = ParameterLocation.Header,
                Required = true,
                Description = "Token returned by GET /api/v1/auth/csrf.",
                Schema = new OpenApiSchema { Type = "string" }
            });
        }
    }
}
