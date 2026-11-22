using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Bookings;
using TheBha.Application.Promotions;
using TheBha.Application.Properties;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;
using TheBha.Domain.Properties;

namespace TheBha.Infrastructure.Persistence;

internal sealed class BookingHoldCreationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider,
    IGuestAccessTokenGenerator guestAccessTokenGenerator,
    BookingIntake intake) : IBookingHoldCreationStore
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

            // A replay above is still answered; only a NEW Hold is refused while intake is stopped. No inventory lock is taken for it.
            if (!intake.AcceptingNewReservations)
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.Closed("New reservations are not being accepted right now."),
                    cancellationToken);
            }

            await AdvisoryLockCoordinator.AcquireAsync(
                dbContext,
                BookingOfferEvaluator.BuildLockPlan(request.PropertyId, request.RoomTypeId, request.CheckIn, request.CheckOut),
                cancellationToken);

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
            var evaluation = await BookingOfferEvaluator.EvaluateAsync(
                dbContext,
                new BookingOfferRequest(
                    request.PropertyId,
                    request.RoomTypeId,
                    request.RatePlanId,
                    request.CheckIn,
                    request.CheckOut,
                    request.Adults,
                    request.Children,
                    request.Rooms,
                    request.CustomerAccountId),
                utcNow,
                cancellationToken);
            if (evaluation.Offer is not { } offer)
            {
                return await RollbackResultAsync(
                    transaction,
                    evaluation.Failure switch
                    {
                        BookingOfferFailure.Unauthorized => BookingHoldCreationResult.Unauthorized(evaluation.Error!),
                        BookingOfferFailure.NotFound => BookingHoldCreationResult.NotFound(evaluation.Error!),
                        BookingOfferFailure.Invalid => BookingHoldCreationResult.Invalid(evaluation.Error!),
                        _ => BookingHoldCreationResult.Conflict(evaluation.Error!)
                    },
                    cancellationToken);
            }

            var priced = offer.Priced;
            var itemNightPlan = offer.NightPlan;

            // The guest confirmed a price. If it is not the price now, nothing is held: the new price is shown for a new decision.
            // Replays returned earlier, before pricing, so a Hold that already exists is never re-priced.
            if (request.ExpectedTotalAmount is { } expectedTotal &&
                (expectedTotal != priced.FinalTotal ||
                 !string.Equals(request.ExpectedCurrencyCode, offer.CurrencyCode, StringComparison.Ordinal)))
            {
                return await RollbackResultAsync(
                    transaction,
                    BookingHoldCreationResult.PriceChanged(offer.ToQuote()),
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
                    offer.CurrencyCode,
                    utcNow,
                    request.IdempotencyKeyHash,
                    request.RequestFingerprint,
                    guestAccessTokenHash,
                    itemNightPlan,
                    priced.Promotion is { } applied
                        ? new AppliedPromotionSnapshot(
                            applied.Id,
                            applied.Version,
                            applied.Slug,
                            applied.Title,
                            applied.Kind,
                            applied.Value,
                            applied.CurrencyCode)
                        : null);
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

    private Task<InventoryHold?> FindExistingAsync(
        string idempotencyKeyHash,
        CancellationToken cancellationToken) =>
        dbContext.InventoryHolds
            .AsNoTracking()
            .Include(hold => hold.Items)
            .ThenInclude(item => item.Nights)
            .Include(x => x.PromotionApplication)
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
                var listUnitAmount = group.First().ListUnitAmount;
                var rooms = group.Count();
                return new BookingHoldNightDto(group.Key, rooms, unitAmount, unitAmount * rooms, listUnitAmount, listUnitAmount - unitAmount);
            })
            .ToList();
        var listTotal = hold.Items.SelectMany(item => item.Nights).Sum(night => night.ListUnitAmount);

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
            guestAccessToken,
            listTotal,
            listTotal - hold.TotalAmount,
            PromotionSnapshotMapping.ToDto(hold.PromotionApplication));
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
    private const string ReservationTransitionNamespace = "thebha:booking:reservation-transition:v1:";
    private const string ReservationFolioNamespace = "thebha:booking:reservation-folio:v1:";
    private const string ReservationUnitNamespace = "thebha:pms:reservation-unit:v1:";
    private const string RoomTypeInventoryScopeNamespace = "thebha:pms:roomtype-inventory-scope:v1:";
    private const string WebsiteSettingsNamespace = "thebha:website:settings:v1";

    public static long ForIdempotency(string idempotencyKeyHash) =>
        HashToInt64(IdempotencyNamespace + idempotencyKeyHash);

    public static long ForHoldTransition(Guid holdId) =>
        HashToInt64(HoldTransitionNamespace + holdId.ToString("D"));

    /// <summary>Serializes lifecycle transitions of a Reservation that has no Hold (a Hold-sourced one uses <see cref="ForHoldTransition"/>). Separate namespace: a reservation id never collides with a hold id.</summary>
    public static long ForReservationTransition(Guid reservationId) =>
        HashToInt64(ReservationTransitionNamespace + reservationId.ToString("D"));

    /// <summary>
    /// BHA-CHECKOUT-001-PR02: serializes every folio posting of one Reservation (replay check, reference check, refund/reversal quota, insert). A LEAF lock: taken after any other booking lock a caller needs
    /// (hold/reservation transition, ReservationUnit, RoomType scope, inventory) and never before one. The folio writer takes no other lock.
    /// </summary>
    public static long ForReservationFolio(Guid reservationId) =>
        HashToInt64(ReservationFolioNamespace + reservationId.ToString("D"));

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

    /// <summary>
    /// CUST-WEB-HEADER-001-CP02: the one site-wide lock every website-settings writer takes, first, inside its
    /// transaction. These tables are tiny and rarely written, so one lock costs nothing and is what keeps
    /// "exactly one default", "no active currency without a rate" and a version check true under concurrency.
    /// It shares no class with the booking locks above: no website path takes a booking lock and none takes both.
    /// </summary>
    public static long ForWebsiteSettings() => HashToInt64(WebsiteSettingsNamespace);

    private static long HashToInt64(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return BinaryPrimitives.ReadInt64BigEndian(hash);
    }
}
