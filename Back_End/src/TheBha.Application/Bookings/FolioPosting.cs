using TheBha.Domain.Bookings;

namespace TheBha.Application.Bookings;

/// <summary>
/// One posting to a Reservation's folio. <see cref="Amount"/> is a decimal only because that is the type prices have; it must be a positive whole number of VND and is rejected, never rounded, otherwise
/// (a malformed request throws <see cref="TheBha.Domain.Common.DomainException"/> before anything is read or written). <see cref="OccurredAtUtc"/> is business time stated by the caller and takes part in the
/// replay comparison, so a caller that retries must send the same value (a charge made at confirmation uses the Reservation's own ConfirmedAtUtc, not "now").
/// </summary>
public sealed record FolioPostingRequest(
    Guid PropertyId,
    Guid ReservationId,
    FolioEntryKind Kind,
    decimal Amount,
    string CurrencyCode,
    string PostingKey,
    Guid? ReferenceEntryId,
    FolioActor Actor,
    string? Reason,
    DateTimeOffset OccurredAtUtc);

public enum FolioPostingStatus
{
    /// <summary>A new entry was appended.</summary>
    Posted,

    /// <summary>The same key with the same business payload had already been posted; the stored entry is returned and nothing was written.</summary>
    Replayed,

    /// <summary>The key exists with a different business payload; the stored entry is unchanged.</summary>
    Conflict,

    /// <summary>No Reservation with this id exists in this Property.</summary>
    ReservationNotFound,

    /// <summary>The Reservation is not in VND (legacy data); it has no ledger and gets none.</summary>
    ReservationNotVnd,

    /// <summary>The referenced entry does not exist in this Reservation, or is not of the kind the posting needs (Reversal → RoomCharge; Refund and GatewayFee → Payment).</summary>
    InvalidReference,

    /// <summary>Refunds of one Payment, or reversals of one RoomCharge, would exceed the amount they reduce.</summary>
    QuotaExceeded
}

public sealed record FolioPostingResult(FolioPostingStatus Status, FolioEntry? Entry, string? Error)
{
    public bool Succeeded => Status is FolioPostingStatus.Posted or FolioPostingStatus.Replayed;
}

/// <summary>
/// The only writer of the folio (BHA-CHECKOUT-001-PR02). Every entry of a Reservation goes through it, because it serializes them with the per-reservation advisory lock
/// <c>BookingAdvisoryLockKeys.ForReservationFolio</c>, which is what keeps "refunds ≤ payment" and "reversals ≤ charge" true under concurrency (the unique PostingKey index is the last guard against duplicates, not
/// against quotas). Under that lock it replays, then validates the reference, then checks the quota, then appends.
/// <para>
/// <b>Transaction contract (for PR 05 and any later caller).</b> The writer runs on the caller's own <c>TheBhaDbContext</c>. If the context has an explicit transaction, the writer joins it: it never commits,
/// rolls back or disposes it, the advisory lock (transaction-scoped) lasts until the caller's commit or rollback, and a rolled-back caller leaves no entry. The transaction must be READ COMMITTED (the default) so the
/// replay and quota reads, taken after the lock, see what the previous lock holder committed; any other level is refused. Without an explicit transaction the writer opens and commits its own.
/// The writer calls <c>SaveChanges</c> itself (so a second posting in the same transaction sees the first), which also flushes anything else the caller has pending on that context: a caller that creates a
/// Reservation and its RoomCharge in one transaction adds the Reservation, then posts. The Reservation row is what the writer looks up, so it must be saved before it is called.
/// </para>
/// <para>
/// <b>Lock order.</b> The folio lock is a leaf: it is taken after any Reservation, ReservationUnit, RoomType or inventory lock a caller needs, and no booking lock is ever taken after it. The writer itself takes no
/// inventory lock.
/// </para>
/// </summary>
public interface IFolioPosting
{
    Task<FolioPostingResult> PostAsync(FolioPostingRequest request, CancellationToken cancellationToken);
}

public enum FolioBalanceStatus
{
    Found,

    /// <summary>No Reservation with this id exists in this Property (also the answer for a Reservation of another Property).</summary>
    ReservationNotFound
}

public sealed record FolioBalanceResult(FolioBalanceStatus Status, ReservationBalance? Balance);

/// <summary>Internal read of a Reservation's balance, scoped by (PropertyId, ReservationId). It exposes no HTTP shape; a Reservation that has no RoomCharge is <see cref="LedgerState.NotRecorded"/>, which is not "not found".</summary>
public interface IFolioReader
{
    Task<FolioBalanceResult> GetBalanceAsync(Guid propertyId, Guid reservationId, CancellationToken cancellationToken);
}
