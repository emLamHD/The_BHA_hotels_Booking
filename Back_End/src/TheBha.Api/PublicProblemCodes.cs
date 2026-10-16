using Microsoft.AspNetCore.Mvc;

namespace TheBha.Api;

/// <summary>
/// CUST-WEB-HEADER-001-CP02-C2: a stable, machine-readable <c>code</c> on every problem a PUBLIC (<c>/api/v1</c>) route
/// answers, added to the problem details without touching their <c>title</c>, <c>detail</c> or status — so a client
/// shows a message in the visitor's language chosen by the code, and never has to match English text. The detail
/// strings below are the ones the booking and availability code already produces; a detail that is not listed gets
/// the code of its status (<c>request.invalid</c>, <c>auth.required</c>, …). The codes are API: renaming one is a breaking change.
/// </summary>
public static class PublicProblemCodes
{
    private static readonly (string Title, string? DetailStart, string Code)[] Known =
    [
        // availability + hold + reservation request validation (details are the shared field rules)
        ("Invalid availability request", "propertyId is required", "validation.property-required"),
        ("Invalid booking Hold request", "propertyId is required", "validation.property-required"),
        ("Invalid booking Hold request", "roomTypeId is required", "validation.room-type-required"),
        ("Invalid booking Hold request", "ratePlanId is required", "validation.rate-plan-required"),
        ("Invalid availability request", "checkIn must be earlier", "validation.dates-order"),
        ("Invalid booking Hold request", "checkIn must be earlier", "validation.dates-order"),
        ("Invalid availability request", "Stay cannot exceed", "validation.stay-too-long"),
        ("Invalid booking Hold request", "Stay cannot exceed", "validation.stay-too-long"),
        ("Invalid availability request", "adults must be", "validation.adults-required"),
        ("Invalid booking Hold request", "adults must be", "validation.adults-required"),
        ("Invalid availability request", "children cannot be negative", "validation.children-negative"),
        ("Invalid booking Hold request", "children cannot be negative", "validation.children-negative"),
        ("Invalid availability request", "rooms must be", "validation.rooms-required"),
        ("Invalid booking Hold request", "rooms must be", "validation.rooms-required"),
        ("Invalid availability request", "rooms cannot exceed", "validation.rooms-too-many"),
        ("Invalid booking Hold request", "rooms cannot exceed", "validation.rooms-too-many"),
        ("Invalid availability request", "checkIn cannot be earlier", "validation.check-in-past"),
        ("Invalid booking Hold request", "checkIn cannot be earlier", "validation.check-in-past"),
        ("Invalid booking Hold request", "Idempotency-Key is required", "validation.idempotency-key-required"),
        ("Invalid booking Hold request", "Idempotency-Key", "validation.idempotency-key-invalid"),
        ("Invalid booking Hold request", "fullName", "validation.full-name-invalid"),
        ("Invalid booking Hold request", "email", "validation.email-invalid"),
        ("Invalid booking Hold request", "phone", "validation.phone-invalid"),
        ("Invalid booking Hold request", "The requested occupancy", "validation.occupancy-exceeds"),
        ("Invalid Reservation cancellation request", "reason is required", "validation.reason-required"),
        ("Invalid Reservation cancellation request", "reason cannot exceed", "validation.reason-too-long"),

        // not found
        ("Property not found", null, "property.not-found"),
        ("Room type not found", null, "room-type.not-found"),
        ("Booking selection not found", null, "booking.selection-not-found"),
        ("Booking Hold not found", null, "hold.not-found"),
        ("Reservation not found", null, "reservation.not-found"),

        // credentials and sessions
        ("Invalid customer session", null, "auth.session-invalid"),
        ("Invalid booking access credential", null, "booking.credential-invalid"),
        ("Authentication required", null, "auth.required"),
        ("Authentication failed", null, "auth.invalid-credentials"),
        ("Access denied", null, "auth.forbidden"),
        ("Customer account already exists", null, "auth.account-exists"),
        ("Invalid registration", null, "auth.registration-invalid"),
        ("Invalid antiforgery token", null, "auth.csrf-invalid"),
        ("Too many requests", null, "auth.rate-limited"),

        // conflicts
        ("Booking Hold conflict", "Current pricing is unavailable", "hold.pricing-unavailable"),
        ("Booking Hold conflict", "The selected rooms are no longer available", "hold.rooms-unavailable"),
        ("Booking Hold conflict", "Current pricing exceeds", "hold.pricing-out-of-range"),
        ("Booking Hold conflict", "The Idempotency-Key was already used", "hold.idempotency-conflict"),
        ("Booking Hold conflict", null, "hold.offer-not-holdable"),
        ("Booking Hold cannot be confirmed", "The Hold cannot be confirmed: The Hold has expired", "hold.expired"),
        ("Booking Hold cannot be confirmed", null, "hold.not-confirmable"),
        ("Booking Hold cannot be cancelled", null, "hold.not-cancellable"),
        ("Reservation cannot be cancelled", null, "reservation.not-cancellable")
    ];

    public static string Resolve(int status, string? title, string? detail)
    {
        foreach (var (knownTitle, detailStart, code) in Known)
        {
            if (string.Equals(title, knownTitle, StringComparison.Ordinal) &&
                (detailStart is null || (detail?.StartsWith(detailStart, StringComparison.Ordinal) ?? false)))
            {
                return code;
            }
        }

        return status switch
        {
            StatusCodes.Status400BadRequest => "request.invalid",
            StatusCodes.Status401Unauthorized => "auth.required",
            StatusCodes.Status403Forbidden => "auth.forbidden",
            StatusCodes.Status404NotFound => "request.not-found",
            StatusCodes.Status409Conflict => "request.conflict",
            StatusCodes.Status415UnsupportedMediaType => "request.invalid",
            StatusCodes.Status429TooManyRequests => "auth.rate-limited",
            >= 500 => "error.unexpected",
            _ => "error.unknown"
        };
    }

    /// <summary>Adds the code to a problem of a public route (<c>/api/v1</c>); the Admin routes keep their own codes.</summary>
    public static void Apply(HttpContext httpContext, ProblemDetails problem)
    {
        if (!httpContext.Request.Path.StartsWithSegments("/api/v1", StringComparison.OrdinalIgnoreCase) ||
            problem.Extensions.ContainsKey("code"))
        {
            return;
        }

        problem.Extensions["code"] = Resolve(problem.Status ?? httpContext.Response.StatusCode, problem.Title, problem.Detail);
    }
}
