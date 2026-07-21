using Microsoft.AspNetCore.Mvc;
using TheBha.Application.Properties;

namespace TheBha.Api.Controllers;

[ApiController]
[Route("api/v1/room-types")]
public sealed class RoomTypesController(IPropertyCatalogQueries queries) : ControllerBase
{
    [HttpGet("{roomTypeId}")]
    [ProducesResponseType(typeof(RoomTypeDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RoomTypeDto>> GetRoomType(
        Guid roomTypeId,
        CancellationToken cancellationToken)
    {
        var roomType = await queries.GetRoomTypeAsync(roomTypeId, cancellationToken);
        return roomType is null
            ? Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Room type not found",
                detail: "The requested active room type does not exist for an active property.")
            : Ok(roomType);
    }
}
