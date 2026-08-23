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

            var hold = await dbContext.InventoryHolds
                .Include(item => item.Items)
                .ThenInclude(item => item.Nights)
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
                .Include(item => item.Units)
                .ThenInclude(unit => unit.Nights)
                .SingleOrDefaultAsync(
                    item => item.SourceHoldId == holdId,
                    cancellationToken);
            if (existingReservation is not null)
            {
                if (!hold.IsCoherentReservation(existingReservation))
                {
                    return await RollbackResultAsync(
                        transaction,
                        BookingHoldConfirmationResult.Conflict(
                            "The Hold cannot be confirmed: existing confirmation " +
                            "state is inconsistent."),
                        cancellationToken);
                }

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

            var reloadedHold = await dbContext.InventoryHolds
                .AsNoTracking()
                .Include(item => item.Items)
                .ThenInclude(item => item.Nights)
                .SingleOrDefaultAsync(item => item.Id == holdId, cancellationToken);
            var existing = await dbContext.Reservations
                .AsNoTracking()
                .Include(item => item.Units)
                .ThenInclude(unit => unit.Nights)
                .SingleOrDefaultAsync(item => item.SourceHoldId == holdId, cancellationToken);
            if (reloadedHold is null || existing is null)
            {
                throw;
            }

            if (!reloadedHold.IsCoherentReservation(existing))
            {
                return BookingHoldConfirmationResult.Conflict(
                    "The Hold cannot be confirmed: existing confirmation state is " +
                    "inconsistent.");
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

    /// <summary>
    /// Projects the normalized Unit/UnitNight authority into the unchanged public
    /// ReservationDto shape. Every Unit under one Reservation shares the same
    /// RoomTypeId and identical per-night RatePlanId/UnitAmount, for the same reason
    /// documented on <see cref="BookingHoldCreationStore.Map"/>.
    /// </summary>
    internal static ReservationDto Map(Reservation reservation)
    {
        var roomTypeId = reservation.Units[0].RoomTypeId;
        var ratePlanId = reservation.Units[0].Nights[0].RatePlanId;
        var roomCount = reservation.Units.Count;
        var nights = reservation.Units
            .SelectMany(unit => unit.Nights)
            .GroupBy(night => night.StayDate)
            .OrderBy(group => group.Key)
            .Select(group =>
            {
                var unitAmount = group.First().UnitAmount;
                var rooms = group.Count();
                return new ReservationNightDto(group.Key, rooms, unitAmount, unitAmount * rooms);
            })
            .ToList();

        return new(
            reservation.Id,
            reservation.ConfirmationNumber,
            reservation.Status,
            reservation.PropertyId,
            roomTypeId,
            ratePlanId,
            reservation.FullName,
            reservation.Email,
            reservation.Phone,
            reservation.CheckIn,
            reservation.CheckOut,
            reservation.Adults,
            reservation.Children,
            roomCount,
            reservation.CurrencyCode,
            reservation.TotalAmount,
            reservation.ConfirmedAtUtc,
            reservation.CancelledAtUtc,
            reservation.CancellationReason,
            nights);
    }

    private static bool IsSourceHoldUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_Reservations_SourceHoldId"
        };
}
