using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class BookingHoldCreationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider) : IBookingHoldCreationStore
{
    public async Task<BookingHoldCreationResult> CreateAsync(
        PreparedBookingHoldRequest request,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            cancellationToken);
        try
        {
            await AcquireLockAsync(
                BookingAdvisoryLockKeys.ForIdempotency(request.IdempotencyKeyHash),
                cancellationToken);

            var existing = await FindExistingAsync(
                request.IdempotencyKeyHash,
                cancellationToken);
            if (existing is not null)
            {
                return await CompleteReplayAsync(
                    transaction,
                    existing,
                    request.RequestFingerprint,
                    cancellationToken);
            }

            var stayDates = Enumerable
                .Range(0, request.CheckOut.DayNumber - request.CheckIn.DayNumber)
                .Select(request.CheckIn.AddDays)
                .Order()
                .ToArray();
            foreach (var stayDate in stayDates)
            {
                await AcquireLockAsync(
                    BookingAdvisoryLockKeys.ForInventory(
                        request.PropertyId,
                        request.RoomTypeId,
                        stayDate),
                    cancellationToken);
            }

            existing = await FindExistingAsync(
                request.IdempotencyKeyHash,
                cancellationToken);
            if (existing is not null)
            {
                return await CompleteReplayAsync(
                    transaction,
                    existing,
                    request.RequestFingerprint,
                    cancellationToken);
            }

            var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
            if (request.CustomerAccountId is { } customerAccountId &&
                !await dbContext.CustomerAccounts
                    .AsNoTracking()
                    .AnyAsync(
                        account => account.Id == customerAccountId,
                        cancellationToken))
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Unauthorized(
                        "A valid customer session is required."),
                    cancellationToken);
            }

            var property = await dbContext.Properties
                .AsNoTracking()
                .Where(item => item.Id == request.PropertyId && item.IsActive)
                .Select(item => new { item.Id, item.TimeZone })
                .SingleOrDefaultAsync(cancellationToken);
            if (property is null)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.NotFound(
                        "The requested active property does not exist."),
                    cancellationToken);
            }

            var roomType = await dbContext.RoomTypes
                .AsNoTracking()
                .Where(item =>
                    item.Id == request.RoomTypeId &&
                    item.PropertyId == request.PropertyId &&
                    item.IsActive)
                .Select(item => new { item.Id, item.MaxOccupancy })
                .SingleOrDefaultAsync(cancellationToken);
            if (roomType is null)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.NotFound(
                        "The requested active room type does not exist in this property."),
                    cancellationToken);
            }

            var ratePlan = await dbContext.RatePlans
                .AsNoTracking()
                .Where(item =>
                    item.Id == request.RatePlanId &&
                    item.PropertyId == request.PropertyId &&
                    item.IsActive)
                .Select(item => new { item.Id, item.CurrencyCode })
                .SingleOrDefaultAsync(cancellationToken);
            if (ratePlan is null)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.NotFound(
                        "The requested active rate plan does not exist in this property."),
                    cancellationToken);
            }

            var timeZone = TimeZoneInfo.FindSystemTimeZoneById(property.TimeZone);
            var localToday = DateOnly.FromDateTime(
                TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);
            if (request.CheckIn < localToday)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Invalid(
                        "checkIn cannot be earlier than the Property local date."),
                    cancellationToken);
            }

            var people = (long)request.Adults + request.Children;
            if (people > (long)roomType.MaxOccupancy * request.Rooms)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Invalid(
                        "The requested occupancy exceeds the room type capacity."),
                    cancellationToken);
            }

            var rates = await dbContext.DailyRoomRates
                .AsNoTracking()
                .Where(item =>
                    item.PropertyId == request.PropertyId &&
                    item.RoomTypeId == request.RoomTypeId &&
                    item.RatePlanId == request.RatePlanId &&
                    item.StayDate >= request.CheckIn &&
                    item.StayDate < request.CheckOut)
                .OrderBy(item => item.StayDate)
                .Select(item => new { item.StayDate, item.Amount })
                .ToListAsync(cancellationToken);
            if (rates.Count != stayDates.Length ||
                !rates.Select(rate => rate.StayDate).SequenceEqual(stayDates))
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Conflict(
                        "Current pricing is unavailable for one or more stay dates."),
                    cancellationToken);
            }

            var activeRooms = await dbContext.PhysicalRooms
                .AsNoTracking()
                .CountAsync(
                    room =>
                        room.PropertyId == request.PropertyId &&
                        room.RoomTypeId == request.RoomTypeId &&
                        room.OperationalStatus == OperationalStatus.Active,
                    cancellationToken);
            var controls = await dbContext.DailyInventoryControls
                .AsNoTracking()
                .Where(control =>
                    control.PropertyId == request.PropertyId &&
                    control.RoomTypeId == request.RoomTypeId &&
                    control.StayDate >= request.CheckIn &&
                    control.StayDate < request.CheckOut)
                .Select(control => new
                {
                    control.StayDate,
                    control.SellableLimit,
                    control.IsStopSell
                })
                .ToDictionaryAsync(control => control.StayDate, cancellationToken);
            var committedDemand = await LoadCommittedDemandAsync(
                request.PropertyId,
                request.RoomTypeId,
                request.CheckIn,
                request.CheckOut,
                utcNow,
                cancellationToken);

            foreach (var stayDate in stayDates)
            {
                controls.TryGetValue(stayDate, out var control);
                var controlledInventory = control?.IsStopSell == true
                    ? 0
                    : Math.Min(activeRooms, control?.SellableLimit ?? activeRooms);
                var remainingRooms = controlledInventory -
                    committedDemand.GetValueOrDefault(stayDate);
                if (remainingRooms < request.Rooms)
                {
                    return await RollbackResultAsync(
                        transaction,
                        BookingHoldCreationResult.Conflict(
                            "The selected rooms are no longer available for the complete stay."),
                        cancellationToken);
                }
            }

            BookingNightSnapshot[] snapshots;
            decimal totalAmount;
            try
            {
                snapshots = rates.Select(rate => new BookingNightSnapshot(
                        rate.StayDate,
                        request.Rooms,
                        rate.Amount,
                        rate.Amount * request.Rooms))
                    .ToArray();
                totalAmount = snapshots.Sum(snapshot => snapshot.NightTotal);
            }
            catch (OverflowException)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Conflict(
                        "Current pricing exceeds the supported amount range."),
                    cancellationToken);
            }

            BookingHold hold;
            try
            {
                hold = new BookingHold(
                    Guid.NewGuid(),
                    request.PropertyId,
                    request.RoomTypeId,
                    request.RatePlanId,
                    request.CustomerAccountId,
                    request.FullName,
                    request.Email,
                    request.Phone,
                    request.CheckIn,
                    request.CheckOut,
                    request.Adults,
                    request.Children,
                    request.Rooms,
                    ratePlan.CurrencyCode,
                    totalAmount,
                    utcNow,
                    request.IdempotencyKeyHash,
                    request.RequestFingerprint,
                    request.GuestAccessTokenHash,
                    snapshots);
            }
            catch (DomainException exception)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Conflict(
                        $"The current offer cannot be held: {exception.Message}"),
                    cancellationToken);
            }

            dbContext.BookingHolds.Add(hold);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return BookingHoldCreationResult.Created(
                Map(hold, request.GuestAccessToken));
        }
        catch (DbUpdateException exception) when (IsIdempotencyUniqueViolation(exception))
        {
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            var existing = await FindExistingAsync(
                request.IdempotencyKeyHash,
                cancellationToken);
            if (existing is null)
            {
                throw;
            }

            return existing.RequestFingerprint == request.RequestFingerprint
                ? BookingHoldCreationResult.Replayed(Map(existing, null))
                : BookingHoldCreationResult.Conflict(
                    "The Idempotency-Key was already used for a different booking request.");
        }
    }

    private async Task<Dictionary<DateOnly, int>> LoadCommittedDemandAsync(
        Guid propertyId,
        Guid roomTypeId,
        DateOnly checkIn,
        DateOnly checkOut,
        DateTimeOffset utcNow,
        CancellationToken cancellationToken)
    {
        var holdDemand = await dbContext.BookingHolds
            .AsNoTracking()
            .Where(hold =>
                hold.PropertyId == propertyId &&
                hold.RoomTypeId == roomTypeId &&
                hold.Status == BookingHoldStatus.Active &&
                hold.ExpiresAtUtc > utcNow)
            .SelectMany(hold => hold.Nights)
            .Where(night => night.StayDate >= checkIn && night.StayDate < checkOut)
            .GroupBy(night => night.StayDate)
            .Select(group => new { StayDate = group.Key, Rooms = group.Sum(x => x.Rooms) })
            .ToListAsync(cancellationToken);
        var reservationDemand = await dbContext.Reservations
            .AsNoTracking()
            .Where(reservation =>
                reservation.PropertyId == propertyId &&
                reservation.RoomTypeId == roomTypeId &&
                reservation.Status == ReservationStatus.Confirmed)
            .SelectMany(reservation => reservation.Nights)
            .Where(night => night.StayDate >= checkIn && night.StayDate < checkOut)
            .GroupBy(night => night.StayDate)
            .Select(group => new { StayDate = group.Key, Rooms = group.Sum(x => x.Rooms) })
            .ToListAsync(cancellationToken);
        return holdDemand.Concat(reservationDemand)
            .GroupBy(row => row.StayDate)
            .ToDictionary(group => group.Key, group => group.Sum(row => row.Rooms));
    }

    private Task<BookingHold?> FindExistingAsync(
        string idempotencyKeyHash,
        CancellationToken cancellationToken) =>
        dbContext.BookingHolds
            .AsNoTracking()
            .Include(hold => hold.Nights)
            .SingleOrDefaultAsync(
                hold => hold.IdempotencyKeyHash == idempotencyKeyHash,
                cancellationToken);

    private async Task AcquireLockAsync(long lockKey, CancellationToken cancellationToken)
    {
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }

    private static async Task<BookingHoldCreationResult> CompleteReplayAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        BookingHold existing,
        string requestFingerprint,
        CancellationToken cancellationToken)
    {
        var result = existing.RequestFingerprint == requestFingerprint
            ? BookingHoldCreationResult.Replayed(Map(existing, null))
            : BookingHoldCreationResult.Conflict(
                "The Idempotency-Key was already used for a different booking request.");
        await transaction.RollbackAsync(cancellationToken);
        return result;
    }

    private static async Task<BookingHoldCreationResult> RollbackResultAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        BookingHoldCreationResult result,
        CancellationToken cancellationToken)
    {
        await transaction.RollbackAsync(cancellationToken);
        return result;
    }

    private static BookingHoldDto Map(BookingHold hold, string? guestAccessToken) =>
        new(
            hold.Id,
            hold.Status,
            hold.PropertyId,
            hold.RoomTypeId,
            hold.RatePlanId,
            hold.CheckIn,
            hold.CheckOut,
            hold.Adults,
            hold.Children,
            hold.Rooms,
            hold.CurrencyCode,
            hold.TotalAmount,
            hold.CreatedAtUtc,
            hold.ExpiresAtUtc,
            hold.Nights
                .OrderBy(night => night.StayDate)
                .Select(night => new BookingHoldNightDto(
                    night.StayDate,
                    night.Rooms,
                    night.UnitAmount,
                    night.NightTotal))
                .ToList(),
            guestAccessToken);

    private static bool IsIdempotencyUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_BookingHolds_IdempotencyKeyHash"
        };
}

public static class BookingAdvisoryLockKeys
{
    private const string IdempotencyNamespace = "thebha:booking:idempotency:v1:";
    private const string InventoryNamespace = "thebha:booking:inventory:v1:";

    public static long ForIdempotency(string idempotencyKeyHash) =>
        HashToInt64(IdempotencyNamespace + idempotencyKeyHash);

    public static long ForInventory(
        Guid propertyId,
        Guid roomTypeId,
        DateOnly stayDate) =>
        HashToInt64(
            string.Concat(
                InventoryNamespace,
                propertyId.ToString("D"),
                ":",
                roomTypeId.ToString("D"),
                ":",
                stayDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));

    private static long HashToInt64(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return BinaryPrimitives.ReadInt64BigEndian(hash);
    }
}
