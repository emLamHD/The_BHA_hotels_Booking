using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
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
///
/// <para>
/// Correction C2, finding 1: the four identifying/date properties are required.
/// They are value types, so an omitted property would otherwise deserialize to
/// its default and reach the store as a real-looking value — an absent
/// <c>reservationUnitId</c> became <see cref="Guid.Empty"/> and came back as
/// <c>404 Assignment target not found</c>, telling the caller its Unit does not
/// exist rather than that it forgot a field. <c>[ApiController]</c> cannot tell
/// the difference, because a default is a valid value; System.Text.Json can,
/// because it knows whether the property appeared.
/// <see cref="JsonRequiredAttribute"/> is therefore what enforces presence, and
/// it does so inside the input formatter — before the action, and so before the
/// store. <see cref="RequiredAttribute"/> alongside it changes no behaviour
/// (DataAnnotations treats any non-null value as present, and these four can
/// never be null); it exists because Swashbuckle reads that attribute and not
/// the System.Text.Json one, so without it the published schema would claim
/// nothing is required while the endpoint required four things.
/// </para>
///
/// <para>
/// This is a plain type with init-only properties rather than a positional
/// record for exactly that reason: ASP.NET Core refuses to validate a record
/// whose validation metadata sits on a property that is also a primary
/// constructor parameter (<c>ModelMetadata.ThrowIfRecordTypeHasValidationOnProperties</c>
/// throws, and every request 500s), while Swashbuckle only reads attributes
/// from the property. Moving the attribute to the constructor parameter
/// satisfies MVC and is invisible to Swashbuckle; having no primary constructor
/// satisfies both. The JSON contract is unchanged either way.
/// </para>
/// </summary>
public sealed class CreateReservationAssignmentRequest
{
    [JsonRequired]
    [Required]
    public Guid ReservationUnitId { get; init; }

    [JsonRequired]
    [Required]
    public Guid PhysicalRoomId { get; init; }

    [JsonRequired]
    [Required]
    public DateOnly StartDate { get; init; }

    [JsonRequired]
    [Required]
    public DateOnly EndDate { get; init; }

    /// <summary>
    /// An explicit operational acknowledgement that the caller intends to place
    /// a guest in a PhysicalRoom of a different RoomType than the one sold. It
    /// is <em>not</em> authentication, RBAC, or evidence of staff identity — it
    /// only records that the choice was deliberate rather than accidental.
    /// Optional: absent means "not acknowledged", which is meaningful.
    /// </summary>
    public bool ConfirmCrossRoomType { get; init; }

    /// <summary>Optional; required by the store only for a cross-RoomType placement.</summary>
    public string? Reason { get; init; }
}

/// <summary>
/// One Admin Calendar move request (PMS-CAL-001.2-CP04B): supersedes exactly
/// the segment named in the route with exactly one replacement, which
/// <see cref="AssignmentMutationStoreTests"/>' <c>SupersedeAsync</c> authority
/// requires to exactly and contiguously cover the source segment's own
/// <c>[StartDate, EndDate)</c> — a shorter, longer, or shifted range is a
/// <c>400 Invalid assignment request</c>, exactly as it would be for a direct
/// <see cref="IAssignmentMutationStore"/> caller. <see cref="StartDate"/>/
/// <see cref="EndDate"/> are therefore not an invitation to edit dates: they
/// exist so that check can run, not so this endpoint can bypass it. A partial
/// move, a split, or a date change has no endpoint here — those remain
/// internal-only.
///
/// <para>
/// Deliberately narrower than <see cref="AssignmentSupersession"/>/
/// <see cref="SupersedeAssignmentsCommand"/>: exactly one segment, exactly one
/// replacement, no actor, no authorization evidence, and no way to express a
/// multi-segment atomic batch/swap. A body that invents <c>actorReference</c>
/// or <c>authorizationEvidence</c> is read exactly as one that does not, for
/// the same reason as <see cref="CreateReservationAssignmentRequest"/>.
/// </para>
/// </summary>
public sealed class MoveReservationAssignmentRequest
{
    /// <summary>
    /// The optimistic-concurrency token last observed for the source segment
    /// (its <c>Version</c> from a prior create/board/move/unassign response).
    /// </summary>
    [JsonRequired]
    [Required]
    public uint ExpectedVersion { get; init; }

    [JsonRequired]
    [Required]
    public Guid PhysicalRoomId { get; init; }

    /// <summary>Must equal the source segment's own current StartDate — see class remarks.</summary>
    [JsonRequired]
    [Required]
    public DateOnly StartDate { get; init; }

    /// <summary>Must equal the source segment's own current EndDate — see class remarks.</summary>
    [JsonRequired]
    [Required]
    public DateOnly EndDate { get; init; }

    /// <summary>Same meaning as <see cref="CreateReservationAssignmentRequest.ConfirmCrossRoomType"/>.</summary>
    public bool ConfirmCrossRoomType { get; init; }

    /// <summary>Optional; required by the store only for a cross-RoomType destination.</summary>
    public string? Reason { get; init; }
}

