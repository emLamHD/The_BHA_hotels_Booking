using TheBha.Domain.Common;

namespace TheBha.Domain.Scheduling;

internal static class SchedulingGuard
{
    public static void ValidateHalfOpenRange(DateOnly startDate, DateOnly endDate)
    {
        if (startDate >= endDate)
        {
            throw new DomainException("startDate must be earlier than endDate.");
        }
    }

    public static string ValidateActorReference(string actorReference) =>
        DomainGuard.Required(actorReference, nameof(actorReference), SchedulingFieldLimits.ActorReference);

    public static string? ValidateAuthorizationEvidence(string? authorizationEvidence) =>
        DomainGuard.Optional(
            authorizationEvidence,
            nameof(authorizationEvidence),
            SchedulingFieldLimits.AuthorizationEvidence);

    public static string? ValidateReason(string? reason) =>
        DomainGuard.Optional(reason, nameof(reason), SchedulingFieldLimits.Reason);

    /// <summary>
    /// Validates <see cref="RoomOccupancySegmentType"/>/reference consistency
    /// (ADR 0006 Decision item 3): a <c>ReservationAssignment</c> segment
    /// references exactly one <see cref="RoomOccupancySegment.ReservationUnitId"/>
    /// and no <see cref="RoomOccupancySegment.RoomBlockId"/>; an
    /// <c>OperationalBlock</c> segment references exactly one
    /// <see cref="RoomOccupancySegment.RoomBlockId"/> and no
    /// <see cref="RoomOccupancySegment.ReservationUnitId"/>.
    /// </summary>
    public static void ValidateTypeReferenceConsistency(
        RoomOccupancySegmentType type,
        Guid? reservationUnitId,
        Guid? roomBlockId)
    {
        if (!Enum.IsDefined(type))
        {
            throw new DomainException("type is invalid.");
        }

        switch (type)
        {
            case RoomOccupancySegmentType.ReservationAssignment:
                if (reservationUnitId is null || reservationUnitId == Guid.Empty)
                {
                    throw new DomainException(
                        "A ReservationAssignment segment requires a reservationUnitId.");
                }

                if (roomBlockId is not null)
                {
                    throw new DomainException(
                        "A ReservationAssignment segment cannot reference a roomBlockId.");
                }

                break;
            case RoomOccupancySegmentType.OperationalBlock:
                if (roomBlockId is null || roomBlockId == Guid.Empty)
                {
                    throw new DomainException(
                        "An OperationalBlock segment requires a roomBlockId.");
                }

                if (reservationUnitId is not null)
                {
                    throw new DomainException(
                        "An OperationalBlock segment cannot reference a reservationUnitId.");
                }

                break;
            default:
                throw new DomainException("type is invalid.");
        }
    }
}
