namespace TheBha.Domain.Scheduling;

/// <summary>
/// The exact two <see cref="RoomOccupancySegment"/> statuses (ADR 0006 Decision item 2),
/// independent of Reservation lifecycle or check-in state. No draft value such as
/// <c>Reserved</c>, <c>InHouse</c>, <c>Blocked</c>, or <c>Held</c> exists here.
/// </summary>
public enum RoomOccupancySegmentStatus
{
    Effective,
    Cancelled
}
