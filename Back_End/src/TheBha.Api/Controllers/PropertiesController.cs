using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using TheBha.Application.Properties;

namespace TheBha.Api.Controllers;

[ApiController]
[Route("api/v1/properties")]
public sealed class PropertiesController(IPropertyCatalogQueries queries, IAvailabilitySearch availabilitySearch) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<PropertyDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertyDto>>> GetProperties(
        CancellationToken cancellationToken)
    {
        var properties = await queries.GetPropertiesAsync(cancellationToken);
        return Ok(properties);
    }

    [HttpGet("{propertyId}/availability")]
    [ProducesResponseType(typeof(IReadOnlyList<AvailabilityOfferDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<AvailabilityOfferDto>>> GetAvailability(
        Guid propertyId,
        [FromQuery, BindRequired] DateOnly checkIn,
        [FromQuery, BindRequired] DateOnly checkOut,
        [FromQuery, BindRequired] int adults,
        [FromQuery, BindRequired] int children,
        [FromQuery, BindRequired] int rooms,
        CancellationToken cancellationToken)
    {
        var result = await availabilitySearch.SearchAsync(
            new AvailabilitySearchRequest(propertyId, checkIn, checkOut, adults, children, rooms),
            cancellationToken);
        return result.Status switch
        {
            AvailabilitySearchStatus.Success => Ok(result.Offers),
            AvailabilitySearchStatus.NotFound => Problem(statusCode: StatusCodes.Status404NotFound, title: "Property not found", detail: "The requested active property does not exist."),
            _ => Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid availability request", detail: result.Error)
        };
    }

    [HttpGet("{propertyId}")]
    [ProducesResponseType(typeof(PropertyDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PropertyDto>> GetProperty(
        Guid propertyId,
        CancellationToken cancellationToken)
    {
        var property = await queries.GetPropertyAsync(propertyId, cancellationToken);
        return property is null
            ? Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Property not found",
                detail: "The requested active property does not exist.")
            : Ok(property);
    }

    [HttpGet("{propertyId}/room-types")]
    [ProducesResponseType(typeof(IReadOnlyList<RoomTypeDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<RoomTypeDto>>> GetRoomTypes(
        Guid propertyId,
        CancellationToken cancellationToken)
    {
        var roomTypes = await queries.GetRoomTypesAsync(propertyId, cancellationToken);
        return roomTypes is null
            ? Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Property not found",
                detail: "The requested active property does not exist.")
            : Ok(roomTypes);
    }
}
