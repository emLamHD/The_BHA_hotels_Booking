using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TheBha.Application.Scheduling;

namespace TheBha.Api.Controllers;

/// <summary>
/// One Admin Calendar operational-block create request: exactly one room, one
/// half-open night range and a reason. Deliberately narrower than
/// <see cref="CreateRoomBlockCommand"/>, which can carry many
/// <see cref="BlockSegmentSpec"/>s under one header — this endpoint creates one
/// segment, so a multi-room or multi-range block has no HTTP surface here.
///
/// <para>
/// It carries no actor and no authorization evidence, for the same reason as
/// <see cref="CreateReservationAssignmentRequest"/>: a browser-supplied identity
/// would be a claim, not proof, and this boundary has no authentication or RBAC
/// behind it. Unknown JSON properties are ignored by the default
/// System.Text.Json behaviour, so a body that invents <c>actorReference</c> is
/// read exactly as one that does not.
/// </para>
///
/// <para>
/// All four properties are required, and presence is enforced by
/// <see cref="JsonRequiredAttribute"/> inside the input formatter — before the
/// action, and so before the store. The three value-typed properties need it
/// because an omitted one would otherwise deserialize to its default and reach
/// the store as a real-looking value (an absent <c>physicalRoomId</c> would
/// become <see cref="Guid.Empty"/> and come back as <c>404</c>, telling the
/// caller its room does not exist rather than that it forgot a field).
/// <see cref="RequiredAttribute"/> alongside it is what Swashbuckle reads, so
/// the published schema marks the same four required; on <see cref="Reason"/>
/// it additionally rejects <c>null</c>, <c>""</c> and whitespace, since
/// <see cref="RequiredAttribute"/> treats a whitespace-only string as absent.
/// This is a plain type with init-only properties rather than a positional
/// record because MVC refuses to validate a record whose validation metadata
/// sits on a property that is also a primary constructor parameter.
/// </para>
/// </summary>
public sealed class CreateOperationalBlockRequest
{
    [JsonRequired]
    [Required]
    public Guid PhysicalRoomId { get; init; }

    [JsonRequired]
    [Required]
    public DateOnly StartDate { get; init; }

    /// <summary>Exclusive: the block covers <c>[startDate, endDate)</c>.</summary>
    [JsonRequired]
    [Required]
    public DateOnly EndDate { get; init; }

    /// <summary>Why the room is out of service. Required, and never blank after trimming.</summary>
    [JsonRequired]
    [Required]
    public string Reason { get; init; } = string.Empty;
}

/// <summary>
/// What a created operational block returns: the RoomBlock header's id and the
/// one Effective segment created under it, whose own <c>Id</c> and
/// <c>Version</c> are what a later caller needs to reconcile against the board
/// projection or supersede it. The header's <c>CreatedByActorReference</c> is
/// deliberately not published: it is a server-owned marker of this local
/// boundary, and echoing it back would dress it up as an identity the system
/// does not have.
/// </summary>
public sealed record CreateOperationalBlockResponse(Guid RoomBlockId, RoomOccupancySegmentDto Segment);

