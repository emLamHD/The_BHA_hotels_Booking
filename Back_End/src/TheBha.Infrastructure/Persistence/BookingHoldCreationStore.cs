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
    TimeProvider timeProvider,
    IGuestAccessTokenGenerator guestAccessTokenGenerator) : IBookingHoldCreationStore
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
            var lockPlan = new LockPlanBuilder()
                .WithRoomTypeScope(request.PropertyId, request.RoomTypeId)
                .WithInventory(request.PropertyId, request.RoomTypeId, stayDates)
                .Build();
            await AdvisoryLockCoordinator.AcquireAsync(dbContext, lockPlan, cancellationToken);

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

            NightlyCommitmentSnapshot[] itemNightPlan;
            try
            {
                itemNightPlan = rates.Select(rate => new NightlyCommitmentSnapshot(
                        rate.StayDate,
                        request.RatePlanId,
                        rate.Amount))
                    .ToArray();
            }
            catch (OverflowException)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Conflict(
                        "Current pricing exceeds the supported amount range."),
                    cancellationToken);
            }

            InventoryHold hold;
            string? guestAccessToken = null;
            string? guestAccessTokenHash = null;
            if (request.CustomerAccountId is null)
            {
                guestAccessToken = guestAccessTokenGenerator.Generate();
                guestAccessTokenHash = BookingHoldRequestSecurity.Sha256Hex(
                    guestAccessToken);
            }

            try
            {
                hold = new InventoryHold(
                    Guid.NewGuid(),
                    request.PropertyId,
                    request.RoomTypeId,
                    request.Rooms,
                    request.CustomerAccountId,
                    request.FullName,
                    request.Email,
                    request.Phone,
                    request.CheckIn,
                    request.CheckOut,
                    request.Adults,
                    request.Children,
                    ratePlan.CurrencyCode,
                    utcNow,
                    request.IdempotencyKeyHash,
                    request.RequestFingerprint,
                    guestAccessTokenHash,
                    itemNightPlan);
            }
            catch (DomainException exception)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Conflict(
                        $"The current offer cannot be held: {exception.Message}"),
                    cancellationToken);
            }

            dbContext.InventoryHolds.Add(hold);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return BookingHoldCreationResult.Created(
                Map(hold, guestAccessToken));
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
        var holdDemand = await dbContext.InventoryHolds
            .AsNoTracking()
            .Where(hold =>
                hold.Status == BookingHoldStatus.Active &&
                hold.ExpiresAtUtc > utcNow)
            .SelectMany(hold => hold.Items)
            .Where(item => item.PropertyId == propertyId && item.RoomTypeId == roomTypeId)
            .SelectMany(item => item.Nights)
            .Where(night => night.StayDate >= checkIn && night.StayDate < checkOut)
            .GroupBy(night => night.StayDate)
            .Select(group => new { StayDate = group.Key, Rooms = group.Count() })
            .ToListAsync(cancellationToken);
        var reservationDemand = await dbContext.ReservationUnits
            .AsNoTracking()
            .Where(unit =>
                unit.PropertyId == propertyId &&
                unit.RoomTypeId == roomTypeId &&
                unit.CommitmentStatus == CommitmentStatus.Committed)
            .SelectMany(unit => unit.Nights)
            .Where(night => night.StayDate >= checkIn && night.StayDate < checkOut)
            .GroupBy(night => night.StayDate)
            .Select(group => new { StayDate = group.Key, Rooms = group.Count() })
            .ToListAsync(cancellationToken);
        return holdDemand.Concat(reservationDemand)
            .GroupBy(row => row.StayDate)
            .ToDictionary(group => group.Key, group => group.Sum(row => row.Rooms));
    }

    private Task<InventoryHold?> FindExistingAsync(
        string idempotencyKeyHash,
        CancellationToken cancellationToken) =>
        dbContext.InventoryHolds
            .AsNoTracking()
            .Include(hold => hold.Items)
            .ThenInclude(item => item.Nights)
            .SingleOrDefaultAsync(
                hold => hold.IdempotencyKeyHash == idempotencyKeyHash,
                cancellationToken);

    private Task AcquireLockAsync(long lockKey, CancellationToken cancellationToken) =>
        AdvisoryLockCoordinator.AcquireKeyAsync(dbContext, lockKey, cancellationToken);

    private static async Task<BookingHoldCreationResult> CompleteReplayAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        InventoryHold existing,
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

    /// <summary>
    /// Projects the normalized Item/ItemNight authority into the unchanged public
    /// BookingHoldDto shape. Every Item under one Hold shares the same RoomTypeId and
    /// identical per-night RatePlanId/UnitAmount, because this work item's public
    /// request still accepts exactly one RoomType/RatePlan line, normalized atomically
    /// into <c>rooms</c> independent items at creation (§3 compatibility contract) —
    /// so the first Item's/night's values are representative of the whole Hold.
    /// </summary>
    internal static BookingHoldDto Map(InventoryHold hold, string? guestAccessToken)
    {
        var roomTypeId = hold.Items[0].RoomTypeId;
        var ratePlanId = hold.Items[0].Nights[0].RatePlanId;
        var roomCount = hold.Items.Count;
        var nights = hold.Items
            .SelectMany(item => item.Nights)
            .GroupBy(night => night.StayDate)
            .OrderBy(group => group.Key)
            .Select(group =>
            {
                var unitAmount = group.First().UnitAmount;
                var rooms = group.Count();
                return new BookingHoldNightDto(group.Key, rooms, unitAmount, unitAmount * rooms);
            })
            .ToList();

        return new(
            hold.Id,
            hold.Status,
            hold.PropertyId,
            roomTypeId,
            ratePlanId,
            hold.CheckIn,
            hold.CheckOut,
            hold.Adults,
            hold.Children,
            roomCount,
            hold.CurrencyCode,
            hold.TotalAmount,
            hold.CreatedAtUtc,
            hold.ExpiresAtUtc,
            nights,
            guestAccessToken);
    }

    private static bool IsIdempotencyUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_InventoryHolds_IdempotencyKeyHash"
        };
}

