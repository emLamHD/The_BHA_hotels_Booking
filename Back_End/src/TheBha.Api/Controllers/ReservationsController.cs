using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Bookings;
using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.Api.Controllers;

[ApiController]
[Route("api/v1/reservations")]
public sealed class ReservationsController(
    IReservationRead read,
    IReservationCancellation cancellation,
    ICurrentCustomer currentCustomer) : ControllerBase
{
    [HttpGet("{reservationId:guid}")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ReservationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReservationDto>> Get(
        Guid reservationId,
        [FromHeader(Name = "X-Booking-Access-Token")] string? bookingAccessToken,
        CancellationToken cancellationToken)
    {
        if (Request.Cookies.ContainsKey(".TheBha.Customer") &&
            !currentCustomer.IsAuthenticated)
        {
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid customer session",
                detail: "The supplied customer session is invalid.");
        }

        var result = await read.GetAsync(reservationId, bookingAccessToken, cancellationToken);
        return result.Status switch
        {
            ReservationReadStatus.Found => Ok(result.Reservation),
            ReservationReadStatus.Unauthorized => Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid booking access credential",
                detail: result.Error),
            _ => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Reservation not found",
                detail: result.Error)
        };
    }

    [HttpPost("{reservationId:guid}/cancel")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ReservationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReservationDto>> Cancel(
        Guid reservationId,
        [FromHeader(Name = "X-Booking-Access-Token")] string? bookingAccessToken,
        CancelReservationApiRequest request,
        CancellationToken cancellationToken)
    {
        if (Request.Cookies.ContainsKey(".TheBha.Customer") &&
            !currentCustomer.IsAuthenticated)
        {
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid customer session",
                detail: "The supplied customer session is invalid.");
        }

        var result = await cancellation.CancelAsync(
            reservationId,
            bookingAccessToken,
            new CancelReservationRequest(request.Reason),
            cancellationToken);
        return result.Status switch
        {
            ReservationCancellationStatus.Cancelled => Ok(result.Reservation),
            ReservationCancellationStatus.Replayed => Ok(result.Reservation),
            ReservationCancellationStatus.Unauthorized => Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid booking access credential",
                detail: result.Error),
            ReservationCancellationStatus.Conflict => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Reservation cannot be cancelled",
                detail: result.Error),
            ReservationCancellationStatus.NotFound => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Reservation not found",
                detail: result.Error),
            _ => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid Reservation cancellation request",
                detail: result.Error)
        };
    }
}
