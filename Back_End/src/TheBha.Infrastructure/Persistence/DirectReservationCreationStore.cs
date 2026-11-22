using Microsoft.EntityFrameworkCore;
using Npgsql;
using TheBha.Application.Activity;
using TheBha.Application.Bookings;
using TheBha.Application.Notifications;
using TheBha.Domain.Bookings;
using TheBha.Domain.Common;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-CHECKOUT-001-PR05: creates one Confirmed Direct Reservation, pay at the property, in ONE READ COMMITTED transaction, or none of it. In order:
/// <list type="number">
/// <item>the Direct idempotency key (class 1, scoped to Property and owner), then the replay lookup: a request that already committed is answered here, whatever has changed since (no gate, price or stock is looked at);</item>
/// <item>the two intake switches, for a NEW reservation only (stop-sell is not a switch: it lives in the inventory the evaluator reads);</item>
/// <item>the RoomType scope and per-night inventory locks in the order Holds use, then the shared <see cref="BookingOfferEvaluator"/> (the same availability and pricing authority as a Hold) under those locks;</item>
/// <item>whether the folio can write the price (VND, whole đồng) and whether it is the price the guest confirmed, before anything is written;</item>
/// <item>the Reservation, its units, nights and promotion snapshot, and the idempotency row, flushed with SaveChanges so the folio sees the Reservation;</item>
/// <item>the initial RoomCharge (<c>charge:initial</c>, System, the confirmation instant; the folio lock is a leaf taken after every booking lock), no Payment;</item>
/// <item>one <c>ReservationConfirmed</c> outbox event; then, last, one Calendar event per unit (it takes the stream's counter row, held to COMMIT);</item>
/// <item>COMMIT, and only then the best-effort Calendar hint.</item>
/// </list>
/// Any exception, a folio or outbox status other than the success one included, rolls everything back: no row, no charge, no event, no hint. No provider is called and no Staff lookup is made here.
/// </summary>
internal sealed class DirectReservationCreationStore(
    TheBhaDbContext dbContext,
    TimeProvider timeProvider,
    IReservationIdGenerator reservationIdGenerator,
    IFolioPosting folioPosting,
    IEmailOutbox emailOutbox,
    IAdminActivityRecorder recorder,
    IAdminActivityHint hint,
    BookingIntake intake) : IDirectReservationCreationStore
{
    private const string IdempotencyConflictMessage = "The Idempotency-Key was already used for a different booking request.";
    private const string InitialChargeKey = "charge:initial";

    public async Task<DirectReservationCreationResult> CreateAsync(PreparedDirectReservationRequest request, CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await AdvisoryLockCoordinator.AcquireKeyAsync(
                dbContext, BookingAdvisoryLockKeys.ForDirectIdempotency(request.ScopeHash, request.KeyHash), cancellationToken);

            var mapping = await FindMappingAsync(request, cancellationToken);
            if (mapping is not null)
            {
                return await ReplayAsync(transaction, mapping, request, cancellationToken);
            }

            if (!intake.AcceptingNewReservations)
            {
                return await RollbackResultAsync(transaction, DirectReservationCreationResult.Closed("New reservations are not being accepted right now."), cancellationToken);
            }

            if (!intake.AllowsDirect(request.PropertyId))
            {
                return await RollbackResultAsync(transaction, DirectReservationCreationResult.DirectUnavailable("Direct booking is not available for this property."), cancellationToken);
            }

            await AdvisoryLockCoordinator.AcquireAsync(
                dbContext,
                BookingOfferEvaluator.BuildLockPlan(request.PropertyId, request.RoomTypeId, request.CheckIn, request.CheckOut),
                cancellationToken);

            var utcNow = timeProvider.GetUtcNow().ToUniversalTime();
            var evaluation = await BookingOfferEvaluator.EvaluateAsync(
                dbContext,
                new BookingOfferRequest(
                    request.PropertyId, request.RoomTypeId, request.RatePlanId, request.CheckIn, request.CheckOut, request.Adults, request.Children, request.Rooms, request.CustomerAccountId),
                utcNow,
                cancellationToken);
            if (evaluation.Offer is not { } offer)
            {
                return await RollbackResultAsync(
                    transaction,
                    evaluation.Failure switch
                    {
                        BookingOfferFailure.Unauthorized => DirectReservationCreationResult.Unauthorized(evaluation.Error!),
                        BookingOfferFailure.NotFound => DirectReservationCreationResult.NotFound(evaluation.Error!),
                        BookingOfferFailure.Invalid => DirectReservationCreationResult.Invalid(evaluation.Error!),
                        _ => DirectReservationCreationResult.Conflict(evaluation.Error!)
                    },
                    cancellationToken);
            }

            // A price the folio cannot write (another currency, a fractional đồng) is refused before it is compared: a "price changed" answer would offer a quote that could never be booked.
            var unwritable = UnwritablePriceReason(offer);
            if (unwritable is not null)
            {
                return await RollbackResultAsync(
                    transaction, DirectReservationCreationResult.Conflict($"The current price cannot be charged: {unwritable}"), cancellationToken);
            }

            if (request.ExpectedTotalAmount != offer.Priced.FinalTotal ||
                !string.Equals(request.ExpectedCurrencyCode, offer.CurrencyCode, StringComparison.Ordinal))
            {
                return await RollbackResultAsync(transaction, DirectReservationCreationResult.PriceChanged(offer.ToQuote()), cancellationToken);
            }

            var reservationId = reservationIdGenerator.Generate();
            Reservation reservation;
            try
            {
                reservation = Reservation.CreateDirect(
                    reservationId,
                    ConfirmationNumberGenerator.Generate(reservationId),
                    request.PropertyId,
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
                    request.GuestAccessTokenHash,
                    Enumerable.Range(0, request.Rooms).Select(_ => new ReservationUnitPlan(null, request.RoomTypeId, offer.NightPlan)).ToList(),
                    offer.Priced.Promotion is { } applied
                        ? new AppliedPromotionSnapshot(applied.Id, applied.Version, applied.Slug, applied.Title, applied.Kind, applied.Value, applied.CurrencyCode)
                        : null);
            }
            catch (DomainException exception)
            {
                return await RollbackResultAsync(
                    transaction, DirectReservationCreationResult.Conflict($"The current offer cannot be booked: {exception.Message}"), cancellationToken);
            }

            if (reservation.TotalAmount != offer.Priced.FinalTotal)
            {
                throw new InvalidOperationException("The Reservation total differs from the price that was confirmed.");
            }

            dbContext.Reservations.Add(reservation);
            dbContext.ReservationCreationRequests.Add(new ReservationCreationRequest(
                request.ScopeHash, request.KeyHash, request.RequestFingerprint, reservation.PropertyId, reservation.Id, utcNow));
            await dbContext.SaveChangesAsync(cancellationToken);

            var posted = await folioPosting.PostAsync(
                new FolioPostingRequest(
                    reservation.PropertyId, reservation.Id, FolioEntryKind.RoomCharge, reservation.TotalAmount, reservation.CurrencyCode, InitialChargeKey, null,
                    FolioActor.System, null, reservation.ConfirmedAtUtc),
                cancellationToken);
            if (posted.Status != FolioPostingStatus.Posted)
            {
                throw new InvalidOperationException($"The initial room charge was not posted ({posted.Status}).");
            }

            var enqueued = await emailOutbox.EnqueueAsync(
                BookingEmailEvents.ReservationConfirmedEvent(reservation.PropertyId, reservation.Id), cancellationToken);
            if (enqueued != EmailOutboxEnqueueStatus.Enqueued)
            {
                throw new InvalidOperationException($"The reservation-confirmed event was not queued ({enqueued}).");
            }

            var balance = ReservationBalance.From(
                await dbContext.FolioEntries.AsNoTracking().Where(entry => entry.ReservationId == reservation.Id).ToListAsync(cancellationToken));
            var body = DirectReservationDto.From(BookingHoldConfirmationStore.Map(reservation), balance);

            // Last statement before COMMIT: the recorder takes the Calendar stream's counter row and holds it to the end. Dates only: never the guest, the confirmation number or the price.
            foreach (var unit in reservation.Units.OrderBy(unit => unit.Id))
            {
                await CalendarActivity.RecordPublicAsync(
                    recorder, reservation.PropertyId, AdminActivityActions.Created, CalendarEntityKinds.ReservationUnit, unit.Id,
                    CalendarActivity.Title("Reservation", reservation.CheckIn, reservation.CheckOut), cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            await CalendarActivity.HintAsync(hint, reservation.PropertyId);
            return DirectReservationCreationResult.Created(body);
        }
        catch (DbUpdateException exception) when (IsRequestKeyViolation(exception))
        {
            // Backstop only: the advisory key already serializes one request, so reaching here means the lock was bypassed. Decide from what committed.
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            await using var again = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var existing = await FindMappingAsync(request, cancellationToken);
            if (existing is null)
            {
                throw;
            }

            return await ReplayAsync(again, existing, request, cancellationToken);
        }
    }

    // Only a Property-scoped currency and amount the folio accepts can be booked here (S1 §3.1, OI-10): never converted, never rounded.
    private static string? UnwritablePriceReason(BookingOffer offer)
    {
        if (offer.CurrencyCode != FolioEntry.Vnd)
        {
            return "a direct reservation can only be priced in VND.";
        }

        // The Reservation's total is numeric(18,2): a larger sum would be a database overflow, not a refusal.
        if (offer.Priced.FinalTotal > 9_999_999_999_999_999.99m)
        {
            return "the total is outside the supported range.";
        }

        try
        {
            FolioEntry.ToVnd(offer.Priced.FinalTotal);
            return null;
        }
        catch (DomainException exception)
        {
            return exception.Message;
        }
    }

    private Task<ReservationCreationRequest?> FindMappingAsync(PreparedDirectReservationRequest request, CancellationToken cancellationToken) =>
        dbContext.ReservationCreationRequests
            .AsNoTracking()
            .SingleOrDefaultAsync(row => row.ScopeHash == request.ScopeHash && row.KeyHash == request.KeyHash, cancellationToken);

    private async Task<DirectReservationCreationResult> ReplayAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        ReservationCreationRequest mapping,
        PreparedDirectReservationRequest request,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(mapping.RequestFingerprint, request.RequestFingerprint, StringComparison.Ordinal))
        {
            return await RollbackResultAsync(transaction, DirectReservationCreationResult.Conflict(IdempotencyConflictMessage), cancellationToken);
        }

        // Ownership is checked again on the Reservation itself, not trusted from the mapping: the same Property, a Direct source and the caller's own account or token.
        var reservation = await dbContext.Reservations
            .AsNoTracking()
            .Include(item => item.Units)
            .ThenInclude(unit => unit.Nights)
            .Include(item => item.PromotionApplication)
            .Where(item => item.Id == mapping.ReservationId && item.PropertyId == request.PropertyId && item.Source == ReservationSource.Direct)
            .Where(item =>
                (request.CustomerAccountId != null && item.CustomerAccountId == request.CustomerAccountId) ||
                (request.GuestAccessTokenHash != null && item.GuestAccessTokenHash == request.GuestAccessTokenHash))
            .SingleOrDefaultAsync(cancellationToken);
        if (reservation is null)
        {
            return await RollbackResultAsync(transaction, DirectReservationCreationResult.Conflict(IdempotencyConflictMessage), cancellationToken);
        }

        var balance = ReservationBalance.From(
            await dbContext.FolioEntries.AsNoTracking().Where(entry => entry.ReservationId == reservation.Id).ToListAsync(cancellationToken));
        var body = DirectReservationDto.From(BookingHoldConfirmationStore.Map(reservation), balance);
        await transaction.RollbackAsync(cancellationToken);
        return DirectReservationCreationResult.Replayed(body);
    }

    private static async Task<DirectReservationCreationResult> RollbackResultAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        DirectReservationCreationResult result,
        CancellationToken cancellationToken)
    {
        await transaction.RollbackAsync(cancellationToken);
        return result;
    }

    private static bool IsRequestKeyViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "PK_ReservationCreationRequests" };
}
