using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TheBha.Api.Bookings;
using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.Api.Controllers;

/// <summary>
/// BHA-CHECKOUT-001-PR06: guest reservation management. The exchange turns a single-use link secret into a 24-hour session cookie scoped to one reservation; the private read and the estimated-arrival update accept
/// that session OR the signed-in customer who exactly owns the reservation. Every response of this resource is <c>Cache-Control: no-store</c> (set by a middleware that also covers refusals made before an action runs).
/// </summary>
[ApiController]
[Route("api/v1/reservations/{reservationId:guid}/manage")]
public sealed class ReservationManagementController(
    IReservationManagementExchange exchange,
    IReservationManagement management,
    ICurrentCustomer currentCustomer,
    ReservationManagementCookie cookie,
    TimeProvider timeProvider) : ControllerBase
{
    [HttpPost("exchange")]
    [AllowAnonymous]
    [EnableRateLimiting(ReservationManagementRateLimitOptions.PolicyName)]
    [ProducesResponseType(typeof(ReservationManagementSessionApiResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<ReservationManagementSessionApiResponse>> Exchange(
        Guid reservationId,
        ExchangeReservationManagementLinkApiRequest request,
        CancellationToken cancellationToken)
    {
        var result = await exchange.ExchangeAsync(reservationId, request.Token, cancellationToken);
        if (result.Status != ReservationManagementExchangeStatus.Exchanged)
        {
            // One answer for a malformed, unknown, expired, used or foreign link: nothing says which, or whether the reservation exists.
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid reservation management link",
                detail: "The link is invalid, expired or has already been used.");
        }

        var expiresAt = result.ExpiresAtUtc!.Value;
        Response.Cookies.Append(
            ReservationManagementCookie.Name,
            result.SessionSecret!,
            new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = cookie.SameSite,
                Path = Request.PathBase + ReservationManagementCookie.PathFor(Request.Path),
                Expires = expiresAt,
                MaxAge = expiresAt - timeProvider.GetUtcNow(),
                IsEssential = true
            });
        return Ok(new ReservationManagementSessionApiResponse(reservationId, expiresAt));
    }

    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ReservationManagementDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReservationManagementDto>> Get(Guid reservationId, CancellationToken cancellationToken)
    {
        if (InvalidCustomerSession())
        {
            return InvalidSession();
        }

        return Map(await management.GetAsync(reservationId, Request.Cookies[ReservationManagementCookie.Name], cancellationToken));
    }

    [HttpPost("estimated-arrival")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ReservationManagementDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReservationManagementDto>> UpdateEstimatedArrival(
        Guid reservationId,
        UpdateEstimatedArrivalApiRequest request,
        CancellationToken cancellationToken)
    {
        if (InvalidCustomerSession())
        {
            return InvalidSession();
        }

        return Map(await management.UpdateEstimatedArrivalAsync(
            reservationId, Request.Cookies[ReservationManagementCookie.Name], request.ArrivalDate, request.ArrivalTime, cancellationToken));
    }

    // A session cookie that does not validate is refused, never quietly treated as a guest (the same rule as the other private reservation routes).
    private bool InvalidCustomerSession() => Request.Cookies.ContainsKey(".TheBha.Customer") && !currentCustomer.IsAuthenticated;

    private ActionResult InvalidSession() => Problem(
        statusCode: StatusCodes.Status401Unauthorized,
        title: "Invalid customer session",
        detail: "The supplied customer session is invalid.");

    private ActionResult<ReservationManagementDto> Map(ReservationManagementResult result) => result.Status switch
    {
        ReservationManagementStatus.Found or ReservationManagementStatus.Updated => Ok(result.Reservation),
        ReservationManagementStatus.Unauthorized => Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Invalid reservation management session",
            detail: result.Error),
        ReservationManagementStatus.NotFound => Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Reservation not found",
            detail: result.Error),
        ReservationManagementStatus.Conflict => Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "Reservation arrival cannot be changed",
            detail: result.Error),
        _ => Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: "Invalid estimated arrival",
            detail: result.Error)
    };
}
