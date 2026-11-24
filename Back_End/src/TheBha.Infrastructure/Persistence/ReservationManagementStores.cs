using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-CHECKOUT-001-PR06: issues a guest management link inside the CALLER's transaction (contract on <see cref="IReservationManagementLinkIssuer"/>). It stores only the hash; the secret leaves only as the return value.
/// No transaction of its own on purpose: a link committed on its own, with no delivery stored beside it, would be a secret nobody holds.
/// </summary>
internal sealed class ReservationManagementLinkIssuer(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider,
    IGuestAccessTokenGenerator generator) : IReservationManagementLinkIssuer
{
    public async Task<ReservationManagementLinkIssue> IssueAsync(Guid propertyId, Guid reservationId, TimeSpan? ttl, CancellationToken cancellationToken)
    {
        var lifetime = ttl ?? ReservationManagementRules.DefaultLinkTtl;
        if (lifetime <= TimeSpan.Zero || lifetime > ReservationManagementRules.MaxLinkTtl)
        {
            throw new ArgumentOutOfRangeException(nameof(ttl), "The link lifetime must be positive and at most 30 days.");
        }

        var joined = dbContext.Database.CurrentTransaction
            ?? throw new InvalidOperationException("A management link is issued inside the caller's transaction, so that it commits with the delivery that carries it.");
        if (joined.GetDbTransaction().IsolationLevel is not (IsolationLevel.ReadCommitted or IsolationLevel.Unspecified))
        {
            throw new InvalidOperationException("Issuing a management link needs a READ COMMITTED transaction.");
        }

        var eligible = await dbContext.Reservations
            .AsNoTracking()
            .AnyAsync(
                reservation => reservation.PropertyId == propertyId && reservation.Id == reservationId &&
                               reservation.Source == ReservationSource.Direct && reservation.CustomerAccountId == null,
                cancellationToken);
        if (!eligible)
        {
            return ReservationManagementLinkIssue.NotEligible();
        }

        var secret = generator.Generate();
        if (!ReservationManagementSecrets.TryHashLink(secret, out var hash))
        {
            throw new InvalidOperationException("The generated link secret is malformed.");
        }

        var now = ReservationManagementRules.TruncateToMicroseconds(timeProvider.GetUtcNow());
        var expiresAt = ReservationManagementRules.TruncateToMicroseconds(now + lifetime);
        dbContext.ReservationManagementLinks.Add(new ReservationManagementLink(Guid.NewGuid(), propertyId, reservationId, hash, now, expiresAt));
        await dbContext.SaveChangesAsync(cancellationToken);
        return ReservationManagementLinkIssue.Issued(secret, expiresAt);
    }
}

