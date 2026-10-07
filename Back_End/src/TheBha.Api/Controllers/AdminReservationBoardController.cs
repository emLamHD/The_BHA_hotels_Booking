using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using TheBha.Api.Authentication;
using TheBha.Application.Scheduling;

namespace TheBha.Api.Controllers;

/// <summary>
/// PMS-CAL-001.1: the read-only Admin Reservation Board projection. Gated by
/// <see cref="AdminCalendarOptions.EnableUnauthenticatedRead"/> (default
/// <c>false</c>, Production startup-fatal if enabled — see <c>Program.cs</c>)
/// because Admin authentication/RBAC is explicitly deferred — enforced by
/// <see cref="AdminReservationBoardReadGateFilter"/> (correction C2), which
/// runs before model binding so a disabled deployment returns the same 404
/// regardless of query validity. Never mutates anything; the internal
/// assignment/OperationalBlock mutation boundary (<c>PMS-BE-001.2</c>)
/// remains unexposed by this or any other controller.
///
/// <para>
/// PMS-ADMIN-AUTH-001-CP04: the first route converted to Staff authorization. In
/// <c>AdminCalendar:AccessMode=LocalGate</c> (the default) the attribute below runs exactly the
/// read gate above, in the same place. In <c>Staff</c> mode it requires a Staff session with
/// <see cref="StaffPermission.BoardRead"/> at the route's Property (401/403 before model
/// binding, the local flags ignored), and <c>Program.cs</c> gives this route a credentialed
/// GET-only CORS policy for the Admin origins instead of <c>admin-calendar</c>.
/// </para>
/// </summary>
[ApiController]
[Route("api/admin/v1/properties/{propertyId:guid}/reservation-board")]
[EnableCors("admin-calendar")]
[StaffCalendarPermission(StaffPermission.BoardRead, typeof(AdminReservationBoardReadGateFilter))]
public sealed class AdminReservationBoardController(IReservationBoardQuery query) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(ReservationBoardDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReservationBoardDto>> GetBoard(
        Guid propertyId,
        [FromQuery, BindRequired] DateOnly from,
        [FromQuery, BindRequired] DateOnly to,
        CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";

        var result = await query.GetBoardAsync(propertyId, from, to, cancellationToken);
        return result.Status switch
        {
            ReservationBoardStatus.Success => Ok(result.Board),
            ReservationBoardStatus.NotFound => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Property not found",
                detail: "The requested active property does not exist."),
            _ => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid reservation board request",
                detail: result.Error)
        };
    }
}
