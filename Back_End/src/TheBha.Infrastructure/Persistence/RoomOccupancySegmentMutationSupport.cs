using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Properties;
using TheBha.Application.Scheduling;
using TheBha.Domain.Properties;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// Shared mechanics for every RoomOccupancySegment mutation store (PMS-BE-001.2
/// Phase 4): reading/setting the xmin optimistic-concurrency token, mapping to the
/// public DTO shape, validating that a set of replacement date ranges exactly
/// partitions a superseded segment's range, and translating PostgreSQL errors
/// (deferred exclusion/constraint-trigger violations included) into safe, specific
/// application conflicts — a raw database error, constraint name, or stack trace
/// never reaches a caller.
/// </summary>
internal static class RoomOccupancySegmentMutationSupport
{
    private const string EffectiveRoomOverlapConstraint = "EX_RoomOccupancySegments_EffectiveRoomOverlap";
    private const string EffectiveUnitOverlapConstraint = "EX_RoomOccupancySegments_EffectiveUnitOverlap";
    private const string BookedNightCoverageSqlState = "XBHA1";
    private const string UnitCommitmentConsistencySqlState = "XBHA2";

    public static uint GetVersion(TheBhaDbContext dbContext, RoomOccupancySegment segment) =>
        dbContext.Entry(segment).Property<uint>("xmin").CurrentValue;

    public static RoomOccupancySegmentDto ToDto(TheBhaDbContext dbContext, RoomOccupancySegment segment) =>
        new(
            segment.Id,
            segment.PropertyId,
            segment.PhysicalRoomId,
            segment.Type.ToString(),
            segment.Status.ToString(),
            segment.StartDate,
            segment.EndDate,
            segment.ReservationUnitId,
            segment.RoomBlockId,
            GetVersion(dbContext, segment));

    /// <summary>
    /// True when the half-open ranges in <paramref name="replacements"/>, sorted by
    /// start date, together cover exactly <paramref name="originalStart"/>..
    /// <paramref name="originalEnd"/> with no gap and no overlap. An empty
    /// <paramref name="replacements"/> list is never valid here — callers treat that
    /// case (unassign) separately before calling this.
    /// </summary>
    public static bool ExactlyPartitions(
        IReadOnlyList<(DateOnly Start, DateOnly End)> replacements,
        DateOnly originalStart,
        DateOnly originalEnd)
    {
        if (replacements.Count == 0)
        {
            return false;
        }

        var ordered = replacements.OrderBy(range => range.Start).ToArray();
        var cursor = originalStart;
        foreach (var (start, end) in ordered)
        {
            if (start >= end || start != cursor)
            {
                return false;
            }

            cursor = end;
        }

        return cursor == originalEnd;
    }

    /// <summary>
    /// Runs <paramref name="commitAsync"/> (the transaction's final SaveChanges +
    /// Commit) and translates every PostgreSQL error it can raise — whether
    /// surfaced immediately (wrapped in <see cref="DbUpdateException"/>) or only at
    /// COMMIT for a deferred exclusion/constraint-trigger violation (a raw
    /// <see cref="PostgresException"/>, per the Phase 3 finding) — into a safe,
    /// specific conflict message. Rethrows anything unrecognized rather than
    /// swallowing an unexpected failure mode.
    /// </summary>
    public static async Task<SegmentMutationResult?> TryCommitAsync(Func<Task> commitAsync)
    {
        try
        {
            await commitAsync();
            return null;
        }
        catch (PostgresException exception) when (IsRecognized(exception))
        {
            return SegmentMutationResult.Conflict(Describe(exception));
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException inner && IsRecognized(inner))
        {
            return SegmentMutationResult.Conflict(Describe(inner));
        }
        catch (DbUpdateConcurrencyException)
        {
            return SegmentMutationResult.Conflict(
                "The schedule changed since it was last read. Reload and retry.");
        }
    }

