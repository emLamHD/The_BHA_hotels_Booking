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
        var isHoldRead = declaringType == typeof(BookingHoldsController) &&
            context.MethodInfo.Name == nameof(BookingHoldsController.Get);
        var isHoldCancel = declaringType == typeof(BookingHoldsController) &&
            context.MethodInfo.Name == nameof(BookingHoldsController.Cancel);
        var isReservationRead = declaringType == typeof(ReservationsController) &&
            context.MethodInfo.Name == nameof(ReservationsController.Get);
        var isReservationCancel = declaringType == typeof(ReservationsController) &&
            context.MethodInfo.Name == nameof(ReservationsController.Cancel);
        var isUnsafeMutation = isConfirm || isHoldCancel || isReservationCancel;
        if (!isConfirm && !isHoldRead && !isHoldCancel && !isReservationRead &&
            !isReservationCancel)
        {
            return;
        }

        operation.Summary = true switch
        {
            _ when isConfirm => "Atomically confirm an owned, non-expired Hold into a Reservation",
            _ when isHoldRead => "Read an owned Booking Hold",
            _ when isHoldCancel => "Idempotently cancel an owned, Active Booking Hold",
            _ when isReservationCancel =>
                "Idempotently cancel an owned, Confirmed Reservation before the Property-local check-in date",
            _ => "Read an owned Reservation"
        };
        operation.Description = true switch
        {
            _ when isHoldCancel =>
                "Ownership is proved by the existing customer cookie session or by the opaque " +
                "booking access token originally returned once on Hold creation. An Active Hold " +
                "transitions to Cancelled even at or after its expiry instant. A Cancelled Hold " +
                "replay returns the same snapshot with no change. A Confirmed Hold cannot be " +
                "cancelled and returns 409, since its commitment now belongs to its Reservation.",
            _ when isReservationCancel =>
                "Ownership is proved by the existing customer cookie session or by the opaque " +
                "booking access token originally returned once on Hold creation. Cancellation " +
                "succeeds only while the server-derived Property-local date is strictly earlier " +
                "than check-in; at or after that local date the request returns 409. A Cancelled " +
                "Reservation replay returns the original cancellation timestamp and reason " +
                "unchanged, even after the cutoff.",
            _ =>
                "Ownership is proved by the existing customer cookie session or by the opaque " +
                "booking access token originally returned once on Hold creation. Neither the " +
                "cookie nor the header is a bearer token."
        };

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

        if (isUnsafeMutation)
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

        if (isReservationCancel)
        {
            operation.RequestBody = new OpenApiRequestBody
            {
                Required = true,
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["application/json"] = new()
                    {
                        Schema = new OpenApiSchema
                        {
                            Type = "object",
                            Required = new HashSet<string> { "reason" },
                            Properties = new Dictionary<string, OpenApiSchema>
                            {
                                ["reason"] = new()
                                {
                                    Type = "string",
                                    MaxLength = 500,
                                    Description =
                                        "Required customer-supplied cancellation reason, " +
                                        "trimmed and limited to 500 characters."
                                }
                            }
                        }
                    }
                }
            };
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