/// <summary>
/// PMS-CAL-001.3-CP01: the first OperationalBlock <em>write</em> endpoint, and a
/// thin adapter over the already-accepted
/// <see cref="IOperationalBlockMutationStore.CreateBlockAsync"/> — every room,
/// Active-status, capacity, advisory-lock, transaction and audit rule stays in
/// the store (PMS-BE-001.2 Phase 4 §4/§8). Nothing about scheduling is decided
/// here, and no rule from there is restated here.
///
/// <para>
/// The composition is exactly <see cref="AdminReservationAssignmentsController"/>'s,
/// because it is the same boundary: <see cref="AdminCalendarWriteGateFilter"/>
/// as a resource filter, the separate uncredentialed
/// <c>admin-calendar-write</c> CORS policy, and
/// <see cref="IgnoreAntiforgeryTokenAttribute"/> because the application-wide
/// <c>AutoValidateAntiforgeryToken</c> filter defends the Customer cookie
/// session, which this route neither uses nor accepts. <c>[Consumes]</c> is
/// deliberately absent: an MVC media-type constraint is evaluated at action
/// selection, which would answer 415 before the gate had established that the
/// caller is local at all — the gate owns media-type rejection precisely so
/// environmental refusal stays first.
/// </para>
///
/// <para>
/// The audit actor is a server-owned constant naming this temporary local write
/// boundary and nothing else: not an employee, not a manager approval, not an
/// authenticated Staff identity, and not a production authorization. An
/// operational block has no destination RoomType to cross, so — unlike
/// assignment create/move — no authorization evidence is ever forwarded for it.
/// </para>
///
/// <para>
/// No idempotency or exactly-once guarantee is claimed. A caller that loses the
/// response does not know whether the block exists, and must re-read the board
/// rather than retry blindly; a future UI must not retry automatically. Block
/// move, split and cancel (<see cref="IOperationalBlockMutationStore.SupersedeSegmentsAsync"/>)
/// remain internal-only and get no route here.
/// </para>
/// </summary>
[ApiController]
[Route("api/admin/v1/properties/{propertyId:guid}/operational-blocks")]
[EnableCors("admin-calendar-write")]
[IgnoreAntiforgeryToken]
[ServiceFilter(typeof(AdminCalendarWriteGateFilter))]
public sealed class AdminOperationalBlocksController(IOperationalBlockMutationStore store) : ControllerBase
{
    /// <summary>
    /// The audit actor written for every block this endpoint creates. It names
    /// the boundary, never a person — the same constant, with the same meaning,
    /// as <see cref="AdminReservationAssignmentsController"/>'s.
    /// </summary>
    private const string LocalActorReference = "admin-calendar-local-development";

    /// <summary>
    /// Creates one RoomBlock header with exactly one Effective OperationalBlock
    /// segment over the half-open night range <c>[startDate, endDate)</c>.
    /// Dates are passed to the store un-clipped, and the ordering rule
    /// (<c>startDate &lt; endDate</c>) is the store's to enforce, not
    /// reinterpreted here.
    /// </summary>
    /// <remarks>
    /// The published metadata mirrors the assignment endpoint's for the same
    /// reasons: <c>400</c> is declared as the base <see cref="ProblemDetails"/>
    /// because it has two shapes — the input formatter's
    /// <see cref="ValidationProblemDetails"/> for a malformed or incomplete
    /// body, and this action's plain problem for input the store rejects — and
    /// only the base type is true of both; <c>404</c> is declared as a status
    /// with no body schema because a closed gate answers it with an empty body,
    /// so no schema could be promised for every <c>404</c>. <c>403</c> and
    /// <c>415</c> are the gate's own, published because a caller can receive
    /// them.
    /// </remarks>
    [HttpPost]
    [ProducesResponseType(typeof(CreateOperationalBlockResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(void), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status415UnsupportedMediaType)]
    public async Task<ActionResult<CreateOperationalBlockResponse>> Create(
        Guid propertyId,
        [FromBody] CreateOperationalBlockRequest request,
        CancellationToken cancellationToken)
    {
        var result = await store.CreateBlockAsync(
            new CreateRoomBlockCommand(
                propertyId,
                request.Reason.Trim(),
                LocalActorReference,
                [new BlockSegmentSpec(request.PhysicalRoomId, request.StartDate, request.EndDate)]),
            cancellationToken);

        return result.Status switch
        {
            // No Location header: there is no read-by-id route for a block or a
            // segment, and the board projection is the authoritative read. The
            // body carries the ids and version a caller needs instead.
            SegmentMutationStatus.Succeeded => StatusCode(
                StatusCodes.Status201Created,
                new CreateOperationalBlockResponse(result.Block!.Id, result.Segments![0])),
            SegmentMutationStatus.Invalid => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Invalid operational block request",
                detail: result.Error),
            SegmentMutationStatus.NotFound => Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Operational block target not found",
                detail: result.Error),
            // Conflict is the store's only remaining status for this command; an
            // unrecognised one must never fall through to a success shape.
            _ => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Operational block conflict",
                detail: result.Error)
        };
    }
}