/// <summary>
/// BHA-CHECKOUT-001-PR06: exchanges a link for a session in ONE READ COMMITTED transaction. The winner is decided by a single conditional UPDATE (unused, unexpired, this reservation): a second concurrent request waits
/// for the first row lock, re-evaluates, finds the link used and gets nothing. The session row is added in the same transaction, so a failure after the UPDATE rolls the consumption back too: the link stays usable and
/// no session exists. If the answer is lost after COMMIT the link is spent and the secret is not recoverable (by design: nothing stores it).
/// </summary>
internal sealed class ReservationManagementExchangeStore(TheBhaDbContext dbContext, TimeProvider timeProvider) : IReservationManagementExchangeStore
{
    public async Task<DateTimeOffset?> ExchangeAsync(Guid reservationId, string linkHash, string sessionHash, CancellationToken cancellationToken)
    {
        var now = ReservationManagementRules.TruncateToMicroseconds(timeProvider.GetUtcNow());
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var consumed = await dbContext.ReservationManagementLinks
            .Where(link => link.TokenHash == linkHash && link.ReservationId == reservationId && link.ConsumedAtUtc == null && link.ExpiresAtUtc > now)
            .ExecuteUpdateAsync(set => set.SetProperty(link => link.ConsumedAtUtc, now), cancellationToken);
        if (consumed != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        var link = await dbContext.ReservationManagementLinks
            .AsNoTracking()
            .Where(item => item.TokenHash == linkHash)
            .Select(item => new { item.Id, item.PropertyId })
            .SingleAsync(cancellationToken);
        var expiresAt = ReservationManagementRules.TruncateToMicroseconds(now + ReservationManagementRules.SessionTtl);
        dbContext.ReservationManagementSessions.Add(
            new ReservationManagementSession(Guid.NewGuid(), link.PropertyId, reservationId, link.Id, sessionHash, now, expiresAt));
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return expiresAt;
    }
}

/// <summary>
/// BHA-CHECKOUT-001-PR06: the private management read and the estimated-arrival update, for Direct reservations only. A caller sees a reservation only if it is exactly the signed-in customer's own, or a guest session
/// of that very reservation and Property is still live; nothing falls back from one to the other. The update takes the Reservation transition lock (the one a Direct cancellation takes), so it and a cancellation never
/// interleave; under that lock it re-reads authorization and status. It writes the arrival row and nothing else: no hold, status, inventory, price, folio, Calendar or outbox.
/// </summary>
internal sealed class ReservationManagementStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider,
    IFolioReader folioReader) : IReservationManagementStore
{
    private const string NotFound = "The requested Reservation does not exist.";

    public async Task<ReservationManagementResult> GetAsync(Guid reservationId, ReservationManagementCaller caller, CancellationToken cancellationToken)
    {
        var now = ReservationManagementRules.TruncateToMicroseconds(timeProvider.GetUtcNow());
        var reservation = await Accessible(reservationId, caller, now)
            .AsNoTracking()
            .Include(item => item.Units)
            .ThenInclude(unit => unit.Nights)
            .Include(item => item.PromotionApplication)
            .SingleOrDefaultAsync(cancellationToken);
        return reservation is null
            ? ReservationManagementResult.NotFound(NotFound)
            : await BuildAsync(reservation, cancellationToken) is { } body
                ? ReservationManagementResult.Found(body)
                : ReservationManagementResult.NotFound(NotFound);
    }

    public async Task<ReservationManagementResult> UpdateEstimatedArrivalAsync(
        Guid reservationId,
        ReservationManagementCaller caller,
        DateOnly arrivalDate,
        TimeOnly arrivalTime,
        CancellationToken cancellationToken)
    {
        var now = ReservationManagementRules.TruncateToMicroseconds(timeProvider.GetUtcNow());
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Authorized before the lock, so only a caller who may manage this reservation can make anyone wait on it.
        if (!await Accessible(reservationId, caller, now).AnyAsync(cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationManagementResult.NotFound(NotFound);
        }

        await AdvisoryLockCoordinator.AcquireKeyAsync(dbContext, BookingAdvisoryLockKeys.ForReservationTransition(reservationId), cancellationToken);

        // Same bounded predicate again under the lock: a cancellation or an expired session that happened while this request waited is seen here.
        var reservation = await Accessible(reservationId, caller, now)
            .AsNoTracking()
            .Select(item => new { item.PropertyId, item.CheckIn, item.Status })
            .SingleOrDefaultAsync(cancellationToken);
        if (reservation is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationManagementResult.NotFound(NotFound);
        }

        if (reservation.Status != ReservationStatus.Confirmed)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationManagementResult.Conflict("The arrival of a cancelled Reservation cannot be changed.");
        }

        var timeZoneId = await dbContext.Properties
            .AsNoTracking()
            .Where(property => property.Id == reservation.PropertyId)
            .Select(property => property.TimeZone)
            .SingleAsync(cancellationToken);
        if (!EstimatedArrivalRules.TryCheckWindow(reservation.CheckIn, timeZoneId, arrivalDate, arrivalTime, out var error))
        {
            await transaction.RollbackAsync(cancellationToken);
            return ReservationManagementResult.Invalid(error);
        }

        var estimate = await dbContext.ReservationArrivalEstimates.SingleOrDefaultAsync(item => item.ReservationId == reservationId, cancellationToken);
        if (estimate is null)
        {
            dbContext.ReservationArrivalEstimates.Add(
                new ReservationArrivalEstimate(reservation.PropertyId, reservationId, arrivalDate, arrivalTime, timeZoneId, now));
        }
        else
        {
            estimate.Replace(arrivalDate, arrivalTime, timeZoneId, now);
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        var full = await dbContext.Reservations
            .AsNoTracking()
            .Include(item => item.Units)
            .ThenInclude(unit => unit.Nights)
            .Include(item => item.PromotionApplication)
            .SingleAsync(item => item.Id == reservationId, cancellationToken);
        var body = await BuildAsync(full, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return body is null ? ReservationManagementResult.NotFound(NotFound) : ReservationManagementResult.Updated(body);
    }

    private IQueryable<Reservation> Accessible(Guid reservationId, ReservationManagementCaller caller, DateTimeOffset now)
    {
        var customerAccountId = caller.CustomerAccountId;
        var sessionHash = caller.SessionHash;
        return dbContext.Reservations
            .Where(item => item.Id == reservationId && item.Source == ReservationSource.Direct)
            .Where(item =>
                (customerAccountId != null && item.CustomerAccountId == customerAccountId) ||
                (sessionHash != null &&
                 dbContext.ReservationManagementSessions.Any(session =>
                     session.SessionHash == sessionHash && session.ReservationId == item.Id && session.PropertyId == item.PropertyId && session.ExpiresAtUtc > now)));
    }

    private async Task<ReservationManagementDto?> BuildAsync(Reservation reservation, CancellationToken cancellationToken)
    {
        var balance = await folioReader.GetBalanceAsync(reservation.PropertyId, reservation.Id, cancellationToken);
        if (balance.Balance is not { } folio)
        {
            return null;
        }

        var timeZoneId = await dbContext.Properties
            .AsNoTracking()
            .Where(property => property.Id == reservation.PropertyId)
            .Select(property => property.TimeZone)
            .SingleAsync(cancellationToken);
        var estimate = await dbContext.ReservationArrivalEstimates
            .AsNoTracking()
            .Where(item => item.ReservationId == reservation.Id)
            .SingleOrDefaultAsync(cancellationToken);
        var mapped = BookingHoldConfirmationStore.Map(reservation);
        return new ReservationManagementDto(
            mapped.ReservationId, mapped.ConfirmationNumber, mapped.Status, mapped.PropertyId, mapped.RoomTypeId, mapped.RatePlanId, mapped.FullName, mapped.CheckIn, mapped.CheckOut,
            mapped.Adults, mapped.Children, mapped.Rooms, mapped.CurrencyCode, mapped.TotalAmount, mapped.ConfirmedAtUtc, mapped.CancelledAtUtc, mapped.CancellationReason, mapped.Nights,
            mapped.ListTotalAmount, mapped.DiscountTotalAmount, mapped.AppliedPromotion, DirectReservationPaymentMethods.PayAtProperty,
            folio.State, folio.ReceivableAmount, folio.CollectedAmount, folio.BalanceDueAmount, timeZoneId,
            estimate is null
                ? null
                : new EstimatedArrivalDto(estimate.ArrivalDate, estimate.ArrivalTime.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture), estimate.TimeZoneId, estimate.UpdatedAtUtc));
    }
}