/// <summary>
/// One Admin Calendar unassign request (PMS-CAL-001.2-CP04B): supersedes the
/// segment named in the route with zero replacements, so the Unit's nights
/// revert to its sold RoomType. There is nothing to place, so this carries no
/// target room, no dates, and — because an empty replacement list can never be
/// cross-RoomType — no <c>confirmCrossRoomType</c> either; the controller never
/// forwards authorization evidence for this request.
/// </summary>
public sealed class UnassignReservationAssignmentRequest
{
    /// <summary>The optimistic-concurrency token last observed for the source segment.</summary>
    [JsonRequired]
    [Required]
    public uint ExpectedVersion { get; init; }

    /// <summary>Optional; explains the unassignment. Never required — unassign never crosses RoomTypes.</summary>
    public string? Reason { get; init; }
}

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
///
/// <para>
/// PMS-CAL-001.2-CP04B: <see cref="Move"/> and <see cref="Unassign"/> are the
/// same adapter pattern applied to <see cref="IAssignmentMutationStore.SupersedeAsync"/>,
/// each a thin, narrow single-segment view onto it — never the general
/// multi-segment/multi-replacement command. The same idempotency caveat
/// applies: a lost response leaves the caller not knowing whether the
/// supersession committed, and the response is the mutation evidence, not a
/// substitute for re-reading the board.
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
    /// <remarks>
    /// Correction C3: the published metadata is deliberately the conservative
    /// description of what a caller can actually receive, including the two
    /// statuses the gate answers before this action runs. <c>400</c> is declared
    /// as the base <see cref="ProblemDetails"/> because it has two shapes — the
    /// input formatter's <see cref="ValidationProblemDetails"/> for a malformed
    /// or incomplete body, and this action's plain problem for input the store
    /// rejects — and only the base type is true of both. <c>404</c> is declared
    /// as a status with no body schema for the same reason in the other
    /// direction: a closed gate returns an empty 404, so no schema could be
    /// promised for every 404 without generated clients expecting a payload
    /// that is sometimes absent.
    /// </remarks>
    [HttpPost]
    [ProducesResponseType(typeof(RoomOccupancySegmentDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(void), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status415UnsupportedMediaType)]
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

    /// <summary>
    /// Supersedes one existing Effective segment with one replacement occupying
    /// its entire current range — a move/reassign, never a partial move or
    /// split. Dates are passed to the store un-clipped; a mismatch against the
    /// source segment's own range is refused by the store's exact-partition
    /// check, not reinterpreted here.
    /// </summary>
    /// <remarks>
    /// The published metadata mirrors <see cref="Create"/>'s for the same
    /// reasons (Correction C3): <c>400</c> as the base <see cref="ProblemDetails"/>
    /// because it has two shapes, and <c>404</c> with no body schema because a
    /// closed gate's <c>404</c> is empty. <c>200</c>, not <c>201</c>: nothing new
    /// is only-just-created from the caller's point of view — an existing
    /// segment is ended and its replacement takes over — and the body is an
    /// array of the mutated segments (cancelled source, then created
    /// successor), not one created resource.
    /// </remarks>
    [HttpPost("{segmentId:guid}/move")]
    [ProducesResponseType(typeof(IReadOnlyList<RoomOccupancySegmentDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(void), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status415UnsupportedMediaType)]
    public async Task<ActionResult<IReadOnlyList<RoomOccupancySegmentDto>>> Move(
        Guid propertyId,
        Guid segmentId,
        [FromBody] MoveReservationAssignmentRequest request,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                propertyId,
                [
                    new AssignmentSupersession(
                        segmentId,
                        request.ExpectedVersion,
                        [new AssignmentDestination(request.PhysicalRoomId, request.StartDate, request.EndDate)])
                ],
                LocalActorReference,
                request.ConfirmCrossRoomType ? CrossRoomTypeAuthorizationEvidence : null,
                reason),
            cancellationToken);

        return MapSupersedeResult(result);
    }

    /// <summary>
    /// Supersedes one existing Effective segment with zero replacements: the
    /// Unit's nights covered by it revert to its sold RoomType. Never
    /// cross-RoomType — an empty replacement list places nobody anywhere — so
    /// no authorization evidence is ever forwarded for this request.
    /// </summary>
    [HttpPost("{segmentId:guid}/unassign")]
    [ProducesResponseType(typeof(IReadOnlyList<RoomOccupancySegmentDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(void), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status415UnsupportedMediaType)]
    public async Task<ActionResult<IReadOnlyList<RoomOccupancySegmentDto>>> Unassign(
        Guid propertyId,
        Guid segmentId,
        [FromBody] UnassignReservationAssignmentRequest request,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();

        var result = await store.SupersedeAsync(
            new SupersedeAssignmentsCommand(
                propertyId,
                [new AssignmentSupersession(segmentId, request.ExpectedVersion, [])],
                LocalActorReference,
                null,
                reason),
            cancellationToken);

        return MapSupersedeResult(result);
    }

    /// <summary>
    /// The status mapping <see cref="Move"/> and <see cref="Unassign"/> share —
    /// deliberately the same shape as <see cref="Create"/>'s switch, so the two
    /// write surfaces never disagree about what one <see cref="SegmentMutationStatus"/>
    /// means to a caller.
    /// </summary>
    private ActionResult<IReadOnlyList<RoomOccupancySegmentDto>> MapSupersedeResult(SegmentMutationResult result) =>
        result.Status switch
        {
            SegmentMutationStatus.Succeeded => StatusCode(StatusCodes.Status200OK, result.Segments!),
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
            _ => Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Assignment conflict",
                detail: result.Error)
        };
}
