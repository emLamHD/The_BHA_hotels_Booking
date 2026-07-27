using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;

namespace TheBha.Infrastructure.Persistence;

internal sealed class BookingHoldConfirmationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider,
    IReservationIdGenerator reservationIdGenerator) : IBookingHoldConfirmationStore
{
    public async Task<BookingHoldConfirmationResult> ConfirmAsync(
        Guid holdId,
        Guid? customerAccountId,
        string? guestAccessTokenHash,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            cancellationToken);
        try
        {
            await AcquireLockAsync(
                BookingAdvisoryLockKeys.ForHoldTransition(holdId),
                cancellationToken);

            var hold = await dbContext.BookingHolds
                .Include(item => item.Nights)
                .SingleOrDefaultAsync(item => item.Id == holdId, cancellationToken);
            if (hold is null ||
                !IsOwner(
                    hold.CustomerAccountId,
                    hold.GuestAccessTokenHash,
                    customerAccountId,
                    guestAccessTokenHash))
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldConfirmationResult.NotFound(
                        "The requested Hold does not exist."),
                    cancellationToken);
            }

            var existingReservation = await dbContext.Reservations
                .AsNoTracking()
                .Include(item => item.Nights)
                .SingleOrDefaultAsync(
                    item => item.SourceHoldId == holdId,
                    cancellationToken);
            if (existingReservation is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return BookingHoldConfirmationResult.Replayed(Map(existingReservation));
            }

            if (hold.Status != BookingHoldStatus.Active)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldConfirmationResult.Conflict(
                        "The Hold is not in a confirmable state."),
                    cancellationToken);
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

            var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
            var reservationId = reservationIdGenerator.Generate();
            var confirmationNumber = ConfirmationNumberGenerator.Generate(reservationId);

            Reservation reservation;
            try
            {
                reservation = hold.Confirm(reservationId, confirmationNumber, utcNow);
            }
            catch (DomainException exception)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldConfirmationResult.Conflict(
                        $"The Hold cannot be confirmed: {exception.Message}"),
                    cancellationToken);
            }

            dbContext.Reservations.Add(reservation);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return BookingHoldConfirmationResult.Confirmed(Map(reservation));
        }
        catch (DbUpdateException exception) when (IsSourceHoldUniqueViolation(exception))
        {
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            var existing = await dbContext.Reservations
                .AsNoTracking()
                .Include(item => item.Nights)
                .SingleOrDefaultAsync(item => item.SourceHoldId == holdId, cancellationToken);
            if (existing is null)
            {
                throw;
            }

            return BookingHoldConfirmationResult.Replayed(Map(existing));
        }
    }

    private static bool IsOwner(
        Guid? resourceCustomerAccountId,
        string? resourceGuestAccessTokenHash,
        Guid? customerAccountId,
        string? guestAccessTokenHash) =>
        (customerAccountId is not null &&
         resourceCustomerAccountId == customerAccountId) ||
        (guestAccessTokenHash is not null &&
         resourceGuestAccessTokenHash == guestAccessTokenHash);

    private async Task AcquireLockAsync(long lockKey, CancellationToken cancellationToken)
    {
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }

    private static async Task<BookingHoldConfirmationResult> RollbackResultAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        BookingHoldConfirmationResult result,
        CancellationToken cancellationToken)
    {
        await transaction.RollbackAsync(cancellationToken);
        return result;
    }

    internal static ReservationDto Map(Reservation reservation) =>
        new(
            reservation.Id,
            reservation.ConfirmationNumber,
            reservation.Status,
            reservation.PropertyId,
            reservation.RoomTypeId,
            reservation.RatePlanId,
            reservation.FullName,
            reservation.Email,
            reservation.Phone,
            reservation.CheckIn,
            reservation.CheckOut,
            reservation.Adults,
            reservation.Children,
            reservation.Rooms,
            reservation.CurrencyCode,
            reservation.TotalAmount,
            reservation.ConfirmedAtUtc,
            reservation.CancelledAtUtc,
            reservation.CancellationReason,
            reservation.Nights
                .OrderBy(night => night.StayDate)
                .Select(night => new ReservationNightDto(
                    night.StayDate,
                    night.Rooms,
                    night.UnitAmount,
                    night.NightTotal))
                .ToList());

    private static bool IsSourceHoldUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_Reservations_SourceHoldId"
        };
}
