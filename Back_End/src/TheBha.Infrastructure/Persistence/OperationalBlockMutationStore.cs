using Microsoft.EntityFrameworkCore;
using TheBha.Application.Scheduling;
using TheBha.Domain.Common;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// Internal application/persistence boundary for RoomBlock/OperationalBlock segment
/// mutation (PMS-BE-001.2 Phase 4 §4/§8). The only HTTP surface is two local
/// Development-only single-segment adapters in AdminOperationalBlocksController:
/// create over <c>CreateBlockAsync</c> (PMS-CAL-001.3-CP01) and cancel over a
/// zero-replacement <c>SupersedeSegmentsAsync</c> (PMS-CAL-001.3-CP02). Multi-segment
/// create, block split and multi-segment supersede remain internal-only.
///
/// <para>
/// PMS-CAL-003-CP01 adds a third narrow adapter, <c>MoveAsync</c>: it reads the source's own
/// room and range, then delegates one single-replacement supersession to the unchanged
/// <c>SupersedeSegmentsAsync</c>, which still owns the transaction, version check, locks,
/// capacity, overlap and audit. No engine body was edited.
/// </para>
/// </summary>
internal sealed class OperationalBlockMutationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider) : IOperationalBlockMutationStore
{
    private static readonly IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int> EmptyDeltas =
        new Dictionary<(Guid, DateOnly), int>();

