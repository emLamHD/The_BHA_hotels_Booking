namespace TheBha.Application.Scheduling;

/// <summary>
/// Projection of one <c>RoomOccupancySegment</c> row. <see cref="Version"/> is the
/// PostgreSQL <c>xmin</c>-derived optimistic-concurrency token — callers that intend
/// to supersede this segment later must echo it back exactly as
/// <c>AssignmentSupersession.ExpectedVersion</c>/<c>BlockSegmentSupersession.ExpectedVersion</c>.
/// </summary>
public sealed record RoomOccupancySegmentDto(
    Guid Id,
    Guid PropertyId,
    Guid PhysicalRoomId,
    string Type,
    string Status,
    DateOnly StartDate,
    DateOnly EndDate,
    Guid? ReservationUnitId,
    Guid? RoomBlockId,
    uint Version);

public enum SegmentMutationStatus
{
    Succeeded,
    NotFound,
    Conflict,
    Invalid,
    Unauthorized
}

/// <summary>
/// The result of any internal segment-mutation command (assignment create/supersede,
/// block segment supersede). Never carries a raw PostgreSQL error, constraint name,
/// or stack trace — <see cref="Error"/> is always a safe, specific application
/// message (PMS-BE-001.2 §9).
/// </summary>
public sealed record SegmentMutationResult(
    SegmentMutationStatus Status,
    IReadOnlyList<RoomOccupancySegmentDto>? Segments,
    string? Error)
{
    public static SegmentMutationResult Succeeded(IReadOnlyList<RoomOccupancySegmentDto> segments) =>
        new(SegmentMutationStatus.Succeeded, segments, null);

    public static SegmentMutationResult NotFound(string error) =>
        new(SegmentMutationStatus.NotFound, null, error);

    public static SegmentMutationResult Conflict(string error) =>
        new(SegmentMutationStatus.Conflict, null, error);

    public static SegmentMutationResult Invalid(string error) =>
        new(SegmentMutationStatus.Invalid, null, error);

    public static SegmentMutationResult Unauthorized(string error) =>
        new(SegmentMutationStatus.Unauthorized, null, error);
}
