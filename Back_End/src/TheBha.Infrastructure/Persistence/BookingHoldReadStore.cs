using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;

namespace TheBha.Infrastructure.Persistence;

internal sealed class BookingHoldReadStore(TheBhaDbContext dbContext) : IBookingHoldReadStore
{
    public async Task<BookingHoldReadResult> GetAsync(
        Guid holdId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken)
    {
        var hold = await dbContext.BookingHolds
            .AsNoTracking()
            .Include(item => item.Nights)
            .Where(item => item.Id == holdId)
            .Where(item =>
                (customerAccountId != null && item.CustomerAccountId == customerAccountId) ||
                (guestAccessTokenHash != null &&
                 item.GuestAccessTokenHash == guestAccessTokenHash))
            .SingleOrDefaultAsync(cancellationToken);

        return hold is null
            ? BookingHoldReadResult.NotFound("The requested Hold does not exist.")
            : BookingHoldReadResult.Found(BookingHoldCreationStore.Map(hold, null));
    }
}
