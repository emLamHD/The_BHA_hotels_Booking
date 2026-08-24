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

        var hold = await dbContext.InventoryHolds
            .Include(item => item.Items)
            .ThenInclude(item => item.Nights)
            .Where(item => item.Id == holdId)
            .Where(item =>
                (customerAccountId != null && item.CustomerAccountId == customerAccountId) ||
                (guestAccessTokenHash != null &&
                 item.GuestAccessTokenHash == guestAccessTokenHash))
            .SingleOrDefaultAsync(cancellationToken);
        if (hold is null)
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

        var roomTypeId = hold.Items[0].RoomTypeId;
        foreach (var stayDate in hold.Items
                     .SelectMany(item => item.Nights)
                     .Select(night => night.StayDate)
                     .Distinct()
                     .OrderBy(date => date))
        {
            await AcquireLockAsync(
                BookingAdvisoryLockKeys.ForInventory(
                    hold.PropertyId,
                    roomTypeId,
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
