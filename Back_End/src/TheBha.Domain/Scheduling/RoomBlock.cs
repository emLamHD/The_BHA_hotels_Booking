using TheBha.Domain.Common;

namespace TheBha.Domain.Scheduling;

/// <summary>
/// One multi-room operational/maintenance event header (ADR 0006 Decision item 4).
/// Relates to one or more <see cref="RoomOccupancySegment"/> rows of type
/// <see cref="RoomOccupancySegmentType.OperationalBlock"/>, always within one
/// Property — a RoomBlock never spans Properties. Immutable after creation: a
/// block is "cancelled" by cancelling its constituent segments, not by mutating
/// this header.
/// </summary>
public sealed class RoomBlock
{
    private RoomBlock()
    {
    }

    public RoomBlock(
        Guid id,
        Guid propertyId,
        string reason,
        string createdByActorReference,
        DateTimeOffset createdAtUtc)
    {
        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        Reason = DomainGuard.Required(reason, nameof(reason), SchedulingFieldLimits.Reason);
        CreatedByActorReference = SchedulingGuard.ValidateActorReference(createdByActorReference);
        CreatedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public string CreatedByActorReference { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; private set; }
}
