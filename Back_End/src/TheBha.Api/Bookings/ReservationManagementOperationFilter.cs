using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using TheBha.Api.Controllers;

namespace TheBha.Api.Bookings;

/// <summary>BHA-CHECKOUT-001-PR06: the published contract of the guest reservation management resource (<c>/api/v1/reservations/{id}/manage</c>).</summary>
public sealed class ReservationManagementOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(ReservationManagementController))
        {
            return;
        }

        switch (context.MethodInfo.Name)
        {
            case nameof(ReservationManagementController.Exchange):
                operation.Summary = "Exchange a single-use management link for a 24-hour session cookie";
                operation.Description =
                    "The guest page reads the secret from the URL fragment and sends it here in the body (never in a URL). A link that is unused, unexpired and for this reservation is consumed in the same transaction that creates the session; " +
                    "one concurrent request wins. The answer sets an HttpOnly, Secure, host-only cookie scoped to this reservation's /manage path and returns only the reservation id and the session expiry. " +
                    "A malformed, unknown, expired, used or foreign link is one 401 reservation.manage-link-invalid. A GET never consumes a link. If the answer is lost after it was committed, the link is spent and nothing can recover the session: " +
                    "a new link is needed. Same antiforgery and CORS as the other public POSTs; rate limited per client address (429 booking.rate-limited). Cache-Control: no-store.";
                break;
            case nameof(ReservationManagementController.Get):
                operation.Summary = "Read a Direct reservation the caller manages";
                operation.Description =
                    "Open to the exact signed-in owner, or to a valid management session cookie of this very reservation (a customer cookie that does not validate is 401 auth.session-invalid and never falls back to the guest session). " +
                    "Direct reservations only. No e-mail, phone or secret in the answer; includes the folio balance and the estimated arrival. A guest without a valid session: 401 reservation.manage-session-invalid. Cache-Control: no-store.";
                break;
            case nameof(ReservationManagementController.UpdateEstimatedArrival):
                operation.Summary = "Set the guest's estimated arrival (informational only)";
                operation.Description =
                    "arrivalDate (yyyy-MM-dd) and arrivalTime (HH:mm) are the property's wall clock, no offset, and are never converted. The date must be the check-in date or the day after. A cancelled reservation answers 409 " +
                    "reservation.arrival-not-changeable. It changes nothing else: no hold, status, inventory, price, folio, calendar or e-mail. Same access as the read; antiforgery token required. Cache-Control: no-store.";
                break;
        }

        if (context.MethodInfo.Name != nameof(ReservationManagementController.Get) &&
            !(operation.Parameters ?? []).Any(parameter => parameter.In == ParameterLocation.Header && string.Equals(parameter.Name, "X-CSRF-TOKEN", StringComparison.OrdinalIgnoreCase)))
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "X-CSRF-TOKEN",
                In = ParameterLocation.Header,
                Required = true,
                Description = "Request token returned by GET /api/v1/auth/csrf.",
                Schema = new OpenApiSchema { Type = "string" }
            });
        }
    }
}
