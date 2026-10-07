namespace TheBha.Domain.Bookings;

/// <summary>
/// One room, one stay date: the accepted RatePlan and money for a single
/// InventoryHoldItem/ReservationUnit night. Quantity is always implicit 1 —
/// no Rooms/NightTotal multiplier exists at this level (ADR 0005 item 1).
/// </summary>
public sealed record NightlyCommitmentSnapshot(
    DateOnly StayDate,
    Guid RatePlanId,
    decimal UnitAmount);
