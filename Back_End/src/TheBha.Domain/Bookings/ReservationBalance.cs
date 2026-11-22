using TheBha.Domain.Common;

namespace TheBha.Domain.Bookings;

public enum LedgerState
{
    /// <summary>The Reservation has no <see cref="FolioEntryKind.RoomCharge"/>, so nothing is known about what it owes or has paid (money may have been taken outside the system). No amount is offered.</summary>
    NotRecorded,

    /// <summary>A RoomCharge exists: the amounts below are meaningful.</summary>
    Recorded
}

/// <summary>
/// The one balance of a Reservation, derived from its folio entries and never stored (S1 §2.3). Every consumer (Hold- or Direct-sourced alike) goes through <see cref="From"/>; nothing sums entries by hand and
/// <see cref="Reservation.TotalAmount"/> is never used. When <see cref="State"/> is <see cref="LedgerState.NotRecorded"/> every amount is <c>null</c>: there is no "paid", "unpaid" or balance to show.
/// </summary>
/// <param name="ReceivableAmount">R = Σ RoomCharge − Σ RoomChargeReversal.</param>
/// <param name="CollectedAmount">C = Σ Payment − Σ Refund.</param>
/// <param name="BalanceDueAmount">B = R − C. Negative means the guest has paid more than is owed.</param>
/// <param name="GatewayFeeAmount">F = Σ GatewayFee, kept apart: it is not part of B (reconciliation looks at C − F).</param>
public sealed record ReservationBalance(
    LedgerState State,
    long? ReceivableAmount,
    long? CollectedAmount,
    long? BalanceDueAmount,
    long? GatewayFeeAmount)
{
    public static ReservationBalance NotRecorded { get; } = new(LedgerState.NotRecorded, null, null, null, null);

    public bool IsOverpaid => BalanceDueAmount < 0;

    /// <summary>
    /// Sums are taken in 128 bits, so adding entries cannot wrap. If a result still does not fit a 64-bit amount the call throws <see cref="DomainException"/> instead of returning a wrong number
    /// (each entry is at most <see cref="long.MaxValue"/>; only an implausible total of many such entries gets there).
    /// </summary>
    public static ReservationBalance From(IEnumerable<FolioEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        Int128 charges = 0, reversals = 0, payments = 0, refunds = 0, fees = 0;
        var hasCharge = false;
        foreach (var entry in entries)
        {
            switch (entry.Kind)
            {
                case FolioEntryKind.RoomCharge: charges += entry.Amount; hasCharge = true; break;
                case FolioEntryKind.RoomChargeReversal: reversals += entry.Amount; break;
                case FolioEntryKind.Payment: payments += entry.Amount; break;
                case FolioEntryKind.Refund: refunds += entry.Amount; break;
                case FolioEntryKind.GatewayFee: fees += entry.Amount; break;
                default: throw new DomainException("kind is invalid.");
            }
        }

        if (!hasCharge)
        {
            return NotRecorded;
        }

        var receivable = charges - reversals;
        var collected = payments - refunds;
        return new ReservationBalance(
            LedgerState.Recorded, Narrow(receivable), Narrow(collected), Narrow(receivable - collected), Narrow(fees));
    }

    private static long Narrow(Int128 value) =>
        value >= long.MinValue && value <= long.MaxValue
            ? (long)value
            : throw new DomainException("The folio total is outside the supported range.");
}
