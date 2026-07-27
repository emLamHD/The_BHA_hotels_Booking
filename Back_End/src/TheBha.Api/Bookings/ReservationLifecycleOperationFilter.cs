using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using TheBha.Api.Controllers;

namespace TheBha.Api.Bookings;

public sealed class ReservationLifecycleOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var declaringType = context.MethodInfo.DeclaringType;
        var isConfirm = declaringType == typeof(BookingHoldsController) &&
            context.MethodInfo.Name == nameof(BookingHoldsController.Confirm);
        var isReservationRead = declaringType == typeof(ReservationsController) &&
            context.MethodInfo.Name == nameof(ReservationsController.Get);
        if (!isConfirm && !isReservationRead)
        {
            return;
        }

        operation.Summary = isConfirm
            ? "Atomically confirm an owned, non-expired Hold into a Reservation"
            : "Read an owned Reservation";
        operation.Description =
            "Ownership is proved by the existing customer cookie session or by the opaque " +
            "booking access token originally returned once on Hold creation. Neither the " +
            "cookie nor the header is a bearer token.";

        operation.Parameters ??= [];
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = "X-Booking-Access-Token",
            In = ParameterLocation.Header,
            Required = false,
            Description =
                "Opaque one-time guest access token returned only on the initial Hold " +
                "creation response. Required for guest ownership when no customer cookie " +
                "session is present.",
            Schema = new OpenApiSchema { Type = "string" }
        });

        if (isConfirm)
        {
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "X-CSRF-TOKEN",
                In = ParameterLocation.Header,
                Required = true,
                Description = "Request token returned by GET /api/v1/auth/csrf.",
                Schema = new OpenApiSchema { Type = "string" }
            });
        }

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
