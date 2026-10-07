namespace TheBha.Application.Scheduling;

/// <summary>One proposed Effective OperationalBlock segment's placement.</summary>
public sealed record BlockSegmentSpec(Guid PhysicalRoomId, DateOnly StartDate, DateOnly EndDate);

/// <summary>
/// Creates one new RoomBlock header together with one or more Effective
/// OperationalBlock segments, atomically, within one Property (ADR 0006 Decision
/// item 4). A single header may cover multiple PhysicalRooms and RoomTypes.
/// </summary>
public sealed record CreateRoomBlockCommand(
    Guid PropertyId,
    string Reason,
    string ActorReference,
    IReadOnlyList<BlockSegmentSpec> Segments);

/// <summary>
/// One existing Effective OperationalBlock segment to supersede. Empty
/// <see cref="Replacements"/> means cancel; one entry means move; two or more —
/// whose date ranges must exactly partition <see cref="SegmentId"/>'s current range —
/// means split. <see cref="ExpectedVersion"/> is the optimistic-concurrency token
/// last observed by the caller.
/// </summary>
public sealed record BlockSegmentSupersession(
    Guid SegmentId,
    uint ExpectedVersion,
    IReadOnlyList<BlockSegmentSpec> Replacements);

/// <summary>
/// Supersedes one or more existing Effective OperationalBlock segments atomically in
/// one transaction (split/move/cancel), preserving the RoomBlock header and audit
/// history.
/// </summary>
public sealed record SupersedeBlockSegmentsCommand(
    Guid PropertyId,
    IReadOnlyList<BlockSegmentSupersession> Supersessions,
    string ActorReference,
    string? Reason);

public sealed record RoomBlockDto(
    Guid Id,
    Guid PropertyId,
    string Reason,
    string CreatedByActorReference,
    DateTimeOffset CreatedAtUtc);

public sealed record CreateRoomBlockResult(
    SegmentMutationStatus Status,
    RoomBlockDto? Block,
    IReadOnlyList<RoomOccupancySegmentDto>? Segments,
    string? Error)
{
    public static CreateRoomBlockResult Succeeded(
        RoomBlockDto block,
        IReadOnlyList<RoomOccupancySegmentDto> segments) =>
        new(SegmentMutationStatus.Succeeded, block, segments, null);

    public static CreateRoomBlockResult NotFound(string error) =>
        new(SegmentMutationStatus.NotFound, null, null, error);

    public static CreateRoomBlockResult Conflict(string error) =>
        new(SegmentMutationStatus.Conflict, null, null, error);

    public static CreateRoomBlockResult Invalid(string error) =>
        new(SegmentMutationStatus.Invalid, null, null, error);
}

public interface IOperationalBlockMutationStore
{
    Task<CreateRoomBlockResult> CreateBlockAsync(
        CreateRoomBlockCommand command,
        CancellationToken cancellationToken);

    Task<SegmentMutationResult> SupersedeSegmentsAsync(
        SupersedeBlockSegmentsCommand command,
        CancellationToken cancellationToken);
}
