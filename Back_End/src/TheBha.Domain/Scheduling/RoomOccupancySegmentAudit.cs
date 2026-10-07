using TheBha.Domain.Common;

namespace TheBha.Domain.Scheduling;

/// <summary>
/// One append-only audit row for one <see cref="RoomOccupancySegment"/> event
/// (ADR 0006 Decision item 5). Never updated or deleted through the normal
/// persistence model after insert — this type exposes no mutator. A segment's
/// own structural fields (PhysicalRoom, dates, type, references) never change
/// after creation, so this row does not duplicate them; it records only who
/// did what, when, and why for one <see cref="SegmentId"/> event, joined back
/// to the segment for full detail. A split/move mutation's Cancelled row for
/// the superseded segment and Created row(s) for its successors share one
/// <see cref="MutationGroupId"/>, so the whole mutation can be reconstructed
/// as one unit even though it touches multiple segment rows.
/// </summary>
public sealed class RoomOccupancySegmentAudit
{
    private RoomOccupancySegmentAudit()
    {
    }

    public RoomOccupancySegmentAudit(
        Guid id,
        Guid propertyId,
        Guid segmentId,
        Guid mutationGroupId,
        RoomOccupancySegmentAuditEventType eventType,
        string actorReference,
        string? authorizationEvidence,
        string? reason,
        DateTimeOffset occurredAtUtc)
    {
        if (!Enum.IsDefined(eventType))
        {
            throw new DomainException("eventType is invalid.");
        }

        Id = DomainGuard.RequiredId(id, nameof(id));
        PropertyId = DomainGuard.RequiredId(propertyId, nameof(propertyId));
        SegmentId = DomainGuard.RequiredId(segmentId, nameof(segmentId));
        MutationGroupId = DomainGuard.RequiredId(mutationGroupId, nameof(mutationGroupId));
        EventType = eventType;
        ActorReference = SchedulingGuard.ValidateActorReference(actorReference);
        AuthorizationEvidence = SchedulingGuard.ValidateAuthorizationEvidence(authorizationEvidence);
        Reason = SchedulingGuard.ValidateReason(reason);
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid Id { get; private set; }
    public Guid PropertyId { get; private set; }
    public Guid SegmentId { get; private set; }
    public Guid MutationGroupId { get; private set; }
    public RoomOccupancySegmentAuditEventType EventType { get; private set; }
    public string ActorReference { get; private set; } = string.Empty;
    public string? AuthorizationEvidence { get; private set; }
    public string? Reason { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }
}
