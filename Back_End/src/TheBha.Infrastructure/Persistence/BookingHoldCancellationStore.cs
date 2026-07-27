using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence;

internal sealed class BookingHoldCancellationStore(TheBhaDbContext dbContext)
    : IBookingHoldCancellationStore
{
    public async Task<BookingHoldCancellationResult> CancelAsync(
        Guid holdId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            cancellationToken);

        await AcquireLockAsync(
            BookingAdvisoryLockKeys.ForHoldTransition(holdId),
            cancellationToken);

        var hold = await dbContext.BookingHolds
            .Include(item => item.Nights)
            .SingleOrDefaultAsync(item => item.Id == holdId, cancellationToken);
        if (hold is null ||
            !BookingOwnership.IsOwner(
                hold.CustomerAccountId,
                hold.GuestAccessTokenHash,
                customerAccountId,
                guestAccessTokenHash))
        {
            await transaction.RollbackAsync(cancellationToken);
            return BookingHoldCancellationResult.NotFound(
                "The requested Hold does not exist.");
        }

        if (hold.Status == BookingHoldStatus.Cancelled)
        {
            await transaction.RollbackAsync(cancellationToken);
            return BookingHoldCancellationResult.Replayed(
                BookingHoldCreationStore.Map(hold, null));
        }

        if (hold.Status != BookingHoldStatus.Active)
        {
            await transaction.RollbackAsync(cancellationToken);
            return BookingHoldCancellationResult.Conflict(
                "The Hold is not in a cancellable state.");
        }

        foreach (var stayDate in hold.Nights
                     .Select(night => night.StayDate)
                     .OrderBy(date => date))
        {
            await AcquireLockAsync(
                BookingAdvisoryLockKeys.ForInventory(
                    hold.PropertyId,
                    hold.RoomTypeId,
                    stayDate),
                cancellationToken);
        }

        hold.Cancel();
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return BookingHoldCancellationResult.Cancelled(BookingHoldCreationStore.Map(hold, null));
    }

    private async Task AcquireLockAsync(long lockKey, CancellationToken cancellationToken)
    {
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }
}
