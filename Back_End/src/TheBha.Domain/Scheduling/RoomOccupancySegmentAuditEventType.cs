namespace TheBha.Domain.Scheduling;

/// <summary>
/// One append-only <see cref="RoomOccupancySegmentAudit"/> row's event kind. A
/// split/move mutation writes one <see cref="Cancelled"/> row for the superseded
/// segment and one or more <see cref="Created"/> rows for its successors, all
/// sharing one <see cref="RoomOccupancySegmentAudit.MutationGroupId"/>.
/// </summary>
public enum RoomOccupancySegmentAuditEventType
{
    Created,
    Cancelled
}