    /// <summary>
    /// Validates the final post-operation state for every affected (RoomType,
    /// StayDate) bucket in one pass — never a transient intermediate state, and
    /// never validated per-bucket sequentially where a combined final state is what
    /// actually matters (PMS-BE-001.2 §7). <paramref name="demandDeltas"/> models a
    /// reservation-assignment mutation's nightly attribution change (positive =
    /// added demand); <paramref name="blockedRoomDeltas"/> models an
    /// OperationalBlock mutation's usable-capacity change (positive = capacity
    /// removed). A capacity/demand-mutating store only ever supplies one of the two
    /// non-empty; both default to no change. Returns a safe error message for the
    /// first violated bucket, or <c>null</c> when every affected bucket's final
    /// demand stays within its final usable physical capacity.
    /// </summary>
    public static async Task<string?> ValidateFinalCapacityAsync(
        TheBhaDbContext dbContext,
        Guid propertyId,
        IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int> demandDeltas,
        IReadOnlyDictionary<(Guid RoomTypeId, DateOnly StayDate), int> blockedRoomDeltas,
        CancellationToken cancellationToken)
    {
        var keys = demandDeltas.Keys.Concat(blockedRoomDeltas.Keys).Distinct().ToArray();
        if (keys.Length == 0)
        {
            return null;
        }

        var dates = keys.Select(key => key.StayDate).Distinct().ToArray();
        var minDate = dates.Min();
        var maxDateExclusive = dates.Max().AddDays(1);
        var roomTypeIds = keys.Select(key => key.RoomTypeId).Distinct().ToArray();

        var activeRoomCounts = await dbContext.PhysicalRooms
            .AsNoTracking()
            .Where(room =>
                room.PropertyId == propertyId &&
                roomTypeIds.Contains(room.RoomTypeId) &&
                room.OperationalStatus == OperationalStatus.Active)
            .GroupBy(room => room.RoomTypeId)
            .Select(group => new { RoomTypeId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(group => group.RoomTypeId, group => group.Count, cancellationToken);
        var blockedRoomCounts = await PhysicalCapacityDataLoader.LoadBlockedRoomCountsAsync(
            dbContext, propertyId, minDate, maxDateExclusive, cancellationToken);
        var demand = await PhysicalCapacityDataLoader.LoadAttributedReservationDemandAsync(
            dbContext, propertyId, minDate, maxDateExclusive, cancellationToken);

        foreach (var key in keys)
        {
            var finalBlockedRooms = blockedRoomCounts.GetValueOrDefault(key) + blockedRoomDeltas.GetValueOrDefault(key);
            var usablePhysicalCapacity = PhysicalCapacityFormula.UsablePhysicalCapacity(
                activeRoomCounts.GetValueOrDefault(key.RoomTypeId),
                finalBlockedRooms);
            var finalDemand = demand.GetValueOrDefault(key) + demandDeltas.GetValueOrDefault(key);
            if (finalDemand > usablePhysicalCapacity)
            {
                return $"Insufficient usable physical capacity for {key.StayDate:yyyy-MM-dd}.";
            }
        }

        return null;
    }

    private static bool IsRecognized(PostgresException exception) =>
        exception.SqlState switch
        {
            PostgresErrorCodes.ExclusionViolation => exception.ConstraintName
                is EffectiveRoomOverlapConstraint or EffectiveUnitOverlapConstraint,
            BookedNightCoverageSqlState => true,
            UnitCommitmentConsistencySqlState => true,
            PostgresErrorCodes.ForeignKeyViolation => true,
            _ => false
        };

    private static string Describe(PostgresException exception) =>
        exception.SqlState switch
        {
            PostgresErrorCodes.ExclusionViolation when exception.ConstraintName == EffectiveRoomOverlapConstraint =>
                "The destination PhysicalRoom already has an overlapping Effective schedule entry for one or more of these dates.",
            PostgresErrorCodes.ExclusionViolation when exception.ConstraintName == EffectiveUnitOverlapConstraint =>
                "This ReservationUnit already has an overlapping Effective assignment for one or more of these dates.",
            BookedNightCoverageSqlState =>
                "The requested dates are not fully covered by the ReservationUnit's booked nights.",
            UnitCommitmentConsistencySqlState =>
                "The referenced ReservationUnit or Reservation is not in a state that allows this assignment.",
            PostgresErrorCodes.ForeignKeyViolation =>
                "One or more referenced records do not exist in the same Property.",
            _ => "The mutation could not be completed due to a database conflict."
        };
}
