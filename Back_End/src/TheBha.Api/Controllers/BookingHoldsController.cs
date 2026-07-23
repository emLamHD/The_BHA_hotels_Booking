using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TheBha.Api.Bookings;
using TheBha.Application.Bookings;
using TheBha.Application.Customers;

namespace TheBha.Api.Controllers;

[ApiController]
[Route("api/v1/booking-holds")]
public sealed class BookingHoldsController(
    IBookingHoldCreation creation,
    ICurrentCustomer currentCustomer) : ControllerBase
{
    [HttpPost]
    [AllowAnonymous]
    [ProducesResponseType(typeof(BookingHoldDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(BookingHoldDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<BookingHoldDto>> Create(
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CreateBookingHoldApiRequest request,
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

        var result = await creation.CreateAsync(
            idempotencyKey,
            new CreateBookingHoldRequest(
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
                request.Phone),
            cancellationToken);
        return result.Status switch
        {
            BookingHoldCreationStatus.Created =>
                StatusCode(StatusCodes.Status201Created, result.Hold),
            BookingHoldCreationStatus.Replayed => Ok(result.Hold),
            BookingHoldCreationStatus.Unauthorized => Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Invalid customer session",
                detail: result.Error),
            BookingHoldCreationStatus.NotFound => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Booking selection not found",
                detail: result.Error),
            BookingHoldCreationStatus.Conflict => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Booking Hold conflict",
                detail: result.Error),
            _ => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid booking Hold request",
                detail: result.Error)
        };
    }
}
