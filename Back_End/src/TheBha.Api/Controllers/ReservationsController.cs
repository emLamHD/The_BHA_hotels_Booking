using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TheBha.Api.Bookings;
using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.Api.Controllers;

[ApiController]
[Route("api/v1/reservations")]
public sealed class ReservationsController(
    IDirectReservationCreation creation,
    IReservationRead read,
    IReservationCancellation cancellation,
    ICurrentCustomer currentCustomer) : ControllerBase
{
    /// <summary>BHA-CHECKOUT-001-PR05: books directly, pay at the property. See <see cref="DirectReservationOperationFilter"/> for the published contract.</summary>
    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting(DirectReservationRateLimitOptions.PolicyName)]
    [ProducesResponseType(typeof(DirectReservationDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(DirectReservationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<DirectReservationDto>> Create(
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        [FromHeader(Name = "X-Booking-Access-Token")] string? bookingAccessToken,
        CreateDirectReservationApiRequest request,
        CancellationToken cancellationToken)
    {
        // A session cookie that does not validate is refused, never quietly treated as a guest.
        if (Request.Cookies.ContainsKey(".TheBha.Customer") &&
            !currentCustomer.IsAuthenticated)
        {
            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid customer session",
                detail: "The supplied customer session is invalid.");
        }

        var result = await creation.CreateAsync(
            idempotencyKey,
            bookingAccessToken,
            new CreateDirectReservationRequest(
                request.PropertyId,
                request.RoomTypeId,
                request.RatePlanId,
                request.CheckIn,
                request.CheckOut,
                request.Adults,
                request.Children,
                request.Rooms,
                request.FullName,
                request.Email,
                request.Phone,
                request.ExpectedTotalAmount,
                request.ExpectedCurrencyCode,
                request.PaymentMethod),
            cancellationToken);
        if (result.Status == DirectReservationCreationStatus.PriceChanged)
        {
            // A known refusal: nothing was booked. The body carries the price to confirm again.
            var problem = ProblemDetailsFactory.CreateProblemDetails(
                HttpContext,
                StatusCodes.Status409Conflict,
                "Reservation price changed",
                detail: result.Error);
            problem.Extensions["quote"] = result.Quote;
            return new ObjectResult(problem) { StatusCode = StatusCodes.Status409Conflict };
        }

        return result.Status switch
        {
            DirectReservationCreationStatus.Created => CreatedAtAction(
                nameof(Get),
                new { reservationId = result.Reservation!.ReservationId },
                result.Reservation),
            DirectReservationCreationStatus.Replayed => Ok(result.Reservation),
            DirectReservationCreationStatus.Unauthorized => Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid customer session",
                detail: result.Error),
            DirectReservationCreationStatus.CredentialInvalid => Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid booking access credential",
                detail: result.Error),
            DirectReservationCreationStatus.NotFound => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Booking selection not found",
                detail: result.Error),
            DirectReservationCreationStatus.Conflict => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Reservation conflict",
                detail: result.Error),
            DirectReservationCreationStatus.DirectUnavailable => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Direct checkout unavailable",
                detail: result.Error),
            DirectReservationCreationStatus.Closed => Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Booking closed",
                detail: result.Error),
            _ => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid reservation request",
                detail: result.Error)
        };
    }

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
