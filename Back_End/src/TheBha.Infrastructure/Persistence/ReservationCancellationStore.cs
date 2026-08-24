using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;

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

        var roomTypeId = reservation.Units[0].RoomTypeId;
        foreach (var stayDate in reservation.Units
                     .SelectMany(unit => unit.Nights)
                     .Select(night => night.StayDate)
                     .Distinct()
                     .OrderBy(date => date))
        {
            await AcquireLockAsync(
                BookingAdvisoryLockKeys.ForInventory(
                    reservation.PropertyId,
                    roomTypeId,
                    stayDate),
                cancellationToken);
        }

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

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ReservationCancellationResult.Cancelled(
            BookingHoldConfirmationStore.Map(reservation));
    }

    private async Task AcquireLockAsync(long lockKey, CancellationToken cancellationToken)
    {
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }
}
