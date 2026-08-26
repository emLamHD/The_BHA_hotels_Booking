using Microsoft.EntityFrameworkCore;
using TheBha.Application.Scheduling;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// Internal application/persistence boundary for ReservationAssignment segment
/// mutation (PMS-BE-001.2 Phase 4 §4/§6/§7). No HTTP/controller surface exists or is
/// added for this store — Admin authentication/RBAC do not exist yet (§5).
/// </summary>
internal sealed class AssignmentMutationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider) : IAssignmentMutationStore
{
    public async Task<SegmentMutationResult> CreateAsync(
        CreateAssignmentCommand command,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.ActorReference))
        {
            return SegmentMutationResult.Invalid("actorReference is required.");
        }

        if (command.Destination.StartDate >= command.Destination.EndDate)
        {
            return SegmentMutationResult.Invalid("startDate must be earlier than endDate.");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Lock class 2 before any discovery read that depends on this unit's state.
        await AdvisoryLockCoordinator.AcquireAsync(
            dbContext,
            new LockPlanBuilder().WithReservationUnit(command.ReservationUnitId).Build(),
            cancellationToken);

        var unit = await dbContext.ReservationUnits
            .Include(u => u.Nights)
            .SingleOrDefaultAsync(
                u => u.Id == command.ReservationUnitId && u.PropertyId == command.PropertyId,
                cancellationToken);
        if (unit is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.NotFound("The requested ReservationUnit does not exist in this Property.");
        }

        if (unit.CommitmentStatus != CommitmentStatus.Committed)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Conflict("Only a Committed ReservationUnit can receive an assignment.");
        }

        var room = await dbContext.PhysicalRooms
            .AsNoTracking()
            .SingleOrDefaultAsync(
                r => r.Id == command.Destination.PhysicalRoomId && r.PropertyId == command.PropertyId,
                cancellationToken);
        if (room is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.NotFound("The requested PhysicalRoom does not exist in this Property.");
        }

        if (room.OperationalStatus != OperationalStatus.Active)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Conflict("The destination PhysicalRoom is not Active.");
        }

        var destinationDates = DatesInRange(command.Destination.StartDate, command.Destination.EndDate);
        var bookedDates = unit.Nights.Select(n => n.StayDate).ToHashSet();
        if (destinationDates.Any(date => !bookedDates.Contains(date)))
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Conflict(
                "The requested dates are not fully covered by the ReservationUnit's booked nights.");
        }

        var isCrossType = room.RoomTypeId != unit.RoomTypeId;
        if (isCrossType &&
            (string.IsNullOrWhiteSpace(command.AuthorizationEvidence) || string.IsNullOrWhiteSpace(command.Reason)))
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Unauthorized(
                "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.");
        }

        var lockPlanBuilder = new LockPlanBuilder()
            .WithRoomTypeScope(command.PropertyId, unit.RoomTypeId)
            .WithRoomTypeScope(command.PropertyId, room.RoomTypeId)
            .WithInventory(command.PropertyId, room.RoomTypeId, destinationDates);
        await AdvisoryLockCoordinator.AcquireAsync(dbContext, lockPlanBuilder.Build(), cancellationToken);

        // Same-RoomType creation moves no demand between buckets (the night was
        // already counted under the sold type before this assignment existed) — only
        // a cross-RoomType creation needs a final-state capacity check.
        if (isCrossType)
        {
            var demandDeltas = destinationDates.ToDictionary(date => (room.RoomTypeId, date), _ => 1);
            var capacityError = await RoomOccupancySegmentMutationSupport.ValidateFinalCapacityAsync(
                dbContext,
                command.PropertyId,
                demandDeltas,
                EmptyDeltas,
                cancellationToken);
            if (capacityError is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.Conflict(capacityError);
            }
        }

        var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
        RoomOccupancySegment segment;
        try
        {
            segment = new RoomOccupancySegment(
                Guid.NewGuid(),
                command.PropertyId,
                room.Id,
                RoomOccupancySegmentType.ReservationAssignment,
                command.Destination.StartDate,
                command.Destination.EndDate,
                unit.Id,
                null,
                utcNow);
            dbContext.RoomOccupancySegmentAudits.Add(new RoomOccupancySegmentAudit(
                Guid.NewGuid(),
                command.PropertyId,
                segment.Id,
                Guid.NewGuid(),
                RoomOccupancySegmentAuditEventType.Created,
                command.ActorReference,
                command.AuthorizationEvidence,
                command.Reason,
                utcNow));
        }
        catch (DomainException exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Invalid(exception.Message);
        }

        dbContext.RoomOccupancySegments.Add(segment);

        var conflict = await RoomOccupancySegmentMutationSupport.TryCommitAsync(async () =>
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
        if (conflict is not null)
        {
            return conflict;
        }

        return SegmentMutationResult.Succeeded([RoomOccupancySegmentMutationSupport.ToDto(dbContext, segment)]);
    }

    public async Task<SegmentMutationResult> SupersedeAsync(
        SupersedeAssignmentsCommand command,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.ActorReference))
        {
            return SegmentMutationResult.Invalid("actorReference is required.");
        }

        if (command.Supersessions.Count == 0)
        {
            return SegmentMutationResult.Invalid("At least one supersession is required.");
        }

        foreach (var supersession in command.Supersessions)
        {
            if (supersession.Replacements.Any(r => r.StartDate >= r.EndDate))
            {
                return SegmentMutationResult.Invalid("startDate must be earlier than endDate.");
            }
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var segmentIds = command.Supersessions.Select(s => s.SegmentId).ToArray();

        // Pre-lock discovery read (never trusted for the actual mutation decision):
        // only used to find which ReservationUnits to lock before anything about
        // these segments is treated as authoritative.
        var candidateUnitIds = await dbContext.RoomOccupancySegments
            .AsNoTracking()
            .Where(s =>
                s.PropertyId == command.PropertyId &&
                segmentIds.Contains(s.Id) &&
                s.Type == RoomOccupancySegmentType.ReservationAssignment &&
                s.ReservationUnitId != null)
            .Select(s => s.ReservationUnitId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);
        if (candidateUnitIds.Count == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.NotFound("None of the requested segments exist in this Property.");
        }

        await AdvisoryLockCoordinator.AcquireAsync(
            dbContext,
            new LockPlanBuilder().WithReservationUnits(candidateUnitIds).Build(),
            cancellationToken);

        // Authoritative re-read of the segments under lock.
        var segmentsById = await dbContext.RoomOccupancySegments
            .Where(s =>
                s.PropertyId == command.PropertyId &&
                segmentIds.Contains(s.Id) &&
                s.Type == RoomOccupancySegmentType.ReservationAssignment)
            .ToDictionaryAsync(s => s.Id, cancellationToken);
        if (segmentsById.Count != segmentIds.Length)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.NotFound("One or more requested segments do not exist in this Property.");
        }

        foreach (var supersession in command.Supersessions)
        {
            var segment = segmentsById[supersession.SegmentId];
            if (segment.Status != RoomOccupancySegmentStatus.Effective)
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.Conflict(
                    "One or more requested segments are no longer Effective.");
            }

            if (RoomOccupancySegmentMutationSupport.GetVersion(dbContext, segment) != supersession.ExpectedVersion)
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.Conflict(
                    "The schedule changed since it was last read. Reload and retry.");
            }
        }

        var unitIds = segmentsById.Values.Select(s => s.ReservationUnitId!.Value).Distinct().ToArray();
        var unitsById = await dbContext.ReservationUnits
            .Include(u => u.Nights)
            .Where(u => unitIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        var physicalRoomIds = segmentsById.Values.Select(s => s.PhysicalRoomId)
            .Concat(command.Supersessions.SelectMany(s => s.Replacements.Select(r => r.PhysicalRoomId)))
            .Distinct()
            .ToArray();
        var roomsById = await dbContext.PhysicalRooms
            .AsNoTracking()
            .Where(r => r.PropertyId == command.PropertyId && physicalRoomIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, cancellationToken);

        var demandDeltas = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), int>();
        var requiresCrossTypeAuthorization = false;
        var newSegmentSpecs = new List<(Guid PhysicalRoomId, DateOnly StartDate, DateOnly EndDate, Guid ReservationUnitId)>();

        foreach (var supersession in command.Supersessions)
        {
            var segment = segmentsById[supersession.SegmentId];
            var unit = unitsById[segment.ReservationUnitId!.Value];

            if (!roomsById.TryGetValue(segment.PhysicalRoomId, out var oldRoom))
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.NotFound("The segment's current PhysicalRoom no longer exists.");
            }

            foreach (var date in DatesInRange(segment.StartDate, segment.EndDate))
            {
                AddDelta(demandDeltas, (oldRoom.RoomTypeId, date), -1);
            }

            if (supersession.Replacements.Count == 0)
            {
                // Unassign: nights revert to the unit's sold RoomType.
                foreach (var date in DatesInRange(segment.StartDate, segment.EndDate))
                {
                    AddDelta(demandDeltas, (unit.RoomTypeId, date), 1);
                }

                continue;
            }

            var ranges = supersession.Replacements.Select(r => (r.StartDate, r.EndDate)).ToList();
            if (!RoomOccupancySegmentMutationSupport.ExactlyPartitions(ranges, segment.StartDate, segment.EndDate))
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.Invalid(
                    "Replacement date ranges must exactly and contiguously cover the superseded segment's range, or be empty to unassign.");
            }

            foreach (var replacement in supersession.Replacements)
            {
                if (!roomsById.TryGetValue(replacement.PhysicalRoomId, out var newRoom))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return SegmentMutationResult.NotFound(
                        "The requested destination PhysicalRoom does not exist in this Property.");
                }

                if (newRoom.OperationalStatus != OperationalStatus.Active)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return SegmentMutationResult.Conflict("The destination PhysicalRoom is not Active.");
                }

                if (newRoom.RoomTypeId != unit.RoomTypeId)
                {
                    requiresCrossTypeAuthorization = true;
                }

                foreach (var date in DatesInRange(replacement.StartDate, replacement.EndDate))
                {
                    AddDelta(demandDeltas, (newRoom.RoomTypeId, date), 1);
                }

                newSegmentSpecs.Add((replacement.PhysicalRoomId, replacement.StartDate, replacement.EndDate, unit.Id));
            }
        }

        if (requiresCrossTypeAuthorization &&
            (string.IsNullOrWhiteSpace(command.AuthorizationEvidence) || string.IsNullOrWhiteSpace(command.Reason)))
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Unauthorized(
                "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.");
        }

        var affectedRoomTypeIds = unitsById.Values.Select(u => u.RoomTypeId)
            .Concat(roomsById.Values.Select(r => r.RoomTypeId))
            .Distinct();
        var affectedDates = demandDeltas.Keys.Select(k => k.StayDate).Distinct().ToArray();
        var lockPlanBuilder = new LockPlanBuilder();
        foreach (var roomTypeId in affectedRoomTypeIds)
        {
            lockPlanBuilder.WithRoomTypeScope(command.PropertyId, roomTypeId);
            lockPlanBuilder.WithInventory(command.PropertyId, roomTypeId, affectedDates);
        }

        await AdvisoryLockCoordinator.AcquireAsync(dbContext, lockPlanBuilder.Build(), cancellationToken);

        var capacityError = await RoomOccupancySegmentMutationSupport.ValidateFinalCapacityAsync(
            dbContext,
            command.PropertyId,
            demandDeltas,
            EmptyDeltas,
            cancellationToken);
        if (capacityError is not null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Conflict(capacityError);
        }

        var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
        var mutationGroupId = Guid.NewGuid();
        // xmin is only populated after SaveChanges, so DTOs are built from these
        // tracked entities after the commit succeeds below — never before.
        var mutatedSegments = new List<RoomOccupancySegment>();

        try
        {
            foreach (var supersession in command.Supersessions)
            {
                var segment = segmentsById[supersession.SegmentId];
                segment.Cancel();
                dbContext.RoomOccupancySegmentAudits.Add(new RoomOccupancySegmentAudit(
                    Guid.NewGuid(),
                    command.PropertyId,
                    segment.Id,
                    mutationGroupId,
                    RoomOccupancySegmentAuditEventType.Cancelled,
                    command.ActorReference,
                    command.AuthorizationEvidence,
                    command.Reason,
                    utcNow));
                mutatedSegments.Add(segment);
            }

            foreach (var spec in newSegmentSpecs)
            {
                var newSegment = new RoomOccupancySegment(
                    Guid.NewGuid(),
                    command.PropertyId,
                    spec.PhysicalRoomId,
                    RoomOccupancySegmentType.ReservationAssignment,
                    spec.StartDate,
                    spec.EndDate,
                    spec.ReservationUnitId,
                    null,
                    utcNow);
                dbContext.RoomOccupancySegments.Add(newSegment);
                dbContext.RoomOccupancySegmentAudits.Add(new RoomOccupancySegmentAudit(
                    Guid.NewGuid(),
                    command.PropertyId,
                    newSegment.Id,
                    mutationGroupId,
                    RoomOccupancySegmentAuditEventType.Created,
                    command.ActorReference,
                    command.AuthorizationEvidence,
                    command.Reason,
                    utcNow));
                mutatedSegments.Add(newSegment);
            }
        }
        catch (DomainException exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Invalid(exception.Message);
        }

        var conflict = await RoomOccupancySegmentMutationSupport.TryCommitAsync(async () =>
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
        if (conflict is not null)
        {
            return conflict;
        }

        return SegmentMutationResult.Succeeded(
            mutatedSegments.Select(segment => RoomOccupancySegmentMutationSupport.ToDto(dbContext, segment)).ToList());
    }

    private static readonly IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int> EmptyDeltas =
        new Dictionary<(Guid, DateOnly), int>();

    private static void AddDelta(
        Dictionary<(Guid RoomTypeId, DateOnly StayDate), int> deltas,
        (Guid RoomTypeId, DateOnly StayDate) key,
        int amount) =>
        deltas[key] = deltas.GetValueOrDefault(key) + amount;

    private static DateOnly[] DatesInRange(DateOnly start, DateOnly endExclusive) =>
        Enumerable.Range(0, endExclusive.DayNumber - start.DayNumber)
            .Select(start.AddDays)
            .ToArray();
}
