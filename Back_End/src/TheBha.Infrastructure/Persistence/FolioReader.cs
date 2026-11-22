using Microsoft.EntityFrameworkCore;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence;

/// <summary>BHA-CHECKOUT-001-PR02: the one reader behind <see cref="ReservationBalance.From"/>. Same code for a Hold- and a Direct-sourced Reservation; a Reservation with no RoomCharge (every one that predates the folio) is NotRecorded.</summary>
internal sealed class FolioReader(TheBhaDbContext dbContext) : IFolioReader
{
    public async Task<FolioBalanceResult> GetBalanceAsync(Guid propertyId, Guid reservationId, CancellationToken cancellationToken)
    {
        var exists = await dbContext.Reservations
            .AsNoTracking()
            .AnyAsync(reservation => reservation.PropertyId == propertyId && reservation.Id == reservationId, cancellationToken);
        if (!exists)
        {
            return new FolioBalanceResult(FolioBalanceStatus.ReservationNotFound, null);
        }

        var entries = await dbContext.FolioEntries
            .AsNoTracking()
            .Where(entry => entry.PropertyId == propertyId && entry.ReservationId == reservationId)
            .ToListAsync(cancellationToken);
        return new FolioBalanceResult(FolioBalanceStatus.Found, ReservationBalance.From(entries));
    }
}
