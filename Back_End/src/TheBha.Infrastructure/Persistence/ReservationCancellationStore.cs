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

        var reservation = await dbContext.Reservations
            .Include(item => item.Nights)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken);
        if (reservation is null ||
            !BookingOwnership.IsOwner(
                reservation.CustomerAccountId,
                reservation.GuestAccessTokenHash,
                customerAccountId,
                guestAccessTokenHash))
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationCancellationResult.NotFound(
                "The requested Reservation does not exist.");
        }

        await AcquireLockAsync(
            BookingAdvisoryLockKeys.ForHoldTransition(reservation.SourceHoldId),
            cancellationToken);

        await dbContext.Entry(reservation).ReloadAsync(cancellationToken);

        if (reservation.Status == ReservationStatus.Cancelled)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationCancellationResult.Replayed(
                BookingHoldConfirmationStore.Map(reservation));
        }

        foreach (var stayDate in reservation.Nights
                     .Select(night => night.StayDate)
                     .OrderBy(date => date))
        {
            await AcquireLockAsync(
                BookingAdvisoryLockKeys.ForInventory(
                    reservation.PropertyId,
                    reservation.RoomTypeId,
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
