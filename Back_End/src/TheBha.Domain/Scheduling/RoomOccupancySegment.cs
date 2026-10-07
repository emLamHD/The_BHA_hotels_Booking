using TheBha.Domain.Common;

namespace TheBha.Domain.Scheduling;

/// <summary>
/// The authoritative PhysicalRoom schedule row (ADR 0006 Decision item 1) — no
/// separate <c>RoomAssignments</c> dual-write model exists alongside it. A
/// segment's <see cref="StartDate"/>/<see cref="EndDate"/>/<see cref="PhysicalRoomId"/>/
/// <see cref="Type"/>/reference fields never change after creation: a split or
/// move never overwrites a segment's date range in place — it cancels this row
/// and creates new successor rows instead (ADR 0006 Decision item 5). The only
/// field this type ever mutates is <see cref="Status"/>, exactly once, from
/// <see cref="RoomOccupancySegmentStatus.Effective"/> to
/// <see cref="RoomOccupancySegmentStatus.Cancelled"/>.
/// </summary>
public sealed class RoomOccupancySegment
{
    private RoomOccupancySegment()
    {
    }

    public RoomOccupancySegment(
        Guid id,
        Guid propertyId,
        Guid physicalRoomId,
        RoomOccupancySegmentType type,
        DateOnly startDate,
        DateOnly endDate,
        Guid? reservationUnitId,
        Guid? roomBlockId,
        DateTimeOffset createdAtUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        PhysicalRoomId = DomainGuard.RequiredId(physicalRoomId, nameof(physicalRoomId));
        SchedulingGuard.ValidateHalfOpenRange(startDate, endDate);
        SchedulingGuard.ValidateTypeReferenceConsistency(type, reservationUnitId, roomBlockId);

        Type = type;
        StartDate = startDate;
        EndDate = endDate;
        ReservationUnitId = reservationUnitId;
        RoomBlockId = roomBlockId;
        Status = RoomOccupancySegmentStatus.Effective;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid PhysicalRoomId { get; private set; }
    public RoomOccupancySegmentType Type { get; private set; }
    public RoomOccupancySegmentStatus Status { get; private set; }
    public DateOnly StartDate { get; private set; }
    public DateOnly EndDate { get; private set; }
    public Guid? ReservationUnitId { get; private set; }
    public Guid? RoomBlockId { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }

    /// <summary>Half-open <c>[StartDate, EndDate)</c> coverage of <paramref name="date"/>.</summary>
    public bool Covers(DateOnly date) => date >= StartDate && date < EndDate;

    /// <summary>
    /// Transitions this segment from <see cref="RoomOccupancySegmentStatus.Effective"/> to
    /// <see cref="RoomOccupancySegmentStatus.Cancelled"/>. Already-<see cref="RoomOccupancySegmentStatus.Cancelled"/>
    /// is an idempotent no-op. Never reactivated in place — a later re-assignment of the
    /// same room/dates is always a new segment row (ADR 0006 Decision item 5).
    /// </summary>
    public void Cancel()
    {
        if (Status == RoomOccupancySegmentStatus.Cancelled)
        {
            return;
        }

        Status = RoomOccupancySegmentStatus.Cancelled;
    }
}
