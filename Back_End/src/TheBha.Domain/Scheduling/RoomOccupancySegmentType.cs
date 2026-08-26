namespace TheBha.Domain.Scheduling;

/// <summary>
/// The exact two <see cref="RoomOccupancySegment"/> types (ADR 0006 Decision item 2).
/// No other value exists.
/// </summary>
public enum RoomOccupancySegmentType
{
    ReservationAssignment,
    OperationalBlock
}