    public async Task<CreateRoomBlockResult> CreateBlockAsync(
        CreateRoomBlockCommand command,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.ActorReference))
        {
            return CreateRoomBlockResult.Invalid("actorReference is required.");
        }

        if (string.IsNullOrWhiteSpace(command.Reason))
        {
            return CreateRoomBlockResult.Invalid("reason is required.");
        }

        if (command.Segments.Count == 0)
        {
            return CreateRoomBlockResult.Invalid("At least one segment is required.");
        }

        if (command.Segments.Any(s => s.StartDate >= s.EndDate))
        {
            return CreateRoomBlockResult.Invalid("startDate must be earlier than endDate.");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var physicalRoomIds = command.Segments.Select(s => s.PhysicalRoomId).Distinct().ToArray();
        var roomsById = await dbContext.PhysicalRooms
            .AsNoTracking()
            .Where(r => r.PropertyId == command.PropertyId && physicalRoomIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, cancellationToken);
        if (roomsById.Count != physicalRoomIds.Length)
        {
            await transaction.RollbackAsync(cancellationToken);
            return CreateRoomBlockResult.NotFound(
                "One or more requested PhysicalRooms do not exist in this Property.");
        }

        if (roomsById.Values.Any(room => room.OperationalStatus != OperationalStatus.Active))
        {
            await transaction.RollbackAsync(cancellationToken);
            return CreateRoomBlockResult.Conflict("One or more requested PhysicalRooms are not Active.");
        }

        var lockPlanBuilder = new LockPlanBuilder();
        foreach (var roomTypeId in roomsById.Values.Select(r => r.RoomTypeId).Distinct())
        {
            lockPlanBuilder.WithRoomTypeScope(command.PropertyId, roomTypeId);
        }

        foreach (var segment in command.Segments)
        {
            var roomTypeId = roomsById[segment.PhysicalRoomId].RoomTypeId;
            lockPlanBuilder.WithInventory(
                command.PropertyId,
                roomTypeId,
                DatesInRange(segment.StartDate, segment.EndDate));
        }

        await AdvisoryLockCoordinator.AcquireAsync(dbContext, lockPlanBuilder.Build(), cancellationToken);

        var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
        var blockedRoomDeltas = ComputeBlockedRoomDeltas(command.Segments, roomsById);
        var capacityError = await RoomOccupancySegmentMutationSupport.ValidateFinalCapacityAsync(
            dbContext,
            command.PropertyId,
            EmptyDeltas,
            blockedRoomDeltas,
            utcNow,
            cancellationToken);
        if (capacityError is not null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return CreateRoomBlockResult.Conflict(capacityError);
        }

        var mutationGroupId = Guid.NewGuid();
        RoomBlock block;
        var createdSegments = new List<RoomOccupancySegment>();
        try
        {
            block = new RoomBlock(Guid.NewGuid(), command.PropertyId, command.Reason, command.ActorReference, utcNow);
            dbContext.RoomBlocks.Add(block);

            foreach (var segmentSpec in command.Segments)
            {
                var segment = new RoomOccupancySegment(
                    Guid.NewGuid(),
                    command.PropertyId,
                    segmentSpec.PhysicalRoomId,
                    RoomOccupancySegmentType.OperationalBlock,
                    segmentSpec.StartDate,
                    segmentSpec.EndDate,
                    null,
                    block.Id,
                    utcNow);
                dbContext.RoomOccupancySegments.Add(segment);
                dbContext.RoomOccupancySegmentAudits.Add(new RoomOccupancySegmentAudit(
                    Guid.NewGuid(),
                    command.PropertyId,
                    segment.Id,
                    mutationGroupId,
                    RoomOccupancySegmentAuditEventType.Created,
                    command.ActorReference,
                    null,
                    command.Reason,
                    utcNow));
                createdSegments.Add(segment);
            }
        }
        catch (DomainException exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            return CreateRoomBlockResult.Invalid(exception.Message);
        }

        var conflictResult = await RoomOccupancySegmentMutationSupport.TryCommitAsync(async () =>
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
        if (conflictResult is not null)
        {
            return CreateRoomBlockResult.Conflict(conflictResult.Error!);
        }

        return CreateRoomBlockResult.Succeeded(
            new RoomBlockDto(block.Id, block.PropertyId, block.Reason, block.CreatedByActorReference, block.CreatedAtUtc),
            createdSegments.Select(segment => RoomOccupancySegmentMutationSupport.ToDto(dbContext, segment)).ToList());
    }

    public async Task<SegmentMutationResult> SupersedeSegmentsAsync(
        SupersedeBlockSegmentsCommand command,
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
        var segmentsById = await dbContext.RoomOccupancySegments
            .Where(s =>
                s.PropertyId == command.PropertyId &&
                segmentIds.Contains(s.Id) &&
                s.Type == RoomOccupancySegmentType.OperationalBlock)
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
                return SegmentMutationResult.Conflict("One or more requested segments are no longer Effective.");
            }

            if (RoomOccupancySegmentMutationSupport.GetVersion(dbContext, segment) != supersession.ExpectedVersion)
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.Conflict(
                    "The schedule changed since it was last read. Reload and retry.");
            }
        }

        var physicalRoomIds = segmentsById.Values.Select(s => s.PhysicalRoomId)
            .Concat(command.Supersessions.SelectMany(s => s.Replacements.Select(r => r.PhysicalRoomId)))
            .Distinct()
            .ToArray();
        var roomsById = await dbContext.PhysicalRooms
            .AsNoTracking()
            .Where(r => r.PropertyId == command.PropertyId && physicalRoomIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, cancellationToken);

        var newSegmentSpecs = new List<(Guid PhysicalRoomId, DateOnly StartDate, DateOnly EndDate, Guid RoomBlockId)>();
        var removedRoomDates = new List<(Guid RoomId, DateOnly Date)>();
        var addedRoomDates = new List<(Guid RoomId, DateOnly Date)>();

        foreach (var supersession in command.Supersessions)
        {
            var segment = segmentsById[supersession.SegmentId];
            if (!roomsById.TryGetValue(segment.PhysicalRoomId, out var oldRoom))
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.NotFound("The segment's current PhysicalRoom no longer exists.");
            }

            foreach (var date in DatesInRange(segment.StartDate, segment.EndDate))
            {
                removedRoomDates.Add((oldRoom.Id, date));
            }

            if (supersession.Replacements.Count == 0)
            {
                continue;
            }

            var ranges = supersession.Replacements.Select(r => (r.StartDate, r.EndDate)).ToList();
            if (!RoomOccupancySegmentMutationSupport.ExactlyPartitions(ranges, segment.StartDate, segment.EndDate))
            {
                await transaction.RollbackAsync(cancellationToken);
                return SegmentMutationResult.Invalid(
                    "Replacement date ranges must exactly and contiguously cover the superseded segment's range, or be empty to cancel.");
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

                foreach (var date in DatesInRange(replacement.StartDate, replacement.EndDate))
                {
                    addedRoomDates.Add((newRoom.Id, date));
                }

                newSegmentSpecs.Add((replacement.PhysicalRoomId, replacement.StartDate, replacement.EndDate, segment.RoomBlockId!.Value));
            }
        }

        var affectedRoomTypeIds = roomsById.Values.Select(r => r.RoomTypeId).Distinct();
        var affectedDates = removedRoomDates.Select(r => r.Date).Concat(addedRoomDates.Select(a => a.Date)).Distinct().ToArray();
        var lockPlanBuilder = new LockPlanBuilder();
        foreach (var roomTypeId in affectedRoomTypeIds)
        {
            lockPlanBuilder.WithRoomTypeScope(command.PropertyId, roomTypeId);
            lockPlanBuilder.WithInventory(command.PropertyId, roomTypeId, affectedDates);
        }

        await AdvisoryLockCoordinator.AcquireAsync(dbContext, lockPlanBuilder.Build(), cancellationToken);

        var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
        var blockedRoomDeltas = ComputeBlockedRoomDeltas(removedRoomDates, addedRoomDates, roomsById);
        var capacityError = await RoomOccupancySegmentMutationSupport.ValidateFinalCapacityAsync(
            dbContext,
            command.PropertyId,
            EmptyDeltas,
            blockedRoomDeltas,
            utcNow,
            cancellationToken);
        if (capacityError is not null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return SegmentMutationResult.Conflict(capacityError);
        }

        var mutationGroupId = Guid.NewGuid();
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
                    null,
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
                    RoomOccupancySegmentType.OperationalBlock,
                    spec.StartDate,
                    spec.EndDate,
                    null,
                    spec.RoomBlockId,
                    utcNow);
                dbContext.RoomOccupancySegments.Add(newSegment);
                dbContext.RoomOccupancySegmentAudits.Add(new RoomOccupancySegmentAudit(
                    Guid.NewGuid(),
                    command.PropertyId,
                    newSegment.Id,
                    mutationGroupId,
                    RoomOccupancySegmentAuditEventType.Created,
                    command.ActorReference,
                    null,
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

    /// <summary>
    /// PMS-CAL-003-CP01: the longest range <see cref="MoveAsync"/> will hand to the supersession
    /// engine, in nights. The same resource bound as the HTTP block-create budget: the engine
    /// materializes every night of the range and takes one advisory lock per night, so the span
    /// of a move must not be caller-controlled load. Existing longer segments (internal create
    /// has no such bound) can still be cancelled or superseded through the unchanged engine;
    /// they just cannot be moved through this narrow adapter.
    /// </summary>
    private const int MaximumMoveNights = 366;

    public async Task<SegmentMutationResult> MoveAsync(
        MoveOperationalBlockCommand command,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.ActorReference))
        {
            return SegmentMutationResult.Invalid("actorReference is required.");
        }

        // Refused before any read or lock: the audit rows would reject it after the engine had
        // already taken its locks, and the limit is the Domain's own constant.
        if (command.Reason?.Trim().Length > SchedulingFieldLimits.Reason)
        {
            return SegmentMutationResult.Invalid(
                $"reason must be at most {SchedulingFieldLimits.Reason} characters.");
        }

        // PMS-CAL-003-CP01. This read only learns the source's own room and nights so the one
        // replacement can be composed; it decides nothing about versions or availability. A
        // segment's room and dates never change (only its status and version do), and
        // SupersedeSegmentsAsync re-reads status, version, destination, capacity and overlap
        // under its locks, so a source cancelled or re-versioned in between is the same
        // Conflict as for any other superseding command.
        var source = await dbContext.RoomOccupancySegments
            .AsNoTracking()
            .Where(s =>
                s.Id == command.SegmentId &&
                s.PropertyId == command.PropertyId &&
                s.Type == RoomOccupancySegmentType.OperationalBlock)
            .Select(s => new { s.PhysicalRoomId, s.StartDate, s.EndDate })
            .SingleOrDefaultAsync(cancellationToken);
        if (source is null)
        {
            return SegmentMutationResult.NotFound("The requested operational block segment does not exist in this Property.");
        }

        if (command.DestinationPhysicalRoomId == source.PhysicalRoomId)
        {
            return SegmentMutationResult.Invalid("The destination PhysicalRoom must differ from the block's current room.");
        }

        // Bounded before the engine enumerates a single night. DayNumber is an int, so this
        // difference cannot overflow even for DateOnly.MinValue … DateOnly.MaxValue.
        if (source.EndDate.DayNumber - source.StartDate.DayNumber > MaximumMoveNights)
        {
            return SegmentMutationResult.Invalid(
                $"A block longer than {MaximumMoveNights} nights cannot be moved in one request.");
        }

        return await SupersedeSegmentsAsync(
            new SupersedeBlockSegmentsCommand(
                command.PropertyId,
                [
                    new BlockSegmentSupersession(
                        command.SegmentId,
                        command.ExpectedVersion,
                        [new BlockSegmentSpec(command.DestinationPhysicalRoomId, source.StartDate, source.EndDate)])
                ],
                command.ActorReference,
                command.Reason),
            cancellationToken);
    }

    private static Dictionary<(Guid RoomTypeId, DateOnly StayDate), int> ComputeBlockedRoomDeltas(
        IReadOnlyList<BlockSegmentSpec> newSegments,
        IReadOnlyDictionary<Guid, PhysicalRoom> roomsById)
    {
        var roomsByKey = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), HashSet<Guid>>();
        foreach (var segmentSpec in newSegments)
        {
            var room = roomsById[segmentSpec.PhysicalRoomId];
            foreach (var date in DatesInRange(segmentSpec.StartDate, segmentSpec.EndDate))
            {
                var key = (room.RoomTypeId, date);
                if (!roomsByKey.TryGetValue(key, out var set))
                {
                    set = [];
                    roomsByKey[key] = set;
                }

                set.Add(room.Id);
            }
        }

        return roomsByKey.ToDictionary(entry => entry.Key, entry => entry.Value.Count);
    }

    private static Dictionary<(Guid RoomTypeId, DateOnly StayDate), int> ComputeBlockedRoomDeltas(
        IReadOnlyList<(Guid RoomId, DateOnly Date)> removed,
        IReadOnlyList<(Guid RoomId, DateOnly Date)> added,
        IReadOnlyDictionary<Guid, PhysicalRoom> roomsById)
    {
        var removedByKey = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), HashSet<Guid>>();
        foreach (var (roomId, date) in removed)
        {
            var key = (roomsById[roomId].RoomTypeId, date);
            if (!removedByKey.TryGetValue(key, out var set))
            {
                set = [];
                removedByKey[key] = set;
            }

            set.Add(roomId);
        }

        var addedByKey = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), HashSet<Guid>>();
        foreach (var (roomId, date) in added)
        {
            var key = (roomsById[roomId].RoomTypeId, date);
            if (!addedByKey.TryGetValue(key, out var set))
            {
                set = [];
                addedByKey[key] = set;
            }

            set.Add(roomId);
        }

        var keys = removedByKey.Keys.Concat(addedByKey.Keys).Distinct();
        var deltas = new Dictionary<(Guid RoomTypeId, DateOnly StayDate), int>();
        foreach (var key in keys)
        {
            var removedCount = removedByKey.TryGetValue(key, out var removedSet) ? removedSet.Count : 0;
            var addedCount = addedByKey.TryGetValue(key, out var addedSet) ? addedSet.Count : 0;
            deltas[key] = addedCount - removedCount;
        }

        return deltas;
    }

    private static DateOnly[] DatesInRange(DateOnly start, DateOnly endExclusive) =>
        Enumerable.Range(0, endExclusive.DayNumber - start.DayNumber)
            .Select(start.AddDays)
            .ToArray();
}
