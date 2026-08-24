using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;

namespace TheBha.Infrastructure.Persistence;

internal sealed class ReservationReadStore(TheBhaDbContext dbContext) : IReservationReadStore
{
    public async Task<ReservationReadResult> GetAsync(
        Guid reservationId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken)
    {
        var reservation = await dbContext.Reservations
            .AsNoTracking()
            .Include(item => item.Units)
            .ThenInclude(unit => unit.Nights)
            .Where(item => item.Id == reservationId)
            .Where(item =>
                (customerAccountId != null && item.CustomerAccountId == customerAccountId) ||
                (guestAccessTokenHash != null &&
                 item.GuestAccessTokenHash == guestAccessTokenHash))
            .SingleOrDefaultAsync(cancellationToken);

        return reservation is null
            ? ReservationReadResult.NotFound("The requested Reservation does not exist.")
            : ReservationReadResult.Found(BookingHoldConfirmationStore.Map(reservation));
    }
}
