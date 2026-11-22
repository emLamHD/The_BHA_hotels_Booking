using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using TheBha.Api.Controllers;

namespace TheBha.Api.Bookings;

/// <summary>BHA-CHECKOUT-001-PR05: the published contract of <c>POST /api/v1/reservations</c> (Direct booking, pay at the property), including the headers and every declared refusal.</summary>
public sealed class DirectReservationOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(ReservationsController) ||
            context.MethodInfo.Name != nameof(ReservationsController.Create))
        {
            return;
        }

        operation.Summary = "Create or idempotently replay a confirmed Direct reservation, payable at the property";
        operation.Description =
            "Confirms a reservation in one step: no Hold is made, nothing is collected now, and the whole room charge becomes the balance due at the property. " +
            "It uses the same availability, stop-sell and pricing as a Hold, rechecked under lock; expectedTotalAmount and expectedCurrencyCode are the price the guest confirmed, not an amount the server takes " +
            "on trust (a different current price answers 409 reservation.price-changed with the new quote and books nothing). Only VND amounts that are whole đồng can be booked. paymentMethod must be PayAtProperty; " +
            "any property the body does not define (a deposit, fee or amount to collect) is refused with 400 request.invalid. " +
            "Owner: a valid customer session owns the reservation, and X-Booking-Access-Token must then be absent (400 validation.access-token-with-session); a rejected session cookie is 401 auth.session-invalid and is never treated as a guest. " +
            "Without a session the guest sends a token the client generated itself (32 random bytes, base64url without padding), together with the Idempotency-Key, on the first request and on every retry; " +
            "only its hash is stored and the server never returns or reissues it (missing or malformed: 401 booking.credential-invalid). " +
            "Idempotency is scoped to the Property and the owner. The same key, owner and body answers 200 with the same reservation (its current status and balance; never re-priced or re-checked, even if the price, " +
            "stock, a gate or the reservation's status has changed since); the same key with another body is 409 reservation.idempotency-conflict; the same key under another owner or Property is a different request. " +
            "Booking:DirectCheckout:PropertyIds (default: none) and Booking:AcceptingNewReservations (default: true) decide whether a NEW reservation is taken: 409 checkout.direct-unavailable and 503 booking.closed. " +
            "Success is 201 with Location pointing at GET /api/v1/reservations/{id}. The body is the reservation plus paymentMethod, ledgerState, receivableAmount, collectedAmount (0 on create) and balanceDueAmount. " +
            "The antiforgery cookie and request token come from GET /api/v1/auth/csrf. Requests are rate limited per client address (429 booking.rate-limited, before anything is written).";
        operation.Parameters ??= [];

        var idempotencyHeader = operation.Parameters.SingleOrDefault(
            parameter => parameter.In == ParameterLocation.Header && parameter.Name == "Idempotency-Key");
        if (idempotencyHeader is null)
        {
            idempotencyHeader = new OpenApiParameter { Name = "Idempotency-Key", In = ParameterLocation.Header, Schema = new OpenApiSchema { Type = "string" } };
            operation.Parameters.Add(idempotencyHeader);
        }

        idempotencyHeader.Required = true;
        idempotencyHeader.Description = "Opaque, case-sensitive request identity; maximum 256 UTF-8 bytes. The raw value is never persisted.";

        var tokenHeader = operation.Parameters.SingleOrDefault(
            parameter => parameter.In == ParameterLocation.Header &&
                         string.Equals(parameter.Name, "X-Booking-Access-Token", StringComparison.OrdinalIgnoreCase));
        if (tokenHeader is null)
        {
            tokenHeader = new OpenApiParameter { Name = "X-Booking-Access-Token", In = ParameterLocation.Header, Schema = new OpenApiSchema { Type = "string" } };
            operation.Parameters.Add(tokenHeader);
        }

        tokenHeader.Required = false;
        tokenHeader.Description =
            "Guest ownership only (required without a customer session, refused with one): a client-generated token of 32 random bytes, base64url without padding, kept with the Idempotency-Key and resent on a retry. " +
            "Only its hash is stored; it is never returned.";
        tokenHeader.Schema ??= new OpenApiSchema { Type = "string" };

        if (!operation.Parameters.Any(parameter =>
                parameter.In == ParameterLocation.Header &&
                string.Equals(parameter.Name, "X-CSRF-TOKEN", StringComparison.OrdinalIgnoreCase)))
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
                [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "CustomerCookie" } }] = []
            }
        ];

        Describe(operation, "201", "Created: the reservation, confirmed, with its folio balance (collectedAmount 0).");
        Describe(operation, "200", "Replay: the reservation this key, owner and body already created.");
        Describe(operation, "400", "validation.* (field rules), validation.expected-price-invalid, validation.payment-method-invalid, validation.access-token-with-session, validation.idempotency-key-*, request.invalid (malformed JSON or a field the route does not define), auth.csrf-invalid.");
        Describe(operation, "401", "auth.session-invalid (the session cookie is not valid) or booking.credential-invalid (no session and no usable access token).");
        Describe(operation, "404", "booking.selection-not-found (property, room type or rate plan not found or inactive).");
        Describe(operation, "409", "reservation.price-changed (with quote), reservation.rooms-unavailable, reservation.pricing-unavailable, reservation.pricing-out-of-range, reservation.amount-unsupported, reservation.offer-not-bookable, reservation.idempotency-conflict, checkout.direct-unavailable.");
        Describe(operation, "429", "booking.rate-limited: too many requests from this client address; nothing was written.");
        Describe(operation, "503", "booking.closed: Booking:AcceptingNewReservations is off.");
    }

    private static void Describe(OpenApiOperation operation, string status, string description)
    {
        if (operation.Responses.TryGetValue(status, out var response))
        {
            response.Description = description;
        }
    }
}
