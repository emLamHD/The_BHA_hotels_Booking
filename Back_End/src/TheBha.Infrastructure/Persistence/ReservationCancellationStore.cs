using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;
using TheBha.Domain.Scheduling;

namespace TheBha.Infrastructure.Persistence;

internal sealed class ReservationCancellationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider) : IReservationCancellationStore
{
    public async Task<ReservationCancellationResult> CancelAsync(
        Guid reservationId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        string reason,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            cancellationToken);

        var sourceHoldId = await dbContext.Reservations
            .AsNoTracking()
            .Where(item => item.Id == reservationId)
            .Where(item =>
                (customerAccountId != null && item.CustomerAccountId == customerAccountId) ||
                (guestAccessTokenHash != null &&
                 item.GuestAccessTokenHash == guestAccessTokenHash))
            .Select(item => (Guid?)item.SourceHoldId)
            .SingleOrDefaultAsync(cancellationToken);
        if (sourceHoldId is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationCancellationResult.NotFound(
                "The requested Reservation does not exist.");
        }

        await AcquireLockAsync(
            BookingAdvisoryLockKeys.ForHoldTransition(sourceHoldId.Value),
            cancellationToken);

        // Re-run the same bounded ownership+identity predicate under the lock rather
        // than trusting the pre-lock read: this both revalidates ownership and picks
        // up any Status a concurrent transaction committed while this request waited.
        var reservation = await dbContext.Reservations
            .Include(item => item.Units)
            .ThenInclude(unit => unit.Nights)
            .Where(item => item.Id == reservationId)
            .Where(item =>
                (customerAccountId != null && item.CustomerAccountId == customerAccountId) ||
                (guestAccessTokenHash != null &&
                 item.GuestAccessTokenHash == guestAccessTokenHash))
            .SingleOrDefaultAsync(cancellationToken);
        if (reservation is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationCancellationResult.NotFound(
                "The requested Reservation does not exist.");
        }

        if (reservation.Status == ReservationStatus.Cancelled)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationCancellationResult.Replayed(
                BookingHoldConfirmationStore.Map(reservation));
        }

        // Lock-class order (PMS-BE-001.2 §7.1): ReservationUnit locks must be acquired
        // before the RoomType-scope keys they gate discovery of. Locking the units
        // here first blocks every concurrent assignment mutation for them, so the
        // Effective-assignment query below is authoritative — nothing can create,
        // move, or cancel a segment for these units while these locks are held.
        var unitIds = reservation.Units.Select(unit => unit.Id).ToList();
        await AdvisoryLockCoordinator.AcquireAsync(
            dbContext,
            new LockPlanBuilder().WithReservationUnits(unitIds).Build(),
            cancellationToken);

        var effectiveSegments = await dbContext.RoomOccupancySegments
            .Where(segment =>
                segment.PropertyId == reservation.PropertyId &&
                segment.Type == RoomOccupancySegmentType.ReservationAssignment &&
                segment.Status == RoomOccupancySegmentStatus.Effective &&
                segment.ReservationUnitId != null &&
                unitIds.Contains(segment.ReservationUnitId!.Value))
            .ToListAsync(cancellationToken);
        var actualRoomTypeById = await dbContext.PhysicalRooms
            .AsNoTracking()
            .Where(room => room.PropertyId == reservation.PropertyId)
            .Select(room => new { room.Id, room.RoomTypeId })
            .ToDictionaryAsync(room => room.Id, room => room.RoomTypeId, cancellationToken);
        var effectiveAssignments = effectiveSegments
            .Select(segment => new { Segment = segment, ActualRoomTypeId = actualRoomTypeById[segment.PhysicalRoomId] })
            .ToList();

        var soldRoomTypeIds = reservation.Units.Select(unit => unit.RoomTypeId);
        var actualRoomTypeIds = effectiveAssignments.Select(row => row.ActualRoomTypeId);
        var affectedRoomTypeIds = soldRoomTypeIds.Concat(actualRoomTypeIds).Distinct();
        var affectedStayDates = reservation.Units
            .SelectMany(unit => unit.Nights)
            .Select(night => night.StayDate)
            .Distinct()
            .ToArray();

        var lockPlanBuilder = new LockPlanBuilder();
        foreach (var affectedRoomTypeId in affectedRoomTypeIds)
        {
            lockPlanBuilder
                .WithRoomTypeScope(reservation.PropertyId, affectedRoomTypeId)
                .WithInventory(reservation.PropertyId, affectedRoomTypeId, affectedStayDates);
        }

        await AdvisoryLockCoordinator.AcquireAsync(dbContext, lockPlanBuilder.Build(), cancellationToken);

        var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
        var timeZoneId = await dbContext.Properties
            .AsNoTracking()
            .Where(property => property.Id == reservation.PropertyId)
            .Select(property => property.TimeZone)
            .SingleAsync(cancellationToken);
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var propertyLocalDate = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);

        try
        {
            reservation.Cancel(reason, utcNow, propertyLocalDate);
        }
        catch (DomainException exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationCancellationResult.Conflict(
                $"The Reservation cannot be cancelled: {exception.Message}");
        }

        // Cancellation is a demand-removal, not a transfer (blueprint §7 rules 19, 27,
        // 30): every Effective assignment referencing one of this Reservation's Units
        // is atomically cancelled/superseded in the same transaction, with append-only
        // audit evidence recording the system (not a human) as the actor.
        var mutationGroupId = Guid.NewGuid();
        foreach (var row in effectiveAssignments)
        {
            row.Segment.Cancel();
            dbContext.RoomOccupancySegmentAudits.Add(new RoomOccupancySegmentAudit(
                Guid.NewGuid(),
                reservation.PropertyId,
                row.Segment.Id,
                mutationGroupId,
                RoomOccupancySegmentAuditEventType.Cancelled,
                SystemActorReferences.ReservationCancellationCleanup,
                null,
                reason,
                utcNow));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ReservationCancellationResult.Cancelled(
            BookingHoldConfirmationStore.Map(reservation));
    }

    private Task AcquireLockAsync(long lockKey, CancellationToken cancellationToken) =>
        AdvisoryLockCoordinator.AcquireKeyAsync(dbContext, lockKey, cancellationToken);
}