public static class BookingAdvisoryLockKeys
{
    private const string IdempotencyNamespace = "thebha:booking:idempotency:v1:";
    private const string InventoryNamespace = "thebha:booking:inventory:v1:";
    private const string HoldTransitionNamespace = "thebha:booking:hold-transition:v1:";
    private const string ReservationUnitNamespace = "thebha:pms:reservation-unit:v1:";
    private const string RoomTypeInventoryScopeNamespace = "thebha:pms:roomtype-inventory-scope:v1:";

    public static long ForIdempotency(string idempotencyKeyHash) =>
        HashToInt64(IdempotencyNamespace + idempotencyKeyHash);

    public static long ForHoldTransition(Guid holdId) =>
        HashToInt64(HoldTransitionNamespace + holdId.ToString("D"));

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

    /// <summary>
    /// PMS-BE-001.2 §7.1 lock class 2: serializes concurrent mutations (assignment
    /// create/activate/split/move/cancel) against the same ReservationUnit's
    /// physical schedule.
    /// </summary>
    public static long ForReservationUnit(Guid reservationUnitId) =>
        HashToInt64(ReservationUnitNamespace + reservationUnitId.ToString("D"));

    /// <summary>
    /// PMS-BE-001.2 §7.1 lock class 3: serializes PhysicalRoom-capacity changes
    /// (block create/cancel, operational-status change) for one RoomType against
    /// every date-specific demand writer for that RoomType, including dates not
    /// yet present in any daily-inventory lock.
    /// </summary>
    public static long ForRoomTypeInventoryScope(Guid propertyId, Guid roomTypeId) =>
        HashToInt64(
            string.Concat(
                RoomTypeInventoryScopeNamespace,
                propertyId.ToString("D"),
                ":",
                roomTypeId.ToString("D")));

    private static long HashToInt64(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return BinaryPrimitives.ReadInt64BigEndian(hash);
    }
}
