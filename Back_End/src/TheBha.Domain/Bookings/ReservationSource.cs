namespace TheBha.Domain.Bookings;

/// <summary>How a Reservation came to exist (BHA-CHECKOUT-001-PR01). Persisted as text; <c>CK_Reservations_Source</c> couples it to <see cref="Reservation.SourceHoldId"/>.</summary>
public enum ReservationSource
{
    /// <summary>Confirmed from an <see cref="InventoryHold"/>; the only value any row had before PR01, hence the database default.</summary>
    Hold,

    /// <summary>Created without a Hold.</summary>
    Direct
}
