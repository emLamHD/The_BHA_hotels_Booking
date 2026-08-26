namespace TheBha.Application.Scheduling;

/// <summary>One proposed Effective ReservationAssignment segment's placement.</summary>
public sealed record AssignmentDestination(Guid PhysicalRoomId, DateOnly StartDate, DateOnly EndDate);

/// <summary>
/// Creates one new Effective ReservationAssignment segment for a Committed
/// ReservationUnit (covers create/activate, same- and cross-RoomType, and partial
/// assignment — <see cref="AssignmentDestination"/> may cover any subset of the
/// unit's booked nights). <see cref="AuthorizationEvidence"/> and <see cref="Reason"/>
/// are required only when the destination PhysicalRoom's RoomType differs from the
/// unit's sold RoomType (ADR 0006 Decision item 8).
/// </summary>
public sealed record CreateAssignmentCommand(
    Guid PropertyId,
    Guid ReservationUnitId,
    AssignmentDestination Destination,
    string ActorReference,
    string? AuthorizationEvidence,
    string? Reason);

/// <summary>
/// One existing Effective segment to supersede. <see cref="Replacements"/> empty
/// means unassign (the unit's nights revert to its sold RoomType); one entry means
/// move/reassign; two or more entries — whose date ranges must exactly partition
/// <see cref="SegmentId"/>'s current range, contiguously and without overlap — means
/// split. <see cref="ExpectedVersion"/> is the optimistic-concurrency token last
/// observed by the caller for this segment.
/// </summary>
public sealed record AssignmentSupersession(
    Guid SegmentId,
    uint ExpectedVersion,
    IReadOnlyList<AssignmentDestination> Replacements);

/// <summary>
/// Supersedes one or more existing Effective assignment segments atomically in one
/// transaction, evaluating the combined final-state attribution once — this is also
/// how an atomic batch move/swap between two units' rooms is expressed (two
/// supersessions in one command), so the final state is never validated as two
/// independent sequential moves.
/// </summary>
public sealed record SupersedeAssignmentsCommand(
    Guid PropertyId,
    IReadOnlyList<AssignmentSupersession> Supersessions,
    string ActorReference,
    string? AuthorizationEvidence,
    string? Reason);

public interface IAssignmentMutationStore
{
    Task<SegmentMutationResult> CreateAsync(
        CreateAssignmentCommand command,
        CancellationToken cancellationToken);

    Task<SegmentMutationResult> SupersedeAsync(
        SupersedeAssignmentsCommand command,
        CancellationToken cancellationToken);
}
