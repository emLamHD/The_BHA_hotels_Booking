namespace TheBha.Domain.Bookings;

/// <summary>
/// One room, one stay date: the accepted RatePlan and money for a single
/// InventoryHoldItem/ReservationUnit night. Quantity is always implicit 1 —
/// no Rooms/NightTotal multiplier exists at this level (ADR 0005 item 1).
/// </summary>
/// <remarks>
/// <see cref="UnitAmount"/> is what the guest pays for the night. <see cref="ListUnitAmount"/> is the rate before a promotion
/// (<c>null</c> means no promotion: the list amount is the unit amount); the difference is the discount.
/// </remarks>
public sealed record NightlyCommitmentSnapshot(
    DateOnly StayDate,
    Guid RatePlanId,
    decimal UnitAmount,
    decimal? ListUnitAmount = null);
