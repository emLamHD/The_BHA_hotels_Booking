using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using TheBha.Application.Bookings;
using TheBha.Domain.Bookings;

namespace TheBha.Infrastructure.Persistence;

/// <summary>
/// BHA-CHECKOUT-001-PR02: the folio writer (contract on <see cref="IFolioPosting"/>). Under the per-reservation advisory lock it reads, in this order, the Reservation (scope and currency), an entry with the same
/// PostingKey (replay or conflict, decided before any quota is looked at), the referenced entry (same Reservation, right kind) and the quota already used, then appends and saves. Every read is AsNoTracking and the entry
/// is built and validated before anything is read, so a malformed request touches nothing.
/// </summary>
internal sealed class FolioPostingStore(TheBhaDbContext dbContext, TimeProvider timeProvider) : IFolioPosting
{
    public async Task<FolioPostingResult> PostAsync(FolioPostingRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var candidate = new FolioEntry(
            Guid.NewGuid(), request.PropertyId, request.ReservationId, request.Kind, request.Amount, request.CurrencyCode, request.PostingKey,
            request.ReferenceEntryId, request.Actor, request.Reason, request.OccurredAtUtc, timeProvider.GetUtcNow());

        var joined = dbContext.Database.CurrentTransaction;
        if (joined is not null && joined.GetDbTransaction().IsolationLevel is not (IsolationLevel.ReadCommitted or IsolationLevel.Unspecified))
        {
            throw new InvalidOperationException("The folio writer needs a READ COMMITTED transaction: the reads after its lock must see what the previous lock holder committed.");
        }

        await using var own = joined is null ? await dbContext.Database.BeginTransactionAsync(cancellationToken) : null;
        var result = await PostLockedAsync(candidate, cancellationToken);
        if (own is not null)
        {
            await own.CommitAsync(cancellationToken);
        }

        return result;
    }

    private async Task<FolioPostingResult> PostLockedAsync(FolioEntry candidate, CancellationToken cancellationToken)
    {
        await AdvisoryLockCoordinator.AcquireKeyAsync(dbContext, BookingAdvisoryLockKeys.ForReservationFolio(candidate.ReservationId), cancellationToken);

        var currency = await dbContext.Reservations
            .AsNoTracking()
            .Where(reservation => reservation.PropertyId == candidate.PropertyId && reservation.Id == candidate.ReservationId)
            .Select(reservation => reservation.CurrencyCode)
            .SingleOrDefaultAsync(cancellationToken);
        if (currency is null)
        {
            return Refused(FolioPostingStatus.ReservationNotFound, "No such Reservation in this Property.");
        }

        if (currency != FolioEntry.Vnd)
        {
            return Refused(FolioPostingStatus.ReservationNotVnd, "The Reservation is not in VND, so it has no folio.");
        }

        var existing = await dbContext.FolioEntries
            .AsNoTracking()
            .SingleOrDefaultAsync(entry => entry.ReservationId == candidate.ReservationId && entry.PostingKey == candidate.PostingKey, cancellationToken);
        if (existing is not null)
        {
            return candidate.HasSamePostingAs(existing)
                ? new FolioPostingResult(FolioPostingStatus.Replayed, existing, null)
                : new FolioPostingResult(FolioPostingStatus.Conflict, existing, "This posting key was already used for a different posting.");
        }

        if (candidate.ReferenceEntryId is { } referenceId)
        {
            var requiredKind = candidate.Kind == FolioEntryKind.RoomChargeReversal ? FolioEntryKind.RoomCharge : FolioEntryKind.Payment;
            var reference = await dbContext.FolioEntries
                .AsNoTracking()
                .Where(entry => entry.ReservationId == candidate.ReservationId && entry.Id == referenceId)
                .Select(entry => new { entry.Kind, entry.Amount })
                .SingleOrDefaultAsync(cancellationToken);
            if (reference is null || reference.Kind != requiredKind)
            {
                return Refused(FolioPostingStatus.InvalidReference, $"{candidate.Kind} must reference an existing {requiredKind} of this Reservation.");
            }

            // Refunds of one Payment and reversals of one RoomCharge; a GatewayFee has no quota (it is not money returned to the guest).
            if (candidate.Kind is FolioEntryKind.Refund or FolioEntryKind.RoomChargeReversal)
            {
                var used = await dbContext.FolioEntries
                    .AsNoTracking()
                    .Where(entry => entry.ReservationId == candidate.ReservationId && entry.ReferenceEntryId == referenceId && entry.Kind == candidate.Kind)
                    .Select(entry => (long?)entry.Amount)
                    .SumAsync(cancellationToken) ?? 0;
                if (used > reference.Amount - candidate.Amount)
                {
                    return Refused(FolioPostingStatus.QuotaExceeded, $"{candidate.Kind} entries would exceed the {reference.Amount} of the referenced {requiredKind} ({used} already used).");
                }
            }
        }

        dbContext.FolioEntries.Add(candidate);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            dbContext.Entry(candidate).State = EntityState.Detached;
            throw;
        }

        return new FolioPostingResult(FolioPostingStatus.Posted, candidate, null);
    }

    private static FolioPostingResult Refused(FolioPostingStatus status, string error) => new(status, null, error);
}
