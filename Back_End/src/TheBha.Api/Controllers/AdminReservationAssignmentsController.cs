using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TheBha.Application.Scheduling;

namespace TheBha.Api.Controllers;

/// <summary>
/// One Admin Calendar assignment-create request. Deliberately narrower than
/// <see cref="CreateAssignmentCommand"/>: it carries no actor and no
/// authorization evidence, because a browser-supplied identity would be a
/// claim, not proof, and this boundary has no authentication or RBAC behind it
/// (PMS-CAL-001.2-CP01). Unknown JSON properties are ignored by the default
/// System.Text.Json behaviour, so a body that invents <c>actorReference</c> or
/// <c>authorizationEvidence</c> is read exactly as one that does not.
/// </summary>
/// <param name="ConfirmCrossRoomType">
/// An explicit operational acknowledgement that the caller intends to place a
/// guest in a PhysicalRoom of a different RoomType than the one sold. It is
/// <em>not</em> authentication, RBAC, or evidence of staff identity — it only
/// records that the choice was deliberate rather than accidental.
/// </param>
public sealed record CreateReservationAssignmentRequest(
    Guid ReservationUnitId,
    Guid PhysicalRoomId,
    DateOnly StartDate,
    DateOnly EndDate,
    bool ConfirmCrossRoomType,
    string? Reason);

/// <summary>
/// PMS-CAL-001.2-CP02: the first Admin Calendar <em>write</em> endpoint, and a
/// thin adapter over the already-accepted
/// <see cref="IAssignmentMutationStore.CreateAsync"/> — every reservation,
/// property, room, booked-night, capacity, audit and transaction rule stays in
/// the store (PMS-BE-001.2 Phase 4). Nothing about scheduling is decided here.
///
/// <para>
/// The composition is CP01's, applied to a real business route for the first
/// time: <see cref="AdminCalendarWriteGateFilter"/> as a resource filter, the
/// separate uncredentialed <c>admin-calendar-write</c> CORS policy, and
/// <see cref="IgnoreAntiforgeryTokenAttribute"/> because the application-wide
/// <c>AutoValidateAntiforgeryToken</c> filter defends the Customer cookie
/// session, which this route neither uses nor accepts. <c>[Consumes]</c> is
/// deliberately absent: an MVC media-type constraint is evaluated at action
/// selection, which would answer 415 before the gate had established that the
/// caller is local at all — CP01 owns media-type rejection inside the filter
/// precisely so environmental refusal stays first.
/// </para>
///
/// <para>
/// The audit actor and authorization evidence are server-owned constants. They
/// describe how this temporary local write boundary was exercised and nothing
/// else: they are not an employee, not a manager approval, not an authenticated
/// Staff identity, and not a production authorization. When Admin
/// authentication/RBAC arrives, a real actor provider replaces them; CP02
/// introduces none.
/// </para>
///
/// <para>
/// No idempotency or exactly-once guarantee is claimed. A caller that loses the
/// response to a create does not know whether the segment exists, and must
/// re-read the board rather than retry blindly; a future UI must not retry
/// automatically.
/// </para>
/// </summary>
[ApiController]
[Route("api/admin/v1/properties/{propertyId:guid}/reservation-assignments")]
[EnableCors("admin-calendar-write")]
[IgnoreAntiforgeryToken]
[ServiceFilter(typeof(AdminCalendarWriteGateFilter))]
public sealed class AdminReservationAssignmentsController(IAssignmentMutationStore store) : ControllerBase
{
    /// <summary>
    /// The audit actor written for every assignment this endpoint creates. It
    /// names the boundary, never a person.
    /// </summary>
    private const string LocalActorReference = "admin-calendar-local-development";

    /// <summary>
    /// The authorization evidence written when — and only when — the caller
    /// acknowledged a cross-RoomType placement. It records that the local write
    /// gate was the thing that let the request through, which is the whole of
    /// what is actually known about it.
    /// </summary>
    private const string CrossRoomTypeAuthorizationEvidence =
        "local-development-write-gate:cross-room-type-confirmed";

    /// <summary>
    /// Creates one Effective ReservationAssignment segment over the half-open
    /// night range <c>[startDate, endDate)</c>. Dates are passed to the store
    /// un-clipped, so a range that exceeds the Unit's booked nights is refused
    /// rather than silently trimmed to fit.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(RoomOccupancySegmentDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RoomOccupancySegmentDto>> Create(
        Guid propertyId,
        [FromBody] CreateReservationAssignmentRequest request,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();

        var result = await store.CreateAsync(
            new CreateAssignmentCommand(
                propertyId,
                request.ReservationUnitId,
                new AssignmentDestination(request.PhysicalRoomId, request.StartDate, request.EndDate),
                LocalActorReference,
                request.ConfirmCrossRoomType ? CrossRoomTypeAuthorizationEvidence : null,
                reason),
            cancellationToken);

        return result.Status switch
        {
            // No Location header: there is no read-by-id route for a segment,
            // and the board projection is the authoritative read. The body
            // carries the segment's own Id and Version, which is what a caller
            // needs to supersede it later.
            SegmentMutationStatus.Succeeded => StatusCode(
                StatusCodes.Status201Created,
                result.Segments![0]),
            SegmentMutationStatus.Invalid => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid assignment request",
                detail: result.Error),
            SegmentMutationStatus.Unauthorized => Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "Cross-RoomType confirmation required",
                detail: result.Error),
            SegmentMutationStatus.NotFound => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Assignment target not found",
                detail: result.Error),
            // Conflict is the store's only remaining status; an unrecognised
            // one must never fall through to a success shape.
            _ => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Assignment conflict",
                detail: result.Error)
        };
    }
}
